// 全域狀態：資料、題庫、本機答案與資料庫行動單。資格答案只在本機評估與保存。

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
  loadPersonalPlan,
  PERSONAL_PLAN_KEY,
  purgeLegacySession,
  savePrefs,
  saveSession,
  switchPerson,
  type Prefs,
  type SessionState,
} from './domain/session';
import { EXTRA_QUALIFICATION_FIELDS } from './domain/answer-fields';
import { availability, discoveryScore, identityRanking, questionApplies, rankQuestions } from './domain/adaptive';
import { filterCatalog, SITUATIONS } from './domain/situations';
import { isClosed } from './domain/browse';
import { taipeiToday } from './domain/reviewed-rules';
import type { Answers, LoadedCatalog, Question, QuestionBank, Subsidy, Target } from './domain/types';
import { validFactValue, type CandidateFact } from './chat/interpretation';
import { ActionPlanSync, savedPlan } from './domain/action-plan';
import { forgetTyped, resetTyped } from './chat/typing';

export type View = 'home' | 'needs' | 'search' | 'questions' | 'results' | 'detail' | 'plan' | 'planItem' | 'browse';
/** 本人行動單的頁面：列表與單張行動單。 */
export const PLAN_VIEWS: View[] = ['plan', 'planItem'];

interface State {
  view: View;
  history: View[];
  detailId: string | null;
  /** 正在看的單張行動單（補助 id） */
  planItemId: string | null;
  catalog: LoadedCatalog | null;
  bank: QuestionBank | null;
  loading: boolean;
  loadError: string;
  notice: string;
  session: SessionState;
  personalPlan: SessionState;
  detailTarget: Target;
  prefs: Prefs;
  qIndex: number;
  questionPool: Question[] | null;
  questionRoute: Question[];
  questionBudget: number;
  runVisited: string[];
}

export const state = reactive<State>({
  view: 'home',
  history: [],
  detailId: null,
  planItemId: null,
  catalog: null,
  bank: null,
  loading: true,
  loadError: '',
  notice: '',
  session: (purgeLegacySession(), loadSession()),
  personalPlan: loadPersonalPlan(),
  detailTarget: 'self',
  prefs: loadPrefs(),
  qIndex: 0,
  questionPool: null,
  questionRoute: [],
  questionBudget: 8,
  runVisited: [],
});

export const planSync = new ActionPlanSync(() => savedPlan(state.personalPlan, state.catalog?.items), (plan) => {
  Object.assign(state.personalPlan, plan);
  if (state.catalog) {
    const { notice, ...patch } = migrateSession(state.personalPlan, state.catalog);
    Object.assign(state.personalPlan, patch);
    if (notice) state.notice = notice;
  }
});
watch(() => JSON.stringify(savedPlan(state.personalPlan, state.catalog?.items)), () => planSync.changed());
watch(() => state.personalPlan, p => saveSession(p, undefined, PERSONAL_PLAN_KEY), { deep: true });

export const pendingResume = ref(false);
export const conversationEpoch = ref(0);
const CHAT_VIEWS: View[] = ['home', 'needs', 'search', 'questions', 'results'];
let lastChatView: View = 'home';
watch(() => state.view, (view) => { if (CHAT_VIEWS.includes(view)) lastChatView = view; }, { flush: 'sync' });

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

// Track source mutations once, then evaluate a plain snapshot. Vue proxies around the
// full evidence dataset make repeated canonical hashing needlessly expensive.
const catalogItems = computed<Subsidy[]>(()=>state.catalog?JSON.parse(JSON.stringify(state.catalog.items)) as Subsidy[]:[]);
export const itemsById = computed(() => {
  const map = new Map<string, Subsidy>();
  for (const item of catalogItems.value) map.set(item.id, item);
  return map;
});

// 已截止的案件不列入問答候選與結果。
export const candidates = computed(() => {
  if (!state.catalog) return [];
  const today = taipeiToday();
  return filterCatalog(catalogItems.value, state.session.situation, state.session.query).filter(item => !isClosed(item, today));
});

