/** 模型只選擇目前提供的動作；不產生題目、資格、答案欄位或政策。 */
export interface ChatChoice { id: string; label: string; description?: string }
export type FactField = 'age' | 'region' | 'is_student' | 'household_type';
export interface CandidateFact { field: FactField; value: string | number | boolean; subject: 'self' | 'other' | 'applicant' | 'unclear'; subjectLabel: string; evidence: string }
export interface AllowedFact { field: FactField; options?: { label: string; value: string | boolean }[]; min?: number; max?: number }
export interface InterpretationContext {
  stage: 'home' | 'needs' | 'questions' | 'results' | 'search';
  target: 'self' | 'other' | null;
  question?: { id: string; field?: string; title: string; kind: string; min?: number; max?: number; options: ChatChoice[] };
  choices: ChatChoice[];
  situations: { id: string; label: string; hint: string }[];
  allowedFacts: AllowedFact[];
  knownAnswers?: Partial<Record<FactField, string | number | boolean>>;
  currentNeed?: { situationId: string | null; label: string | null; query: string };
  situationIndex?: { id: string; label: string; resourceCount: number; categories: string[]; applicants: string[]; keywords: string[] }[];
  followupQuestion?: string;
}
export type Interpretation =
  | { kind: 'answer'; choiceId: string; evidence: string }
  | { kind: 'answer'; numberValue: number; evidence: string }
  | { kind: 'situation'; situationIds: string[]; facts: CandidateFact[]; details: string[]; uncertainties: string[] }
  | { kind: 'clarify' | 'off_topic' };

export class InvalidInterpretationError extends Error {
  constructor() { super('模型回覆無法安全對應目前選項'); this.name = 'InvalidInterpretationError'; }
}

/** 全部拒絕額外欄位，避免模型的欄位推測繞過既有填答入口。 */
export function parseInterpretation(raw: unknown, requestId: string, input: string, context: InterpretationContext): Interpretation {
  const fail = (): never => { throw new InvalidInterpretationError(); };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail();
  const value = raw as Record<string, unknown>;
  if (value.requestId !== requestId) return fail();
  const fields = ['requestId', 'kind'];
  if (value.kind === 'clarify' || value.kind === 'off_topic') {
    if (Object.keys(value).some(k => !fields.includes(k))) return fail();
    return { kind: value.kind };
  }
  if (value.kind === 'situation') {
    fields.push('situationIds', 'facts', 'details', 'uncertainties');
    if (Object.keys(value).some(k => !fields.includes(k))) return fail();
    if (!Array.isArray(value.situationIds) || value.situationIds.length > 3 || value.situationIds.some(id => typeof id !== 'string' || !context.situations.some(s => s.id === id))) return fail();
    if (!Array.isArray(value.facts) || value.facts.length > 8) return fail();
    for (const fact of value.facts) {
      if (!fact || typeof fact !== 'object' || Array.isArray(fact)) return fail();
      if (Object.keys(fact).some(k => !['field', 'value', 'subject', 'subjectLabel', 'evidence'].includes(k))) return fail();
      if (!['self', 'other', 'applicant', 'unclear'].includes(fact.subject) || typeof fact.evidence !== 'string' || !fact.evidence.trim() || !input.includes(fact.evidence)) return fail();
      if (typeof fact.subjectLabel !== 'string' || fact.subjectLabel.length > 40 || (fact.subject !== 'unclear' && !fact.subjectLabel.trim()) || !input.includes(fact.subjectLabel)) return fail();
      const allowed = context.allowedFacts.find(f => f.field === fact.field);
      if (!allowed || !validFactValue(allowed, fact.value)) return fail();
      // 格式正確仍不代表有法定身分證據：將高風險的地點／經濟推測擋在確認卡之前。
      if (fact.field === 'region' && !/(戶籍|設籍|戶口)/u.test(fact.evidence)) return fail();
      if (fact.field === 'household_type') {
        if (fact.value !== 'general' && !/低收入戶/u.test(fact.evidence)) return fail();
        if (fact.value === 'low_income' && (/中低收入戶/u.test(fact.evidence) || /(不是|沒有|未取得|未核定|不具|並非|可能|好像)/u.test(fact.evidence))) return fail();
        if (fact.value === 'mid_low_income' && (!/中低收入戶/u.test(fact.evidence) || /(不是|沒有|未取得|未核定|不具|並非|可能|好像)/u.test(fact.evidence))) return fail();
        if (fact.value === 'general' && !/一般戶/u.test(fact.evidence)
          && (!/(不是|沒有|未取得|未核定|不具|並非)/u.test(fact.evidence) || (fact.evidence.match(/中低收入戶|低收入戶/gu) ?? []).length < 2)) return fail();
      }
    }
    for (const name of ['details', 'uncertainties'] as const) {
      if (!Array.isArray(value[name]) || value[name].length > 6 || value[name].some(s => typeof s !== 'string' || !s.trim() || s.length > 200 || (name === 'details' && !input.includes(s)))) return fail();
    }
    if (!value.situationIds.length && !value.facts.length && !(value.details as string[]).length && !(value.uncertainties as string[]).length) return fail();
    return { kind: 'situation', situationIds: [...new Set(value.situationIds)] as string[], facts: value.facts as CandidateFact[], details: value.details as string[], uncertainties: value.uncertainties as string[] };
  }
  if (typeof value.evidence !== 'string' || !value.evidence.trim() || !input.includes(value.evidence)) return fail();
  fields.push('evidence');
  if (value.kind !== 'answer') return fail();
  if (typeof value.choiceId === 'string' && context.choices.some(c => c.id === value.choiceId)) {
    fields.push('choiceId');
    if (Object.keys(value).some(k => !fields.includes(k))) return fail();
    return { kind: 'answer', choiceId: value.choiceId, evidence: value.evidence };
  }
  const q = context.question;
  if (q?.kind === 'number' && typeof value.numberValue === 'number' && Number.isInteger(value.numberValue)
    && value.numberValue >= (q.min ?? 0) && value.numberValue <= (q.max ?? 130)) {
    fields.push('numberValue');
    if (Object.keys(value).some(k => !fields.includes(k))) return fail();
    return { kind: 'answer', numberValue: value.numberValue, evidence: value.evidence };
  }
  return fail();
}

