<script setup lang="ts">
import { computed } from 'vue';
import { FIT_LABEL, text } from '../domain/match';
import { buildRoute, SOURCE_KIND_LABEL, SOURCE_ROLE, STATUS_LABEL } from '../domain/route';
import { back, inPlan, itemsById, results, state, togglePlan } from '../store';
import ExternalLink from './ExternalLink.vue';
import RouteSteps from './RouteSteps.vue';

const item = computed(() => (state.detailId ? itemsById.value.get(state.detailId) : undefined));
const result = computed(() => (item.value ? results.value.get(item.value.id) : undefined));
const route = computed(() => (item.value ? buildRoute(item.value) : null));
const added = computed(() => (item.value ? inPlan(item.value.id) : false));

function kindOf(type: string) {
  return SOURCE_KIND_LABEL[type === 'official' || type === 'third_party' || type === 'other' ? type : 'unknown'];
}
</script>

<template>
  <div class="view">
    <button type="button" class="btn btn--ghost" @click="back">返回</button>
    <template v-if="item && route">
      <h1 id="view-title" class="view-title" tabindex="-1">{{ item.name }}</h1>
      <p class="result__tags">
        <span class="tag" :class="`tag--${result?.fit ?? 'possible'}`">{{ FIT_LABEL[result?.fit ?? 'possible'] }}</span>
        <span class="tag tag--plain">{{ STATUS_LABEL[route.status] ?? '資料狀態未註明' }}</span>
      </p>

      <section class="card" aria-labelledby="benefit-h">
        <h2 id="benefit-h" class="section-title">能提供什麼</h2>
        <p>{{ text(item.benefit?.raw) || '原文未提供內容說明' }}</p>
        <p v-if="text(item.eligibility?.raw_summary)"><strong>對象：</strong>{{ text(item.eligibility?.raw_summary) }}</p>
        <p v-if="text(item.eligibility?.taipei_applicability)" class="muted">
          適用說明：{{ text(item.eligibility?.taipei_applicability) }}
        </p>
      </section>

      <section class="card" aria-labelledby="fit-h">
        <h2 id="fit-h" class="section-title">初篩說明</h2>
        <p class="muted">本服務不比較所得，也不代替機關審核。</p>
        <template v-if="result?.blocked_by.length">
          <h3 class="sub-title">目前不符</h3>
          <ul><li v-for="r in result.blocked_by" :key="r">{{ r }}</li></ul>
        </template>
        <template v-if="result?.reasons.length">
          <h3 class="sub-title">已知相符的單項</h3>
          <ul><li v-for="r in result.reasons" :key="r">{{ r }}</li></ul>
        </template>
        <template v-if="result?.pending?.length">
          <h3 class="sub-title">還要確認（{{ result.pending.length }} 項）</h3>
          <ul><li v-for="r in result.pending" :key="r">{{ r }}</li></ul>
        </template>
        <template v-if="result?.warnings.length">
          <h3 class="sub-title">提醒</h3>
          <ul><li v-for="r in result.warnings" :key="r">{{ r }}</li></ul>
        </template>
      </section>

      <RouteSteps :item="item" />

      <section class="card" aria-labelledby="src-h">
        <h2 id="src-h" class="section-title">資料來源</h2>
        <p class="muted">
          查核日期 {{ route.checkedDate || '未註明' }}；{{ STATUS_LABEL[route.status] ?? '狀態未註明' }}（資料原有標記，本服務未重新查核）。
        </p>
        <p v-if="text(item.source_meta?.notes)" class="muted">備註：{{ text(item.source_meta?.notes) }}</p>
        <ul class="link-list">
          <li v-for="s in route.sources" :key="s.url + s.role">
            <ExternalLink :url="s.url" :label="SOURCE_ROLE[s.role] ?? (s.role || '來源')" :tag="kindOf(s.type)" />
            <span v-if="s.sourceDate" class="muted">來源日期：{{ s.sourceDate }}</span>
          </li>
        </ul>
      </section>

      <div class="sticky-cta">
        <button
          type="button"
          class="btn btn--block"
          :class="added ? 'btn--ghost' : 'btn--primary'"
          :aria-pressed="added"
          @click="togglePlan(item.id)"
        >
          {{ added ? '已在行動單（再按移除）' : '加入行動單' }}
        </button>
      </div>
    </template>
    <template v-else>
      <h1 id="view-title" class="view-title" tabindex="-1">找不到這筆資料</h1>
      <p>資料可能已更新。請回到結果重新選擇。</p>
    </template>
  </div>
</template>
