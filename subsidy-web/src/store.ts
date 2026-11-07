// 全域狀態：資料、題庫、本機答案與行動單。答案只在本機評估與保存。

import { computed, reactive, ref, watch } from 'vue';
import { loadCatalog } from './domain/catalog';
import { loadAppData, migrateSession } from './domain/bootstrap';
import type { ConditionEntry } from './domain/export';
import { evaluateAll, sortByFit } from './domain/match';
import { answerOf, describeAnswer, loadQuestions, questionsFor, setAnswer, titleFor } from './domain/questions';
import {
  clearSession,
  emptySession,
  hasPersonalData,
  loadPrefs,
  loadSession,
  purgeLegacySession,
  savePrefs,
  saveSession,
  switchPerson,
  type Prefs,
  type SessionState,
} from './domain/session';
import { filterCatalog, SITUATIONS } from './domain/situations';
import type { LoadedCatalog, Question, QuestionBank, Subsidy, Target } from './domain/types';

export type View = 'home' | 'needs' | 'search' | 'questions' | 'results' | 'detail' | 'plan' | 'help';

interface State {
  view: View;
  history: View[];
  detailId: string | null;
  catalog: LoadedCatalog | null;
  bank: QuestionBank | null;
  loading: boolean;
  loadError: string;
  notice: string;
  session: SessionState;
  prefs: Prefs;
  qIndex: number;
  questionPool: Question[] | null;
  questionRoute: Question[];
  showIneligible: boolean;
  /** 從詳情頁進入求助時帶入的資源與步驟 */
  helpContext: { itemId: string | null; stepText?: string };
}

export const state = reactive<State>({
  view: 'home',
  history: [],
  detailId: null,
  catalog: null,
  bank: null,
  loading: true,
  loadError: '',
  notice: '',
  session: (purgeLegacySession(), loadSession()),
  prefs: loadPrefs(),
  qIndex: 0,
  questionPool: null,
  questionRoute: [],
  showIneligible: false,
  helpContext: { itemId: null },
});

watch(
  () => state.session,
  (s) => saveSession(s),
  { deep: true },
);
watch(
  () => state.prefs,
  (p) => savePrefs(p),
  { deep: true },
);

export const itemsById = computed(() => {
  const map = new Map<string, Subsidy>();
  for (const item of state.catalog?.items ?? []) map.set(item.id, item);
  return map;
});

export const candidates = computed(() =>
  state.catalog ? filterCatalog(state.catalog.items, state.session.situation, state.session.query) : [],
);

const candidateQuestions = computed<Question[]>(() =>
  state.bank ? questionsFor(state.bank.questions, candidates.value.map(c => c.id)) : [],
);
// Keep visited identities stable. Only answerAndAdvance rebuilds the future tail.
export const questions = computed<Question[]>(() => state.questionPool === null ? candidateQuestions.value : state.questionRoute);

export const results = computed(() => evaluateAll(state.catalog?.items ?? [], state.session.answers));

export const sortedCandidates = computed(() => sortByFit(candidates.value, results.value));

export const planItems = computed(() =>
  state.session.planIds.map((id) => itemsById.value.get(id)).filter((x): x is Subsidy => !!x),
);

/** 已填條件（用於輸出預覽，預設不加入）。 */
export const conditionEntries = computed<ConditionEntry[]>(() => {
  const out: ConditionEntry[] = [];
  for (const q of state.bank?.questions ?? []) {
    const value = answerOf(state.session.answers, q.field);
    if (value === undefined || out.some((c) => c.field === q.field)) continue;
    out.push({ field: q.field, line: `${titleFor(q, state.session.target ?? 'self').replace(/？$/, '')}：${describeAnswer(q, value)}` });
  }
  return out;
});

export const conditionLines = computed(() => conditionEntries.value.map((c) => c.line));

/** 依勾選的文字取回條件項目。 */
export function pickConditions(lines: string[]): ConditionEntry[] {
  return conditionEntries.value.filter((c) => lines.includes(c.line));
}

export async function init(): Promise<void> {
  state.loading = true;
  state.loadError = '';
  try {
    // 先完整載入，再同步一次套用：載入期間或失敗時，畫面與進度維持一致的舊狀態。
    const { catalog, bank } = await loadAppData({ loadCatalog, loadQuestions });
    const patch = migrateSession(state.session, catalog);
    state.catalog = catalog;
    state.bank = bank;
    state.session.planIds = patch.planIds;
    state.session.stepDone = patch.stepDone;
    state.session.docChecks = patch.docChecks;
    state.session.catalogVersion = patch.catalogVersion;
    state.session.rulesVersion = patch.rulesVersion;
    if (patch.notice) state.notice = patch.notice;
    state.questionPool = null;
    state.questionRoute = [];
    state.qIndex = 0;
    if (state.view === 'questions') startQuestions();
  } catch (error) {
    state.loadError = `資料載入失敗：${(error as Error).message}`;
  } finally {
    state.loading = false;
  }
}

export function go(view: View): void {
  if (state.view !== view) state.history.push(state.view);
  state.view = view;
}

export function back(): void {
  if (state.view === 'questions' && state.qIndex > 0) {
    state.qIndex -= 1;
    return;
  }
  state.view = state.history.pop() ?? 'home';
}

/** 直接切換主要分頁，清掉返回紀錄。 */
export function tab(view: View): void {
  state.history = [];
  state.view = view;
}

