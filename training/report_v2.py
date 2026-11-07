"""Readable paired breakdown; does not alter scores or select a candidate."""
import argparse
import json
from pathlib import Path
from run_pilot import write


def main():
    p=argparse.ArgumentParser();p.add_argument('--evaluation',type=Path,required=True)
    a=p.parse_args()
    base=json.loads((a.evaluation/'baseline.json').read_text())['predictions']
    tuned=json.loads((a.evaluation/'tuned.json').read_text())['predictions']
    b={r['id']:r for r in base};t={r['id']:r for r in tuned}
    if set(b)!=set(t):raise RuntimeError('Mismatched paired cases')
    def group(r):
        if r['id'].startswith('mmlu-'):return 'mmlu_subset'
        if r.get('category')=='previous_round_regression':return 'previous_regression_'+r['task']
        return 'fresh_'+r['task']
    report={}
    for label in sorted({group(r) for r in base}):
        ids=[key for key,r in b.items() if group(r)==label]
        report[label]={'count':len(ids),'baseline_correct':sum(bool(b[k]['correct']) for k in ids),
            'candidate_correct':sum(bool(t[k]['correct']) for k in ids),
            'baseline_strict':sum(bool(b[k]['strict']) for k in ids),
            'candidate_strict':sum(bool(t[k]['strict']) for k in ids),
            'lost_correct_ids':[k for k in ids if b[k]['correct'] and not t[k]['correct']],
            'gained_correct_ids':[k for k in ids if not b[k]['correct'] and t[k]['correct']]}
    write(a.evaluation/'paired-breakdown.json',report)
    print(json.dumps(report,ensure_ascii=False),flush=True)


if __name__=='__main__':main()
