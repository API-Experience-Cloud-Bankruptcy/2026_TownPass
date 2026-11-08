"""Combine the two pilot tasks without re-splitting or duplicating holdouts."""
import argparse
import hashlib
import json
from pathlib import Path


def combine(policy, needs, out):
    out.mkdir(parents=True, exist_ok=True)
    counts = {}
    for split in ('train', 'validation', 'test'):
        rows = []
        for source in (policy, needs):
            rows.extend(json.loads(x) for x in (source / f'{split}.jsonl').read_text().splitlines())
        ids = [r['id'] for r in rows]
        if len(ids) != len(set(ids)): raise ValueError('Duplicate example IDs')
        (out / f'{split}.jsonl').write_text(''.join(json.dumps(r, ensure_ascii=False)+'\n' for r in rows))
        counts[split] = len(rows)
    report = {'examples': counts, 'parts': [json.loads((p/'data-report.json').read_text()) for p in (policy, needs)],
              'generator_sha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'production_accepted': False}
    (out/'data-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n')
    return report


if __name__ == '__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--policy',type=Path,default=Path('training/artifacts/data'))
    p.add_argument('--needs',type=Path,default=Path('training/artifacts/needs'))
    p.add_argument('--out',type=Path,default=Path('training/artifacts/combined'))
    a=p.parse_args();print(combine(a.policy,a.needs,a.out)['examples'])