const candidateQuestions = computed<Question[]>(() =>
  state.bank ? questionsFor(state.bank.questions, candidates.value.map(c => c.id)) : [],
);
// Keep visited identities stable. Only answerAndAdvance rebuilds the future tail.
export const questions = computed<Question[]>(() => state.questionPool === null ? candidateQuestions.value : state.questionRoute);

export const results = computed(() => evaluateAll(catalogItems.value, state.session.answers));
export const planResults = computed(() => evaluateAll(catalogItems.value, state.personalPlan.answers));
export const detailAnswers = computed(() => state.detailTarget === 'other' ? state.session.answers : state.session.target === 'self' && !PLAN_VIEWS.includes(state.history[state.history.length - 1]) ? state.session.answers : state.personalPlan.answers);
export const detailResults = computed(() => evaluateAll(catalogItems.value, detailAnswers.value));
/** 查詢對象回答的戶籍，用於篩選只適用特定縣市的文件。 */
export const answeredRegion = computed(() => state.session.answers.region);

const discoveryScores=computed(()=>new Map(candidates.value.map(item=>[item.id,discoveryScore(item,state.session.answers,state.session.situation)])));
const identityRankings=computed(()=>new Map(candidates.value.map(item=>[item.id,identityRanking(item,state.session.answers)])));
export const sortedCandidates = computed(() => sortByFit(candidates.value, results.value)
  .map((item,index)=>({item,index,score:discoveryScores.value.get(item.id)?.score??0}))
  .sort((a,b)=> {
    const fa=results.value.get(a.item.id)?.fit==='ineligible',fb=results.value.get(b.item.id)?.fit==='ineligible';
    if (fa !== fb) return fa ? 1 : -1;
    const ia=identityRankings.value.get(a.item.id)!,ib=identityRankings.value.get(b.item.id)!;
    return ia.unconfirmed-ib.unconfirmed || ib.preferred-ia.preferred || b.score-a.score || a.index-b.index;
  }).map(x=>x.item));
export const focusedCandidates = computed(()=>sortedCandidates.value.filter(item=>results.value.get(item.id)?.fit!=='ineligible'&&discoveryScores.value.get(item.id)?.conflicts===0&&discoveryScores.value.get(item.id)?.unmapped===0));
export const uncertainCandidates = computed(()=>sortedCandidates.value.filter(i=>results.value.get(i.id)?.fit!=='ineligible'&&availability(i)==='unknown'));
export const recommendedCandidates = computed(()=> {
  const focused=new Set(focusedCandidates.value.map(i=>i.id));
  const relevant=sortedCandidates.value.filter(i=>focused.has(i.id));
  const preparing=relevant.filter(i=>availability(i)==='prepare');
  return (preparing.length?preparing:relevant.filter(i=>availability(i)==='unknown')).slice(0,5);
});
export const otherCandidates = computed(()=> {
  const first=new Set(recommendedCandidates.value.map(i=>i.id));
  return sortedCandidates.value.filter(i=>results.value.get(i.id)?.fit!=='ineligible'&&!first.has(i.id));
});
export const canRefine = computed(()=>rankQuestions(state.bank?.questions??[],candidates.value,state.session.answers,state.session.situation,new Set(state.session.seenQuestions)).length>0);
export const questionInsight = computed(()=> {
  const current=questions.value[state.qIndex];
  const nonIneligibleCount=candidates.value.filter(i=>results.value.get(i.id)?.fit!=='ineligible').length;
  return {initialCount:candidates.value.length,remainingCount:focusedCandidates.value.length,nonIneligibleCount,
    excludedCount:candidates.value.length-nonIneligibleCount,weakCount:nonIneligibleCount-focusedCandidates.value.length,
    answeredCount:conditionEntries.value.length,
    reason:['need_area','explore_context','expense_priority'].includes(current?.field??'') ? '先了解生活狀況與支出，再找相關資源；不知道可以跳過。' : current?.purpose==='qualification'
      ? '這題會確認相關補助的一項必要條件，並依回答調整結果與下一題；其他資格仍要確認。'
      : '這題會依補助原文幫忙縮小查詢方向；其他方向的方案仍會列在「其他相關資源」，不會因此判定資格不符。'};
});

