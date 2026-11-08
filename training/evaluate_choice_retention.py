"""Supplementary forced-choice likelihood probe; keeps free-generation failures intact."""
import argparse
import hashlib
import json
from pathlib import Path
from run_pilot import BASE,REVISION,read,write
from run_v2 import load_model


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--holdout',type=Path,required=True);p.add_argument('--benchmark',type=Path,required=True)
    p.add_argument('--adapter',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    p.add_argument('--mode',choices=['raw','chat'],default='chat')
    a=p.parse_args()
    if a.out.exists():raise RuntimeError('Refuse to overwrite result')
    import torch
    from transformers import AutoTokenizer,set_seed
    from peft import PeftModel
    set_seed(20261108)
    rows=[r for r in read(a.holdout)+read(a.benchmark) if r['task']=='general']
    tok=AutoTokenizer.from_pretrained(BASE,revision=REVISION)
    model=load_model()
    def evaluate(label):
        model.eval();results=[]
        for row in rows:
            # Based on lm-evaluation-harness MMLU question/choices/Answer: template, zero-shot.
            prompt=(row['prompt'][-1]['content'].strip()+'\nAnswer:') if a.mode=='raw' else tok.apply_chat_template(
                row['prompt'],tokenize=False,add_generation_prompt=True,enable_thinking=False)
            prefix=tok(prompt,add_special_tokens=a.mode=='raw')['input_ids']
            suffixes=[]
            for letter in 'ABCD':
                ids=tok(prompt+(' ' if a.mode=='raw' else '')+letter,add_special_tokens=a.mode=='raw')['input_ids']
                if ids[:len(prefix)]!=prefix:raise RuntimeError('Answer token boundary mismatch')
                suffixes.append(ids[len(prefix):])
            if not all(suffixes):raise RuntimeError('Empty option tokens')
            if len(prefix)+max(map(len,suffixes))>2048:raise RuntimeError('Context limit exceeded')
            with torch.inference_mode():
                if all(len(s)==1 for s in suffixes):
                    ids=torch.tensor([prefix],device='cuda')
                    logits=model(input_ids=ids,attention_mask=torch.ones_like(ids),logits_to_keep=1).logits[0,-1].float()
                    scores=logits.log_softmax(-1)[[s[0] for s in suffixes]].tolist()
                else:
                    scores=[]
                    for suffix in suffixes:
                        ids=torch.tensor([prefix+suffix],device='cuda')
                        logits=model(input_ids=ids,attention_mask=torch.ones_like(ids),logits_to_keep=len(suffix)+1).logits[0].float()
                        logp=logits[-len(suffix)-1:-1].log_softmax(-1)
                        scores.append(sum(logp[i,t].item() for i,t in enumerate(suffix)))
            answer='ABCD'[max(range(4),key=lambda i:scores[i])]
            results.append({'id':row['id'],'category':row['category'],'answer':answer,
                'expected':row['expected'],'correct':answer==row['expected'],'option_log_probabilities':scores})
        summary={}
        for category in ('fresh_general','mmlu_subset'):
            subset=[r for r in results if r['id'].startswith('mmlu-')==(category=='mmlu_subset')]
            summary[category]={'count':len(subset),'correct':sum(r['correct'] for r in subset)}
        print(label,json.dumps(summary),flush=True)
        return {'summary':summary,'predictions':results}
    baseline=evaluate('baseline')
    model=PeftModel.from_pretrained(model,a.adapter)
    candidate=evaluate('candidate')
    b={r['id']:r for r in baseline['predictions']};c={r['id']:r for r in candidate['predictions']}
    lost=[key for key,r in b.items() if r['correct'] and not c[key]['correct']]
    gained=[key for key,r in b.items() if not r['correct'] and c[key]['correct']]
    report={'protocol':('Zero-shot raw question + options + Answer:' if a.mode=='raw' else 'Same non-thinking chat prompt as free generation')+'; compare likelihood of A/B/C/D continuations. Not a full official MMLU score.',
        'mode':a.mode,
        'source_template':'https://github.com/EleutherAI/lm-evaluation-harness/blob/main/lm_eval/tasks/mmlu/default/_default_template_yaml',
        'base_revision':REVISION,'script_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'baseline':baseline,'candidate':candidate,'lost_correct_ids':lost,'gained_correct_ids':gained,
        'no_observed_choice_regression':not lost,'production_accepted':False,
        'scope':'Supplementary diagnostic after free-generation truncation was observed; does not replace failed development or format gates.'}
    write(a.out,report)
    print('CHOICE_RETENTION_COMPLETE',json.dumps({'lost':len(lost),'gained':len(gained)}),flush=True)


if __name__=='__main__':main()
