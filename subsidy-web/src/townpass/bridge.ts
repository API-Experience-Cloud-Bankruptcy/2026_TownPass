// 與城市通 App 雙向溝通的底層。
//
// App 在 WebView 注入 window.flutterObject（見 lib/util/tp_web_view.dart、
// lib/util/web_message_handler/tp_web_message_listener.dart）。
// 網頁送出：flutterObject.postMessage(JSON.stringify({ name, data }))
// App 回覆：message 事件，event.data 是 JSON 字串 { name, data }
//
// 一般瀏覽器沒有 flutterObject，request() 會改用 mock.ts 的假資料，
// 方便在電腦上開發；雙向溝通的實測仍須在 App 內進行。

import { mockReply } from './mock';

export interface TownPassMessage<T = unknown> {
  name: string;
  data: T;
}

type MessageListener = (event: MessageEvent) => void;

interface FlutterObject {
  postMessage(message: string): void;
  addEventListener(type: 'message', listener: MessageListener): void;
  removeEventListener(type: 'message', listener: MessageListener): void;
}

declare global {
  interface Window {
    flutterObject?: FlutterObject;
  }
}

export class TownPassError extends Error {
  readonly code: 'NOT_IN_APP' | 'TIMEOUT';

  constructor(code: 'NOT_IN_APP' | 'TIMEOUT', message: string) {
    super(message);
    this.code = code;
  }
}

/** 目前是否在城市通 App 的 WebView 內。 */
export function isInTownPass(): boolean {
  return typeof window !== 'undefined' && window.flutterObject != null;
}

/** 解析 App 傳來的訊息；格式不符時回傳 null。 */
export function parseMessage(raw: unknown): TownPassMessage | null {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (typeof value !== 'object' || value === null) return null;
  const { name, data } = value as Record<string, unknown>;
  if (typeof name !== 'string') return null;
  return { name, data };
}

/**
 * 只送出、不等回覆。用於 App 成功時不回覆的能力：
 * notify、open_link、1999agree。
 */
export function send(name: string, data: unknown = null): void {
  const target = window.flutterObject;
  if (!target) {
    console.info('[townpass] 不在 App 內，略過送出', { name, data });
    return;
  }
  target.postMessage(JSON.stringify({ name, data }));
}

export interface RequestOptions {
  /** 等待回覆的毫秒數；0 代表不逾時（例如等使用者掃碼）。預設 10 秒。 */
  timeoutMs?: number;
}

/**
 * 送出並等待同名回覆。App 以 name 對應回覆，
 * 同一個 name 同時只應有一個請求在等待。
 */
export function request<T>(
  name: string,
  data: unknown = null,
  { timeoutMs = 10_000 }: RequestOptions = {},
): Promise<T> {
  const target = window.flutterObject;
  if (!target) {
    const mock = mockReply(name, data);
    if (mock === undefined) {
      return Promise.reject(
        new TownPassError('NOT_IN_APP', `不在 App 內，且沒有 ${name} 的模擬資料`),
      );
    }
    return new Promise((resolve) => setTimeout(() => resolve(mock as T), 300));
  }

  return new Promise<T>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const listener: MessageListener = (event) => {
      const message = parseMessage(event.data);
      if (!message || message.name !== name) return;
      cleanup();
      resolve(message.data as T);
    };

    const cleanup = () => {
      target.removeEventListener('message', listener);
      if (timer !== undefined) clearTimeout(timer);
    };

    target.addEventListener('message', listener);
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        cleanup();
        reject(new TownPassError('TIMEOUT', `${name} 等待 App 回覆逾時`));
      }, timeoutMs);
    }
    target.postMessage(JSON.stringify({ name, data }));
  });
}
