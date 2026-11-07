<script setup lang="ts">
import { computed } from 'vue';
import { FIT_LABEL, text } from '../domain/match';
import type { MatchResult, Subsidy } from '../domain/types';
import { inPlan, openDetail, togglePlan } from '../store';

const props = defineProps<{ item: Subsidy; result: MatchResult | undefined }>();
const fit = computed(() => props.result?.fit ?? 'possible');
const added = computed(() => inPlan(props.item.id));
const snippet = computed(() => {
  const full = text(props.item.benefit?.raw);
  return full.length > 70 ? `${full.slice(0, 70)}…` : full;
});
const expired = computed(() => props.result?.warnings.some((w) => w.includes('可能已過')) ?? false);
</script>

<template>
  <article class="result" :aria-labelledby="`r-${item.id}`">
    <p class="result__tags">
      <span class="tag" :class="`tag--${fit}`">{{ FIT_LABEL[fit] }}</span>
      <span v-if="item.source_meta?.verification_status !== 'verified'" class="tag tag--plain">{{ item.source_meta?.verification_status === 'partial' ? '部分查核' : '未查核' }}</span>
      <span v-if="expired" class="tag tag--ineligible">原期限可能已過</span>
    </p>
    <h2 :id="`r-${item.id}`" class="result__name">{{ item.name }}</h2>
    <p v-if="snippet" class="result__benefit">{{ snippet }}</p>
    <p v-if="result?.blocked_by.length" class="error">有 {{ result.blocked_by.length }} 項已填條件不符，詳情請確認。</p>
    <div class="btn-row">
      <button type="button" class="btn btn--primary" :aria-label="`看詳情：${item.name}`" @click="openDetail(item.id)">看詳情 →</button>
      <button type="button" class="btn btn--ghost" :aria-pressed="added" :aria-label="`${added ? '移出行動單' : '加入行動單'}：${item.name}`" @click="togglePlan(item.id)">{{ added ? '已加入 · 移除' : '加入行動單' }}</button>
    </div>
  </article>
</template>
