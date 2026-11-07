<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { answerOf, MAX_AGE, parseNumberAnswer, titleFor } from '../domain/questions';
import { answerAndAdvance, go, questions, state } from '../store';

const total = computed(() => questions.value.length);
const index = computed(() => Math.min(state.qIndex, Math.max(total.value - 1, 0)));
const q = computed(() => questions.value[index.value]);
const current = computed(() => q.value ? answerOf(state.session.answers, q.value.field) : undefined);
const target = computed(() => state.session.target ?? 'self');
const numberInput = ref<string | number>('');
const numberError = ref('');
watch(q, (question) => {
  numberError.value = '';
  const value = question ? answerOf(state.session.answers, question.field) : undefined;
  numberInput.value = typeof value === 'number' ? String(value) : '';
}, { immediate: true });

function choose(value: string | boolean | undefined) {
  if (q.value) answerAndAdvance(q.value.id, value);
}
function submitNumber() {
  if (!q.value) return;
  const parsed = parseNumberAnswer(numberInput.value, q.value.min ?? 0, q.value.max ?? MAX_AGE);
  if (!parsed.ok) { numberError.value = parsed.error; return; }
  numberError.value = '';
  answerAndAdvance(q.value.id, parsed.value);
}
</script>

<template>
  <div class="view intake-view">
    <p class="eyebrow">找資源 · 3 / 3<span v-if="q"> · 問題 {{ index + 1 }} / {{ total }}</span></p>
    <template v-if="q">
      <h1 id="view-title" class="view-title" tabindex="-1">{{ titleFor(q, target) }}</h1>
      <div class="progress" role="progressbar" :aria-valuenow="index + 1" aria-valuemin="1" :aria-valuemax="total" :aria-label="`問答進度 ${index + 1}/${total}`">
        <span class="progress__bar" :style="{ width: `${((index + 1) / total) * 100}%` }"></span>
      </div>
      <div :key="q.id" class="question-page">
        <div v-if="q.kind !== 'number'" class="option-list" role="group" :aria-label="titleFor(q, target)">
          <button v-for="opt in q.options" :key="String(opt.value)" type="button" class="btn btn--option" :aria-pressed="current === opt.value" @click="choose(opt.value)">{{ opt.label }}<span class="choice__arrow" aria-hidden="true">→</span></button>
        </div>
        <form v-else class="number-form" novalidate @submit.prevent="submitNumber">
          <label class="field" :for="`${q.id}-input`">
            <span class="field__label">{{ q.field === 'age' ? '年齡（歲）' : '請輸入數字' }}</span>
            <input :id="`${q.id}-input`" v-model="numberInput" class="input" type="number" inputmode="numeric" :min="q.min ?? 0" :max="q.max ?? MAX_AGE" step="1" :aria-invalid="numberError ? 'true' : 'false'" :aria-describedby="numberError ? `${q.id}-err` : undefined" />
          </label>
          <p v-if="numberError" :id="`${q.id}-err`" class="error" role="alert">{{ numberError }}</p>
          <button type="submit" class="btn btn--primary btn--block">下一步 →</button>
        </form>
        <button type="button" class="btn btn--ghost btn--block" @click="choose(undefined)">不知道／略過</button>
        <details class="disclosure">
          <summary>為什麼問這題？</summary>
          <p v-if="q.description">{{ q.description }}</p>
          <p>只問與這次候選資源有關的條件。答案只保存在本分頁，不會送出。</p>
        </details>
      </div>
    </template>
    <template v-else><h1 id="view-title" class="view-title" tabindex="-1">目前沒有需要回答的問題</h1></template>
    <button type="button" class="btn btn--link" @click="go('results')">先看資源</button>
  </div>
</template>