export const planItems = computed(() =>
  state.personalPlan.planIds.map((id) => itemsById.value.get(id)).filter((x): x is Subsidy => !!x),
);

/** 已填條件（用於輸出預覽，預設不加入）。 */
function conditionsFor(answers: Answers, target: Target): ConditionEntry[] {
  const out: ConditionEntry[] = [];
  for (const q of state.bank?.questions ?? []) {
    const value = answerOf(answers, q.field);
    if (value === undefined || out.some((c) => c.field === q.field)) continue;
    out.push({ field: q.field, line: `${titleFor(q, target).replace(/？$/, '')}：${describeAnswer(q, value)}` });
  }
  return out;
}
export const conditionEntries = computed(() => conditionsFor(state.session.answers, state.session.target ?? 'self'));
export const planConditions = computed(() => conditionsFor(state.personalPlan.answers, 'self'));
export const planConditionLines = computed(() => planConditions.value.map(c => c.line));

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
    state.session.engineVersion=patch.engineVersion;
    state.session.answers=patch.answers;
    state.session.seenQuestions=patch.seenQuestions;
    const { notice: personalNotice, ...personalPatch } = migrateSession(state.personalPlan, catalog);
    Object.assign(state.personalPlan, personalPatch);
    if (patch.notice || personalNotice) state.notice = [...new Set([patch.notice, personalNotice].filter(Boolean))].join('');
    state.questionPool = null;
    state.questionRoute = [];
    state.qIndex = 0;
    if (state.view === 'questions') startQuestions();
    if (planSync.state.phase === 'loading') await planSync.load();
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
  state.view = state.history.pop() ?? (state.view === 'planItem' ? 'plan' : 'home');
}

/** 直接切換主要分頁，清掉返回紀錄。 */
export function tab(view: View): void {
  if (PLAN_VIEWS.includes(view) && state.session.target === 'self' && Object.keys(state.session.answers).length) state.personalPlan.answers = JSON.parse(JSON.stringify(state.session.answers));
  // 回到進行中的對話：先切回原本那一步，畫面進場後再問要不要接著（見 App.vue）。
  const resume = view === 'home' && !CHAT_VIEWS.includes(state.view) && lastChatView !== 'home';
  state.history = [];
  state.view = resume ? lastChatView : view;
  if (resume) pendingResume.value = true;
}

export function continueConversation(): void {
  pendingResume.value = false;
  state.history = [];
  state.view = lastChatView;
}

/** 開新對話只重設對話；已加入的行動單與勾選進度保留。 */
export function newConversation(): void {
  resetPerson(null);
  state.notice = '';
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
  // 在招呼這一步選對象：對話接著往下長，招呼語不重打。
  if (state.session.target !== target) resetPerson(target, state.view === 'home');
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
    resetPerson(pending, destination !== 'home' && state.view === 'home');
    if (destination !== 'home') go(destination);
    state.notice = '已換人並清除前一位的查詢答案；自己的行動單已保留。';
  }
}

/**
 * 換人只清除查詢，自己的行動單獨立保留。
 * keepGreeting：在招呼那一步直接選對象時，沿用同一段對話（不重新掛載、招呼語不重播），只清掉之後的訊息。
 */
export function resetPerson(target: Target | null, keepGreeting = false): void {
  if (state.session.target === 'self' && Object.keys(state.session.answers).length) state.personalPlan.answers = JSON.parse(JSON.stringify(state.session.answers));
  pendingResume.value = false;
  lastChatView = 'home';
  if (keepGreeting) forgetTyped((key) => key === 'greet');
  else {
    conversationEpoch.value += 1;
    resetTyped();
  }
  const version = state.session.catalogVersion;
  const rulesVersion = state.session.rulesVersion;
  const engineVersion=state.session.engineVersion;
  state.session = target ? switchPerson(target) : emptySession();
  state.session.catalogVersion = version;
  state.session.rulesVersion = rulesVersion;
  state.session.engineVersion=engineVersion;
  state.qIndex = 0;
  state.questionPool = null;
  state.questionRoute = [];
  state.runVisited=[];
  state.questionBudget=8;
  lastAnswerAt = -Infinity;
  state.detailId = null;
  state.history = [];
  state.view = 'home';
}

