<script setup lang="ts">
import { computed } from 'vue';
import { text } from '../domain/match';
import { buildRoute, SOURCE_KIND_LABEL, SOURCE_ROLE } from '../domain/route';
import { benefitLabel, itemFlags, statusPlain } from '../presentation';
import { inPlan, itemsById, results, state, togglePlan } from '../store';
import ExternalLink from './ExternalLink.vue';
import RouteSteps from './RouteSteps.vue';

const item = computed(() => (state.detailId ? itemsById.value.get(state.detailId) : undefined));
const result = computed(() => (item.value ? results.value.get(item.value.id) : undefined));
const route = computed(() => (item.value ? buildRoute(item.value) : null));
const sub = computed(() => (item.value ? [benefitLabel(item.value), text(item.value.provider?.name)].filter(Boolean).join('・') : ''));
const benefit = computed(() => text(item.value?.benefit?.raw));
const summary = computed(() => text(item.value?.eligibility?.raw_summary));
const flags = computed(() => (item.value ? itemFlags(item.value, result.value) : []));
/** 受理情形原文；已在提醒列出時不重複。 */
const statusText = computed(() => {
  const s = route.value?.applicationStatus ?? '';
  return s && !flags.value.some((f) => f.includes(s)) ? s : '';
});
const added = computed(() => (item.value ? inPlan(item.value.id) : false));
/** 申請方法連結：先找申請入口，沒有才用說明頁。 */
const applyLink = computed(() => route.value?.links.find((l) => l.kind === 'apply') ?? route.value?.links.find((l) => l.kind === 'program') ?? null);

function kindOf(type: string) {
  return SOURCE_KIND_LABEL[type === 'official' || type === 'third_party' || type === 'other' ? type : 'unknown'];
}
</script>

<template>
  <div v-if="item && route" class="view">
    <div class="view-head">
      <h1 id="view-title" class="view-title" tabindex="-1">{{ item.name }}</h1>
      <p v-if="sub" class="lead">{{ sub }}</p>
    </div>

    <section class="block" aria-labelledby="d-benefit-h">
      <h2 id="d-benefit-h" class="section-title">能提供什麼</h2>
      <p class="selectable">{{ benefit || '原文沒有提供內容說明，請看官方說明頁或問承辦窗口' }}</p>
    </section>

    <section class="block" aria-labelledby="d-limit-h">
      <h2 id="d-limit-h" class="section-title">要先注意</h2>
      <p v-for="f in flags" :key="f" class="alert">{{ f }}</p>
      <dl class="facts">
        <div v-if="summary"><dt>適用對象（原文）</dt><dd class="selectable">{{ summary }}</dd></div>
        <div v-if="statusText"><dt>受理情形</dt><dd>{{ statusText }}</dd></div>
        <div v-if="route.deadline"><dt>期限</dt><dd>{{ route.deadline }}</dd></div>
      </dl>
      <template v-if="result?.blocked_by.length">
        <h3 class="sub-title">依填寫的條件不符</h3>
        <ul><li v-for="r in result.blocked_by" :key="r">{{ r }}</li></ul>
      </template>
      <p class="muted">相關不等於符合資格。本服務不計算所得，能不能領由承辦機關審核。</p>
    </section>

    <section class="block" aria-labelledby="d-start-h">
      <h2 id="d-start-h" class="section-title">想申請的話</h2>
      <div class="actions">
        <button v-if="!added" type="button" class="btn btn--primary btn--block" @click="togglePlan(item.id)">加入行動單，開始準備</button>
        <p v-else class="inline-actions">
          <span class="row__mark">已在行動單</span>
          <button type="button" class="btn btn--text" @click="togglePlan(item.id)">移除<span class="sr-only">：{{ item.name }}</span></button>
        </p>
        <ExternalLink v-if="applyLink" :url="applyLink.url" :label="`看申請方法：${applyLink.label}`" :tag="SOURCE_KIND_LABEL[applyLink.sourceKind]" />
      </div>
    </section>

    <div>
      <RouteSteps :item="item" hide-deadline />
      <div class="more-group">
        <details class="more">
          <summary>完整條件與初篩說明</summary>
          <div class="more__body">
            <p v-if="text(item.eligibility?.taipei_applicability)">{{ text(item.eligibility?.taipei_applicability) }}</p>
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
