"""Evaluate one fixed candidate versus original BF16 model on untouched tests."""
import argparse
import hashlib
import json
from pathlib import Path
from run_pilot import BASE,REVISION,read,write
from run_v2 import evaluate,load_model
from prepare_v2 import SYSTEM
from v2_metrics import paired_gate


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--holdout',type=Path,required=True)
    p.add_argument('--benchmark',type=Path,required=True)
    p.add_argument('--adapter',type=Path,required=True)
    p.add_argument('--regression',type=Path)
    p.add_argument('--out',type=Path,required=True)
    a=p.parse_args();a.out.mkdir(parents=True,exist_ok=False)
    from transformers import AutoTokenizer,set_seed
    from peft import PeftModel
    set_seed(20261108)
    rows=read(a.holdout)+read(a.benchmark)
    if a.regression:
        rows += [{**r,'category':'previous_round_regression'} for r in read(a.regression)]
    # Identical deployed system prompt for base and candidate; test user inputs/targets remain unchanged.
    for row in rows:
        if row['task']=='interpret':row['prompt'][0]={'role':'system','content':SYSTEM}
    write(a.out/'provenance.json',{'base':BASE,'revision':REVISION,
        'test_sha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (a.holdout,a.benchmark,a.regression) if p},
        'system_prompt_sha256':hashlib.sha256(SYSTEM.encode()).hexdigest(),
        'candidate_adapter_sha256':hashlib.sha256((a.adapter/'adapter_model.safetensors').read_bytes()).hexdigest(),
        'production_accepted':False})
    tok=AutoTokenizer.from_pretrained(BASE,revision=REVISION)
    model=load_model()
    baseline=evaluate(model,tok,rows,a.out/'baseline.json')
    model=PeftModel.from_pretrained(model,a.adapter)
    candidate=evaluate(model,tok,rows,a.out/'tuned.json')
    gate=paired_gate(baseline['predictions'],candidate['predictions'])
    gate['production_accepted']=False
    gate['pending']=['Independent semantic review of evidence and uncertainty','Mobile runtime and physical-device acceptance']
    write(a.out/'gate.json',gate)
    print('HOLDOUT_COMPLETE',json.dumps(gate),flush=True)


if __name__=='__main__':main()
