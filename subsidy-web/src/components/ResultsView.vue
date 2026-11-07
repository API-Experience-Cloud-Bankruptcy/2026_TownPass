<script setup lang="ts">
import { computed, ref } from 'vue';
import { go, planItems, questions, results, sortedCandidates, startQuestions, state, tab } from '../store';
import ResultCard from './ResultCard.vue';

const PAGE = 6;
const shown = ref(PAGE);
const visible = computed(() =>
  sortedCandidates.value.filter((i) => state.showIneligible || results.value.get(i.id)?.fit !== 'ineligible'),
);
const hiddenCount = computed(() => sortedCandidates.value.length - visible.value.length);
</script>

<template>
  <div class="view">
    <div class="view-head">
      <h1 id="view-title" class="view-title" tabindex="-1">找到 {{ visible.length }} 項</h1>
      <p class="lead">點一項看怎麼辦。能不能領，最後由承辦機關決定。</p>
      <div class="inline-actions">
        <button v-if="questions.length" type="button" class="btn btn--text" @click="startQuestions">改答案</button>
        <button type="button" class="btn btn--text" @click="go('needs')">換需求</button>
      </div>
    </div>

    <div v-if="visible.length === 0" class="actions">
      <p>這次沒有找到，不代表沒有可以申請的福利。</p>
      <button type="button" class="btn btn--block" @click="tab('help')">找人幫忙</button>
    </div>

    <ul v-else class="rows" aria-label="資源">
      <li v-for="item in visible.slice(0, shown)" :key="item.id">
        <ResultCard :item="item" :result="results.get(item.id)" />
      </li>
    </ul>

    <div class="actions">
      <button v-if="shown < visible.length" type="button" class="btn btn--block" @click="shown += PAGE">
        再看 {{ Math.min(PAGE, visible.length - shown) }} 項
      </button>
      <button v-if="hiddenCount || state.showIneligible" type="button" class="btn btn--text" @click="state.showIneligible = !state.showIneligible">
        {{ state.showIneligible ? '隱藏條件不符的項目' : `另有 ${hiddenCount} 項填寫的條件不符，也顯示` }}
      </button>
      <button v-if="planItems.length" type="button" class="btn btn--primary btn--block" @click="tab('plan')">
        看行動單（{{ planItems.length }} 項）
      </button>
    </div>
  </div>
</template>
