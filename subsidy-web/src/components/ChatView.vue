<script setup lang="ts">
// 「找資源」的對話介面：選對象 → 選需求或搜尋 → 逐題問答 → 結果。
// 流程與判斷全部沿用 store；這裡只把同一份狀態排成一則則訊息。
// 對話紀錄由狀態推導：點自己過去的回答即可回到那一步修改。
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';
import LogoMark from './LogoMark.vue';
import { vSmoothDetails } from '../chat/smooth-details';
import { followBottom, forgetTyped, isTyped, releaseFollow, trackPinned, type Line } from '../chat/typing';
import { answerOf, describeAnswer, MAX_AGE, titleFor } from '../domain/questions';
import { modelAdapter, ModelInputTooLongError, type ModelStatus } from '../domain/model';
import { explicitSelfAge, factApplies, InterpretationTurn, type CandidateFact, type ChatChoice, type FactField, type Interpretation, type InterpretationContext } from '../chat/interpretation';
import { matchCurrentChoice, normalizeInput, routeInput, suggestSearchQueries } from '../chat/input-router';
import { filterCatalog, SITUATIONS } from '../domain/situations';
import { adaptiveReviewFor } from '../domain/adaptive';
import type { Question, Subsidy } from '../domain/types';
import { distinctGroups, numberUnit, optionalText } from '../presentation';
import {
  answerAndAdvance,
  back,
  applyConfirmedFacts,
  canRefine,
  closedCandidates,
  continueQuestions,
  discoverWithKnownAnswers,
  go,
  otherCandidates,
  pendingSwitch,
  planItems,
  questionInsight,
  questions,
  recommendedCandidates,
  requestTarget,
  results,
  searchResources,
  selectNeed,
  sortedCandidates,
  startExplore,
  startQuestions,
  state,
  tab,
  uncertainCandidates,
} from '../store';
import BotMessage from './chat/BotMessage.vue';
import TurnMessages from './chat/TurnMessages.vue';
import UserMessage from './chat/UserMessage.vue';
import WheelPicker from './chat/WheelPicker.vue';
import ResultCard from './ResultCard.vue';
import ConfirmDialog from './ConfirmDialog.vue';

const target = computed(() => state.session.target ?? 'self');
const ask = computed(() => (target.value === 'other' ? '對方' : '你'));
const busy = computed(() => state.loading || !state.catalog);
const view = computed(() => state.view);
const past = (step: 'home' | 'needs') =>
  step === 'home' ? view.value !== 'home' && !!state.session.target : ['questions', 'results'].includes(view.value);

// ── 1. 打招呼與選對象 ──
const greetKey = 'greet';
const greetLines: Line[] = [
  { text: '嗨，我是福利連。' },
  { text: '回答幾個簡單問題，我幫你從補助、津貼、獎助與服務中，找出值得先看的幾項。' },
  { text: '這次要幫誰找？', tone: 'title' },
];
const targetLabel = computed(() => (state.session.target === 'other' ? '幫家人或別人找' : '幫自己找'));

// ── 2. 選需求 ──
const needKey = computed(() => `need:${target.value}`);
const needLines = computed<Line[]>(() => [
  { text: `${ask.value}需要哪方面的幫忙？`, tone: 'title' },
  { text: target.value === 'other' ? '提醒：幫別人查，不代表可以替對方申請。' : '不確定也沒關係，我可以一步步帶你找。', tone: 'muted' },
]);
const needAnswer = computed(() => {
  if (state.session.query) return `找「${state.session.query}」`;
  const s = SITUATIONS.find((x) => x.id === state.session.situation);
  return s ? s.label : '還不確定，帶我找';
});

// ── 3. 問答 ──
const index = computed(() => Math.min(state.qIndex, Math.max(questions.value.length - 1, 0)));
const current = computed<Question | undefined>(() => (view.value === 'questions' ? questions.value[index.value] : undefined));
/** 已回答（含跳過）的題目：問答中是目前題之前；結果頁是這一輪走過的題目。 */
const answered = computed(() => {
  if (view.value === 'questions') return questions.value.slice(0, index.value);
  if (view.value === 'results') return questions.value.filter((q) => state.runVisited.includes(q.id));
  return [];
});
function answerText(q: Question): string {
  const v = answerOf(state.session.answers, q.field);
  const typed = typedAnswers.value[q.id];
  if (typed && typed.value === v) return typed.text;
  return v === undefined ? '不知道，先跳過' : describeAnswer(q, v);
}
function qLines(q: Question, withMeta: boolean): Line[] {
  const purpose = optionalText(q, 'description');
  return [
    { text: titleFor(q, target.value), tone: 'title' },
    { text: withMeta ? purpose : '', tone: 'muted' },
  ];
}
/** 回到某一題修改；結果頁列出的題目要換回路線上的位置。 */
function editQuestion(q: Question) {
  const i = questions.value.findIndex((x) => x.id === q.id);
  if (i < 0) return;
  rewind(`q:${q.id}`);
  if (view.value !== 'questions') go('questions');
  state.qIndex = i;
}

/** 結果頁「改答案」：從第一題重新走，之後的紀錄與動畫同「修改」處理。 */
function redoAnswers() {
  const first = questions.value[0];
  rewind(first ? `q:${first.id}` : 'results');
  startQuestions();
}

async function submit(value: string | number | boolean | undefined, typedText?: string) {
  const q = current.value;
  if (!q) return false;
  if (!answerAndAdvance(q.id, value)) return false;
  if (typedText) typedAnswers.value[q.id] = { value, text: typedText };
  else delete typedAnswers.value[q.id];
  return true;
}

// 年齡滾輪：有答案用答案，沒有時依對象給一個常見的起點。
const wheelValue = ref(40);
watch(
  current,
  (q) => {
    if (q?.kind !== 'number') return;
    const min = q.min ?? 0;
    const max = q.max ?? MAX_AGE;
    // 改答案時也從預設值開始，不預先停在舊答案。
    const start = target.value === 'other' ? 65 : 35;
    wheelValue.value = Math.min(max, Math.max(min, start));
  },
  { immediate: true },
);

// ── 4. 結果 ──
const PAGE = 10;
const shownCount = ref<Record<string, number>>({});
const notIneligible = (i: Subsidy) => results.value.get(i.id)?.fit !== 'ineligible';
const groups = computed(() => {
  const [recommended, closed, uncertain, general] = distinctGroups([
    recommendedCandidates.value.filter(notIneligible),
    closedCandidates.value.filter(notIneligible),
    uncertainCandidates.value.filter(notIneligible),
    otherCandidates.value.filter(notIneligible),
  ]);
  return { recommended, closed, uncertain, general };
});
const ineligible = computed(() => sortedCandidates.value.filter((i) => !notIneligible(i)));
const sections = computed(() =>
  [
    { key: 'general', title: '其他相關資源', note: '沒有列在上面，但可能和你的情況有關，不代表不能申請。', list: groups.value.general },
    { key: 'uncertain', title: '受理時間需確認', note: '資料沒有寫清楚現在是否受理，請看原文或問承辦窗口。', list: groups.value.uncertain },
    { key: 'closed', title: '目前已截止', note: '依資料原文的受理情形或期限；之後可能再開放，請看官方公告。', list: groups.value.closed },
    { key: 'ineligible', title: '依填寫的條件不符', note: '只依你填的答案判斷；填錯或情況改變，可以改答案再看。', list: ineligible.value },
  ].filter((s) => s.list.length),
);
const answeredCount = computed(() => questionInsight.value?.answeredCount ?? 0);
const recommended = computed(() => groups.value.recommended);
const nothing = computed(() => recommended.value.length === 0 && sections.value.length === 0);
const exploring = computed(() => !state.session.situation && !state.session.query);
const resultsKey = computed(
  () => `res:${state.session.situation ?? ''}:${state.session.query}:${answeredCount.value}:${recommended.value.map((i) => i.id).join(',')}`,
);
const resultLines = computed<Line[]>(() => [
  {
    text: recommended.value.length
      ? `整理好了，建議先從這 ${recommended.value.length} 項了解：`
      : nothing.value
        ? '這次沒有找到相關資源。'
        : '可以先看看這些資源：',
    tone: 'title',
  },
  { text: answeredCount.value === 0 && !nothing.value ? '還沒有回答問題，下面依需求列出，不是依你的情況挑選。' : '', tone: 'muted' },
  { text: nothing.value ? '沒找到不代表沒有可以申請的福利。可以換個需求、改答案，或找人幫忙。' : '相關不等於符合資格，能不能領由承辦機關審核。', tone: 'muted' },
]);
const nextKey = computed(() => `${resultsKey.value}:next`);
const nextLines: Line[] = [{ text: '接下來想怎麼做？' }];
const sectionsKey = computed(() => `${resultsKey.value}:more`);

