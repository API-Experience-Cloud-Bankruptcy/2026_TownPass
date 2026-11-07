"""One-time held-out comparison. Never trains or chooses hyperparameters."""
import argparse
import hashlib
import json
import os
import time
from pathlib import Path
from run_pilot import BASE, REVISION, read, score, write


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--data',type=Path,required=True)
    p.add_argument('--adapter',type=Path,required=True)
    p.add_argument('--out',type=Path,required=True)
    a=p.parse_args()
    if a.out.exists(): raise RuntimeError('Refusing to overwrite a held-out result')
    import torch
    from transformers import AutoTokenizer,AutoModelForMultimodalLM,BitsAndBytesConfig,set_seed
    from peft import PeftModel
    set_seed(20261107)
    tokenizer=AutoTokenizer.from_pretrained(BASE,revision=REVISION)
    quant=BitsAndBytesConfig(load_in_4bit=True,bnb_4bit_quant_type='nf4',bnb_4bit_use_double_quant=True,
                            bnb_4bit_compute_dtype=torch.bfloat16)
    model=AutoModelForMultimodalLM.from_pretrained(BASE,revision=REVISION,quantization_config=quant,
                    device_map={'':0},dtype=torch.bfloat16,attn_implementation={'text_config': 'sdpa', 'vision_config': 'sdpa', 'audio_config': 'eager'})
    rows=read(a.data)
    def evaluate(label):
        model.eval(); results=[]; start=time.time()
        for row in rows:
            prompt=tokenizer.apply_chat_template(row['prompt'],tokenize=False,add_generation_prompt=True,enable_thinking=False)
            inputs=tokenizer(prompt,return_tensors='pt',add_special_tokens=False).to('cuda')
            if inputs['input_ids'].shape[1]+384>2048: raise RuntimeError('Holdout exceeds mobile context budget')
            with torch.inference_mode():
                output=model.generate(**inputs,max_new_tokens=384,do_sample=False,pad_token_id=tokenizer.pad_token_id)
            generated=output[0,inputs['input_ids'].shape[1]:]
            answer=tokenizer.decode(generated,skip_special_tokens=True)
            results.append({'id':row['id'],'task':row['task'],'output':answer,'hit_token_limit':len(generated)>=384,
                            **score(answer,row)})
        def metrics(items):
            return {k:sum(bool(r.get(k)) for r in items)/len(items) for k in ('json_valid','schema_valid','exact','source_correct')}
        summary={'count':len(results),'seconds':time.time()-start,**metrics(results)}
        for task in sorted({r['task'] for r in results}):
            items=[r for r in results if r['task']==task]
            summary[task]={'count':len(items),**metrics(items)}
            if task=='interpret':
                summary[task].update({k:sum(bool(r.get(k)) for r in items)/len(items) for k in ('tags_exact','fields_exact')})
        print(label,json.dumps(summary),flush=True)
        return {'summary':summary,'predictions':results}
    report={'dataset_sha256':hashlib.sha256(a.data.read_bytes()).hexdigest(),'model_revision':REVISION,
            'baseline':evaluate('baseline')}
    model=PeftModel.from_pretrained(model,a.adapter)
    report['tuned']=evaluate('tuned')
    report['production_accepted']=False
    report['limitations']=['Small synthetic held-out set; independent human and physical-device acceptance still required.']
    write(a.out,report)


if __name__=='__main__':main()
