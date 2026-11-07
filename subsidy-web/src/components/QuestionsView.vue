<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { answerOf, MAX_AGE, parseNumberAnswer, titleFor } from '../domain/questions';
import { answerAndAdvance, go, questions, state } from '../store';
import StepDots from './StepDots.vue';

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
    const value = question ? answerOf(state.session.answers, question.field) : undefined;
    numberInput.value = typeof value === 'number' ? String(value) : '';
  },
  { immediate: true },
);

function choose(value: string | boolean | undefined) {
  if (q.value) answerAndAdvance(q.value.id, value);
}
function submitNumber() {
  if (!q.value) return;
  const parsed = parseNumberAnswer(numberInput.value, q.value.min ?? 0, q.value.max ?? MAX_AGE);
  if (!parsed.ok) {
    numberError.value = parsed.error;
    return;
  }
  numberError.value = '';
  answerAndAdvance(q.value.id, parsed.value);
}
</script>

<template>
  <div class="view">
    <template v-if="q">
      <div class="view-head">
        <StepDots :current="index + 1" :total="total" label="問題" />
        <h1 id="view-title" class="view-title" tabindex="-1">{{ titleFor(q, target) }}</h1>
      </div>
      <div :key="q.id" class="actions">
        <ul v-if="q.kind !== 'number'" class="rows" :aria-label="titleFor(q, target)">
          <li v-for="opt in q.options" :key="String(opt.value)">
            <button type="button" class="row" :aria-pressed="current === opt.value" @click="choose(opt.value)">
              <span class="row__main">
                <span class="row__title">{{ opt.label }}</span>
                <span v-if="current === opt.value" class="row__mark">上次選這個</span>
              </span>
              <span class="row__chev" aria-hidden="true">›</span>
            </button>
          </li>
          <li>
            <button type="button" class="row row--quiet" @click="choose(undefined)">
              <span class="row__main"><span class="row__title">不知道，先跳過</span></span>
              <span class="row__chev" aria-hidden="true">›</span>
            </button>
          </li>
        </ul>
        <template v-else>
          <form class="actions" novalidate @submit.prevent="submitNumber">
            <label class="field" :for="`${q.id}-input`">
              <span class="field__label">{{ q.field === 'age' ? '歲' : '數字' }}</span>
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
            <button type="submit" class="btn btn--primary btn--block">下一題</button>
          </form>
          <button type="button" class="btn btn--block" @click="choose(undefined)">不知道，先跳過</button>
        </template>
        <details class="more more--single">
          <summary>為什麼問這題</summary>
          <div class="more__body">
            <p v-if="q.description">{{ q.description }}</p>
            <p class="muted">只問和這次資源有關的條件。答案只留在這個分頁。</p>
          </div>
        </details>
      </div>
    </template>
    <template v-else>
      <h1 id="view-title" class="view-title" tabindex="-1">不用回答問題</h1>
    </template>
    <button type="button" class="btn btn--text" @click="go('results')">直接看結果</button>
  </div>
</template>