// ── 跟著最新訊息捲動：內容長高（打字、選項、滾輪出現）時，若使用者停在底部就跟著到底 ──
const log = ref<HTMLElement | null>(null);
let observer: ResizeObserver | null = null;
onActivated(() => {
  log.value?.addEventListener('scroll', trackPinned, { passive: true });
  window.addEventListener('touchstart', releaseFollow, { passive: true });
  window.addEventListener('wheel', releaseFollow, { passive: true });
  if (typeof ResizeObserver !== 'undefined' && log.value) {
    observer = new ResizeObserver(() => followBottom());
    observer.observe(log.value);
  }
  followBottom(true);
});
onDeactivated(() => {
  log.value?.removeEventListener('scroll', trackPinned);
  window.removeEventListener('touchstart', releaseFollow);
  window.removeEventListener('wheel', releaseFollow);
  observer?.disconnect();
  observer = null;
});

// ── 自然語言：目前答案優先，其次提出情境與事實供確認 ──
const query = ref('');
const typedAnswers = ref<Record<string, { value: string | number | boolean | undefined; text: string }>>({});
const typedTarget = ref<{ target: string; text: string } | null>(null);
const typedNeed = ref<{ situation: string | null; query: string; text: string } | null>(null);
/** at：送出時所在的那一步（home、needs、q:題目 id、results），對話紀錄依此排在那一步的位置。 */
const turns = ref<{ id: number; text: string; reply: string; hidden?: boolean; at: string }[]>([]);
let turnId = 0;
const interpreting = ref(false);
const turn = new InterpretationTurn();
const modelStatus = ref<ModelStatus | null>(null);
const preparing = ref(false);
const downloadPrompt = ref(false);
const lifecycleController = new AbortController();
const downloadDismissedKey = 'townpass-model-download-dismissed';
let prepareController: AbortController | null = null;
let statusTimer: ReturnType<typeof setTimeout> | undefined;
const proposal = ref<{ result: Extract<Interpretation, { kind: 'situation' }>; fingerprint: string; turnId: number; input: string } | null>(null);
const selectedFacts = ref<number[]>([]);
const selectedSituation = ref('');
const selectedPerson = ref('');
const clarification = ref<{ input: string; prompt: string; fingerprint: string } | null>(null);
const recovery = ref<{ turnId: number; mode: 'current' | 'need' } | null>(null);
type ProposedAction = { fingerprint: string; turnId: number; text: string } & (
  | { kind: 'choice'; choices: ChatChoice[] }
  | { kind: 'number'; value: number; label: string }
  | { kind: 'search'; query: string }
);
const actionProposal = ref<ProposedAction | null>(null);
const searchSuggestions = ref<string[]>([]);
const fallbackCount = ref(0);
const applyingInput = ref(false);
// 只在資料載入或題庫變動時建立簡短分類索引，不把補助全文放進每輪模型輸入。
const situationIndex = computed(() => {
  const groups = new Map(SITUATIONS.map(s => [s.id, { resourceCount: 0, categories: new Set<string>(), applicants: new Set<string>(), keywords: new Set<string>() }]));
  for (const item of state.catalog?.items ?? []) {
    const review = adaptiveReviewFor(item); if (!review) continue;
    for (const id of review.situations) {
      const group = groups.get(id); if (!group) continue;
      group.resourceCount++;
      if (item.classification?.category) group.categories.add(item.classification.category);
      for (const applicant of item.search?.facets?.applicant_types ?? []) group.applicants.add(applicant);
      for (const facet of review.facets) for (const value of facet.values) {
        const q = state.bank?.questions.find(q => q.field === facet.field);
        if (!q?.situations?.includes(id) || ['need_area', 'explore_context', 'expense_priority', 'benefit_style'].includes(facet.field)) continue;
        const label = q.options?.find(o => String(o.value) === value)?.label;
        if (label && group.keywords.size < 5) group.keywords.add(label);
      }
    }
  }
  return SITUATIONS.map(s => { const group = groups.get(s.id)!; return { id: s.id, label: s.label, resourceCount: group.resourceCount, categories: [...group.categories].slice(0, 3), applicants: [...group.applicants].slice(0, 3), keywords: [...group.keywords].slice(0, 5) }; });
});
const allowedFields: FactField[] = ['age', 'region', 'is_student', 'household_type'];
const context = computed<InterpretationContext>(() => {
  const q = view.value === 'questions' ? current.value : null;
  const choices = view.value === 'home'
    ? [{ id: 'target:self', label: '幫自己找' }, { id: 'target:other', label: '幫家人或別人找' }]
    : view.value === 'needs' || view.value === 'search'
      ? [{ id: 'explore', label: '還不確定，帶我找' }, ...SITUATIONS.map(s => ({ id: `need:${s.id}`, label: s.label, description: s.hint }))]
      : q ? [...(q.options ?? []).map((o, i) => ({ id: `option:${i}`, label: o.label, description: optionalText(o, 'description') })), { id: 'skip', label: '不知道，先跳過' }, { id: 'results', label: '先看目前結果' }]
        : [{ id: 'needs', label: '換需求' }, { id: 'help', label: '找人幫忙' }, ...(canRefine.value ? [{ id: 'continue', label: '再回答幾題，繼續縮小' }] : []), ...(target.value === 'self' && planItems.value.length ? [{ id: 'plan', label: '看行動單' }] : [])];
  return {
    stage: view.value as InterpretationContext['stage'], target: state.session.target, choices,
    ...(q ? { question: { id: q.id, field: q.field, title: titleFor(q, target.value), kind: q.kind, min: q.min, max: q.max, options: choices.filter(c => c.id.startsWith('option:')) } } : {}),
    situations: SITUATIONS.map(({ id, label, hint }) => ({ id, label, hint })),
    situationIndex: situationIndex.value,
    knownAnswers: Object.fromEntries(allowedFields.map(field => [field, answerOf(state.session.answers, field)]).filter(([, value]) => value !== undefined)),
    currentNeed: { situationId: state.session.situation, label: SITUATIONS.find(s => s.id === state.session.situation)?.label ?? null, query: state.session.query },
    allowedFacts: (state.bank?.questions ?? []).filter(q => allowedFields.includes(q.field as FactField)).map(q => ({ field: q.field as FactField, options: q.options, min: q.min, max: q.max })),
  };
});
// 包含答案、題目、對象與資料版本；按鈕、返回、換人或資料重載都會使舊結果失效。
const fingerprint = computed(() => JSON.stringify([context.value, state.session.answers, state.session.situation, state.session.query, state.session.catalogVersion, state.session.rulesVersion, state.session.engineVersion, pendingSwitch.value]));
watch(fingerprint, () => { turn.cancel(); if (interpreting.value) { const latest = turns.value[turns.value.length - 1]; if (latest && !latest.reply) latest.reply = '流程已更新，已略過先前的理解。'; } interpreting.value = false; proposal.value = null; selectedFacts.value = []; recovery.value = null; clarification.value = null; actionProposal.value = null; searchSuggestions.value = []; }, { flush: 'sync' });
watch(() => state.session, (_session, previous) => {
  if (previous.target === null && state.session.target !== null) return;
  turn.cancel(); turns.value = []; typedAnswers.value = {}; typedTarget.value = null; typedNeed.value = null; query.value = ''; proposal.value = null; recovery.value = null; clarification.value = null; actionProposal.value = null; searchSuggestions.value = []; fallbackCount.value = 0;
}, { flush: 'sync' });
/** 這一步在對話中的先後：打招呼 → 需求 → 依題目順序 → 結果；不在目前路線上的題目排最後。 */
function stepRank(at: string): number {
  if (at === 'home') return 0;
  if (at === 'needs') return 1;
  if (at.startsWith('q:')) {
    const i = questions.value.findIndex((q) => `q:${q.id}` === at);
    return 2 + (i < 0 ? questions.value.length : i);
  }
  return Number.POSITIVE_INFINITY;
}
/** 在某一步顯示的打字往來；畫面上找不到那一步的（例如結果頁、已不在路線上的題目）一律接在最後。 */
const shownTurns = computed(() => turns.value.filter((t) => !t.hidden));
const placedSteps = computed(() => {
  const steps = new Set(['home']);
  if (past('home') && isTyped(greetKey)) steps.add('needs');
  if (past('needs') && isTyped(needKey.value)) {
    for (const q of answered.value) steps.add(`q:${q.id}`);
    if (current.value) steps.add(`q:${current.value.id}`);
  }
  return steps;
});
const turnsAt = (step: string) => shownTurns.value.filter((t) => t.at === step);
const tailTurns = computed(() => shownTurns.value.filter((t) => !placedSteps.value.has(t.at)));
function currentStep(): string {
  if (view.value === 'home') return 'home';
  if (view.value === 'needs' || view.value === 'search') return 'needs';
  if (view.value === 'questions') return `q:${current.value?.id ?? ''}`;
  return 'results';
}
/**
 * 按「修改」回到某一則（from：那一則所在的步驟）：那一則之下的訊息全部收掉，
 * 包含打字送出的原句、福利連的回覆、打字填的答案文字與進行中的理解；
 * 之後重新出現的訊息也要重新播放打字動畫，不能直接整段跳出。必須在改變流程狀態前呼叫。
 */
