"""Separate strict output-contract compliance from fenced-JSON content quality."""
import argparse
import json
import re
from pathlib import Path
from run_pilot import read, score, write


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--data', type=Path, required=True)
    p.add_argument('--run', type=Path, required=True)
    p.add_argument('--heldout', action='store_true')
    a = p.parse_args()
    rows = {r['id']: r for r in read(a.data)}
    report = {'scope': 'Secondary content diagnostic only; strict JSON metrics remain unchanged.'}
    heldout = json.loads((a.run / 'heldout.json').read_text()) if a.heldout else None
    for label in ('baseline', 'tuned'):
        original = heldout[label] if heldout else json.loads((a.run / (label + '.json')).read_text())
        results = []
        for item in original['predictions']:
            output = item['output'].strip()
            match = re.fullmatch(r'```(?:json)?\s*\n(.*?)\n```', output, re.DOTALL)
            normalized = match.group(1) if match else output
            results.append({'id': item['id'], 'task': item['task'],
                            'fence_removed': bool(match), **score(normalized, rows[item['id']])})
        def metrics(items):
            return {'count': len(items), **{k: sum(bool(r.get(k)) for r in items)/len(items)
                    for k in ('json_valid', 'schema_valid', 'exact', 'source_correct')}}
        summary = metrics(results)
        for task in sorted({r['task'] for r in results}):
            items = [r for r in results if r['task'] == task]
            summary[task] = metrics(items)
            if task == 'interpret':
                summary[task].update({k: sum(bool(r.get(k)) for r in items)/len(items)
                                     for k in ('tags_exact', 'fields_exact')})
        report[label] = {'summary': summary, 'predictions': results}
    write(a.run / ('heldout-content-diagnostic.json' if a.heldout else 'content-diagnostic.json'), report)
    print(json.dumps({k: v['summary'] for k, v in report.items() if isinstance(v, dict)}))


if __name__ == '__main__':
    main()
