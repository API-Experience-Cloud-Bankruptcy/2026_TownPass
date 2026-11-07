<script setup lang="ts">
import { computed } from 'vue';
import { plainLanguageFor } from '../domain/plain-language';
import { text } from '../domain/match';
import type { MatchResult, Subsidy } from '../domain/types';
import { benefitLabel, itemFlags, sourceExcerpt } from '../presentation';
import { inPlan, openDetail, state } from '../store';

const props = defineProps<{ item: Subsidy; result: MatchResult | undefined }>();
const plain = computed(() => plainLanguageFor(props.item));
const kind = computed(() => benefitLabel(props.item));
const provider = computed(() => text(props.item.provider?.name));
const sub = computed(() => [kind.value, provider.value].filter(Boolean).join('・'));
const flags = computed(() => itemFlags(props.item, props.result));
const added = computed(() => state.session.target === 'self' && inPlan(props.item.id));
</script>

<template>
  <button type="button" class="row" @click="openDetail(item.id)">
    <span class="row__main">
      <span class="row__title">{{ item.name }}</span>
      <span v-if="sub" class="row__sub">{{ sub }}</span>
      <span v-if="plain" class="row__sub">白話導讀：{{ plain.support }}</span>
      <span v-else-if="item.benefit.raw" class="row__sub">內容節錄：{{ sourceExcerpt(item.benefit.raw, 72) }}</span>
      <span v-for="f in flags" :key="f" class="row__flag">{{ f }}</span>
      <span v-if="added" class="row__mark">已在行動單</span>
    </span>
    <span class="row__chev" aria-hidden="true"><svg viewBox="0 0 24 24" width="20" height="20"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg></span>
  </button>
</template>
