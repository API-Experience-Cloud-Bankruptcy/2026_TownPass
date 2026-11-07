"""Paired final evaluation of a frozen V3 adapter; never selects or edits weights."""
import argparse
import hashlib
import json
from pathlib import Path

from run_pilot import BASE, REVISION, read
from run_v2 import load_model
from run_v3 import evaluate, write
from v3_metrics import paired_gate


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--holdout', type=Path, required=True)
    p.add_argument('--benchmark', type=Path)
    p.add_argument('--regression', type=Path)
    p.add_argument('--adapter', type=Path, required=True)
    p.add_argument('--selection', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    p.add_argument('--diagnostic-only', action='store_true')
    a = p.parse_args()
    selection = json.loads(a.selection.read_text())
    if selection.get('status') != 'complete':
        raise RuntimeError('Training must complete before final evaluation')
    chosen = selection.get('selected')
    if not a.diagnostic_only:
        if (not chosen or not chosen.get('gate', {}).get('eligible') or chosen.get('status') != 'evaluated'
                or (Path(chosen['path'])/'adapter').resolve() != a.adapter.resolve()):
            raise RuntimeError('Adapter is not the frozen development-selected candidate')
    else:
        chosen = next((c for c in selection.get('candidates', [])
                       if (Path(c['path'])/'adapter').resolve() == a.adapter.resolve()
                       and c.get('status') == 'evaluated'), None)
        if not chosen:
            raise RuntimeError('Diagnostic adapter is absent from evaluated experiment record')
    for name in ('adapter_model.safetensors','adapter_config.json'):
        if hashlib.sha256((a.adapter/name).read_bytes()).hexdigest() != chosen.get('artifact_sha256',{}).get(name):
            raise RuntimeError('Adapter bytes changed since development evaluation: '+name)
    environment = json.loads((a.selection.parent/'environment.json').read_text())
    dev_path = Path(environment['settings']['data'])/'validation.jsonl'
    if hashlib.sha256(dev_path.read_bytes()).hexdigest() != environment['dataset_sha256']['validation.jsonl']:
        raise RuntimeError('Development prompt source changed since training')
    systems = {r['prompt'][0]['content'] for r in read(dev_path) if r['task']=='interpret'}
    if len(systems) != 1:
        raise RuntimeError('Expected one frozen interpretation system prompt')
    system = systems.pop()
    a.out.mkdir(parents=True, exist_ok=False)
    rows = read(a.holdout)
    for path in (a.benchmark, a.regression):
        if path:
            rows += read(path)
    if len({r['id'] for r in rows}) != len(rows):
        raise ValueError('Duplicate evaluation IDs')
    for row in rows:
        if row['task'] == 'interpret':
            row['prompt'][0] = {'role':'system','content':system}
    write(a.out/'provenance.json', {
        'base':BASE, 'revision':REVISION,
        'evaluator_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'metrics_sha256':hashlib.sha256(Path(__file__).with_name('v3_metrics.py').read_bytes()).hexdigest(),
        'input_sha256':{str(path):hashlib.sha256(path.read_bytes()).hexdigest()
                        for path in (a.holdout,a.benchmark,a.regression,a.selection) if path},
        'adapter_sha256':hashlib.sha256((a.adapter/'adapter_model.safetensors').read_bytes()).hexdigest(),
        'system_prompt_sha256':hashlib.sha256(system.encode()).hexdigest(),
        'diagnostic_only':a.diagnostic_only, 'production_accepted':False})
    from transformers import AutoTokenizer, set_seed
    from peft import PeftModel
    set_seed(20261109)
    tokenizer = AutoTokenizer.from_pretrained(BASE, revision=REVISION)
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token
    model = load_model()
    # Source extraction may legitimately require more than the needs budget.
    # Keep prior 384-token regression allowance for BOTH models.
    def run(label):
        reports = []
        for name, subset, limit in [('needs-general',[r for r in rows if r['task'] in {'interpret','general','replay'}],256),
                                    ('source',[r for r in rows if r['task'] not in {'interpret','general','replay'}],384)]:
            if subset:
                reports.append(evaluate(model,tokenizer,subset,a.out/f'{label}-{name}.json',needs_tokens=limit))
        return [r for report in reports for r in report['predictions']]
    baseline = run('baseline')
    model = PeftModel.from_pretrained(model,a.adapter)
    candidate = run('candidate')
    gate = paired_gate(baseline,candidate)
    gate.update(diagnostic_only=a.diagnostic_only,production_accepted=False,
                pending=['Semantic review of output evidence and uncertainty',
                         'Quantized runtime and physical phone acceptance'])
    write(a.out/'gate.json',gate)
    print('V3_FINAL_EVALUATION_COMPLETE',json.dumps(gate),flush=True)


if __name__ == '__main__':
    main()