export function clearAllData(): void {
  clearSession();
  resetPerson(null);
  state.personalPlan = { ...emptySession('self'), catalogVersion: state.personalPlan.catalogVersion, rulesVersion: state.personalPlan.rulesVersion, engineVersion: state.personalPlan.engineVersion };
  state.notice = '已清除這次的答案、行動單與進度；資料庫是否已清除，請看行動單的儲存狀態。';
}

function beginQuestions(continuing: boolean): void {
  state.qIndex=0;
  state.runVisited=continuing?[...state.session.seenQuestions]:[];
  state.questionBudget=8;
  state.questionPool=[...candidateQuestions.value];
  // Revisit known questions without letting their own old answers hide the edit controls.
  const editable=continuing?[]:state.questionPool.filter(q=>questionApplies(q,state.session.answers,state.session.situation)&&(state.session.seenQuestions.includes(q.id)||answerOf(state.session.answers,q.field)!==undefined));
  const unseen=rankQuestions(state.questionPool,candidates.value,state.session.answers,state.session.situation,new Set([...state.runVisited,...editable.map(q=>q.id)]));
  state.questionRoute=[...editable,...unseen];
  lastAnswerAt=-Infinity;
  if(state.questionRoute.length) go('questions'); else go('results');
}
/** Revisit answers; previously skipped questions may be considered in this new run. */
export function startQuestions(): void { beginQuestions(false); }
/** Continue with unseen useful questions, retaining prior answers and skips. */
export function continueQuestions(): void { beginQuestions(true); }
export function startExplore(): void {
  if(state.loading) return;
  if(!state.session.target) {state.notice='請先選這次要幫誰找。';return;}
  state.session.situation=null; state.session.query='';
  // A new discovery direction must not inherit old branch-specific preferences.
  clearDiscoveryPreferences(); state.session.seenQuestions=[];
  startQuestions();
}

/** 對話已確認基本資料後，從全資料的需求探索接續；不重問已知基本條件。 */
export function discoverWithKnownAnswers(): void {
  if (state.loading || !state.session.target || !state.bank) return;
  state.session.situation = null;
  state.session.query = '';
  clearDiscoveryPreferences();
  const stable = new Set(['age', 'region', 'is_student', 'household_type']);
  state.session.seenQuestions = state.bank.questions.filter(q => stable.has(q.field) && answerOf(state.session.answers, q.field) !== undefined).map(q => q.id);
  continueQuestions();
}

function clearDiscoveryPreferences(): void {
  const removedFields=new Set(Object.keys(state.session.answers.extra??{}).filter(field=>!EXTRA_QUALIFICATION_FIELDS.has(field)));
  const removedIds=new Set((state.bank?.questions??[]).filter(q=>removedFields.has(q.field)).map(q=>q.id));
  state.session.seenQuestions=state.session.seenQuestions.filter(id=>!removedIds.has(id));
  const kept=Object.fromEntries(Object.entries(state.session.answers.extra??{}).filter(([field])=>EXTRA_QUALIFICATION_FIELDS.has(field)));
  if(Object.keys(kept).length) state.session.answers.extra=kept; else delete state.session.answers.extra;
}

/** 分類與搜尋分開使用，換需求時不留下另一種篩選。 */
export function selectNeed(id: string): void {
  if (!SITUATIONS.some((s) => s.id === id) || !state.session.target || state.loading) return;
  clearDiscoveryPreferences();
  state.session.situation = id;
  state.session.query = '';
  startNeedQuestions();
}

function startNeedQuestions(): void {
  // 換需求不需要重新問已確認的基本資料；「改答案」仍明確從 startQuestions 進入。
  const known = (state.bank?.questions ?? []).filter(q => ['age', 'region', 'is_student', 'household_type'].includes(q.field) && answerOf(state.session.answers, q.field) !== undefined);
  for (const q of known) if (!state.session.seenQuestions.includes(q.id)) state.session.seenQuestions.push(q.id);
  if (known.length) continueQuestions(); else startQuestions();
}

