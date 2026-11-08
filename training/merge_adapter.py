"""Merge only the adapter produced by this pinned-base trial, on cloud CPU RAM."""
import argparse
import json
import os
from pathlib import Path
from run_pilot import BASE, REVISION


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--adapter',type=Path,required=True)
    p.add_argument('--out',type=Path,required=True)
    a=p.parse_args()
    if a.out.exists(): raise RuntimeError('Do not overwrite an existing merged model')
    import torch
    from transformers import AutoModelForMultimodalLM, AutoProcessor
    from peft import PeftModel
    config=json.loads((a.adapter/'adapter_config.json').read_text())
    if config['base_model_name_or_path'] != BASE: raise RuntimeError('Unexpected base model')
    base=AutoModelForMultimodalLM.from_pretrained(BASE,revision=REVISION,
             dtype=torch.bfloat16,device_map='cpu',low_cpu_mem_usage=True)
    model=PeftModel.from_pretrained(base,a.adapter).merge_and_unload(safe_merge=True)
    model.save_pretrained(a.out,safe_serialization=True,max_shard_size='2GB')
    AutoProcessor.from_pretrained(BASE,revision=REVISION).save_pretrained(a.out)
    print('MERGED',str(a.out),flush=True)


if __name__ == '__main__':main()
