"""Prepare a reviewed, task-specific pilot. No network, model downloads or GPU use."""
import argparse
import hashlib
import json
from pathlib import Path

from prepare_v2 import SYSTEM


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_rows(path):
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def validate_material(row):
    if not isinstance(row.get('input'), str) or not row['input'].strip():
        raise ValueError('Empty input')
    target = row['target']
    if set(target) != {'situationIds', 'candidateFields', 'uncertain', 'evidence'}:
        raise ValueError('Unexpected target keys')
    for key in ('situationIds', 'uncertain', 'evidence'):
        if not isinstance(target[key], list) or any(type(s) is not str or not s.strip() for s in target[key]):
            raise ValueError(f'Invalid {key}')
        if len(target[key]) != len(set(target[key])):
            raise ValueError(f'Duplicate {key}')
    if not set(target['situationIds']) <= {'living','elder','study','family','health','disability','housing','work'}:
        raise ValueError('Unknown situation')
    fields = target['candidateFields']
    if not isinstance(fields, dict) or not set(fields) <= {'age','region','is_student','household_type'}:
        raise ValueError('Unknown candidate field')
    if 'age' in fields and (type(fields['age']) is not int or not 0 <= fields['age'] <= 120):
        raise ValueError('Invalid age')
    if 'region' in fields and (type(fields['region']) is not str or not fields['region'].strip()):
        raise ValueError('Invalid region')
    if 'is_student' in fields and type(fields['is_student']) is not bool:
        raise ValueError('Invalid student flag')
    if 'household_type' in fields and fields['household_type'] not in {'low_income','mid_low_income','general'}:
        raise ValueError('Invalid household type')
    if any(s not in row['input'] for s in target['evidence']):
        raise ValueError('Evidence not in input')
    if (target['situationIds'] or fields) and not target['evidence']:
        raise ValueError('Missing evidence')
    if not row.get('id') or not row.get('group_id') or not row.get('annotation_reason'):
        raise ValueError('Missing material provenance')


def build(materials, review, dev, replay, out):
    source = read_rows(materials)
    decision = json.loads(review.read_text())
    if decision.get('materials_sha256') != digest(materials):
        raise ValueError('Review does not match the exact material file')
    if decision.get('reviewer_type') not in {'AI', 'human'}:
        raise ValueError('Reviewer type must be explicit')
    if decision.get('purpose') != 'experimental_training_only':
        raise ValueError('Review must explicitly allow this experimental pilot')
    identifiers = [r['id'] for r in source]
    if len(identifiers) != len(set(identifiers)):
        raise ValueError('Duplicate material IDs')
    approved = decision.get('approved_ids', [])
    if len(approved) != len(set(approved)) or not set(approved) <= set(identifiers) or not approved:
        raise ValueError('Missing or invalid reviewed IDs')
    rejected = {r['id'] for r in decision.get('rejected', [])}
    if rejected & set(approved):
        raise ValueError('Approved and rejected IDs conflict')
    rows = []
    for row in source:
        validate_material(row)
        if row['id'] not in approved:
            continue
        rows.append({'id': row['id'], 'group': row['group_id'], 'task': 'interpret',
                     'category': row['category'], 'expected': row['target'],
                     'prompt': [{'role':'system','content':SYSTEM}, {'role':'user','content':row['input']}],
                     'completion':[{'role':'assistant','content':json.dumps(row['target'],ensure_ascii=False)}],
                     'provenance':row['provenance'], 'reviewer_type':decision['reviewer_type']})
    replay_rows = [r for r in read_rows(replay) if r['task'] == 'replay']
    if not replay_rows:
        raise ValueError('No general retention replay')
    # These are the existing deterministic replay exercises, not fresh teacher reasoning traces.
    for row in replay_rows:
        row = dict(row)
        row['id'] = 'v3-replay-' + row['id']
        rows.append(row)
    development = read_rows(dev)
    for row in development:
        if row['task'] == 'interpret':
            row['prompt'][0] = {'role':'system','content':SYSTEM}
    ids = [r['id'] for r in rows + development]
    if len(ids) != len(set(ids)):
        raise ValueError('Train/dev ID collision')
    train_inputs = {r['prompt'][-1]['content'].strip() for r in rows}
    dev_inputs = {r['prompt'][-1]['content'].strip() for r in development}
    if train_inputs & dev_inputs:
        raise ValueError('Train/dev exact input overlap')
    if len(train_inputs) != len(rows):
        raise ValueError('Duplicate training inputs')
    out.mkdir(parents=True, exist_ok=False)
    for name, items in [('train', rows), ('validation', development)]:
        (out / f'{name}.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in items))
    report = {'materials':len(source), 'approved_needs':len(approved), 'replay':len(replay_rows),
              'development':len(development), 'reviewer_type':decision['reviewer_type'],
              'production_accepted':False, 'holdout_read':False,
              'sources_sha256':{str(p):digest(p) for p in (materials,review,dev,replay)},
              'outputs_sha256':{p.name:digest(p) for p in out.glob('*.jsonl')},
              'limitations':['Synthetic AI-authored cases; no human acceptance implied.',
                            'Substring checks do not prove semantic support.',
                            'No exact overlap does not exclude semantic family overlap.',
                            'This dataset alone cannot establish broad capability retention.']}
    (out/'data-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2))
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--materials',type=Path,default=Path('training/v3_teaching.jsonl'))
    parser.add_argument('--review',type=Path,required=True)
    parser.add_argument('--dev',type=Path,default=Path('training/v3_eval_dev.jsonl'))
    parser.add_argument('--replay',type=Path,default=Path('training/artifacts/v2/data/train.jsonl'))
    parser.add_argument('--out',type=Path,default=Path('training/artifacts/v3/data'))
    args = parser.parse_args()
    print(json.dumps(build(args.materials,args.review,args.dev,args.replay,args.out),ensure_ascii=False,indent=2))
