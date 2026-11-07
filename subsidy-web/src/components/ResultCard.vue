<script setup lang="ts">
import { computed } from 'vue';
import { FIT_LABEL, text } from '../domain/match';
import type { MatchResult, Subsidy } from '../domain/types';
import { inPlan, openDetail, togglePlan } from '../store';

const props = defineProps<{ item: Subsidy; result: MatchResult | undefined }>();
const fit = computed(() => props.result?.fit ?? 'possible');
const added = computed(() => inPlan(props.item.id));
const level = computed(() => {
  const l = props.item.scope?.level;
  return l === 'taipei' ? '臺北市' : l === 'central' ? '中央' : l === 'private_national' ? '民間' : '其他';
});
</script>

<template>
  <article class="result" :aria-labelledby="`r-${item.id}`">
    <p class="result__tags">
      <span class="tag" :class="`tag--${fit}`">{{ FIT_LABEL[fit] }}</span>
      <span class="tag tag--plain">{{ level }}</span>
      <span v-if="item.source_meta?.verification_status !== 'verified'" class="tag tag--plain">
        {{ item.source_meta?.verification_status === 'partial' ? '部分查核' : '未查核' }}
      </span>
    </p>
    <h3 :id="`r-${item.id}`" class="result__name">{{ item.name }}</h3>
    <p v-if="text(item.benefit?.raw)" class="result__benefit">{{ text(item.benefit?.raw) }}</p>
    <ul v-if="result?.reasons.length || result?.blocked_by.length" class="result__reasons">
      <li v-for="r in result?.blocked_by" :key="r" class="is-blocked">{{ r }}</li>
      <li v-for="r in result?.reasons.slice(0, 2)" :key="r">{{ r }}</li>
    </ul>
    <p v-if="result?.pending?.length" class="muted">待確認 {{ result.pending.length }} 項</p>
    <div class="btn-row">
      <button type="button" class="btn" :aria-label="`看詳情：${item.name}`" @click="openDetail(item.id)">看詳情與辦理路線</button>
      <button
        type="button"
        class="btn"
        :class="added ? 'btn--ghost' : 'btn--primary'"
        :aria-pressed="added"
        :aria-label="`${added ? '移出行動單' : '加入行動單'}：${item.name}`"
        @click="togglePlan(item.id)"
      >
        {{ added ? '已加入（再按移除）' : '加入行動單' }}
      </button>
    </div>
  </article>
</template>
