"""Run synthetic cases through the production Dart prompt/parser and local LiteRT.

Install litert-lm==0.19.1 in an isolated environment. No cloud inference, downloads,
app deployment or repository writes are performed by this evaluator.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import time
import litert_lm


class DeclaredTool(litert_lm.Tool):
    def __init__(self, definition):
        self.definition = {'type': 'function', 'function': definition}

    def get_tool_description(self):
        return self.definition

    def execute(self, _):
        raise RuntimeError('Interpretation tools only return proposals; never execute actions')


def tool_response(response):
    calls = response.to_json().get('tool_calls', [])
    if len(calls) != 1:
        return {'controlText': str(response)} if not calls else {'toolResponse': {'name': 'invalid_response', 'args': {}}}
    function = calls[0].get('function', {})
    return {'toolResponse': {'name': function.get('name', ''), 'args': function.get('arguments', {})}}


def semantic_errors(parsed, expected):
    errors = []
    for key in ('kind', 'choiceId', 'numberValue'):
        if key in expected and parsed.get(key) != expected[key]:
            errors.append(f'{key}: expected {expected[key]!r}, got {parsed.get(key)!r}')
    if 'situationIds' in expected and set(parsed.get('situationIds', [])) != set(expected['situationIds']):
        errors.append('situationIds mismatch')
    facts = parsed.get('facts', [])
    if 'facts' in expected:
        fields = ('field', 'value', 'subject')
        key = lambda f: json.dumps({k: f.get(k) for k in fields}, ensure_ascii=False, sort_keys=True)
        if sorted(map(key, facts)) != sorted(map(key, expected['facts'])):
            errors.append('facts mismatch')
    if any(f.get('field') in expected.get('forbiddenFields', []) for f in facts):
        errors.append('unsupported inferred field')
    return errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', required=True)
    parser.add_argument('--dart', default='dart')
    parser.add_argument('--cases', default='tool/fixtures/llm_acceptance.json')
    parser.add_argument('--report', required=True)
    parser.add_argument('--ids', help='Comma-separated case IDs')
    parser.add_argument('--backend', choices=('cpu', 'gpu'), default='cpu')
    args = parser.parse_args()
    model = Path(args.model)
    digest = hashlib.file_digest(model.open('rb'), 'sha256').hexdigest()
    if digest != '181938105e0eefd105961417e8da75903eacda102c4fce9ce90f50b97139a63c':
        raise ValueError('Model is not the pinned production bundle')
    suite_bytes = Path(args.cases).read_bytes()
    suite = json.loads(suite_bytes)
    cases = [s for s in suite['cases'] if not args.ids or s['id'] in args.ids.split(',')]
    contract = subprocess.Popen([args.dart, 'run', 'tool/llm_contract.dart'], stdin=subprocess.PIPE,
                                stdout=subprocess.PIPE, text=True, encoding='utf-8', bufsize=1)
    def call(command):
        contract.stdin.write(json.dumps(command, ensure_ascii=False) + '\n')
        contract.stdin.flush()
        line = contract.stdout.readline()
        if not line:
            raise RuntimeError('Dart contract process stopped')
        return json.loads(line)
    report = {'modelSha256': digest, 'runtime': 'litert-lm 0.19.1', 'backend': args.backend,
              'caseSha256': hashlib.sha256(suite_bytes).hexdigest(),
              'contractSha256': hashlib.sha256(Path('lib/service/llm_interpretation.dart').read_bytes()).hexdigest(),
              'candidateSha256': hashlib.sha256(Path('lib/service/llm_fact_candidates.dart').read_bytes()).hexdigest(),
              'sampling': {'topK': 1, 'topP': 1, 'temperature': 0, 'seed': 42, 'maxOutputTokens': 768, 'maxTokens': 4096},
              'cases': []}
    litert_lm.set_min_log_severity(litert_lm.LogSeverity.ERROR)
    backend = litert_lm.Backend.CPU(thread_count=4) if args.backend == 'cpu' else litert_lm.Backend.GPU()
    def save():
        report['passed'] = sum(c.get('pass', False) for c in report['cases'])
        report['total'] = len(report['cases'])
        report['byMode'] = {mode: {'passed': sum(c.get('pass', False) for c in report['cases'] if c.get('mode') == mode), 'total': sum(c.get('mode') == mode for c in report['cases'])} for mode in {c.get('mode', 'unknown') for c in report['cases']}}
        Path(args.report).parent.mkdir(parents=True, exist_ok=True)
        Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    try:
        # CPU can run without a persistent weight cache; :memory is not available
        # in every prebuilt GPU runtime. Do not silently change the backend.
        with litert_lm.Engine(str(model), backend=backend, max_num_tokens=4096, cache_dir=':memory') as engine:
            for sample in cases:
                request = {'requestId': sample['id'], 'input': sample['input'],
                           'context': {**suite['context'], **sample.get('context', {})}}
                record = {'id': sample['id'], 'input': sample['input'], 'expected': sample['expect'], 'attempts': []}
                started = time.monotonic()
                for attempt in range(2):
                    prepared = call({'request': request, 'attempt': attempt})
                    if not prepared['ok']:
                        raise RuntimeError(prepared)
                    if prepared.get('direct') is not None:
                        record['mode'] = 'explicit_background'
                        record['parsed'] = prepared['direct']
                        record['errors'] = semantic_errors(prepared['direct'], sample['expect'])
                        record['pass'] = not record['errors']
                        break
                    record['mode'] = 'gemma_tools'
                    instruction = prepared['instruction']
                    payload = json.dumps(prepared['payload'], ensure_ascii=False, separators=(',', ':'))
                    tool_tokens = len(engine.tokenize(json.dumps(prepared['tools'], ensure_ascii=False, separators=(',', ':'))))
                    tokens = len(engine.tokenize(instruction)) + len(engine.tokenize(payload)) + tool_tokens
                    if tokens > 3000:
                        prepared = call({'request': request, 'attempt': attempt, 'minimal': True})
                        payload = json.dumps(prepared['payload'], ensure_ascii=False, separators=(',', ':'))
                        tokens = len(engine.tokenize(instruction)) + len(engine.tokenize(payload)) + tool_tokens
                    if tokens > 3000:
                        record.update({'pass': False, 'errors': ['INPUT_TOO_LONG']})
                        break
                    report['instructionSha256'] = hashlib.sha256(prepared['instruction'].encode()).hexdigest()
                    with engine.create_conversation(system_message=instruction,
                            tools=[DeclaredTool(t) for t in prepared['tools']], automatic_tool_calling=False,
                            constrained_decoding_config=litert_lm.ConstrainedDecodingConfig(enable=True),
                            extra_context={'enable_thinking': False},
                            sampler_config=litert_lm.SamplerConfig(top_k=1, top_p=1, temperature=0, seed=42),
                            max_output_tokens=768) as chat:
                        response = chat.send_message(payload)
                    raw = response.to_json()
                    parsed = call({'request': request, **tool_response(response)})
                    record['attempts'].append({'raw': raw, 'inputTokens': tokens, **parsed})
                    if parsed['ok']:
                        record['errors'] = semantic_errors(parsed['parsed'], sample['expect'])
                        record['pass'] = not record['errors']
                        break
                else:
                    record.update({'pass': False, 'errors': ['production contract rejected both outputs']})
                record['seconds'] = round(time.monotonic() - started, 3)
                report['cases'].append(record)
                save()
                print(f"{sample['id']}: {'PASS' if record['pass'] else 'FAIL'} {record.get('errors')}", flush=True)
    finally:
        contract.stdin.close()
        contract.wait(timeout=10)
        save()
    print(f"{report['passed']}/{report['total']}", flush=True)
    return 0 if report['passed'] == report['total'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
