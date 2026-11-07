<script setup lang="ts">
import { computed } from 'vue';
import { text } from '../domain/match';
import type { MatchResult, Subsidy } from '../domain/types';
import { benefitLabel, itemFlags } from '../presentation';
import { inPlan, openDetail, state } from '../store';

const props = defineProps<{ item: Subsidy; result: MatchResult | undefined }>();
const kind = computed(() => benefitLabel(props.item));
const provider = computed(() => text(props.item.provider?.name));
const sub = computed(() => [kind.value, provider.value].filter(Boolean).join('・'));
const flags = computed(() => itemFlags(props.item, props.result));
const added = computed(() => inPlan(props.item.id));
</script>

<template>
  <button type="button" class="row" @click="openDetail(item.id)">
    <span class="row__main">
      <span class="row__title">{{ item.name }}</span>
      <span v-if="sub" class="row__sub">{{ sub }}</span>
      <span v-for="f in flags" :key="f" class="row__flag">{{ f }}</span>
      <span v-if="added" class="row__mark">{{ state.session.target === 'other' ? '已加入檢核表' : '已在行動單' }}</span>
    </span>
    <span class="row__chev" aria-hidden="true">›</span>
  </button>
</template>
