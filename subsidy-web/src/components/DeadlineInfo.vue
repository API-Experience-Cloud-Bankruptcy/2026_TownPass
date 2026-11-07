<script setup lang="ts">
defineProps<{ summary: string; raw: string; hideLabel?: boolean }>();
</script>

<template>
  <div class="deadline-info">
    <p class="deadline-info__summary"><template v-if="!hideLabel">期限：</template>{{ summary }}</p>
    <details v-if="raw && raw !== summary" class="more">
      <summary>完整期限說明</summary>
      <p class="more__body">{{ raw }}</p>
    </details>
  </div>
</template>

<style scoped>
.deadline-info__summary { color: var(--text); font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
</style>
