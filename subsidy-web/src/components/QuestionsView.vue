<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { answerOf, describeAnswer, MAX_AGE, parseNumberAnswer, titleFor } from '../domain/questions';
import { answer, back, go, questions, state } from '../store';

const total = computed(() => questions.value.length);
const index = computed(() => Math.min(state.qIndex, Math.max(total.value - 1, 0)));
const q = computed(() => questions.value[index.value]);
const current = computed(() => (q.value ? answerOf(state.session.answers, q.value.field) : undefined));
const target = computed(() => state.session.target ?? 'self');

const numberInput = ref<string | number>('');
const numberError = ref('');
watch(
  q,
  (question) => {
    numberError.value = '';
    const v = question ? answerOf(state.session.answers, question.field) : undefined;
    numberInput.value = typeof v === 'number' ? String(v) : '';
  },
  { immediate: true },
);

function next() {
  if (index.value >= total.value - 1) go('results');
  else state.qIndex = index.value + 1;
}

function prev() {
  if (index.value === 0) back();
  else state.qIndex = index.value - 1;
}

function choose(value: string | boolean) {
  if (!q.value) return;
  answer(q.value, value);
  next();
}

function submitNumber() {
  const question = q.value;
  if (!question) return;
  const parsed = parseNumberAnswer(numberInput.value, question.min ?? 0, question.max ?? MAX_AGE);
  if (!parsed.ok) {
    numberError.value = parsed.error;
    return;
  }
  numberError.value = '';
  answer(question, parsed.value);
  next();
}

function skip() {
  if (!q.value) return;
  answer(q.value, undefined);
  next();
}
</script>

<template>
  <div class="view">
    <h1 id="view-title" class="view-title" tabindex="-1">回答幾個問題</h1>
    <p class="muted">只問會影響目前候選資源的問題。答案只存在這台裝置，不會送出。</p>

    <div v-if="q" class="card question">
      <p class="progress-text">第 {{ index + 1 }} 題，共 {{ total }} 題</p>
      <div
        class="progress"
        role="progressbar"
        :aria-valuenow="index + 1"
        aria-valuemin="1"
        :aria-valuemax="total"
        :aria-label="`問答進度 ${index + 1}/${total}`"
      >
        <span class="progress__bar" :style="{ width: `${((index + 1) / total) * 100}%` }"></span>
      </div>

      <fieldset class="question__set">
        <legend class="question__title">{{ titleFor(q, target) }}</legend>
        <p v-if="q.description" :id="`${q.id}-desc`" class="muted">{{ q.description }}</p>
        <p class="muted">影響 {{ q.resource_ids.length }} 筆資料的初篩。</p>

        <div v-if="q.kind !== 'number'" class="option-list">
          <button
            v-for="opt in q.options"
            :key="String(opt.value)"
            type="button"
            class="btn btn--option"
            :aria-pressed="current === opt.value"
            @click="choose(opt.value)"
          >
            {{ opt.label }}
          </button>
        </div>

        <form v-else class="number-form" novalidate @submit.prevent="submitNumber">
          <label class="field" :for="`${q.id}-input`">
            <span class="field__label">請輸入數字{{ q.field === 'age' ? '（歲）' : '' }}</span>
            <input
              :id="`${q.id}-input`"
              v-model="numberInput"
              class="input input--number"
              type="number"
              inputmode="numeric"
              :min="q.min ?? 0"
              :max="q.max ?? MAX_AGE"
              step="1"
              :aria-invalid="numberError ? 'true' : 'false'"
              :aria-describedby="numberError ? `${q.id}-err` : q.description ? `${q.id}-desc` : undefined"
            />
          </label>
          <p v-if="numberError" :id="`${q.id}-err`" class="error" role="alert">{{ numberError }}</p>
          <button type="submit" class="btn btn--primary btn--block">確定</button>
        </form>

        <button type="button" class="btn btn--ghost btn--block" @click="skip">不知道／略過</button>
      </fieldset>
      <p class="muted" aria-live="polite">目前答案：{{ describeAnswer(q, current) }}</p>
    </div>

    <div class="btn-row">
      <button type="button" class="btn" @click="prev">上一步</button>
      <button type="button" class="btn btn--ghost" @click="go('results')">直接看結果</button>
    </div>
  </div>
</template>
