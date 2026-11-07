<script setup lang="ts">
import { computed } from 'vue';
import { buildRoute } from '../domain/route';
import type { Subsidy } from '../domain/types';
import { openStepHelp } from '../store';
const props = defineProps<{ item: Subsidy; step: string }>();
const index = computed(() => buildRoute(props.item).steps.indexOf(props.step));
</script>

<template>
  <button v-if="index >= 0" :id="`step-help-${item.id}-${index}`" type="button" class="btn btn--block step-help-link" @click="openStepHelp(item.id, step)">
    <span>這一步做不到<span class="sr-only">，開啟步驟協助頁</span></span>
    <span aria-hidden="true">→</span>
  </button>
</template>

<style scoped>
.step-help-link { justify-content: space-between; gap: 12px; white-space: normal; min-height: 48px; }
</style>
