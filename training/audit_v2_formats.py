"""Add a format-only paired audit without overwriting the original trial reports."""
import argparse
import hashlib
import json
from pathlib import Path
from run_pilot import read,write
from v2_metrics import evaluate_answer,summarize,paired_gate


def main():
    p=argparse.ArgumentParser();p.add_argument('--root',type=Path,required=True)
    a=p.parse_args()
    dev={r['id']:r for r in read(Path('training/artifacts/v2/data/validation.jsonl'))}
    test={r['id']:r for path in (Path('training/eval_v2_holdout.jsonl'),
        Path('training/artifacts/v2/retention-benchmark.jsonl'),Path('training/artifacts/combined/test.jsonl')) for r in read(path)}
    def rescore(path,rows):
        predictions=json.loads(path.read_text())['predictions']
        return [{**r,**evaluate_answer(r['output'],rows[r['id']])} for r in predictions]
    result={'reason':'Original general strict field combined correctness and format; this audit separates pure A/B/C/D format, including originally incorrect answers.',
            'original_reports_unchanged':True,'production_accepted':False,'comparisons':{}}
    for name,base_path,tuned_path,rows in [
        ('dev-064',a.root/'baseline-dev.json',a.root/'candidate-064/validation.json',dev),
        ('dev-128',a.root/'baseline-dev.json',a.root/'candidate-128/validation.json',dev),
        ('diagnostic-128',a.root/'diagnostic-128/baseline.json',a.root/'diagnostic-128/tuned.json',test)]:
        b=rescore(base_path,rows);t=rescore(tuned_path,rows)
        result['comparisons'][name]={'baseline':summarize(b),'candidate':summarize(t),'gate':paired_gate(b,t)}
    result['metrics_sha256']=hashlib.sha256(Path(__file__).with_name('v2_metrics.py').read_bytes()).hexdigest()
    write(a.root/'format-audit.json',result)
    print(json.dumps({k:v['gate'] for k,v in result['comparisons'].items()}))


if __name__=='__main__':main()
