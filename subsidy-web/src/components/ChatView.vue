<script setup lang="ts">
// 「找資源」的對話介面：選對象 → 選需求或搜尋 → 逐題問答 → 結果。
// 流程與判斷全部沿用 store；這裡只把同一份狀態排成一則則訊息。
// 對話紀錄由狀態推導：點自己過去的回答即可回到那一步修改。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { followBottom, isTyped, trackPinned, type Line } from '../chat/typing';
import { answerOf, describeAnswer, MAX_AGE, titleFor } from '../domain/questions';
import { SITUATIONS } from '../domain/situations';
import type { Question, Subsidy } from '../domain/types';
import { distinctGroups, insightLine, narrowingNote, numberUnit, optionalText, rangeLine } from '../presentation';
import {
  answerAndAdvance,
  canRefine,
  closedCandidates,
  continueQuestions,
  go,
  otherCandidates,
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
import UserMessage from './chat/UserMessage.vue';
import WheelPicker from './chat/WheelPicker.vue';
import ResultCard from './ResultCard.vue';

const target = computed(() => state.session.target ?? 'self');
const ask = computed(() => (target.value === 'other' ? '對方' : '你'));
const busy = computed(() => state.loading || !state.catalog);
const view = computed(() => state.view);
const past = (step: 'home' | 'needs') =>
  step === 'home' ? view.value !== 'home' && !!state.session.target : ['questions', 'results'].includes(view.value);

// ── 1. 打招呼與選對象 ──
const greetKey = 'greet';
const greetLines: Line[] = [
  { text: '嗨，我是福利通。' },
  { text: '回答幾個簡單問題，我幫你從補助、津貼、獎助與服務中，找出值得先看的幾項。' },
  { text: '這次要幫誰找？', tone: 'title' },
];
const targetLabel = computed(() => (state.session.target === 'other' ? '幫家人或別人找' : '幫自己找'));

// ── 2. 選需求 ──
const needKey = computed(() => `need:${target.value}`);
const needLines = computed<Line[]>(() => [
  { text: `好的。${ask.value}需要哪方面的幫忙？`, tone: 'title' },
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
  return v === undefined ? '不知道，先跳過' : describeAnswer(q, v);
}
function qLines(q: Question, withMeta: boolean): Line[] {
  const purpose = optionalText(q, 'description');
  return [
    { text: withMeta ? insightLine(questionInsight.value) : '', tone: 'caption' },
    { text: titleFor(q, target.value), tone: 'title' },
    { text: withMeta ? purpose : '', tone: 'muted' },
  ];
}
const why = computed(() => {
  const reason = optionalText(questionInsight.value, 'reason');
  return reason && current.value && reason !== optionalText(current.value, 'description') ? reason : '';
});

/** 回到某一題修改；結果頁列出的題目要換回路線上的位置。 */
function editQuestion(q: Question) {
  const i = questions.value.findIndex((x) => x.id === q.id);
  if (i < 0) return;
  if (view.value !== 'questions') go('questions');
  state.qIndex = i;
}

// 回答後的回饋（範圍變化）只跟著下一則訊息出現。
const feedback = ref<{ text: string; before: string } | null>(null);
async function submit(value: string | number | boolean | undefined) {
  const q = current.value;
  if (!q) return;
  const before = questionInsight.value?.remainingCount;
  if (!answerAndAdvance(q.id, value)) return;
  await nextTick();
  const note = narrowingNote(before, questionInsight.value?.remainingCount, value === undefined);
  const next = view.value === 'questions' ? `q:${current.value?.id}` : resultsKey.value;
  feedback.value = note ? { text: note, before: next } : null;
}

// 年齡滾輪：有答案用答案，沒有時依對象給一個常見的起點。
const wheelValue = ref(40);
watch(
  current,
  (q) => {
    if (q?.kind !== 'number') return;
    const v = answerOf(state.session.answers, q.field);
    const min = q.min ?? 0;
    const max = q.max ?? MAX_AGE;
    const start = typeof v === 'number' ? v : target.value === 'other' ? 65 : 35;
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
  { text: answeredCount.value ? rangeLine(questionInsight.value) : '', tone: 'caption' },
  { text: answeredCount.value === 0 && !nothing.value ? '還沒有回答問題，下面依需求列出，不是依你的情況挑選。' : '', tone: 'muted' },
  { text: nothing.value ? '沒找到不代表沒有可以申請的福利。可以換個需求、改答案，或找人幫忙。' : '相關不等於符合資格，能不能領由承辦機關審核。', tone: 'muted' },
]);
const nextKey = computed(() => `${resultsKey.value}:next`);
const nextLines: Line[] = [{ text: '接下來想怎麼做？' }];
const sectionsKey = computed(() => `${resultsKey.value}:more`);

// ── 跟著最新訊息捲動：內容長高（打字、選項、滾輪出現）時，若使用者停在底部就跟著到底 ──
const log = ref<HTMLElement | null>(null);
let observer: ResizeObserver | null = null;
onMounted(() => {
  window.addEventListener('scroll', trackPinned, { passive: true });
  if (typeof ResizeObserver !== 'undefined' && log.value) {
    observer = new ResizeObserver(() => followBottom());
    observer.observe(log.value);
  }
  followBottom(true);
});
onBeforeUnmount(() => {
  window.removeEventListener('scroll', trackPinned);
  observer?.disconnect();
});

// ── 底部輸入列：隨時可以直接搜尋名稱 ──
const query = ref('');
function onSearch() {
  if (!query.value.trim()) return;
  searchResources(query.value);
  query.value = '';
}
</script>

<template>
  <div class="chat">
    <h1 class="sr-only">福利通對話</h1>
    <section ref="log" class="chat__log" aria-label="對話紀錄">
      <p class="chat__day" aria-hidden="true">答案只留在這個分頁，不會送出</p>

      <!-- 1. 打招呼與選對象 -->
      <BotMessage :msg-key="greetKey" :lines="greetLines" :active="view === 'home'">
        <details class="bubble-more">
          <summary>我可以幫你做什麼</summary>
          <ol class="bubble-more__list">
            <li>不知道從哪裡找，一步步帶你縮小範圍</li>
            <li>每項列出能提供什麼、限制與受理情形</li>
            <li>整理辦理步驟與文件，或印成檢核表交給家人</li>
            <li>卡住時整理要問窗口的話</li>
          </ol>
        </details>
        <template v-if="view === 'home'" #after>
          <div class="replies" role="group" aria-label="查詢對象">
            <button type="button" class="reply" :aria-pressed="state.session.target === 'self'" @click="requestTarget('self')">
              <span class="reply__label">幫自己找</span>
              <span class="reply__sub">依你的情況回答，存成線上行動單</span>
            </button>
            <button type="button" class="reply" :aria-pressed="state.session.target === 'other'" @click="requestTarget('other')">
              <span class="reply__label">幫家人或別人找</span>
              <span class="reply__sub">依對方的情況回答，做成可列印的 A4 檢核表</span>
            </button>
          </div>
        </template>
      </BotMessage>

      <template v-if="past('home') && isTyped(greetKey)">
        <UserMessage :text="targetLabel" edit-label="改對象" @edit="tab('home')" />

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
                  :aria-pressed="state.session.situation === s.id && !state.session.query"
                  :aria-describedby="`need-${s.id}-hint`"
                  @click="selectNeed(s.id)"
                >
                  <span class="reply__label">{{ s.label }}</span>
                  <span :id="`need-${s.id}-hint`" class="reply__sub">{{ s.hint }}</span>
                </button>
              </div>
              <p class="chat__tip">知道名稱？直接在下方輸入搜尋。</p>
            </div>
          </template>
        </BotMessage>

        <template v-if="past('needs') && isTyped(needKey)">
          <UserMessage :text="needAnswer" edit-label="換需求" @edit="go('needs')" />

          <!-- 3. 問答紀錄 -->
          <template v-for="q in answered" :key="q.id">
            <BotMessage :msg-key="`q:${q.id}`" :lines="qLines(q, false)" />
            <UserMessage :text="answerText(q)" edit-label="改答案" @edit="editQuestion(q)" />
          </template>

          <!-- 目前的題目 -->
          <template v-if="view === 'questions'">
            <p v-if="feedback && current && feedback.before === `q:${current.id}`" class="chat__system" role="status">{{ feedback.text }}</p>

            <BotMessage v-if="current" :key="`q:${current.id}`" :msg-key="`q:${current.id}`" :lines="qLines(current, true)" active>
              <details v-if="why" class="bubble-more">
                <summary>為什麼問這題</summary>
                <p>{{ why }}</p>
              </details>
              <template v-if="current.kind === 'number'">
                <WheelPicker
                  v-model="wheelValue"
                  :min="current.min ?? 0"
                  :max="current.max ?? MAX_AGE"
                  :unit="numberUnit(current)"
                  :label="titleFor(current, target)"
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
                      :aria-pressed="answerOf(state.session.answers, current.field) === opt.value"
                      @click="submit(opt.value)"
                    >
                      <span class="reply__label">{{ opt.label }}</span>
                      <span v-if="optionalText(opt, 'description')" class="reply__sub">{{ optionalText(opt, 'description') }}</span>
                    </button>
                  </template>
                  <div class="replies__row">
                    <button type="button" class="reply reply--quiet" @click="submit(undefined)">
                      <span class="reply__label">不知道，先跳過</span>
                      <span class="reply__sub">不會當成「否」</span>
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
              v-else
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
            <p v-if="feedback && feedback.before === resultsKey" class="chat__system" role="status">{{ feedback.text }}</p>

            <BotMessage :key="resultsKey" :msg-key="resultsKey" :lines="resultLines" active wide>
              <ul v-if="recommended.length" class="cards" aria-label="建議先了解">
                <li v-for="item in recommended" :key="item.id">
                  <ResultCard :item="item" :result="results.get(item.id)" />
                </li>
              </ul>
            </BotMessage>

            <BotMessage v-if="isTyped(resultsKey) && sections.length" :key="sectionsKey" :msg-key="sectionsKey" :lines="[{ text: '另外還有這些，點開可以看：' }]" wide>
              <div class="bubble-groups">
                <details v-for="s in sections" :key="s.key" class="bubble-more" :open="s.key === 'ineligible' ? state.showIneligible : undefined"
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
                  <button v-if="planItems.length" type="button" class="reply" @click="tab('plan')">
                    <span class="reply__label">{{ state.session.target === 'other' ? '製作 A4 檢核表' : '看行動單' }}（{{ planItems.length }} 項）</span>
                  </button>
                  <div class="replies__row">
                    <button v-if="answeredCount" type="button" class="reply reply--quiet" @click="startQuestions"><span class="reply__label">改答案</span></button>
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
    </section>

    <form v-if="state.session.target && view !== 'home'" class="composer no-print" role="search" @submit.prevent="onSearch">
      <label class="sr-only" for="chat-search">用名稱或關鍵字搜尋</label>
      <input
        id="chat-search"
        v-model="query"
        class="composer__input"
        type="search"
        inputmode="search"
        enterkeyhint="search"
        maxlength="100"
        placeholder="輸入名稱搜尋，例如：租金補貼"
        :disabled="busy"
      />
      <button type="submit" class="composer__send" :disabled="busy || !query.trim()">
        <span class="sr-only">搜尋</span>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 12h14M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>
    </form>
  </div>
</template>
