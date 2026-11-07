// 一句話裡聽到好幾件事時，拆成一題一題的追問，像一般問答一樣逐題回答。
// 全部答完才產生 outcome 交給上層一次套用；中途取消就什麼都不改。
// 純函式：不碰 store，題目只由模型已通過驗證的候選內容產生，不新增資格欄位。
import type { CandidateFact, FactField, Interpretation } from './interpretation';
import { normalizeInput } from './input-router';

type Target = 'self' | 'other';
export interface FollowupChoice { id: string; label: string }
export interface FollowupStep {
  id: string;
  prompt: string;
  note?: string;
  choices: FollowupChoice[];
  /** 是非題時「對」「是」對應的選項；打字回答用。 */
  yes?: string;
  /** 「不是」「先不要」對應的選項。 */
  no?: string;
}
export interface FollowupOutcome {
  target: Target | null;
  facts: CandidateFact[];
  situation: string | null;
  /** 沒有採用的內容與原因，給完成時的回覆說明。 */
  skipped: string[];
}
export interface FollowupInput {
  result: Extract<Interpretation, { kind: 'situation' }>;
  target: Target | null;
  currentSituation: string | null;
  /** 欄位與值的白話說明，例如「已核定家戶身分：低收入戶」。 */
  describe: (fact: CandidateFact) => string;
  situationLabel: (id: string) => string;
}
export interface FollowupPlan {
  /** 已回答的題目加上目前這一題（若還有）。 */
  steps: FollowupStep[];
  current: FollowupStep | null;
  outcome: FollowupOutcome | null;
}

export const FIELD_LABELS: Record<FactField, string> = { age: '年齡', region: '戶籍', is_student: '在學身分', household_type: '低收入戶／中低收入戶資格' };
const FIELD_NOTES: Partial<Record<FactField, string>> = {
  household_type: '請以政府核定的低收入戶或中低收入戶資格為準，生活困難不代表已有資格。',
  region: '這裡指戶籍所在地，不是目前住的地方。',
};

const yesNo = (yes: string, no: string): Pick<FollowupStep, 'choices' | 'yes' | 'no'> => ({ choices: [{ id: 'yes', label: yes }, { id: 'no', label: no }], yes: 'yes', no: 'no' });

