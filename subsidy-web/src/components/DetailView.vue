<script setup lang="ts">
import { computed } from 'vue';
import { text } from '../domain/match';
import { buildRoute, SOURCE_KIND_LABEL, SOURCE_ROLE } from '../domain/route';
import { applicationStatusAlert, benefitLabel, deadlineNote, fitNote, statusPlain } from '../presentation';
import { inPlan, itemsById, results, state, togglePlan } from '../store';
import ExternalLink from './ExternalLink.vue';
import RouteSteps from './RouteSteps.vue';

const item = computed(() => (state.detailId ? itemsById.value.get(state.detailId) : undefined));
const result = computed(() => (item.value ? results.value.get(item.value.id) : undefined));
const route = computed(() => (item.value ? buildRoute(item.value) : null));
const kind = computed(() => (item.value ? benefitLabel(item.value) : ''));
const benefit = computed(() => text(item.value?.benefit?.raw));
const flags = computed(() =>
  [fitNote(result.value), deadlineNote(result.value), applicationStatusAlert(route.value?.applicationStatus ?? '')].filter(Boolean) as string[],
);
const added = computed(() => (item.value ? inPlan(item.value.id) : false));

function kindOf(type: string) {
  return SOURCE_KIND_LABEL[type === 'official' || type === 'third_party' || type === 'other' ? type : 'unknown'];
}
</script>

<template>
  <div v-if="item && route" class="view">
    <div class="view-head">
      <h1 id="view-title" class="view-title" tabindex="-1">{{ item.name }}</h1>
      <p v-if="kind" class="lead">{{ kind }}</p>
      <p v-for="f in flags" :key="f" class="alert">{{ f }}</p>
    </div>

    <div class="actions">
      <button v-if="!added" type="button" class="btn btn--primary btn--block" @click="togglePlan(item.id)">加入行動單</button>
      <p v-else class="inline-actions">
        <span class="row__mark">已在行動單</span>
        <button type="button" class="btn btn--text" @click="togglePlan(item.id)">移除</button>
      </p>
    </div>

    <div>
      <RouteSteps :item="item" />
      <div class="more-group">
        <details class="more">
          <summary>補助內容（原文）</summary>
          <div class="more__body">
            <p>{{ benefit || '原文沒有提供內容說明' }}</p>
          </div>
        </details>

        <details class="more">
          <summary>申請條件</summary>
          <div class="more__body">
            <p v-if="text(item.eligibility?.raw_summary)">適用對象：{{ text(item.eligibility?.raw_summary) }}</p>
            <p v-if="text(item.eligibility?.taipei_applicability)">{{ text(item.eligibility?.taipei_applicability) }}</p>
            <template v-if="result?.blocked_by.length">
              <h3>填寫的條件不符</h3>
              <ul><li v-for="r in result.blocked_by" :key="r">{{ r }}</li></ul>
            </template>
            <template v-if="result?.reasons.length">
              <h3>依填答符合的部分</h3>
              <ul><li v-for="r in result.reasons" :key="r">{{ r }}</li></ul>
            </template>
            <template v-if="result?.pending?.length">
              <h3>要向窗口問清楚（{{ result.pending.length }}）</h3>
              <ul><li v-for="r in result.pending" :key="r">{{ r }}</li></ul>
            </template>
            <template v-if="result?.warnings.length">
              <h3>提醒</h3>
              <ul><li v-for="r in result.warnings" :key="r">{{ r }}</li></ul>
            </template>
            <p class="muted">本服務不計算所得，能不能領由承辦機關審核</p>
          </div>
        </details>

        <details class="more">
          <summary>資料來源</summary>
          <div class="more__body">
            <p class="muted">{{ statusPlain(route.status, route.checkedDate) }}；沿用資料原有標記，本服務未重新查核</p>
            <p v-if="text(item.source_meta?.verification_note)" class="muted">查核說明：{{ text(item.source_meta?.verification_note) }}</p>
            <p v-if="text(item.source_meta?.notes)" class="muted">備註：{{ text(item.source_meta?.notes) }}</p>
            <ul class="link-list">
              <li v-for="s in route.sources" :key="s.url + s.role">
                <ExternalLink :url="s.url" :label="SOURCE_ROLE[s.role] ?? (s.role || '來源')" :tag="kindOf(s.type)" />
                <span v-if="s.sourceDate" class="muted">來源日期：{{ s.sourceDate }}</span>
              </li>
            </ul>
          </div>
        </details>
      </div>
    </div>
  </div>
  <div v-else class="view">
    <h1 id="view-title" class="view-title" tabindex="-1">找不到這筆資料</h1>
    <p>資料可能更新了，請回到結果重新選。</p>
  </div>
</template>
