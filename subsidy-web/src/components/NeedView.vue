<script setup lang="ts">
import { computed } from 'vue';
import { SITUATIONS } from '../domain/situations';
import { go, selectNeed, state } from '../store';
import StepDots from './StepDots.vue';

const ask = computed(() => (state.session.target === 'other' ? '對方' : '你'));
</script>

<template>
  <div class="view">
    <div class="view-head">
      <StepDots :current="2" :total="3" />
      <h1 id="view-title" class="view-title" tabindex="-1">{{ ask }}需要哪方面的幫忙？</h1>
      <p v-if="state.session.target === 'other'" class="muted">幫別人查，不代表可以替對方申請</p>
    </div>
    <p v-if="state.loading" class="muted" role="status">資料載入中</p>
    <ul class="rows" aria-label="需要的幫忙">
      <li v-for="s in SITUATIONS" :key="s.id">
        <button
          type="button"
          class="row"
          :disabled="state.loading"
          :aria-pressed="state.session.situation === s.id && !state.session.query"
          @click="selectNeed(s.id)"
        >
          <span class="row__main"><span class="row__title">{{ s.label }}</span></span>
          <span class="row__chev" aria-hidden="true">›</span>
        </button>
      </li>
      <li>
        <button type="button" class="row row--quiet" @click="go('search')">
          <span class="row__main"><span class="row__title">用關鍵字找</span></span>
          <span class="row__chev" aria-hidden="true">›</span>
        </button>
      </li>
    </ul>
  </div>
</template>
