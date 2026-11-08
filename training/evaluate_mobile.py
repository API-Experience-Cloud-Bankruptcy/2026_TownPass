"""Cloud CPU smoke evaluation of the exported runtime, not physical-phone acceptance."""
import argparse
import json
import time
from pathlib import Path
from run_pilot import read, score, write


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--model', type=Path, required=True)
    p.add_argument('--data', type=Path, required=True)
    p.add_argument('--reference', type=Path, required=True)
    p.add_argument('--out', type=Path, required=True)
    a = p.parse_args()
    if a.out.exists():
        raise RuntimeError('Refusing to overwrite an evaluation')
    import litert_lm
    reference = json.loads(a.reference.read_text())
    ids = {r['id'] for r in reference['predictions']}
    rows = [r for r in read(a.data) if r['id'] in ids]
    if len(rows) != len(ids):
        raise RuntimeError('Reference cases missing from dataset')
    results = []
    started = time.time()
    with litert_lm.Engine(str(a.model), backend=litert_lm.Backend.CPU(thread_count=12),
                          max_num_tokens=2048) as engine:
        for row in rows:
            with engine.create_conversation(
                messages=row['prompt'][:-1],
                thinking_config=litert_lm.ThinkingConfig(enable_thinking=False),
                sampler_config=litert_lm.SamplerConfig(top_k=1, temperature=0.0, seed=20261107),
                max_output_tokens=384,
            ) as conversation:
                answer = str(conversation.send_message(row['prompt'][-1]))
            result = {'id': row['id'], 'task': row['task'], 'output': answer, **score(answer, row)}
            results.append(result)
            print(row['id'], result['schema_valid'], result['exact'], flush=True)
    summary = {k: sum(bool(r.get(k)) for r in results)/len(results)
               for k in ('json_valid', 'schema_valid', 'exact', 'source_correct')}
    write(a.out, {'summary': summary, 'reference_summary': reference['summary'],
                 'seconds': time.time()-started, 'predictions': results,
                 'physical_device_accepted': False,
                 'scope': 'Cloud CPU runtime comparison; quantization and runtime differences combined.'})


if __name__ == '__main__':
    main()
