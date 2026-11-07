<script setup lang="ts">
import { requestTarget, state } from '../store';
</script>

<template>
  <div class="view intake-view">
    <p class="eyebrow">找資源 · 1 / 3</p>
    <h1 id="view-title" class="view-title" tabindex="-1">這次要幫誰找？</h1>
    <div class="person-choices" role="group" aria-label="查詢對象">
      <button type="button" class="choice person-choice" :aria-pressed="state.session.target === 'self'" @click="requestTarget('self')">
        <span class="choice__title">自己</span><span class="choice__arrow" aria-hidden="true">→</span>
      </button>
      <button type="button" class="choice person-choice" :aria-pressed="state.session.target === 'other'" @click="requestTarget('other')">
        <span class="choice__title">幫別人</span><span class="choice__arrow" aria-hidden="true">→</span>
      </button>
    </div>
    <p class="muted">選擇後，下一步挑需要的協助。</p>
  </div>
</template>
