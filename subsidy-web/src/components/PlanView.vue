<script setup lang="ts">
import { computed, ref } from 'vue';
import { buildPlanText } from '../domain/export';
import { PLAN_STATUS_LABEL, planProgress, sortPlans } from '../domain/plan-progress';
import { applicationStatusAlert, sourceExcerpt } from '../presentation';
import { openPlanItem, planConditions, planItems, planResults, state, tab } from '../store';
import PlanExport from './PlanExport.vue';

const cards = computed(() => sortPlans(planItems.value.map((item) => ({
  item,
  progress: planProgress(item, state.personalPlan.answers, state.personalPlan.stepDone, state.personalPlan.docChecks),
}))));

function nextLine(p: (typeof cards.value)[number]['progress']): string {
  if (p.status === 'no-steps') return '原文沒有列出步驟，先問承辦窗口';
  if (p.status === 'done') return '照官方方式送件，並留下收件證明';
  return `下一步：${sourceExcerpt(p.steps[p.current] ?? '', 40)}`;
}
function percent(p: (typeof cards.value)[number]['progress']): number {
  return p.total ? Math.round((p.doneCount / p.total) * 100) : 0;
}

const exportOpen = ref(false);
const included = ref<string[]>([]);
const includedValid = computed(() => planConditions.value.filter((c) => included.value.includes(c.line)));
const planText = computed(() => buildPlanText({
  meta: {
    catalogVersion: state.catalog?.version ?? '未載入',
    sourceLabel: state.catalog?.sourceLabel ?? '未載入',
    generatedAt: new Date(),
  },
  target: 'self',
  items: planItems.value,
  results: planResults.value,
  conditions: includedValid.value,
  docChecks: state.personalPlan.docChecks,
  stepDone: state.personalPlan.stepDone,
  documentAnswers: state.personalPlan.answers,
}));
</script>

<template>
  <div class="view">
    <h1 id="view-title" class="sr-only" tabindex="-1">行動單（{{ planItems.length }} 張）</h1>

    <div v-if="planItems.length === 0" class="card plan-empty">
      <p class="plan-empty__title">還沒有行動單</p>
      <button type="button" class="btn btn--primary btn--block" @click="tab('home')">開始找資源</button>
    </div>

    <template v-else>
      <TransitionGroup name="list" tag="ul" class="plan-cards no-print" appear>
        <li v-for="({ item, progress }, i) in cards" :key="item.id" :style="{ '--i': String(i) }">
          <button
            type="button"
            class="plan-card"
            :class="`plan-card--${progress.status}`"
            @click="openPlanItem(item.id)"
          >
            <span class="plan-card__top">
              <span class="plan-card__title">{{ item.name }}</span>
              <span class="plan-card__badge">{{ PLAN_STATUS_LABEL[progress.status] }}</span>
            </span>
            <span class="plan-card__next">{{ nextLine(progress) }}</span>
            <span v-if="progress.total" class="progress" aria-hidden="true"><span class="progress__bar" :style="{ width: `${percent(progress)}%` }" /></span>
            <span class="plan-card__meta">
              <span v-if="progress.total">步驟 {{ progress.doneCount }}／{{ progress.total }}</span>
              <span v-if="progress.docsTotal">文件 {{ progress.docsDone }}／{{ progress.docsTotal }}</span>
              <span v-if="progress.deadline" class="plan-card__deadline">期限：{{ progress.deadline }}</span>
              <span v-if="applicationStatusAlert(progress.applicationStatus)" class="plan-card__flag">{{ applicationStatusAlert(progress.applicationStatus) }}</span>
            </span>
            <span class="plan-card__chev" aria-hidden="true">›</span>
          </button>
        </li>
      </TransitionGroup>

      <details class="more card card--list no-print" :open="exportOpen" @toggle="exportOpen = ($event.target as HTMLDetailsElement).open">
        <summary>下載行動單 PDF（{{ planItems.length }} 張）</summary>
        <div v-if="exportOpen" class="more__body">
          <PlanExport :items="cards.map((c) => c.item)" />
        </div>
      </details>
      <pre class="print-sheet" aria-hidden="true">{{ planText }}</pre>
    </template>
  </div>
</template>

<style scoped>
.plan-card__deadline { flex-basis: 100%; color: var(--text); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
</style>