/** 依已回答的內容逐步產生下一題；後面的題目會依前面的答案（例如查詢對象）調整。 */
export function planFollowups(input: FollowupInput, answers: Readonly<Record<string, string>>): FollowupPlan {
  const steps: FollowupStep[] = [];
  const skipped: string[] = [];
  const ask = (step: FollowupStep): string | undefined => { steps.push(step); return answers[step.id]; };
  const stop = (): FollowupPlan => ({ steps, current: steps[steps.length - 1]!, outcome: null });
  const facts = input.result.facts;

  // 1. 查詢對象：一輪只查一位，先確定是誰才知道哪些條件能用。
  let target = input.target;
  if (!target) {
    const subjects = new Set(facts.map(f => f.subject).filter(s => s === 'self' || s === 'other'));
    const only = subjects.size === 1 ? [...subjects][0] as Target : null;
    const otherLabel = only === 'other' ? facts.find(f => f.subject === 'other')?.subjectLabel : '';
    const step: FollowupStep = only === 'self'
      ? { id: 'target', prompt: '這次是幫自己找嗎？', choices: [{ id: 'target:self', label: '對，幫自己找' }, { id: 'target:other', label: '不是，幫家人或別人找' }], yes: 'target:self' }
      : only === 'other'
        ? { id: 'target', prompt: `這次是幫${otherLabel || '家人或別人'}找嗎？`, choices: [{ id: 'target:other', label: '對，幫家人或別人找' }, { id: 'target:self', label: '不是，幫自己找' }], yes: 'target:other' }
        : { id: 'target', prompt: '這次要幫誰找？', choices: [{ id: 'target:self', label: '幫自己找' }, { id: 'target:other', label: '幫家人或別人找' }] };
    const answer = ask(step);
    if (!answer) return stop();
    target = answer === 'target:other' ? 'other' : 'self';
  }
  const who = target === 'self' ? '你自己' : '這次要查的人';

  // 2. 說不清楚是誰的條件：逐筆問，答「不是」就不採用。
  const resolved: CandidateFact[] = [];
  facts.forEach((fact, i) => {
    if (fact.subject === 'applicant' || fact.subject === target) resolved.push(fact);
    else if (fact.subject !== 'unclear') skipped.push(`「${fact.evidence}」不是這次查詢對象的情況，先不採用`);
    else resolved.push({ ...fact, subjectLabel: `#unclear:${i}` });
  });
  const people: CandidateFact[] = [];
  for (const [i, fact] of resolved.entries()) {
    if (!fact.subjectLabel.startsWith('#unclear:')) { people.push(fact); continue; }
    const answer = ask({ id: `who:${i}`, prompt: `你提到「${fact.evidence}」，這是在說${who}嗎？`, ...yesNo(`對，是${who}`, '不是，先不採用') });
    if (!answer) return stop();
    if (answer === 'yes') people.push({ ...fact, subject: 'applicant', subjectLabel: target === 'self' ? '你' : '對方' });
    else skipped.push(`「${fact.evidence}」不確定是誰的情況，先不採用`);
  }

  // 3. 同一句提到好幾位（例如「媽媽」「爸爸」）：這一輪先查一位。
  const labels = [...new Set(people.map(f => f.subjectLabel))];
  let person = labels[0];
  if (labels.length > 1) {
    const answer = ask({ id: 'person', prompt: '你提到了好幾位，這次先幫哪一位找？', note: '其他人可以之後再查。', choices: labels.map((label, i) => ({ id: `person:${i}`, label })) });
    if (!answer) return stop();
    person = labels[Number(answer.slice(7))];
    for (const label of labels) if (label !== person) skipped.push(`${label}的情況這輪先不查`);
  }
  const mine = people.filter(f => f.subjectLabel === person);

  // 4. 每個欄位一題；同一欄位有不同說法時讓本人選。
  const chosen: CandidateFact[] = [];
  for (const field of [...new Set(mine.map(f => f.field))]) {
    const options = mine.filter(f => f.field === field).filter((f, i, all) => all.findIndex(g => g.value === f.value) === i);
    if (options.length === 1) {
      const fact = options[0]!;
      const answer = ask({ id: `fact:${field}`, prompt: `你提到「${fact.evidence}」，要把「${input.describe(fact)}」記為${target === 'self' ? '你的情況' : '對方的情況'}嗎？`, note: FIELD_NOTES[field], ...yesNo('對，記下來', '先不要') });
      if (!answer) return stop();
      if (answer === 'yes') chosen.push(fact); else skipped.push(`${FIELD_LABELS[field]}先不填`);
    } else {
      const answer = ask({ id: `fact:${field}`, prompt: `關於${FIELD_LABELS[field]}，你提到不同的情況，要記下哪一個？`, note: FIELD_NOTES[field], choices: [...options.map((f, i) => ({ id: `value:${i}`, label: input.describe(f) })), { id: 'no', label: '都不確定，先不填' }], no: 'no' });
      if (!answer) return stop();
      if (answer === 'no') skipped.push(`${FIELD_LABELS[field]}先不填`); else chosen.push(options[Number(answer.slice(6))]!);
    }
  }

  // 5. 想找的方向：已經在找的方向不重問。
  let situation: string | null = null;
  const ids = input.result.situationIds.filter(id => id !== input.currentSituation);
  const keep = input.currentSituation ? '先維持目前方向' : '先不要，之後再選';
  if (ids.length === 1) {
    const answer = ask({ id: 'situation', prompt: `要先從「${input.situationLabel(ids[0]!)}」這方面幫${target === 'self' ? '你' : '對方'}找嗎？`, ...yesNo('對，先找這方面', keep) });
    if (!answer) return stop();
    if (answer === 'yes') situation = ids[0]!;
  } else if (ids.length > 1) {
    const answer = ask({ id: 'situation', prompt: '你提到幾方面的需要，想先從哪一方面找？', note: '其他方面之後可以再換。', choices: [...ids.map(id => ({ id: `situation:${id}`, label: input.situationLabel(id) })), { id: 'no', label: keep }], no: 'no' });
    if (!answer) return stop();
    if (answer !== 'no') situation = answer.slice(10);
  }

  return { steps, current: null, outcome: { target, facts: chosen, situation, skipped } };
}

const YES = /^(對|是|是的|沒錯|正確|對的|好|好的|可以|要|記下來|ok|yes)$/u;
const NO = /^(不是|不對|否|不要|先不要|沒有|不用|算了|no)$/u;
const TARGET_ALIASES: Record<string, string> = { 自己: 'target:self', 我: 'target:self', 我自己: 'target:self', 本人: 'target:self', 幫我: 'target:self', 家人: 'target:other', 別人: 'target:other', 幫家人: 'target:other', 幫別人: 'target:other' };
const ORDINALS: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, '1': 1, '2': 2, '3': 3, '4': 4, '5': 5 };

/** 打字回答目前這一題：只接受完整選項、是非、對象別稱或序號；其他一律不猜。 */
export function matchFollowupChoice(text: string, step: FollowupStep): string | null {
  if (/[?？「」『』"'`]/u.test(text)) return null;
  const input = normalizeInput(text);
  if (!input) return null;
  const exact = step.choices.filter(c => normalizeInput(c.label) === input);
  if (exact.length === 1) return exact[0]!.id;
  if (step.yes && YES.test(input)) return step.yes;
  if (step.no && NO.test(input)) return step.no;
  const alias = TARGET_ALIASES[input];
  if (alias && step.choices.some(c => c.id === alias)) return alias;
  const ordinal = /^(?:第|選)?([一二三四五12345])(?:個|項)?$/u.exec(input);
  if (ordinal) return step.choices[ORDINALS[ordinal[1]!]! - 1]?.id ?? null;
  // 選項文字的前段（例如只打「低收入戶」對上「已核定家戶身分：低收入戶」）只有唯一命中才採用。
  const partial = step.choices.filter(c => input.length >= 2 && normalizeInput(c.label).includes(input));
  return partial.length === 1 ? partial[0]!.id : null;
}
