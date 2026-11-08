import { afterEach, describe, expect, it, vi } from 'vitest';
import { OnDeviceModelAdapter, ModelInputTooLongError, ModelRequestError } from '../model';
import type { InterpretationContext } from '../../chat/interpretation';

const context: InterpretationContext = { stage: 'home', target: null, choices: [], situations: [], allowedFacts: [] };
const model = new OnDeviceModelAdapter();
type Listener = (event: { data: string }) => void;
function install(reply: (name: string, data: Record<string, unknown>) => Record<string, unknown> | null) {
  const listeners = new Set<Listener>();
  vi.stubGlobal('window', { flutterObject: {
    postMessage(raw: string) {
      const { name, data } = JSON.parse(raw);
      const response = reply(name, data);
      if (response) queueMicrotask(() => listeners.forEach(l => l({ data: JSON.stringify({ name, data: { requestId: data.requestId, ...response } }) })));
    },
    addEventListener(_: string, listener: Listener) { listeners.add(listener); },
    removeEventListener(_: string, listener: Listener) { listeners.delete(listener); },
  } });
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
describe('模型錯誤保留實際原因', () => {
  it.each(['BUSY', 'INVALID_OUTPUT', 'MODEL_UNAVAILABLE', 'FORBIDDEN'])('%s 不被誤報成語意不明', async code => {
    install(() => ({ error: { code, message: '不直接顯示原生任意文字' } }));
    await expect(model.interpret('想找幫忙', context)).rejects.toMatchObject({ name: 'ModelRequestError', code });
  });
  it('輸入過長回專用提示', async () => {
    install(() => ({ error: { code: 'INPUT_TOO_LONG' } }));
    await expect(model.interpret('想找幫忙', context)).rejects.toBeInstanceOf(ModelInputTooLongError);
  });
  it('格式不合法仍拒絕，不能當成合法模型結果', async () => {
    install(() => ({ kind: 'situation', situationIds: ['invented'] }));
    await expect(model.interpret('想找幫忙', context)).rejects.toMatchObject({ code: 'INVALID_OUTPUT' });
  });
  it('逾時與取消分開；取消不產生錯誤復原回覆', async () => {
    vi.useFakeTimers(); install(() => null);
    const pending = model.interpret('想找幫忙', context);
    const assertion = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(180_001); await assertion;
    const abort = new AbortController();
    const cancelled = model.interpret('想找幫忙', context, abort.signal);
    abort.abort(); await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
  });
  it('合法澄清仍是語意結果，不當作引擎失敗', async () => {
    install(() => ({ kind: 'clarify' }));
    await expect(model.interpret('想找幫忙', context)).resolves.toEqual({ kind: 'clarify' });
    expect(new ModelRequestError('BUSY').message).toContain('上一段');
  });
});