export function needsSwitchConfirm(target: Target): boolean {
  return state.session.target !== null && state.session.target !== target && hasPersonalData(state.session);
}

/** 等待使用者確認的換人或清除動作。 */
export const pendingSwitch = ref<Target | 'clear' | null>(null);
const pendingDestination = ref<View>('home');

/** 選擇查詢對象；已有資料且對象不同時，先要求確認。 */
export function requestTarget(target: Target): void {
  if (needsSwitchConfirm(target)) {
    pendingDestination.value = 'needs';
    pendingSwitch.value = target;
    return;
  }
  if (state.session.target !== target) resetPerson(target);
  go('needs');
}

/** 「換人」：保留同一對象類型但清除資料，也需確認。 */
export function requestNewPerson(): void {
  pendingDestination.value = 'home';
  if (hasPersonalData(state.session)) pendingSwitch.value = state.session.target ?? 'clear';
  else resetPerson(state.session.target);
}

export function confirmPending(): void {
  const pending = pendingSwitch.value;
  const destination = pendingDestination.value;
  pendingSwitch.value = null;
  pendingDestination.value = 'home';
  if (pending === 'clear') clearAllData();
  else if (pending) {
    resetPerson(pending);
    if (destination !== 'home') go(destination);
    state.notice = '已換人並清除前一位的答案、行動單與進度。';
  }
}

/** 換人：清除答案、行動單、進度。 */
export function resetPerson(target: Target | null): void {
  const version = state.session.catalogVersion;
  const rulesVersion = state.session.rulesVersion;
  state.session = target ? switchPerson(target) : emptySession();
  state.session.catalogVersion = version;
  state.session.rulesVersion = rulesVersion;
  state.qIndex = 0;
  state.questionPool = null;
  state.questionRoute = [];
  lastAnswerAt = -Infinity;
  state.showIneligible = false;
  state.detailId = null;
  state.helpContext = { itemId: null };
  state.history = [];
  state.view = 'home';
}

export function clearAllData(): void {
  clearSession();
  resetPerson(null);
  state.notice = '已清除本分頁保存的答案、行動單與進度。';
}

export function startQuestions(): void {
  state.qIndex = 0;
  state.questionPool = [...candidateQuestions.value];
  state.questionRoute = [...state.questionPool];
  lastAnswerAt = -Infinity;
  if (questions.value.length > 0) go('questions');
  else go('results');
}

/** 分類與搜尋分開使用，換需求時不留下另一種篩選。 */
export function selectNeed(id: string): void {
  if (!SITUATIONS.some((s) => s.id === id) || !state.session.target || state.loading) return;
  state.session.situation = id;
  state.session.query = '';
  startQuestions();
}

export function searchResources(query: string): void {
  if (!state.session.target || state.loading || !query.trim()) return;
  state.session.situation = null;
  state.session.query = query.trim().slice(0, 100);
  startQuestions();
}

let lastAnswerAt = -Infinity;
/** 鎖住同一次連點，且拒絕已離開的題目事件。 */
export function answerAndAdvance(
  questionId: string,
  value: string | number | boolean | undefined,
  now = Date.now(),
): boolean {
  const question = questions.value[state.qIndex];
  if (state.view !== 'questions' || !question || question.id !== questionId || now - lastAnswerAt < 450) return false;
  lastAnswerAt = now;
  const prefix = questions.value.slice(0, state.qIndex + 1);
  answer(question, value);
  // Future answers retained from an earlier run must not hide their own questions.
  const knownFields = new Set(prefix.map(q => q.field));
  const knownAnswers = Object.fromEntries(Object.entries(state.session.answers).filter(([field]) => knownFields.has(field)));
  const partialResults = evaluateAll(candidates.value, knownAnswers);
  const remainingIds = candidates.value.filter(item => partialResults.get(item.id)?.fit !== 'ineligible').map(item => item.id);
  const useful = new Set(questionsFor(state.bank?.questions ?? [], remainingIds).map(q => q.id));
  const pool = state.questionPool ?? candidateQuestions.value;
  const position = pool.findIndex(q => q.id === questionId);
  const tail = pool.slice(position + 1).filter(q => useful.has(q.id));
  state.questionRoute = [...prefix, ...tail];
  if (!tail.length) go('results');
  else state.qIndex = prefix.length;
  return true;
}

export function answer(question: Question, value: string | number | boolean | undefined): void {
  state.session.answers = setAnswer(state.session.answers, question, value);
  if (!state.session.seenQuestions.includes(question.id)) state.session.seenQuestions.push(question.id);
}

export function openDetail(id: string): void {
  state.detailId = id;
  go('detail');
}

export function inPlan(id: string): boolean {
  return state.session.planIds.includes(id);
}

export function togglePlan(id: string): void {
  const ids = state.session.planIds;
  state.session.planIds = ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id];
}

export function toggleDoc(key: string): void {
  const checks = { ...state.session.docChecks };
  if (checks[key]) delete checks[key];
  else checks[key] = true;
  state.session.docChecks = checks;
}

export function toggleStep(id: string, index: number): void {
  const done = new Set(state.session.stepDone[id] ?? []);
  if (done.has(index)) done.delete(index);
  else done.add(index);
  state.session.stepDone = { ...state.session.stepDone, [id]: [...done].sort((a, b) => a - b) };
}

export function openHelp(itemId: string | null, stepText?: string): void {
  state.helpContext = { itemId, stepText };
  go('help');
}
