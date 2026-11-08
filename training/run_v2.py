"""BF16 frozen-base LoRA; selection uses development data only, never holdout."""
import argparse
import hashlib
import importlib.metadata
import json
import os
import time
from pathlib import Path
from run_pilot import BASE,REVISION,read,write
from v2_metrics import evaluate_answer,summarize,paired_gate


def evaluate(model,tokenizer,rows,out):
    import torch
    model.eval(); predictions=[]; start=time.time()
    for row in rows:
        text=tokenizer.apply_chat_template(row['prompt'],tokenize=False,add_generation_prompt=True,enable_thinking=False)
        inputs=tokenizer(text,add_special_tokens=False,return_tensors='pt').to('cuda')
        limit=32 if row['task']=='general' else 384
        if inputs['input_ids'].shape[1]+limit>2048:raise RuntimeError('Evaluation exceeds context budget')
        with torch.inference_mode():
            result=model.generate(**inputs,max_new_tokens=limit,do_sample=False,pad_token_id=tokenizer.pad_token_id)
        tokens=result[0,inputs['input_ids'].shape[1]:]
        answer=tokenizer.decode(tokens,skip_special_tokens=True)
        predictions.append({'id':row['id'],'task':row['task'],'category':row.get('category'),
            'output':answer,'hit_token_limit':len(tokens)>=limit,**evaluate_answer(answer,row)})
    report={'summary':summarize(predictions),'seconds':time.time()-start,'predictions':predictions}
    write(out,report);print(out.name,json.dumps(report['summary']),flush=True)
    return report


