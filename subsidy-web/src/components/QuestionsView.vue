<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { answerOf, MAX_AGE, parseNumberAnswer, titleFor } from '../domain/questions';
import { insightLine, narrowingNote, numberUnit, optionalText } from '../presentation';
import { answerAndAdvance, go, questionInsight, questions, state } from '../store';

const total = computed(() => questions.value.length);
const index = computed(() => Math.min(state.qIndex, Math.max(total.value - 1, 0)));
const q = computed(() => questions.value[index.value]);
const current = computed(() => (q.value ? answerOf(state.session.answers, q.value.field) : undefined));
const target = computed(() => state.session.target ?? 'self');
const insight = computed(() => questionInsight.value);
const progress = computed(() => insightLine(insight.value));
/** 這題的用處：題目說明優先，沒有才用後端提供的原因。 */
const purpose = computed(() => (q.value ? optionalText(q.value, 'description') || optionalText(insight.value, 'reason') : ''));
const reasonExtra = computed(() => {
  const reason = optionalText(insight.value, 'reason');
  return reason && reason !== purpose.value ? reason : '';
});

const numberInput = ref<string | number>('');
const numberError = ref('');
const feedback = ref<string | null>(null);
let shownFor: string | null = null;

watch(
  q,
  (question) => {
    numberError.value = '';
    const value = question ? answerOf(state.session.answers, question.field) : undefined;
    numberInput.value = typeof value === 'number' ? String(value) : '';
    // 回饋只跟著剛答完後出現的那一題；返回或改到別題就收起。
    if (question?.id !== shownFor) feedback.value = null;
  },
  { immediate: true },
);

async function submit(value: string | number | boolean | undefined) {
  if (!q.value) return;
  const before = insight.value?.remainingCount;
  if (!answerAndAdvance(q.value.id, value)) return;
  await nextTick();
  if (state.view !== 'questions') return;
  shownFor = q.value?.id ?? null;
  feedback.value = narrowingNote(before, insight.value?.remainingCount, value === undefined);
}

function choose(value: string | boolean | undefined) {
  void submit(value);
}
function submitNumber() {
  if (!q.value) return;
  const parsed = parseNumberAnswer(numberInput.value, q.value.min ?? 0, q.value.max ?? MAX_AGE);
  if (!parsed.ok) {
    numberError.value = parsed.error;
    return;
  }
  numberError.value = '';
  void submit(parsed.value);
}
</script>

<template>
  <div class="view">
    <template v-if="q">
      <div class="view-head">
        <p v-if="progress" class="muted">{{ progress }}</p>
        <h1 id="view-title" class="view-title" tabindex="-1">{{ titleFor(q, target) }}</h1>
        <p v-if="purpose" :id="`${q.id}-purpose`" class="lead">{{ purpose }}</p>
      </div>
      <p v-if="feedback" class="feedback" role="status">{{ feedback }}</p>

      <div :key="q.id" class="actions">
        <ul v-if="q.kind !== 'number'" class="rows" :aria-label="titleFor(q, target)">
          <li v-for="opt in q.options" :key="String(opt.value)">
            <button type="button" class="row" :aria-pressed="current === opt.value" @click="choose(opt.value)">
              <span class="row__main">
                <span class="row__title">{{ opt.label }}</span>
                <span v-if="optionalText(opt, 'description')" class="row__sub">{{ optionalText(opt, 'description') }}</span>
                <span v-if="current === opt.value" class="row__mark">上次選這個</span>
              </span>
              <span class="row__chev" aria-hidden="true">›</span>
            </button>
          </li>
          <li>
            <button type="button" class="row row--quiet" @click="choose(undefined)">
              <span class="row__main">
                <span class="row__title">不知道，先跳過</span>
                <span class="row__sub">不會當成「否」</span>
              </span>
              <span class="row__chev" aria-hidden="true">›</span>
            </button>
          </li>
        </ul>
        <template v-else>
          <form class="actions" novalidate @submit.prevent="submitNumber">
            <label class="field" :for="`${q.id}-input`">
              <span class="field__label">{{ numberUnit(q) }}</span>
              <input
                :id="`${q.id}-input`"
                v-model="numberInput"
                class="input"
                type="number"
                inputmode="numeric"
                :min="q.min ?? 0"
                :max="q.max ?? MAX_AGE"
                step="1"
                :aria-invalid="numberError ? 'true' : 'false'"
                :aria-describedby="numberError ? `${q.id}-err` : undefined"
              />
            </label>
            <p v-if="numberError" :id="`${q.id}-err`" class="error" role="alert">{{ numberError }}</p>
            <button type="submit" class="btn btn--primary btn--block">確定</button>
          </form>
          <button type="button" class="btn btn--block" @click="choose(undefined)">不知道，先跳過</button>
        </template>
      </div>

      <div class="actions">
        <button type="button" class="btn btn--block" @click="go('results')">先看目前結果</button>
        <p class="muted">
          下一題會依你的回答調整<template v-if="state.qIndex > 0">；按上方「上一題」可以改答案</template>。答案只留在這個分頁，不會送出。
        </p>
      </div>
      <details v-if="reasonExtra" class="more more--single">
        <summary>為什麼問這題</summary>
        <div class="more__body"><p>{{ reasonExtra }}</p></div>
      </details>
    </template>

    <template v-else-if="state.loading">
      <h1 id="view-title" class="view-title" tabindex="-1">題目載入中</h1>
      <p class="muted" role="status">請稍候</p>
    </template>

    <template v-else>
      <div class="view-head">
        <h1 id="view-title" class="view-title" tabindex="-1">可以先看結果</h1>
        <p class="lead">這裡沒有其他能幫忙縮小的問題了。目前仍有條件需要確認，請在每一項的詳情看原文或問承辦窗口。</p>
      </div>
      <button type="button" class="btn btn--primary btn--block" @click="go('results')">看結果</button>
    </template>
  </div>
</template>
