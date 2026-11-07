<script setup lang="ts">
import { computed, ref } from 'vue';
import { results, sortedCandidates, state, go, planItems, tab } from '../store';
import ResultCard from './ResultCard.vue';

const PAGE = 6;
const shown = ref(PAGE);
const visible = computed(() =>
  sortedCandidates.value.filter((i) => state.showIneligible || results.value.get(i.id)?.fit !== 'ineligible'),
);
const hiddenCount = computed(() => sortedCandidates.value.length - visible.value.length);
const target = computed(() => (state.session.target === 'other' ? '對方' : '你'));
</script>

<template>
  <div class="view">
    <h1 id="view-title" class="view-title" tabindex="-1">可能適合{{ target }}的資源</h1>
    <div class="card card--soft">
      <p>
        共 {{ visible.length }} 筆。結果依資料原文保守初篩：不知道的條件不會被判為不符，也不會判為已符合。
        資格以主管機關審核為準。
      </p>
      <p v-if="hiddenCount > 0">
        已隱藏 {{ hiddenCount }} 筆目前條件不符的資料。
        <button type="button" class="btn btn--link" @click="state.showIneligible = true">也顯示這些</button>
      </p>
      <p v-else-if="state.showIneligible">
        <button type="button" class="btn btn--link" @click="state.showIneligible = false">隱藏條件不符</button>
      </p>
      <div class="btn-row">
        <button type="button" class="btn" @click="go('questions'); state.qIndex = 0">修改答案</button>
        <button type="button" class="btn" @click="tab('home')">換需求或關鍵字</button>
      </div>
    </div>

    <p v-if="visible.length === 0" class="card">
      目前沒有結果。資料僅涵蓋 {{ state.catalog?.items.length ?? 0 }} 筆中央與臺北市資源，這不代表沒有任何福利。
      可以修改條件，或到「找人幫忙」取得詢問文字。
    </p>

    <ul class="result-list">
      <li v-for="item in visible.slice(0, shown)" :key="item.id">
        <ResultCard :item="item" :result="results.get(item.id)" />
      </li>
    </ul>
    <button v-if="shown < visible.length" type="button" class="btn btn--block" @click="shown += PAGE">
      再顯示 {{ Math.min(PAGE, visible.length - shown) }} 筆（尚有 {{ visible.length - shown }} 筆）
    </button>

    <div v-if="planItems.length" class="sticky-cta">
      <button type="button" class="btn btn--primary btn--block" @click="tab('plan')">
        查看行動單（{{ planItems.length }} 項）
      </button>
    </div>
  </div>
</template>
