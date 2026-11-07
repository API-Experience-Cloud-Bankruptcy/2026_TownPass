<script setup lang="ts">
import { computed } from 'vue';
import { SITUATIONS } from '../domain/situations';
import { go, selectNeed, state } from '../store';
const ask = computed(() => state.session.target === 'other' ? '對方' : '你');
</script>

<template>
  <div class="view intake-view">
    <p class="eyebrow">找資源 · 2 / 3</p>
    <h1 id="view-title" class="view-title" tabindex="-1">{{ ask }}需要哪方面協助？</h1>
    <div class="need-choices" role="group" aria-label="需要的協助">
      <button v-for="s in SITUATIONS" :key="s.id" type="button" class="choice need-choice" :disabled="state.loading" :aria-pressed="state.session.situation === s.id && !state.session.query" @click="selectNeed(s.id)">
        <span class="choice__title">{{ s.label }}</span><span class="choice__arrow" aria-hidden="true">→</span>
      </button>
    </div>
    <p v-if="state.loading" class="muted" role="status">正在載入資源…</p>
    <button type="button" class="btn btn--ghost btn--block" @click="go('search')">用關鍵字找 →</button>
    <p v-if="state.session.target === 'other'" class="muted">接下來請填對方的情況；代查不代表可代辦。</p>
  </div>
</template>