export function searchResources(query: string): void {
  if (!state.session.target || state.loading || !query.trim()) return;
  clearDiscoveryPreferences();
  state.session.situation = null;
  state.session.query = query.trim().slice(0, 100);
  startNeedQuestions();
}

/** 僅接收使用者逐項確認、已選定主體的穩定欄位；整批驗證後才原子套用。 */
export function applyConfirmedFacts(facts: CandidateFact[]): boolean {
  if (!state.session.target || !state.bank || state.loading || !facts.length) return false;
  const fields = new Set<string>();
  const patches: { question: Question; fact: CandidateFact }[] = [];
  for (const fact of facts) {
    if (!['age', 'region', 'is_student', 'household_type'].includes(fact.field) || fields.has(fact.field)
      || !(fact.subject === 'applicant' || fact.subject === state.session.target)) return false;
    const question = state.bank.questions.find(q => q.field === fact.field);
    if (!question || !validFactValue({ field: fact.field, min: question.min, max: question.max, options: question.options }, fact.value)) return false;
    fields.add(fact.field); patches.push({ question, fact });
  }
  let answers: Answers = { ...state.session.answers, extra: { ...state.session.answers.extra } };
  // 只撤銷實際變更前提的相依答案；補年齡不會刪掉已確認的住宅需求。
  const changed = new Set(patches.filter(({ question, fact }) => answerOf(answers, question.field) !== fact.value).map(({ question }) => question.field));
  const invalidated = new Set<string>();
  let found = true;
  while (found) {
    found = false;
    for (const q of state.bank.questions) if (!invalidated.has(q.field) && q.depends_on && Object.keys(q.depends_on).some(field => changed.has(field) || invalidated.has(field))) {
      invalidated.add(q.field); found = true;
    }
  }
  for (const q of state.bank.questions) if (invalidated.has(q.field)) answers = setAnswer(answers, q, undefined);
  for (const { question, fact } of patches) answers = setAnswer(answers, question, fact.value);
  state.session.answers = answers;
  state.session.seenQuestions = state.session.seenQuestions.filter(id => {
    const q = state.bank!.questions.find(q => q.id === id);
    return !!q && !invalidated.has(q.field);
  });
  for (const { question } of patches) if (!state.session.seenQuestions.includes(question.id)) state.session.seenQuestions.push(question.id);
  // 年齡或身分本身不是需求。沒有方向時先問生活情境，不直接倒出結果。
  if (!state.session.situation && !state.session.query && !state.session.answers.extra?.need_area
    && !state.session.answers.extra?.expense_priority && !state.session.answers.extra?.explore_context) discoverWithKnownAnswers();
  else continueQuestions();
  return true;
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
  const prefix = questions.value.slice(0,state.qIndex+1);
  const futureIds=new Set(questions.value.slice(state.qIndex+1).map(q=>q.id));
  state.runVisited=state.runVisited.filter(id=>!futureIds.has(id));
  const oldValue=answerOf(state.session.answers,question.field);
  if(oldValue!==value) {
    // Editing an earlier choice invalidates later answers, including hidden branches.
    const futureFields=new Set(questions.value.slice(state.qIndex+1).map(q=>q.field));
    const branchFields=new Set((state.bank?.questions??[]).filter(q=>q.situations?.length||q.depends_on).map(q=>q.field));
    if(['need_area','explore_context','expense_priority'].includes(question.field)) for(const field of branchFields) futureFields.add(field);
    for(const q of state.bank?.questions??[]) if(futureFields.has(q.field)) state.session.answers=setAnswer(state.session.answers,q,undefined);
    const removedIds=new Set((state.bank?.questions??[]).filter(q=>futureFields.has(q.field)).map(q=>q.id));
    state.session.seenQuestions=state.session.seenQuestions.filter(id=>!removedIds.has(id));
    state.runVisited=state.runVisited.filter(id=>!removedIds.has(id));
  }
  answer(question,value);
  const visited=new Set([...state.runVisited,...prefix.map(q=>q.id)]);
  state.runVisited=[...visited];
  const routeAnswers={...state.session.answers,extra:{...state.session.answers.extra}};
  const confirmedFields=new Set(prefix.map(q=>q.field));
  let rankingAnswers:Answers=routeAnswers;
  for(const q of state.questionPool??candidateQuestions.value) if(!confirmedFields.has(q.field)&&!state.runVisited.includes(q.id)) rankingAnswers=setAnswer(rankingAnswers,q,undefined);
  const tail=rankQuestions(state.questionPool??candidateQuestions.value,candidates.value,rankingAnswers,state.session.situation,visited);
  state.questionRoute=[...prefix,...tail];
  // Budget pauses questioning, never truncates accessible result candidates.
  if(!tail.length||prefix.length>=state.questionBudget) go('results');
  else state.qIndex=prefix.length;
  return true;
}

