<script setup lang="ts">
import { requestTarget, state } from '../store';
import StepDots from './StepDots.vue';
</script>

<template>
  <div class="view">
    <div class="view-head">
      <StepDots :current="1" :total="3" />
      <h1 id="view-title" class="view-title" tabindex="-1">這次要幫誰找？</h1>
    </div>
    <ul class="rows" aria-label="查詢對象">
      <li>
        <button type="button" class="row" :aria-pressed="state.session.target === 'self'" @click="requestTarget('self')">
          <span class="row__main"><span class="row__title">幫自己找</span></span>
          <span class="row__chev" aria-hidden="true">›</span>
        </button>
      </li>
      <li>
        <button type="button" class="row" :aria-pressed="state.session.target === 'other'" @click="requestTarget('other')">
          <span class="row__main">
            <span class="row__title">幫家人或別人找</span>
            <span class="row__sub">填對方的情況</span>
          </span>
          <span class="row__chev" aria-hidden="true">›</span>
        </button>
      </li>
    </ul>
  </div>
</template>
