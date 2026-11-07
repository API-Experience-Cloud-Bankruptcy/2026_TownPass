"""Pinned, stratified MMLU subset for paired regression checks, never training."""
import hashlib
import json
import random
from pathlib import Path

REPO='cais/mmlu'
REVISION='c30699e8356da336a370243923dbaf21066bb9fe'
SUBJECTS=['abstract_algebra','high_school_mathematics','formal_logic','high_school_computer_science',
          'high_school_physics','high_school_biology','world_religions','high_school_world_history']


def main():
    from huggingface_hub import hf_hub_download
    import pyarrow.parquet as pq
    path=hf_hub_download(REPO,'all/test-00000-of-00001.parquet',repo_type='dataset',revision=REVISION)
    records=pq.read_table(path).to_pylist()
    rows=[];rng=random.Random(20261108)
    for subject in SUBJECTS:
        candidates=[(i,r) for i,r in enumerate(records) if r['subject']==subject]
        if len(candidates)<8:raise RuntimeError('Missing expected benchmark subject: '+subject)
        for index,r in rng.sample(candidates,8):
            text=r['question']+'\n'+'\n'.join(f'{letter}. {value}' for letter,value in zip('ABCD',r['choices']))
            rows.append({'id':f'mmlu-{subject}-{index}','task':'general','category':'mmlu_'+subject,
                'prompt':[{'role':'system','content':'Choose the single best answer. Reply with only A, B, C, or D.'},
                          {'role':'user','content':text}], 'expected':'ABCD'[r['answer']]})
    out=Path('data');out.mkdir(exist_ok=True)
    dest=out/'retention-benchmark.jsonl'
    dest.write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in rows))
    report={'source':REPO,'revision':REVISION,'license':'MIT','split':'test','count':len(rows),
        'subjects':SUBJECTS,'seed':20261108,'source_parquet_sha256':hashlib.sha256(Path(path).read_bytes()).hexdigest(),
        'sha256':hashlib.sha256(dest.read_bytes()).hexdigest(),
        'scope':'Small stratified zero-shot subset; not an official full MMLU score; may occur in base pretraining.'}
    (out/'retention-benchmark-manifest.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report),flush=True)


if __name__=='__main__':main()
