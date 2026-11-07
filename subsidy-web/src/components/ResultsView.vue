<script setup lang="ts">
import { computed, ref } from 'vue';
import { results, sortedCandidates, state, go, startQuestions, planItems, tab, questions } from '../store';
import ResultCard from './ResultCard.vue';

const PAGE = 6;
const shown = ref(PAGE);
const visible = computed(() => sortedCandidates.value.filter((i) => state.showIneligible || results.value.get(i.id)?.fit !== 'ineligible'));
const hiddenCount = computed(() => sortedCandidates.value.length - visible.value.length);
</script>

<template>
  <div class="view">
    <div class="results-heading">
      <h1 id="view-title" class="view-title" tabindex="-1">找到 {{ visible.length }} 筆資源</h1>
      <p class="muted">初步整理，資格仍須向機關確認。</p>
    </div>
    <div class="btn-row">
      <button v-if="questions.length" type="button" class="btn btn--ghost" @click="startQuestions">修改答案</button>
      <button type="button" class="btn btn--ghost" @click="go('needs')">換個需求</button>
    </div>
    <details v-if="hiddenCount || state.showIneligible" class="disclosure">
      <summary>{{ hiddenCount ? `已隱藏 ${hiddenCount} 筆條件不符資料` : '目前包含條件不符資料' }}</summary>
      <p>不知道的條件仍保留為待確認。</p>
      <button type="button" class="btn btn--ghost" @click="state.showIneligible = !state.showIneligible">{{ state.showIneligible ? '隱藏條件不符' : '也顯示條件不符' }}</button>
    </details>
    <div v-if="visible.length === 0" class="card">
      <p>這次沒有找到資源，不代表沒有福利。可以換個需求、關鍵字，或找人協助。</p>
      <button type="button" class="btn" @click="tab('help')">找人幫忙</button>
    </div>
    <ul class="result-list">
      <li v-for="item in visible.slice(0, shown)" :key="item.id"><ResultCard :item="item" :result="results.get(item.id)" /></li>
    </ul>
    <button v-if="shown < visible.length" type="button" class="btn btn--block" @click="shown += PAGE">再看 {{ Math.min(PAGE, visible.length - shown) }} 筆</button>
    <button v-if="planItems.length" type="button" class="btn btn--primary btn--block" @click="tab('plan')">查看行動單（{{ planItems.length }} 項）</button>
  </div>
</template>
