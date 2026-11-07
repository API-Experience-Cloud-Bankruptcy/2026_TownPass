// 裝置端原始 Gemma 4 E2B 的型別化介面；一般瀏覽器不模擬 AI。
import { isInTownPass, requestCorrelated } from '../townpass/bridge';
import { parseInterpretation, type Interpretation, type InterpretationContext } from '../chat/interpretation';

export type ModelStatus =
  | { state: 'unavailable'; reason: string }
  | { state: 'not_downloaded' | 'downloaded' | 'downloading' | 'loading' | 'ready' | 'error'; model: string; progress?: number; message?: string };

export interface ModelAdapter {
  status(signal?: AbortSignal): Promise<ModelStatus>;
  prepare(signal?: AbortSignal): Promise<ModelStatus>;
  interpret(input: string, context: InterpretationContext, signal?: AbortSignal): Promise<Interpretation>;
}
export class ModelUnavailableError extends Error {
  constructor(message = '裝置端模型目前無法使用，仍可使用畫面選項。') { super(message); this.name = 'ModelUnavailableError'; }
}
export class ModelInputTooLongError extends Error {
  constructor() { super('這段內容較長，請分成兩段補充；原文仍會保留。'); this.name = 'ModelInputTooLongError'; }
}
let sequence = 0;
const requestId = () => `${Date.now().toString(36)}-${++sequence}-${Math.random().toString(36).slice(2)}`;
export class OnDeviceModelAdapter implements ModelAdapter {
  private async getStatus(name: 'llm_status' | 'llm_prepare', signal?: AbortSignal): Promise<ModelStatus> {
    if (!isInTownPass()) return { state: 'unavailable', reason: '請在城市通 App 載入 Gemma 4 E2B；目前可用畫面選項與名稱搜尋。' };
    try {
      const raw = await requestCorrelated<Record<string, unknown>>(name, { requestId: requestId() }, { signal, timeoutMs: name === 'llm_prepare' ? 900_000 : 8_000 });
      if (!['not_downloaded', 'downloaded', 'downloading', 'loading', 'ready', 'error'].includes(String(raw.state)) || raw.model !== 'Gemma 4 E2B') throw new ModelUnavailableError();
      return { state: raw.state, model: raw.model, ...(typeof raw.progress === 'number' && Number.isFinite(raw.progress) ? { progress: Math.max(0, Math.min(1, raw.progress)) } : {}), ...(typeof raw.message === 'string' ? { message: raw.message.slice(0, 300) } : {}) } as ModelStatus;
    } catch (error) {
      if (signal?.aborted) throw error;
      return { state: 'unavailable', reason: '裝置端模型尚未就緒，請確認 App 已更新；仍可使用畫面選項與名稱搜尋。' };
    }
  }
  status(signal?: AbortSignal) { return this.getStatus('llm_status', signal); }
  prepare(signal?: AbortSignal) { return this.getStatus('llm_prepare', signal); }
  async interpret(input: string, context: InterpretationContext, signal?: AbortSignal): Promise<Interpretation> {
    if (!input.trim() || input.length > 2000) throw new ModelUnavailableError('請輸入 1 至 2000 字的情況。');
    const id = requestId();
    const raw = await requestCorrelated<unknown>('llm_interpret', { requestId: id, input, context }, { signal, timeoutMs: 180_000 });
    if (raw && typeof raw === 'object' && 'error' in raw) {
      const error = (raw as { error: unknown }).error;
      if (error && typeof error === 'object' && 'code' in error && error.code === 'INPUT_TOO_LONG') throw new ModelInputTooLongError();
    }
    return parseInterpretation(raw, id, input, context);
  }
}
export const modelAdapter: ModelAdapter = new OnDeviceModelAdapter();
