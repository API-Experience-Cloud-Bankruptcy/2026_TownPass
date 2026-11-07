// SituationInterpreter 的模型接口。使用者模型仍在微調，本版不接任何 LLM：
// 不呼叫雲端、不假裝模型已下載。題庫與資格判斷都不依賴此接口。

export interface NeedInterpretation {
  /** 需求標籤（對應 SITUATIONS id），需經使用者確認才採用 */
  situationIds: string[];
  /** 候選欄位，例如 { age: 72 }；不得直接寫入答案 */
  candidateFields: Record<string, string | number | boolean>;
  /** 無法確定的部分 */
  uncertain: string[];
  /** 支持判斷的輸入片段 */
  evidence: string[];
}

export type ModelStatus =
  | { state: 'unavailable'; reason: string }
  | { state: 'loading' }
  | { state: 'ready'; name: string; version: string };

export interface ModelAdapter {
  status(): Promise<ModelStatus>;
  interpret(input: string, signal?: AbortSignal): Promise<NeedInterpretation>;
}

export class ModelUnavailableError extends Error {
  constructor(message = '裝置端模型尚未提供') {
    super(message);
    this.name = 'ModelUnavailableError';
  }
}

/** 目前唯一實作：永遠不可用，呼叫端應回到按鈕與文字搜尋。 */
export class UnavailableModelAdapter implements ModelAdapter {
  async status(): Promise<ModelStatus> {
    return { state: 'unavailable', reason: '裝置端模型尚未接入，本版使用規則式搜尋與固定題庫。' };
  }

  async interpret(): Promise<NeedInterpretation> {
    throw new ModelUnavailableError();
  }
}

export const modelAdapter: ModelAdapter = new UnavailableModelAdapter();