export function validFactValue(fact: AllowedFact, value: unknown): boolean {
  return fact.field === 'age'
    ? typeof value === 'number' && Number.isInteger(value) && value >= (fact.min ?? 0) && value <= (fact.max ?? 130)
    : !!fact.options?.some(o => o.value === value);
}

/** 只有主體符合目前查詢對象的事實可勾選；不明主體與跨人資料保留待問。 */
export function factApplies(fact: CandidateFact, target: 'self' | 'other' | null): boolean {
  return !!target && (fact.subject === 'applicant' || fact.subject === target);
}

const normalizeLabel = (s: string) => s.trim().replace(/[。！？!?]$/u, '').replace(/臺/g, '台');
/** 僅完整選項文字或單一數字的確定性捷徑。其他自然語句一定交給模型。 */
export function exactAnswer(input: string, context: InterpretationContext): Interpretation | null {
  const text = normalizeLabel(input);
  const matches = context.choices.filter(c => normalizeLabel(c.label) === text);
  if (matches.length === 1) {
    const id = matches[0]!.id;
    if (id.startsWith('need:')) return { kind: 'situation', situationIds: [id.slice(5)], facts: [], details: [input], uncertainties: [] };
    return { kind: 'answer', choiceId: id, evidence: input };
  }
  if (context.question?.kind === 'number' && /^\d{1,3}(?:\s*歲)?$/u.test(input.trim())) {
    const numberValue = Number(input.trim().replace(/\s*歲$/u, ''));
    if (numberValue >= (context.question.min ?? 0) && numberValue <= (context.question.max ?? 130)) return { kind: 'answer', numberValue, evidence: input };
  }
  return null;
}

/** 窄而確定的資料輸入捷徑：完整的本人阿拉伯數字實歲陳述，仍需確認才採用。
 * 不掃描複合句，不處理親屬、否定、修正、約數或從年齡猜測需求。
 */
export function explicitSelfAge(input: string): Interpretation | null {
  const match = /^我\s*(?:今年|目前|現在)?\s*(?:已滿\s*)?(\d{1,3})\s*歲\s*(?:了)?[。！!]?$/u.exec(input.trim());
  if (!match) return null;
  const value = Number(match[1]);
  if (value < 0 || value > 130) return null;
  return { kind: 'situation', situationIds: [], facts: [{ field: 'age', value, subject: 'self', subjectLabel: '我', evidence: input.trim() }], details: [], uncertainties: [] };
}

/** 不依賴 AbortSignal 是否真的終止原生推論，仍阻擋已取消／過期結果。 */
export class InterpretationTurn {
  private generation = 0;
  private controller: AbortController | null = null;
  cancel(): void { this.generation++; this.controller?.abort(); this.controller = null; }
  async run<T>(fingerprint: string, current: () => string, task: (signal: AbortSignal) => Promise<T>): Promise<T | null> {
    this.cancel();
    const generation = this.generation;
    const controller = this.controller = new AbortController();
    try {
      const result = await task(controller.signal);
      return generation === this.generation && !controller.signal.aborted && fingerprint === current() ? result : null;
    } catch (error) {
      if (generation !== this.generation || controller.signal.aborted || fingerprint !== current()) return null;
      throw error;
    } finally {
      if (this.controller === controller) this.controller = null;
    }
  }
}