def load_model():
    import torch
    from transformers import AutoModelForMultimodalLM
    return AutoModelForMultimodalLM.from_pretrained(BASE,revision=REVISION,dtype=torch.bfloat16,
        device_map={'':0},attn_implementation={'text_config':'sdpa','vision_config':'sdpa','audio_config':'eager'})


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--data',type=Path,required=True)
    p.add_argument('--out',type=Path,required=True)
    p.add_argument('--token-file',type=Path,required=True)
    a=p.parse_args();a.out.mkdir(parents=True,exist_ok=False)
    os.environ['HF_TOKEN']=a.token_file.read_text().strip()
    os.environ['TOKENIZERS_PARALLELISM']='false'
    import torch
    from transformers import AutoTokenizer,Trainer,TrainingArguments,TrainerCallback,set_seed
    from peft import LoraConfig,get_peft_model
    from datasets import Dataset
    set_seed(20261108)
    tok=AutoTokenizer.from_pretrained(BASE,revision=REVISION)
    if tok.pad_token_id is None:tok.pad_token=tok.eos_token
    rows=read(a.data/'train.jsonl');dev=read(a.data/'validation.jsonl')
    encoded=[]
    for row in rows:
        prefix=tok.apply_chat_template(row['prompt'],tokenize=False,add_generation_prompt=True,enable_thinking=False)
        full=tok.apply_chat_template(row['prompt']+row['completion'],tokenize=False,enable_thinking=False)
        if not full.startswith(prefix):raise RuntimeError('Completion prefix mismatch')
        ids=tok(full,add_special_tokens=False)['input_ids'];pids=tok(prefix,add_special_tokens=False)['input_ids']
        if ids[:len(pids)]!=pids or len(ids)>2048:raise RuntimeError('Token boundary/length failure')
        labels=[-100]*len(pids)+ids[len(pids):]
        if all(x==-100 for x in labels):raise RuntimeError('Empty labels')
        encoded.append({'input_ids':ids,'attention_mask':[1]*len(ids),'labels':labels})
    write(a.out/'tokenization.json',{'count':len(encoded),'max_tokens':max(len(x['input_ids']) for x in encoded)})
    model=load_model()
    baseline=evaluate(model,tok,dev,a.out/'baseline-dev.json')
    targets=[name for name,_ in model.named_modules() if 'language_model' in name and name.rsplit('.',1)[-1] in {'q_proj','v_proj'}]
    if not targets:raise RuntimeError('No text attention LoRA targets')
    model=get_peft_model(model,LoraConfig(r=8,lora_alpha=16,lora_dropout=0.05,target_modules=targets,bias='none',task_type='CAUSAL_LM'))
    model.enable_input_require_grads();model.config.use_cache=False
    trainable=[name for name,param in model.named_parameters() if param.requires_grad]
    if not all('lora_' in name for name in trainable):raise RuntimeError('Base parameter unexpectedly trainable')
    write(a.out/'environment.json',{'model':BASE,'revision':REVISION,'precision':'bf16; no training quantization',
        'seed':20261108,'learning_rate':3e-5,'steps':128,'r':8,'alpha':16,'batch':1,'gradient_accumulation':8,
        'targets':targets,'trainable_parameters':sum(p.numel() for p in model.parameters() if p.requires_grad),
        'gpu':torch.cuda.get_device_name(),'cuda':torch.version.cuda,
        'packages':{k:importlib.metadata.version(k) for k in ['torch','transformers','peft','datasets','accelerate']},
        'script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'component_sha256':{name:hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest()
                            for name in ('run_pilot.py','v2_metrics.py','prepare_v2.py')},
        'dataset_sha256':{x.name:hashlib.sha256(x.read_bytes()).hexdigest() for x in a.data.glob('*.jsonl')},
        'selection_rule':'Choose best development correctness among 64/128 passing paired general/schema/critical-fields gates; tie prefer earlier. Holdout never selects.'})
    reports=[]
    class Checkpoint(TrainerCallback):
        def on_step_end(self,args,state,control,**kwargs):
            if state.global_step not in (64,128):return control
            dest=a.out/f'candidate-{state.global_step:03d}';dest.mkdir()
            model.save_pretrained(dest/'adapter');tok.save_pretrained(dest/'adapter')
            model.gradient_checkpointing_disable();model.config.use_cache=True
            report=evaluate(model,tok,dev,dest/'validation.json')
            gate=paired_gate(baseline['predictions'],report['predictions'])
            write(dest/'gate.json',gate)
            reports.append({'step':state.global_step,'path':str(dest),'summary':report['summary'],'gate':gate})
            model.config.use_cache=False;model.gradient_checkpointing_enable();model.train()
            return control
    def collate(batch):
        length=max(len(x['input_ids']) for x in batch)
        return {k:torch.tensor([x[k]+[pad]*(length-len(x[k])) for x in batch])
                for k,pad in [('input_ids',tok.pad_token_id),('attention_mask',0),('labels',-100)]}
    trainer=Trainer(model=model,train_dataset=Dataset.from_list(encoded),data_collator=collate,callbacks=[Checkpoint()],
        args=TrainingArguments(output_dir=str(a.out/'trainer'),max_steps=128,
            per_device_train_batch_size=1,gradient_accumulation_steps=8,learning_rate=3e-5,
            warmup_steps=8,lr_scheduler_type='cosine',weight_decay=0.01,max_grad_norm=0.5,
            bf16=True,gradient_checkpointing=True,logging_steps=8,save_strategy='no',
            report_to='none',seed=20261108,optim='adamw_torch',remove_unused_columns=False))
    start=time.time();result=trainer.train()
    write(a.out/'train-metrics.json',{**result.metrics,'wall_seconds_including_dev':time.time()-start,
        'peak_gpu_bytes':torch.cuda.max_memory_allocated()})
    eligible=[r for r in reports if r['gate']['eligible']]
    selected=max(eligible,key=lambda r:(r['summary']['interpret']['correct'],-r['step'])) if eligible else None
    # Even if no candidate passes, archive both and diagnose; do not relax the gate.
    write(a.out/'selection.json',{'candidates':reports,'selected':selected,
        'production_accepted':False,'holdout_not_read':True})
    print('V2_TRAINING_COMPLETE',json.dumps({'selected_step':selected['step'] if selected else None}),flush=True)


if __name__=='__main__':main()