function rewind(from: string) {
  turn.cancel(); interpreting.value = false; query.value = ''; proposal.value = null; selectedFacts.value = []; recovery.value = null; clarification.value = null; actionProposal.value = null; searchSuggestions.value = [];
  const cut = stepRank(from);
  turns.value = turns.value.filter((t) => stepRank(t.at) < cut);
  if (cut <= 0) typedTarget.value = null;
  if (cut <= 1) { typedNeed.value = null; typedAnswers.value = {}; }
  // 修改點以上仍在畫面上的訊息保留「已播放」；被修改的那題本身也還在原處，不重打。
  const kept = new Set(['greet']);
  if (cut > 0) kept.add(needKey.value);
  questions.value.forEach((q, i) => {
    if (2 + i >= cut) delete typedAnswers.value[q.id];
    if (2 + i <= cut) kept.add(`q:${q.id}`);
  });
  for (const t of turns.value) kept.add(`turn:${t.id}:${t.reply}`);
  forgetTyped((key) => kept.has(key));
}
const statusText = computed(() => {
  const s = modelStatus.value;
  if (!s) return '正在確認裝置端模型…';
  if (s.state === 'unavailable') return s.reason;
  if (s.state === 'ready') return 'Gemma 4 E2B 已就緒，情況只在此裝置理解。';
  if (s.state === 'downloading') return `正在下載模型${s.progress === undefined ? '' : ` ${Math.round(s.progress * 100)}%`}`;
  if (s.state === 'downloaded') return '模型已下載，正在自動準備文字理解…';
  if (s.state === 'loading') return '正在載入模型，第一次可能需要較久。';
  if (s.state === 'error') return '模型未能啟動，可重試或直接使用選項。';
  return '可載入 Gemma 4 E2B，理解你輸入的情況。首次需下載模型。';
});
async function refreshModel() {
  const signal = lifecycleController.signal;
  try {
    const status = await modelAdapter.status(signal);
    if (signal.aborted) return;
    modelStatus.value = status;
    if (['downloaded', 'loading', 'downloading'].includes(status.state)) {
      downloadPrompt.value = false;
      void prepareModel();
    } else if (status.state === 'not_downloaded') {
      let dismissed = false;
      try { dismissed = sessionStorage.getItem(downloadDismissedKey) === 'yes'; } catch { /* 儲存不可用仍可詢問 */ }
      if (!dismissed) downloadPrompt.value = true;
    }
  } catch { /* 離開微服務後不再更新 */ }
}
function dismissDownload() {
  downloadPrompt.value = false;
  try { sessionStorage.setItem(downloadDismissedKey, 'yes'); } catch { /* 不影響按鈕操作 */ }
}
function acceptDownload() {
  downloadPrompt.value = false;
  void prepareModel();
}
async function prepareModel() {
  if (preparing.value) return;
  preparing.value = true;
  const controller = prepareController = new AbortController();
  const poll = async () => {
    const status = await modelAdapter.status(controller.signal).catch(() => null);
    if (controller.signal.aborted) return;
    if (status) modelStatus.value = status;
    statusTimer = setTimeout(poll, 1500);
  };
  void poll();
  try { const status = await modelAdapter.prepare(controller.signal); if (!controller.signal.aborted) modelStatus.value = status; }
  catch { /* 離開頁面或取消不更新畫面 */ }
  finally { controller.abort(); clearTimeout(statusTimer); if (prepareController === controller) { prepareController = null; preparing.value = false; } }
}
onMounted(() => { void refreshModel(); });
onBeforeUnmount(() => { lifecycleController.abort(); turn.cancel(); prepareController?.abort(); clearTimeout(statusTimer); });
function cancelInput() {
  const pendingId = proposal.value?.turnId ?? actionProposal.value?.turnId;
  turn.cancel(); interpreting.value = false; proposal.value = null; actionProposal.value = null; searchSuggestions.value = []; recovery.value = null; clarification.value = null;
  const latest = pendingId ? turns.value.find(t => t.id === pendingId) : turns.value[turns.value.length - 1];
  if (latest && (pendingId || !latest.reply)) latest.reply = '已取消理解，原本的答案與需求沒有改動。';
}
function factLabel(fact: CandidateFact): string {
  const q = state.bank?.questions.find(q => q.field === fact.field);
  const who = { self: '你', other: '對方', applicant: '目前查詢的人', unclear: '主體待確認' }[fact.subject];
  const label: Record<FactField, string> = { age: '年齡', region: '戶籍', is_student: '在學身分', household_type: '已核定家戶身分' };
  return `${fact.subjectLabel || who}・${label[fact.field]}：${q ? describeAnswer(q, fact.value) : String(fact.value)}`;
}
function chooseProposalTarget(value: 'self' | 'other') {
  const p = proposal.value; if (!p || state.session.target) return;
  requestTarget(value);
  proposal.value = { ...p, fingerprint: fingerprint.value };
}
const eligibleProposalFacts = computed(() => proposal.value?.result.facts.map((fact, index) => ({ fact, index, eligible: factApplies(fact, state.session.target) })) ?? []);
const proposalPeople = computed(() => [...new Set(eligibleProposalFacts.value.filter(row => row.eligible).map(row => row.fact.subjectLabel))]);
watch(selectedPerson, () => { selectedFacts.value = []; });
const canConfirmProposal = computed(() => !!state.session.target && !!proposal.value && (!!selectedSituation.value || selectedFacts.value.length > 0));
function confirmProposal() {
  const p = proposal.value;
  if (!p || p.fingerprint !== fingerprint.value || !canConfirmProposal.value || busy.value) return;
  const facts = selectedFacts.value.map(i => p.result.facts[i]).filter((f): f is CandidateFact => !!f && factApplies(f, state.session.target) && f.subjectLabel === selectedPerson.value);
  if (facts.length !== selectedFacts.value.length) return;
  if (new Set(facts.map(f => f.field)).size !== facts.length) { const t = turns.value.find(t => t.id === p.turnId); if (t) t.reply = '同一欄位有不同說法，請只選一項；不確定可以先不採用。'; return; }
  const situation = selectedSituation.value;
  proposal.value = null;
  // 先由既有切需求動作清理舊探索，再套用使用者確認的穩定事實。
  if (situation) selectNeed(situation);
  const applied = facts.length ? applyConfirmedFacts(facts) : true;
  const t = turns.value.find(t => t.id === p.turnId);
  if (t) t.reply = applied ? facts.length ? `好的，已記下${facts.map(f => factLabel(f)).join('、')}。${!state.session.situation && !state.session.query ? '接著先了解你需要哪方面的幫忙。' : '接著繼續確認這個需求。'}` : `好，我們先從「${SITUATIONS.find(s => s.id === situation)?.label ?? '目前方向'}」找。` : '這些資料還不能直接採用，我們用目前題目繼續確認。';
  if (applied) fallbackCount.value = 0;
  if (applied) clarification.value = { input: p.input, prompt: nextPrompt('current'), fingerprint: fingerprint.value };
  selectedFacts.value = [];
}
async function applyAnswer(result: Extract<Interpretation, { kind: 'answer' }>, text: string): Promise<boolean> {
  if ('numberValue' in result) return submit(result.numberValue, text);
  const id = result.choiceId;
  if (id.startsWith('option:')) {
    const option = current.value?.options?.[Number(id.slice(7))];
    return option ? submit(option.value, text) : false;
  }
  if (id === 'skip') return submit(undefined, text);
  if (id === 'discover') { discoverWithKnownAnswers(); return true; }
  if (id === 'show-question') { recovery.value = null; clarification.value = null; return true; }
  if (id === 'show-needs') { showRecovery(addInputTurn(text), text, '我們換個方向了解。', 'need'); return true; }
  if (id === 'rephrase') { document.getElementById('chat-search')?.focus(); return true; }
  if (id === 'target:self' || id === 'target:other') { const value = id === 'target:self' ? 'self' : 'other'; requestTarget(value); typedTarget.value = { target: value, text }; return true; }
  if (id.startsWith('need:')) { selectNeed(id.slice(5)); typedNeed.value = { situation: state.session.situation, query: state.session.query, text }; return true; }
  if (id === 'explore') { discoverWithKnownAnswers(); typedNeed.value = { situation: null, query: '', text }; return true; }
  if (id === 'results') go('results');
  else if (id === 'needs') go('needs');
  else if (id === 'help') tab('help');
  else if (id === 'continue') continueQuestions();
  else if (id === 'plan') tab('plan');
  else return false;
  return true;
}
const simpleFact = computed(() => {
  const p = proposal.value;
  if (!p || p.result.facts.length !== 1 || p.result.situationIds.length || p.result.uncertainties.length) return null;
  const fact = p.result.facts[0]!;
  if (fact.subject === 'unclear' || (state.session.target && !factApplies(fact, state.session.target)) || (!state.session.target && fact.subject === 'applicant')) return null;
  return fact;
});
const simpleCategory = computed(() => {
  const result = proposal.value?.result;
  return result && result.situationIds.length === 1 && !result.facts.length && !result.uncertainties.length ? result.situationIds[0]! : null;
});
function confirmSimpleFact() {
  const fact = simpleFact.value; if (!fact) return;
  if (!state.session.target) chooseProposalTarget(fact.subject === 'self' ? 'self' : 'other');
  selectedPerson.value = fact.subjectLabel; selectedFacts.value = [0]; confirmProposal();
}
function confirmSimpleCategory() {
  if (!simpleCategory.value) return;
  selectedSituation.value = simpleCategory.value; confirmProposal();
}
function editProposal() {
  const p = proposal.value; if (!p) return;
  const original = p.input; cancelInput(); query.value = original;
  void nextTick(() => document.getElementById('chat-search')?.focus());
}
function nextPrompt(mode: 'current' | 'need'): string {
  if (!state.session.target) return '這次要幫自己找，還是幫家人或別人找？';
  if (mode === 'need') return '你現在最想減輕哪方面的負擔？也可以選「還不確定，帶我找」。';
  if (view.value === 'questions' && current.value) return titleFor(current.value, target.value);
  return view.value === 'results' ? '接下來想繼續縮小範圍，還是換個需求？' : '目前最需要減輕哪一筆支出，或解決什麼困難？';
}
function showRecovery(id: number, input: string, lead: string, mode: 'current' | 'need' = 'current') {
  const prompt = nextPrompt(mode);
  fallbackCount.value++;
  searchSuggestions.value = [];
  const t = turns.value.find(t => t.id === id); if (t) t.reply = `${lead} ${prompt}${fallbackCount.value >= 2 ? ' 也可以直接選下方選項，或找人幫忙。' : ''}`;
  recovery.value = { turnId: id, mode };
  clarification.value = { input: input.slice(-1600), prompt, fingerprint: fingerprint.value };
}
const recoveryChoices = computed(() => {
  if (!recovery.value) return [];
  if (!state.session.target) return [{ id: 'target:self', label: '幫自己找' }, { id: 'target:other', label: '幫家人或別人找' }];
  if (recovery.value.mode === 'need') return [...SITUATIONS.map(s => ({ id: `need:${s.id}`, label: s.label })), { id: 'discover', label: '還不確定，帶我找' }, { id: 'help', label: '找人幫忙' }];
  if (view.value === 'questions' && current.value) return [...(current.value.options ?? []).map((o, i) => ({ id: `option:${i}`, label: o.label })), { id: 'skip', label: '不知道，先跳過' }, { id: 'show-question', label: '回到目前題目' }, { id: 'show-needs', label: '改說其他需求' }, { id: 'help', label: '找人幫忙' }];
  return [{ id: 'discover', label: '還不確定，帶我找' }, { id: 'show-needs', label: '選一個需求方向' }, { id: 'rephrase', label: '我再說清楚一點' }, { id: 'help', label: '找人幫忙' }];
});
async function recoverWith(id: string) {
  if (id === 'rephrase') { document.getElementById('chat-search')?.focus(); return; }
  if (id === 'show-question') { recovery.value = null; return; }
  if (id === 'show-needs') { if (recovery.value) recovery.value.mode = 'need'; return; }
  if (id === 'discover') { cancelInput(); discoverWithKnownAnswers(); return; }
  if (id.startsWith('need:')) {
    const recoveryTurn = recovery.value?.turnId;
    const t = turns.value.find(t => t.id === recoveryTurn);
    const input = t?.text ?? SITUATIONS.find(s => s.id === id.slice(5))?.label ?? '';
    recovery.value = null;
    proposal.value = { result: { kind: 'situation', situationIds: [id.slice(5)], facts: [], details: [], uncertainties: [] }, fingerprint: fingerprint.value, turnId: recoveryTurn ?? ++turnId, input };
    selectedSituation.value = ''; return;
  }
  const previous = clarification.value;
  const recoveryTurnId = recovery.value?.turnId;
  const initialTarget = state.session.target === null;
  recovery.value = null;
  await applyAnswer({ kind: 'answer', choiceId: id, evidence: '' }, context.value.choices.find(c => c.id === id)?.label ?? id);
  if (initialTarget && previous && state.session.target) {
    const latest = turns.value.find(t => t.id === recoveryTurnId);
    clarification.value = { ...previous, prompt: nextPrompt('need'), fingerprint: fingerprint.value };
    if (latest) latest.reply = `好，${nextPrompt('need')}`;
  }
}
// 決策只對「目前看得到的提問」生效，不能回答被確認卡遮住的背景題。
function activeInputContext(): InterpretationContext {
  if (proposal.value || actionProposal.value) return { ...context.value, question: undefined, choices: [] };
  if (!recovery.value) return context.value;
  const choices = recoveryChoices.value;
  const useQuestion = recovery.value.mode === 'current' && view.value === 'questions';
  return { ...context.value, choices, question: useQuestion ? context.value.question : undefined, followupQuestion: clarification.value?.prompt };
}
function addInputTurn(text: string, reply = '') {
  const id = ++turnId; turns.value.push({ id, text, reply, at: currentStep() }); return id;
}
function offerChoices(id: number, text: string, choices: ChatChoice[], lead: string) {
  recovery.value = null; proposal.value = null; searchSuggestions.value = [];
  actionProposal.value = { kind: 'choice', choices, text, turnId: id, fingerprint: fingerprint.value };
  const t = turns.value.find(t => t.id === id);
  if (t) t.reply = choices.length === 1 ? `${lead}你是指「${choices[0]!.label}」嗎？` : `${lead}請選你要表達的那一項。`;
}
function offerSearch(id: number, text: string, searchQuery: string) {
  recovery.value = null; proposal.value = null; searchSuggestions.value = [];
  actionProposal.value = { kind: 'search', query: searchQuery, text, turnId: id, fingerprint: fingerprint.value };
  const t = turns.value.find(t => t.id === id);
  if (t) t.reply = !state.session.target ? `要找「${searchQuery}」，這次是幫自己還是別人找？` : `你是要改查「${searchQuery}」嗎？確認後會切換查找方向，已確認的基本資料與行動單會保留。`;
}
function executeSearch(id: number, text: string, searchQuery: string) {
  if (searchQuery.length > 100) { showRecovery(id, text, '名稱較長，請改用不超過 100 字的名稱或關鍵字；原本進度都保留。', 'need'); return; }
  const matches = state.catalog ? filterCatalog(state.catalog.items, null, searchQuery) : [];
  const t = turns.value.find(t => t.id === id);
  if (!matches.length) {
    showRecovery(id, text, `沒有找到「${searchQuery}」。這不代表你沒有可申請的福利，原本資料都保留。`, 'need');
    searchSuggestions.value = suggestSearchQueries(searchQuery, state.catalog?.items ?? []);
    return;
  }
  searchResources(searchQuery);
  typedNeed.value = { situation: null, query: state.session.query, text };
  fallbackCount.value = 0;
  if (t) t.reply = `找到 ${matches.length} 項名稱或內容相關的資源，接著確認你的情況；相關不代表符合資格。`;
}
async function confirmAction(choiceId?: string) {
  const p = actionProposal.value;
  if (!p || p.fingerprint !== fingerprint.value || busy.value || applyingInput.value) return;
  if (p.kind === 'search' && !state.session.target) return;
  const choice = p.kind === 'choice' ? p.choices.find(c => c.id === (choiceId ?? (p.choices.length === 1 ? p.choices[0]!.id : ''))) : null;
  if (p.kind === 'choice' && !choice) return;
  applyingInput.value = true;
  actionProposal.value = null; clarification.value = null;
  try {
    if (p.kind === 'search') { executeSearch(p.turnId, p.text, p.query); return; }
    const answer: Extract<Interpretation, { kind: 'answer' }> = p.kind === 'number'
      ? { kind: 'answer', numberValue: p.value, evidence: p.text }
      : { kind: 'answer', choiceId: choice!.id, evidence: p.text };
    const ok = await applyAnswer(answer, p.text);
    const t = turns.value.find(t => t.id === p.turnId);
    if (ok) {
      fallbackCount.value = 0;
      if (t) t.reply = pendingSwitch.value ? '請先確認是否切換查詢對象。' : `好，已採用「${p.kind === 'number' ? p.label : choice!.label}」。`;
    } else showRecovery(p.turnId, p.text, '目前題目已改變，請依現在這題重新選擇。');
  } finally { applyingInput.value = false; }
}
function chooseSearchTarget(value: 'self' | 'other') {
  const p = actionProposal.value;
  if (!p || p.kind !== 'search' || state.session.target) return;
  requestTarget(value);
  if (state.session.target !== value) return;
  actionProposal.value = { ...p, fingerprint: fingerprint.value };
  void confirmAction();
}
function rejectAction() {
  const p = actionProposal.value; if (!p) return;
  cancelInput();
  const t = turns.value.find(t => t.id === p.turnId);
  if (t) t.reply = '好，這項建議沒有採用，原本的資料與進度都保留。你可以重說，或繼續目前問題。';
}
function suggestSearch(queryText: string) {
  const id = addInputTurn(queryText);
  offerSearch(id, queryText, queryText);
}
async function onInput() {
  const text = query.value.trim();
  if (!text || busy.value || interpreting.value || applyingInput.value || pendingSwitch.value) return;
  if (text.length > 2000) { addInputTurn('（內容過長）', '請每次輸入不超過 2000 字，分段補充。原文仍留在輸入欄。'); return; }
  const normalized = normalizeInput(text);
  const plainConfirmation = !/[?？「」『』"'`“”‘’]/u.test(text);
  const isYes = plainConfirmation && /^(對|是|是的|沒錯|正確|對的|對繼續|請繼續|確認|好|好的|ok|yes)$/u.test(normalized);
  const isNo = plainConfirmation && /^(不是|不對|否|不要|取消|先不要|不要了|算了|no)$/u.test(normalized);
  query.value = '';
  // 確認與修正永遠先於背景問題、名稱搜尋或模型。
  if (actionProposal.value) {
    const p = actionProposal.value;
    if (isNo) { rejectAction(); addInputTurn(text, '好，維持原本進度。'); return; }
    if (p.kind === 'search' && !state.session.target) {
      const targetContext = { ...context.value, question: undefined, choices: [{ id: 'target:self', label: '幫自己找' }, { id: 'target:other', label: '幫家人或別人找' }] };
      const selected = matchCurrentChoice(text, targetContext);
      if (selected?.kind === 'answer' && 'choiceId' in selected.answer) {
        chooseSearchTarget(selected.answer.choiceId === 'target:self' ? 'self' : 'other'); return;
      }
    }
    if (isYes) {
      if (p.kind === 'choice' && p.choices.length !== 1) addInputTurn(text, '有幾個可能的選項，請選一個，我不會替你猜。');
      else if (p.kind === 'search' && !state.session.target) addInputTurn(text, '請先選這次要幫自己還是別人找。');
      else { addInputTurn(text); await confirmAction(); }
      return;
    }
    if (p.kind === 'choice') {
      const selected = matchCurrentChoice(text, { ...context.value, question: undefined, choices: p.choices });
      if (selected?.kind === 'answer' && 'choiceId' in selected.answer) { addInputTurn(text); await confirmAction(selected.answer.choiceId); return; }
      if (selected?.kind === 'confirm_choice' && selected.reason === 'ambiguous' && selected.choices.length === 1
        && p.choices.some(c => c.id === selected.choices[0]!.id)) {
        addInputTurn(text); await confirmAction(selected.choices[0]!.id); return;
      }
      // 分類精確字串本身仍會回確認，此處已經在確認中，唯一精確匹配才能採用。
      const exact = p.choices.filter(c => normalizeInput(c.label) === normalized);
      if (plainConfirmation && exact.length === 1) { addInputTurn(text); await confirmAction(exact[0]!.id); return; }
    }
  }
  if (proposal.value && !state.session.target && !isYes) {
    const selected = matchCurrentChoice(text, { ...context.value, question: undefined, choices: [{ id: 'target:self', label: '幫自己找' }, { id: 'target:other', label: '幫家人或別人找' }] });
    if (selected?.kind === 'answer' && 'choiceId' in selected.answer) {
      const value = selected.answer.choiceId === 'target:self' ? 'self' : 'other';
      chooseProposalTarget(value); typedTarget.value = { target: value, text }; return;
    }
  }
  if (proposal.value && isYes) {
    const id = addInputTurn(text); const fact = simpleFact.value; const category = simpleCategory.value;
    if (fact) { confirmSimpleFact(); const t = turns.value.find(t => t.id === id); if (t) t.reply = '好，我們接著往下聊。'; }
    else if (category && state.session.target) { confirmSimpleCategory(); const t = turns.value.find(t => t.id === id); if (t) t.reply = '好，先從這個方向了解。'; }
    else { const t = turns.value.find(t => t.id === id); if (t) t.reply = !state.session.target ? '請先選這次要幫誰找，才不會把資料套到不同人。' : '請先選同一位的資料與要處理的方向，再按確認；不會一次全部套用。'; }
    return;
  }
  if (proposal.value && plainConfirmation && /^(不是|不對|我要修改|改一下)$/u.test(normalized)) {
    editProposal(); addInputTurn(text, '好，請修改輸入內容，或補充哪裡不同。'); return;
  }
  if (proposal.value && isNo) { cancelInput(); addInputTurn(text, '好，維持原本的資料與進度。'); return; }
  const routingContext = activeInputContext();
  const route = routeInput(text, routingContext, state.catalog?.items ?? []);
  if (route.kind === 'empty') return;
  if (route.kind === 'command') {
    cancelInput();
    if (route.command === 'back') back();
    else if (route.command === 'help') tab('help');
    else if (route.command === 'restart') pendingSwitch.value = 'clear';
    else addInputTurn(text, '已取消尚未確認的內容，原本資料仍保留。');
    return;
  }
  const previous = proposal.value?.input ?? (clarification.value?.fingerprint === fingerprint.value ? clarification.value.input : '');
  const previousPrompt = proposal.value ? turns.value.find(t => t.id === proposal.value?.turnId)?.reply : clarification.value?.prompt;
  // 舊說法只用於明確補充／修正，不能讓換話題重複採用前人的條件。
  const isCorrection = /^(不是|不對|改成|更正|其實|應該是|剛剛|我是說|補充|另外|還有)/u.test(text);
  const inferenceInput = isCorrection && previous && previous.length + text.length + 24 <= 2000
    ? `先前說法：${previous}\n這次補充或修正：${text}` : text;
  cancelInput();
  const id = addInputTurn(text);
  if (route.kind === 'clarify') { showRecovery(id, text, route.message); return; }
  if (route.kind === 'confirm_choice') { offerChoices(id, text, route.choices, route.reason === 'typo' ? '這句可能有個錯字。' : ''); return; }
  if (route.kind === 'search') {
    const matches = state.catalog ? filterCatalog(state.catalog.items, null, route.query) : [];
    if (!matches.length) { executeSearch(id, text, route.query); return; }
    if (!state.session.target || view.value === 'questions' || state.session.situation || state.session.query) offerSearch(id, text, route.query);
    else executeSearch(id, text, route.query);
    return;
  }
  if (route.kind === 'answer') {
    applyingInput.value = true;
    try {
      const ok = await applyAnswer(route.answer, text);
      const t = turns.value.find(t => t.id === id);
      if (ok) {
        fallbackCount.value = 0;
        if (t && ('numberValue' in route.answer || ('choiceId' in route.answer && /^(option:|skip$|target:|need:|explore$)/.test(route.answer.choiceId)))) t.hidden = true;
        else if (t) t.reply = '好，我們接著往下看。';
      } else showRecovery(id, text, '這個答案目前不能採用，請依現在的題目再選一次。');
    } finally { applyingInput.value = false; }
    return;
  }
  const snapshot = fingerprint.value;
  const inputContext = { ...routingContext, ...(previousPrompt ? { followupQuestion: previousPrompt } : {}) };
  interpreting.value = true;
  try {
    const localFact = explicitSelfAge(text);
    if (!localFact && modelStatus.value?.state !== 'ready') {
      query.value = text;
      showRecovery(id, text, preparing.value ? '文字理解仍在準備中，這句尚未送出。已保留在輸入欄，就緒後可以再送出。' : '文字理解目前無法使用，這句尚未送出。已保留在輸入欄，也可直接選選項。');
      return;
    }
    let result = localFact ?? await turn.run(snapshot, () => fingerprint.value, signal => modelAdapter.interpret(inferenceInput, inputContext, signal));
    if (result?.kind === 'answer' && 'choiceId' in result && result.choiceId.startsWith('need:')) result = { kind: 'situation', situationIds: [result.choiceId.slice(5)], facts: [], details: [text], uncertainties: [] };
    if (!result || snapshot !== fingerprint.value) return;
    const t = turns.value.find(t => t.id === id); if (!t) return;
    if (result.kind === 'answer') {
      // 模型輸出格式通過不等於意思正確；非確定性語意答案一律讓本人確認。
      if ('choiceId' in result) {
        const choiceId = result.choiceId;
        const choice = inputContext.choices.find(c => c.id === choiceId);
        if (choice) offerChoices(id, text, [choice], '我把你的說法理解為目前題目的答案。');
        else showRecovery(id, text, '目前沒有這個選項，請再確認一次。');
      } else {
        const label = `${result.numberValue}${inputContext.question?.field === 'age' ? '歲' : ''}`;
        actionProposal.value = { kind: 'number', value: result.numberValue, label, text, turnId: id, fingerprint: snapshot };
        t.reply = `你的意思是「${label}」嗎？確認後才會填入目前這題。`;
      }
    } else if (result.kind === 'situation') {
      if (!result.situationIds.length && !result.facts.length) {
        showRecovery(id, text, result.details.length ? `我聽到你提到「${result.details.join('、')}」。` : '我還需要多了解一點。', 'need'); return;
      }
      proposal.value = { result, fingerprint: snapshot, turnId: id, input: localFact ? text : inferenceInput };
      selectedFacts.value = []; selectedSituation.value = ''; selectedPerson.value = '';
      t.reply = result.facts.length === 1 && !result.situationIds.length ? `你提到${factLabel(result.facts[0]!)}，這樣理解對嗎？` : result.situationIds.length === 1 && !result.facts.length ? `你是想找「${SITUATIONS.find(s => s.id === result.situationIds[0])?.label}」這方面的幫忙嗎？` : '我聽到了幾項情況。先確認同一位的資料，再挑最想處理的方向。';
    } else showRecovery(id, text, result.kind === 'off_topic' ? '我主要協助找補助與生活資源，我們回到你需要的幫忙。' : '我還沒理解完整，我們先確認一件事。');
  } catch (error) {
    if (snapshot === fingerprint.value) showRecovery(id, text, error instanceof ModelInputTooLongError ? error.message : '這次沒能整理完整，原本資料都保留。可以換個說法，或直接選下方選項。');
  } finally { if (snapshot === fingerprint.value) interpreting.value = false; }
}

</script>

<template>
  <div class="chat">
    <h1 class="sr-only">福利連對話</h1>
    <ConfirmDialog :open="downloadPrompt" title="下載裝置端文字理解模型？" confirm-label="同意下載並啟用" @confirm="acceptDownload" @cancel="dismissDownload">
      <p>下載約 2.6 GB 的 Gemma 4 E2B 後，就能用自己的話描述情況。文字會在手機上理解。</p>
      <p>建議使用 Wi-Fi 並保留足夠空間。下載完成會自動啟用，以後每次開啟補助專區也會自動載入。</p>
      <p>取消仍可使用選項與名稱搜尋，下次開啟補助專區會再詢問。</p>
    </ConfirmDialog>
    <p v-if="modelStatus?.state === 'downloading'" class="chat__system" role="status">{{ statusText }}，下載期間可以先使用選項。</p>
    <p v-else-if="modelStatus?.state === 'error'" class="chat__system" role="status">{{ statusText }} <button type="button" class="btn" @click="prepareModel">重試</button></p>
    <section ref="log" class="chat__log" aria-label="對話紀錄">
      <p class="chat__day" aria-hidden="true">你的回答只存在這支手機，不會傳出去</p>

      <!-- 1. 打招呼與選對象 -->
      <BotMessage :msg-key="greetKey" :lines="greetLines" :active="view === 'home'">
        <template v-if="view === 'home'" #after>
          <div class="replies" role="group" aria-label="查詢對象">
            <button type="button" class="reply" aria-label="幫自己找" @click="requestTarget('self')">
              <span class="reply__label">幫自己找</span>
              <span class="reply__sub">依你的情況查詢，可加入行動單</span>
            </button>
            <button type="button" class="reply" aria-label="幫家人或別人找" @click="requestTarget('other')">
              <span class="reply__label">幫家人或別人找</span>
              <span class="reply__sub">依對方情況查詢，匯出申請準備 PDF</span>
            </button>
          </div>
        </template>
      </BotMessage>
      <TurnMessages :turns="turnsAt('home')" />

      <template v-if="past('home') && isTyped(greetKey)">
        <UserMessage :text="typedTarget?.target === state.session.target ? typedTarget.text : targetLabel" edit-label="修改對象" @edit="rewind('home'); tab('home')" />

        <!-- 2. 選需求 -->
        <BotMessage :key="needKey" :msg-key="needKey" :lines="needLines" :active="view === 'needs' || view === 'search'">
          <template v-if="!past('needs')" #after>
            <p v-if="state.loading" class="chat__status" role="status">資料載入中…</p>
            <div class="replies" role="group" aria-label="需要的幫忙">
              <button type="button" class="reply reply--primary" :disabled="busy" @click="startExplore">
                <span class="reply__label">還不確定，帶我找</span>
                <span class="reply__sub">從簡單的問題開始，逐步縮小範圍</span>
              </button>
              <div class="replies__grid">
                <button
                  v-for="s in SITUATIONS"
                  :key="s.id"
                  type="button"
                  class="reply reply--chip"
                  :disabled="busy"
                  :aria-label="s.label"
                  :aria-describedby="`need-${s.id}-hint`"
                  @click="selectNeed(s.id)"
                >
                  <span class="reply__label">{{ s.label }}</span>
                  <span :id="`need-${s.id}-hint`" class="reply__sub">
                    <span v-for="(phrase, i) in s.hint.split('、')" :key="i" class="reply__phrase">{{ phrase }}{{ i < s.hint.split('、').length - 1 ? '、' : '' }}</span>
                  </span>
                </button>
              </div>
              <p class="chat__tip">也可以直接輸入需求或資源名稱。</p>
            </div>
          </template>
        </BotMessage>
        <TurnMessages :turns="turnsAt('needs')" />

        <template v-if="past('needs') && isTyped(needKey)">
          <UserMessage :text="typedNeed && typedNeed.situation === state.session.situation && typedNeed.query === state.session.query ? typedNeed.text : needAnswer" edit-label="修改需求" @edit="rewind('needs'); go('needs')" />

          <!-- 3. 問答紀錄：在這題打字的往來排在題目前（與作答當下的順序一致） -->
          <template v-for="q in answered" :key="q.id">
            <TurnMessages :turns="turnsAt(`q:${q.id}`)" />
            <BotMessage :msg-key="`q:${q.id}`" :lines="qLines(q, false)" />
            <UserMessage :text="answerText(q)" edit-label="修改答案" @edit="editQuestion(q)" />
          </template>

          <TurnMessages v-if="current" :turns="turnsAt(`q:${current.id}`)" />
          <!-- 目前的題目：確認完成後接在使用者原句與回覆之後 -->
          <template v-if="view === 'questions'">

            <BotMessage v-if="current && !proposal && !actionProposal && !recovery && !interpreting" :key="`q:${current.id}`" :msg-key="`q:${current.id}`" :lines="qLines(current, true)" active>
              <template v-if="current.kind === 'number'">
                <WheelPicker
                  v-model="wheelValue"
                  :min="current.min ?? 0"
                  :max="current.max ?? MAX_AGE"
                  :unit="numberUnit(current)"
                  :label="current.field === 'age' ? '年齡（實歲）' : titleFor(current, target)"
                />
              </template>

              <template #after>
                <div :key="current.id" class="replies" role="group" :aria-label="titleFor(current, target)">
                  <template v-if="current.kind === 'number'">
                    <button type="button" class="reply reply--primary reply--center" @click="submit(wheelValue)">
                      <span class="reply__label">就是 {{ wheelValue }} {{ numberUnit(current) }}</span>
                    </button>
                  </template>
                  <template v-else>
                    <button
                      v-for="opt in current.options"
                      :key="String(opt.value)"
                      type="button"
                      class="reply"
                      :aria-label="opt.label"
                      @click="submit(opt.value)"
                    >
                      <span class="reply__label">{{ opt.label }}</span>
                      <span v-if="optionalText(opt, 'description')" class="reply__sub">{{ optionalText(opt, 'description') }}</span>
                    </button>
                  </template>
                  <div class="replies__row">
                    <button type="button" class="reply reply--quiet" @click="submit(undefined)">
                      <span class="reply__label">不知道，先跳過</span>
                    </button>
                    <button type="button" class="reply reply--quiet" @click="go('results')">
                      <span class="reply__label">先看目前結果</span>
                    </button>
                  </div>
                </div>
              </template>
            </BotMessage>

            <BotMessage
              v-else-if="state.loading"
              key="q-loading"
              msg-key="q-loading"
              :lines="[{ text: '題目載入中，請稍候。' }]"
              active
            />
            <BotMessage
              v-else-if="!current"
              key="q-empty"
              msg-key="q-empty"
              :lines="[
                { text: '沒有其他能幫忙縮小的問題了，可以先看結果。', tone: 'title' },
                { text: '目前仍有條件需要確認，請在每一項的詳情看原文或問承辦窗口。', tone: 'muted' },
              ]"
              active
            >
              <template #after>
                <div class="replies">
                  <button type="button" class="reply reply--primary reply--center" @click="go('results')">
                    <span class="reply__label">看結果</span>
                  </button>
                </div>
              </template>
            </BotMessage>
          </template>

          <!-- 4. 結果 -->
          <template v-if="view === 'results'">

            <BotMessage :key="resultsKey" :msg-key="resultsKey" :lines="resultLines" active wide>
              <ul v-if="recommended.length" class="cards" aria-label="建議先了解">
                <li v-for="item in recommended" :key="item.id">
                  <ResultCard :item="item" :result="results.get(item.id)" />
                </li>
              </ul>
            </BotMessage>

            <BotMessage v-if="isTyped(resultsKey) && sections.length" :key="sectionsKey" :msg-key="sectionsKey" :lines="[{ text: '另外還有這些，點開可以看：' }]" wide>
              <div class="bubble-groups">
                <details v-for="s in sections" :key="s.key" v-smooth-details class="bubble-more" :open="s.key === 'ineligible' ? state.showIneligible : undefined"
                  @toggle="s.key === 'ineligible' && (state.showIneligible = ($event.target as HTMLDetailsElement).open)">
                  <summary>{{ s.title }}（{{ s.list.length }}）</summary>
                  <p class="bubble-more__note">{{ s.note }}</p>
                  <ul class="cards" :aria-label="s.title">
                    <li v-for="item in s.list.slice(0, shownCount[s.key] ?? PAGE)" :key="item.id">
                      <ResultCard :item="item" :result="results.get(item.id)" />
                    </li>
                  </ul>
                  <button
                    v-if="(shownCount[s.key] ?? PAGE) < s.list.length"
                    type="button"
                    class="btn btn--block"
                    @click="shownCount[s.key] = (shownCount[s.key] ?? PAGE) + PAGE"
                  >
                    再看 {{ Math.min(PAGE, s.list.length - (shownCount[s.key] ?? PAGE)) }} 項<span class="sr-only">：{{ s.title }}</span>
                  </button>
                </details>
              </div>
            </BotMessage>

            <BotMessage v-if="isTyped(resultsKey) && (!sections.length || isTyped(sectionsKey))" :key="nextKey" :msg-key="nextKey" :lines="nextLines">
              <template #after>
                <div class="replies">
                  <button v-if="canRefine" type="button" class="reply reply--primary" @click="continueQuestions">
                    <span class="reply__label">{{ answeredCount ? '再回答幾題，繼續縮小' : '回答幾題，縮小範圍' }}</span>
                  </button>
                  <button v-if="target === 'self' && planItems.length" type="button" class="reply" @click="tab('plan')">
                    <span class="reply__label">看行動單（{{ planItems.length }} 項）</span>
                  </button>
                  <div class="replies__row">
                    <button v-if="answeredCount" type="button" class="reply reply--quiet" @click="redoAnswers"><span class="reply__label">改答案</span></button>
                    <button type="button" class="reply reply--quiet" @click="go('needs')"><span class="reply__label">換需求</span></button>
                    <button v-if="!exploring && state.session.target" type="button" class="reply reply--quiet" @click="startExplore"><span class="reply__label">帶我找</span></button>
                    <button type="button" class="reply reply--quiet" @click="tab('help')"><span class="reply__label">找人幫忙</span></button>
                  </div>
                </div>
              </template>
            </BotMessage>
          </template>
        </template>
      </template>
      <TurnMessages :turns="tailTurns" />
      <section v-if="actionProposal" class="conversation-proposal" aria-labelledby="action-proposal-title">
        <h2 id="action-proposal-title">{{ actionProposal.kind === 'search' ? '確認查找方向' : '確認你的意思' }}</h2>
        <template v-if="actionProposal.kind === 'search'">
          <p>查找「{{ actionProposal.query }}」</p>
          <div v-if="!state.session.target" class="replies__row">
            <button type="button" class="btn" :disabled="busy || applyingInput" @click="chooseSearchTarget('self')">幫自己找</button>
            <button type="button" class="btn" :disabled="busy || applyingInput" @click="chooseSearchTarget('other')">幫家人或別人找</button>
          </div>
          <button v-else type="button" class="btn btn--primary" :disabled="busy || applyingInput" @click="confirmAction()">對，查找這個名稱</button>
        </template>
        <div v-else-if="actionProposal.kind === 'choice'" class="replies" role="group" aria-label="請確認選項">
          <button v-for="choice in actionProposal.choices" :key="choice.id" type="button" class="reply" :disabled="busy || applyingInput" @click="confirmAction(choice.id)"><span class="reply__label">{{ choice.label }}</span></button>
        </div>
        <button v-else type="button" class="btn btn--primary" :disabled="busy || applyingInput" @click="confirmAction()">對，是 {{ actionProposal.label }}</button>
        <button type="button" class="btn" :disabled="applyingInput" @click="rejectAction">不是，維持原本進度</button>
      </section>
      <section v-if="proposal" class="conversation-proposal" aria-labelledby="proposal-title">
        <h2 id="proposal-title">{{ simpleFact ? '確認這項資料' : simpleCategory ? '確認想找的方向' : '先確認我整理的內容' }}</h2>
        <template v-if="simpleFact">
          <p>{{ factLabel(simpleFact) }}</p>
          <div class="replies__row">
            <button type="button" class="btn btn--primary" :disabled="busy" @click="confirmSimpleFact">{{ !state.session.target ? simpleFact.subject === 'self' ? '對，幫我繼續找' : `對，幫${simpleFact.subjectLabel}找` : '對，記下來繼續' }}</button>
            <button type="button" class="btn" @click="editProposal">不是，我改一下</button>
            <button type="button" class="btn" @click="cancelInput">先不改</button>
          </div>
        </template>
        <template v-else-if="simpleCategory">
          <template v-if="!state.session.target">
            <p>好的，先告訴我這次是幫誰找？</p>
            <div class="replies__row"><button type="button" class="btn" @click="chooseProposalTarget('self')">幫自己找</button><button type="button" class="btn" @click="chooseProposalTarget('other')">幫家人或別人找</button></div>
          </template>
          <div class="replies__row"><button type="button" class="btn btn--primary" :disabled="!state.session.target || busy" @click="confirmSimpleCategory">對，先找這方面</button><button type="button" class="btn" @click="editProposal">不是，我再說清楚</button><button type="button" class="btn" @click="cancelInput">先不改</button></div>
        </template>
        <template v-else>
        <p>一輪只查一位；請只勾選同一位的資料。沒有勾選的內容不會填入答案。</p>
        <template v-if="!state.session.target">
          <p>這次要幫誰找？選完再確認下面的內容。</p>
          <div class="replies__row"><button type="button" class="btn" @click="chooseProposalTarget('self')">幫自己找</button><button type="button" class="btn" @click="chooseProposalTarget('other')">幫家人或別人找</button></div>
        </template>
        <ul v-if="proposal.result.details.length"><li v-for="detail in proposal.result.details" :key="detail">你提到：「{{ detail }}」</li></ul>
        <fieldset v-if="proposal.result.situationIds.length">
          <legend>想先找哪方面？選擇後仍要按下確認。</legend>
          <label v-for="id in proposal.result.situationIds" :key="id" class="conversation-choice"><input v-model="selectedSituation" type="radio" name="proposed-situation" :value="id" />{{ SITUATIONS.find(s => s.id === id)?.label }}</label>
          <label class="conversation-choice"><input v-model="selectedSituation" type="radio" name="proposed-situation" value="" />先維持目前方向</label>
        </fieldset>
        <fieldset v-if="proposalPeople.length">
          <legend>這次要採用哪一位的條件？</legend>
          <label v-for="person in proposalPeople" :key="person" class="conversation-choice"><input v-model="selectedPerson" type="radio" name="proposed-person" :value="person" />{{ person }}</label>
          <p v-if="proposalPeople.length > 1">每次只選一位。若不同稱呼是同一人，可以在輸入列補充，我會重新整理。</p>
        </fieldset>
        <fieldset v-if="eligibleProposalFacts.length">
          <legend>可採用的條件（逐項確認，預設不採用）</legend>
          <label v-for="row in eligibleProposalFacts" :key="row.index" class="conversation-choice">
            <input v-model="selectedFacts" type="checkbox" :value="row.index" :disabled="!row.eligible || row.fact.subjectLabel !== selectedPerson" />
            <span>{{ factLabel(row.fact) }}<small>原文：「{{ row.fact.evidence }}」</small><small v-if="!row.eligible">對象不符或不明，請先釐清，不會套用。</small></span>
          </label>
        </fieldset>
        <div v-if="proposal.result.uncertainties.length"><p>還要確認：</p><ul><li v-for="item in proposal.result.uncertainties" :key="item">{{ item }}</li></ul></div>
        <template v-if="proposal.result.facts.length && !eligibleProposalFacts.some(row => row.eligible) && state.session.target">
          <p>這些資料不是目前查詢對象的條件。你要換一位查，還是繼續幫目前這位找？</p>
          <button v-if="proposal.result.facts.some(f => f.subject === 'self') && state.session.target === 'other'" type="button" class="btn" @click="requestTarget('self')">這是我，改幫自己找</button>
          <button v-if="proposal.result.facts.some(f => f.subject === 'other') && state.session.target === 'self'" type="button" class="btn" @click="requestTarget('other')">這是家人，改幫別人找</button>
          <button type="button" class="btn" @click="editProposal">補充目前這位的情況</button>
        </template>
        <p>生活困難不等於已核定低收入戶，居住地也不等於戶籍。資格仍依原文及承辦機關審核。</p>
        <div class="replies__row"><button type="button" class="btn btn--primary" :disabled="!canConfirmProposal || busy" @click="confirmProposal">確認採用所選內容</button><button type="button" class="btn" @click="cancelInput">先不要，繼續原本流程</button></div>
        </template>
      </section>
      <div v-if="searchSuggestions.length" class="replies" role="group" aria-label="可能想找的名稱">
        <button v-for="suggestion in searchSuggestions" :key="suggestion" type="button" class="reply" @click="suggestSearch(suggestion)"><span class="reply__label">你是要找「{{ suggestion }}」嗎？</span></button>
      </div>
      <div v-if="recovery" class="replies conversation-recovery" role="group" aria-label="接著可以這樣做">
        <button v-for="choice in recoveryChoices" :key="choice.id" type="button" class="reply reply--chip" :disabled="busy" @click="recoverWith(choice.id)"><span class="reply__label">{{ choice.label }}</span></button>
      </div>
      <div v-if="interpreting" class="msg msg--bot">
        <span class="avatar" aria-hidden="true"><LogoMark thinking /></span>
        <div class="msg__col">
          <p class="bubble bubble--bot thinking__text" role="status">正在裝置上理解你的說法…</p>
          <div class="msg__after"><button type="button" class="btn" @click="cancelInput">取消</button></div>
        </div>
      </div>
    </section>

    <form class="composer no-print conversation-composer" @submit.prevent="onInput">
      <label class="sr-only" for="chat-search">輸入目前選項、補助名稱，或說說你的情況</label>
      <input
        id="chat-search"
        v-model="query"
        class="composer__input"
        type="text"
        enterkeyhint="send"
        maxlength="2000"
        placeholder="輸入選項、補助名稱，或說說你的情況"
        :disabled="busy || !!pendingSwitch"
      />
      <button type="submit" class="composer__send" :disabled="busy || interpreting || applyingInput || !!pendingSwitch || !query.trim()">
        <span class="sr-only">送出</span>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </form>
  </div>
</template>

<style scoped>
.conversation-composer { flex-wrap: wrap; }
.conversation-modes { display: flex; flex-basis: 100%; gap: .5rem; }
.conversation-modes button { min-height: 48px; padding: .5rem .75rem; border: 0; border-radius: .5rem; background: transparent; color: var(--muted); font: inherit; }
.conversation-modes button[aria-pressed='true'] { background: var(--raised); color: var(--accent); font-weight: 600; }
.conversation-proposal { margin: 1rem 0; padding: 1rem; border: 1px solid var(--line); border-radius: var(--radius); overflow-wrap: anywhere; }
.conversation-proposal h2 { margin: 0 0 .75rem; font-size: 1.125rem; }
.conversation-proposal p { margin: .75rem 0; }
.conversation-proposal fieldset { min-width: 0; margin: 1rem 0; border: 0; padding: 0; }
.conversation-choice { display: flex; align-items: center; gap: .75rem; min-height: 48px; padding: .5rem 0; }
.conversation-choice input { width: 1.25rem; height: 1.25rem; flex-shrink: 0; accent-color: var(--accent); }
.conversation-choice small { display: block; margin-top: .3rem; color: var(--muted); font-size: .875rem; }
</style>