export function answer(question: Question, value: string | number | boolean | undefined): void {
  state.session.answers = setAnswer(state.session.answers, question, value);
  if (!state.session.seenQuestions.includes(question.id)) state.session.seenQuestions.push(question.id);
}

export function openDetail(id: string): void {
  // 從行動單回到同一筆詳情：直接返回，不疊一層。
  if (state.view === 'planItem' && state.history[state.history.length - 1] === 'detail' && state.detailId === id) { back(); return; }
  state.detailTarget = CHAT_VIEWS.includes(state.view) && state.session.target === 'other' ? 'other' : 'self';
  state.detailId = id;
  go('detail');
}

export function inPlan(id: string): boolean {
  return state.personalPlan.planIds.includes(id);
}

export function togglePlan(id: string): void {
  if (state.view === 'detail' && state.detailTarget === 'other') return;
  const ids = state.personalPlan.planIds;
  if (!ids.includes(id) && state.session.target === 'self' && Object.keys(state.session.answers).length) state.personalPlan.answers = JSON.parse(JSON.stringify(state.session.answers));
  if (ids.includes(id)) {
    state.personalPlan.planIds = ids.filter((x) => x !== id);
    // 移除就清掉這張的步驟進度，之後重新加入從頭開始。
    state.personalPlan.stepDone = withoutKey(state.personalPlan.stepDone, id);
  } else state.personalPlan.planIds = [...ids, id];
}

function withoutKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  return Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
}

/** 打開單張行動單；從同一筆的行動單進到詳情再回來時直接返回。 */
export function openPlanItem(id: string): void {
  if (!inPlan(id)) return;
  if (state.view === 'detail' && state.history[state.history.length - 1] === 'planItem' && state.planItemId === id) { back(); return; }
  state.planItemId = id;
  go('planItem');
}

/** 從單張行動單移除後回到列表。 */
export function removeFromPlan(id: string): void {
  if (inPlan(id)) togglePlan(id);
  if (state.view === 'planItem' && state.planItemId === id) {
    state.history = [];
    state.view = 'plan';
    state.planItemId = null;
  }
}

/** 這張行動單的步驟全部改回未完成。 */
export function resetSteps(id: string): void {
  state.personalPlan.stepDone = withoutKey(state.personalPlan.stepDone, id);
}

export function toggleDoc(key: string): void {
  const checks = { ...state.personalPlan.docChecks };
  if (checks[key]) delete checks[key];
  else checks[key] = true;
  state.personalPlan.docChecks = checks;
}

/** 步驟進度只記在本人行動單；替他人查詢的詳情不記錄。還沒加入時一併加入，進度才有地方保存。 */
export function toggleStep(id: string, index: number): void {
  if (state.view === 'detail' && state.detailTarget === 'other') return;
  if (!inPlan(id)) togglePlan(id);
  if (!inPlan(id)) return;
  const done = new Set(state.personalPlan.stepDone[id] ?? []);
  if (done.has(index)) done.delete(index);
  else done.add(index);
  state.personalPlan.stepDone = { ...state.personalPlan.stepDone, [id]: [...done].sort((a, b) => a - b) };
}
