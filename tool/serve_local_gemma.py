"""Loopback-only development bridge for testing the real web app with Gemma.

The mobile app keeps its native runtime. This server is never included in the
web bundle. Only the specified local test origin may call it. Use synthetic data.
"""
import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import subprocess
import threading
import time
import litert_lm
from evaluate_local_gemma import DeclaredTool, tool_response


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--model', required=True)
    parser.add_argument('--dart', default='dart')
    parser.add_argument('--port', type=int, default=8766)
    parser.add_argument('--origin', default='http://127.0.0.1:5175')
    parser.add_argument('--report', required=True, help='Local synthetic request/output JSONL')
    args = parser.parse_args()
    if args.origin not in ('http://127.0.0.1:5175', 'http://localhost:5175'):
        raise ValueError('Only the isolated loopback test origin is allowed')
    digest = hashlib.file_digest(Path(args.model).open('rb'), 'sha256').hexdigest()
    if digest != '181938105e0eefd105961417e8da75903eacda102c4fce9ce90f50b97139a63c':
        raise ValueError('Not the pinned mobile model bundle')
    contract = subprocess.Popen([args.dart, 'run', 'tool/llm_contract.dart'],
                                stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding='utf-8', bufsize=1)
    def call(value):
        contract.stdin.write(json.dumps(value, ensure_ascii=False) + '\n'); contract.stdin.flush()
        return json.loads(contract.stdout.readline())
    lock = threading.Lock()
    litert_lm.set_min_log_severity(litert_lm.LogSeverity.ERROR)
    engine = litert_lm.Engine(args.model, backend=litert_lm.Backend.CPU(thread_count=4), max_num_tokens=4096, cache_dir=':memory')
    class Handler(BaseHTTPRequestHandler):
        def reply(self, value, status=200):
            body = json.dumps(value, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header('Access-Control-Allow-Origin', args.origin)
            self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
            self.send_header('Access-Control-Allow-Headers', 'Content-Type')
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            try: self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError): pass
        def do_OPTIONS(self):
            self.reply({} if self.headers.get('Origin') == args.origin else {'error': 'forbidden'}, 200 if self.headers.get('Origin') == args.origin else 403)
        def do_POST(self):
            if self.headers.get('Origin') != args.origin:
                self.reply({'error': 'forbidden'}, 403); return
            size = int(self.headers.get('Content-Length', 0))
            if size < 1 or size > 100_000:
                self.reply({'error': 'invalid_request'}, 400); return
            value = json.loads(self.rfile.read(size))
            request_id = value.get('requestId', '')
            if self.path in ('/llm_status', '/llm_prepare'):
                self.reply({'requestId': request_id, 'state': 'ready', 'model': 'Gemma 4 E2B'}); return
            if self.path != '/llm_interpret':
                self.reply({'requestId': request_id, 'error': {'code': 'FORBIDDEN'}}); return
            if not lock.acquire(blocking=False):
                self.reply({'requestId': request_id, 'error': {'code': 'BUSY'}}); return
            record = {'request': value, 'attempts': []}; started = time.monotonic()
            try:
                result = {'requestId': request_id, 'error': {'code': 'INVALID_OUTPUT'}}
                for attempt in range(2):
                    prepared = call({'request': value, 'attempt': attempt})
                    if not prepared['ok']: break
                    if prepared.get('direct') is not None:
                        result = prepared['direct']; break
                    instruction = prepared['instruction']
                    payload = json.dumps(prepared['payload'], ensure_ascii=False, separators=(',', ':'))
                    tool_tokens = len(engine.tokenize(json.dumps(prepared['tools'], ensure_ascii=False, separators=(',', ':'))))
                    if len(engine.tokenize(instruction)) + len(engine.tokenize(payload)) + tool_tokens > 3000:
                        prepared = call({'request': value, 'attempt': attempt, 'minimal': True})
                        payload = json.dumps(prepared['payload'], ensure_ascii=False, separators=(',', ':'))
                    if len(engine.tokenize(instruction)) + len(engine.tokenize(payload)) + tool_tokens > 3000:
                        result['error']['code'] = 'INPUT_TOO_LONG'; break
                    with engine.create_conversation(system_message=instruction, extra_context={'enable_thinking': False},
                            tools=[DeclaredTool(t) for t in prepared['tools']], automatic_tool_calling=False,
                            constrained_decoding_config=litert_lm.ConstrainedDecodingConfig(enable=True),
                            sampler_config=litert_lm.SamplerConfig(top_k=1, top_p=1, temperature=0, seed=42), max_output_tokens=768) as chat:
                        response = chat.send_message(payload)
                    raw = response.to_json()
                    parsed = call({'request': value, **tool_response(response)})
                    record['attempts'].append({'raw': raw, **parsed})
                    if parsed['ok']:
                        result = parsed['parsed']; break
                self.reply(result)
                record.update({'response': result, 'seconds': round(time.monotonic()-started, 3)})
                with Path(args.report).open('a') as out: out.write(json.dumps(record, ensure_ascii=False) + '\n')
            except Exception as error:
                self.reply({'requestId': request_id, 'error': {'code': 'MODEL_UNAVAILABLE'}})
                print(type(error).__name__, str(error), flush=True)
            finally: lock.release()
        def log_message(self, *_): pass
    print(f'READY {args.origin} -> http://127.0.0.1:{args.port} (local CPU)', flush=True)
    try: ThreadingHTTPServer(('127.0.0.1', args.port), Handler).serve_forever()
    finally:
        engine.close(); contract.stdin.close(); contract.wait(timeout=10)


if __name__ == '__main__': main()
