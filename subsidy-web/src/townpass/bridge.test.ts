import { afterEach, describe, expect, it, vi } from 'vitest';
import { isInTownPass, parseMessage, request, requestCorrelated, send, TownPassError } from './bridge';

type Listener = (event: { data: unknown }) => void;

/** 模擬 App 注入的 flutterObject；reply 決定 App 收到訊息後回什麼。 */
function installFlutterObject(reply?: (name: string, data: unknown) => unknown) {
  const listeners = new Set<Listener>();
  const posted: string[] = [];
  const flutterObject = {
    postMessage(message: string) {
      posted.push(message);
      if (!reply) return;
      const { name, data } = JSON.parse(message);
      const answer = reply(name, data);
      queueMicrotask(() =>
        listeners.forEach((l) => l({ data: JSON.stringify({ name, data: answer }) })),
      );
    },
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
  };
  vi.stubGlobal('window', { flutterObject });
  return { posted, listeners };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('parseMessage', () => {
  it('解析 App 傳來的 JSON 字串', () => {
    expect(parseMessage('{"name":"location","data":{"latitude":25}}')).toEqual({
      name: 'location',
      data: { latitude: 25 },
    });
  });

  it('接受已是物件的訊息', () => {
    expect(parseMessage({ name: 'userinfo', data: [] })).toEqual({ name: 'userinfo', data: [] });
  });

  it('格式不符時回傳 null', () => {
    expect(parseMessage('不是 JSON')).toBeNull();
    expect(parseMessage('{"data":1}')).toBeNull();
    expect(parseMessage(null)).toBeNull();
  });
});

describe('在 App 內', () => {
  it('偵測到 flutterObject', () => {
    installFlutterObject();
    expect(isInTownPass()).toBe(true);
  });

  it('send 以 { name, data } JSON 字串送出', () => {
    const { posted } = installFlutterObject();
    send('notify', { title: 't', content: 'c' });
    expect(posted).toEqual(['{"name":"notify","data":{"title":"t","content":"c"}}']);
  });

  it('request 取得同名回覆並移除監聽', async () => {
    const { listeners } = installFlutterObject((name) => (name === 'phone_call' ? true : null));
    await expect(request<boolean>('phone_call', '1999')).resolves.toBe(true);
    expect(listeners.size).toBe(0);
  });

  it('忽略其他 name 的回覆，逾時後拒絕', async () => {
    vi.useFakeTimers();
    const { listeners } = installFlutterObject();
    const pending = request('location', null, { timeoutMs: 1000 });
    listeners.forEach((l) => l({ data: JSON.stringify({ name: 'userinfo', data: {} }) }));
    vi.advanceTimersByTime(1000);
    await expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(listeners.size).toBe(0);
  });
});

describe('在一般瀏覽器', () => {
  it('request 改用模擬資料', async () => {
    vi.stubGlobal('window', {});
    expect(isInTownPass()).toBe(false);
    const account = await request<{ realName: string }>('userinfo');
    expect(account.realName).toBe('陳福利（虛擬）');
  });

  it('沒有模擬資料時以 NOT_IN_APP 拒絕', async () => {
    vi.stubGlobal('window', {});
    await expect(request('unknown_handler')).rejects.toBeInstanceOf(TownPassError);
  });
});

describe('PDF 原生交付', () => {
  const bytes = new TextEncoder().encode('%PDF-1.7\n%%EOF\n');

  it('傳送原始 PDF base64 與檔名，回傳分享介面狀態', async () => {
    const { sharePdf } = await import('./index');
    const { posted } = installFlutterObject(() => ({ status: 'presented' }));
    await expect(sharePdf(bytes, '行動單.pdf')).resolves.toEqual({ status: 'presented' });
    const message = JSON.parse(posted[0]!);
    expect(message.name).toBe('share_pdf');
    expect(message.data).toEqual({
      base64: btoa(new TextDecoder().decode(bytes)), filename: '行動單.pdf', userInitiated: true,
    });
  });

  it('取消或無法分享不回報成功', async () => {
    const { sharePdf } = await import('./index');
    installFlutterObject(() => ({ status: 'cancelled_or_unavailable' }));
    await expect(sharePdf(bytes, '行動單.pdf')).resolves.toEqual({ status: 'cancelled_or_unavailable' });
  });

  it('拒絕超過限制的文件且不送到 App', async () => {
    const { sharePdf } = await import('./index');
    const { posted } = installFlutterObject();
    await expect(sharePdf(new Uint8Array(10 * 1024 * 1024 + 1), '大檔.pdf')).resolves.toEqual({ status: 'failed', reason: 'invalid_pdf' });
    expect(posted).toHaveLength(0);
  });

  it('舊 App 沒有 handler 時逾時，清理監聽並拒絕連點', async () => {
    vi.useFakeTimers();
    const { sharePdf } = await import('./index');
    const { listeners } = installFlutterObject();
    const pending = sharePdf(bytes, '行動單.pdf');
    const rejected = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' });
    await expect(sharePdf(bytes, '行動單.pdf')).resolves.toEqual({ status: 'failed', reason: 'busy' });
    await vi.advanceTimersByTimeAsync(120_000);
    await rejected;
    expect(listeners.size).toBe(0);
  });
});


describe('模型請求關聯與取消', () => {
  it('相同 name 的舊 requestId 不可被新請求採用', async () => {
    const { listeners } = installFlutterObject();
    const abort = new AbortController();
    const old = requestCorrelated('llm_interpret', { requestId: 'old' }, { signal: abort.signal });
    const rejected = expect(old).rejects.toMatchObject({ name: 'AbortError' });
    abort.abort(); await rejected; expect(listeners.size).toBe(0);
    const next = requestCorrelated('llm_interpret', { requestId: 'new' });
    let settled = false; void next.then(() => { settled = true; });
    listeners.forEach(l => l({ data: JSON.stringify({ name: 'llm_interpret', data: { requestId: 'old', kind: 'answer' } }) }));
    await Promise.resolve(); expect(settled).toBe(false);
    listeners.forEach(l => l({ data: JSON.stringify({ name: 'llm_interpret', data: { requestId: 'new', kind: 'clarify' } }) }));
    await expect(next).resolves.toEqual({ requestId: 'new', kind: 'clarify' });
    expect(listeners.size).toBe(0);
  });
  it('逾時與已取消請求移除監聽，瀏覽器不回傳假模型', async () => {
    vi.useFakeTimers(); const { listeners, posted } = installFlutterObject();
    const abort = new AbortController(); abort.abort();
    await expect(requestCorrelated('llm_interpret', { requestId: 'never' }, { signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(posted).toHaveLength(0);
    const pending = requestCorrelated('llm_interpret', { requestId: 'timeout' }, { timeoutMs: 1000 });
    const rejected = expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' });
    await vi.advanceTimersByTimeAsync(1000); await rejected;
    expect(listeners.size).toBe(0);
    vi.stubGlobal('window', {});
    await expect(requestCorrelated('llm_interpret', { requestId: 'browser' })).rejects.toMatchObject({ code: 'NOT_IN_APP' });
  });
});
