<script setup lang="ts">
// 步驟編號圓圈：本服務的辦事清單標誌。
defineProps<{ current: number; total: number; label?: string }>();
</script>

<template>
  <p class="step-dots">
    <span class="sr-only">{{ label ?? '步驟' }} {{ current }}，共 {{ total }}</span>
    <span v-for="n in total" :key="n" class="dot" :class="{ 'dot--on': n === current, 'dot--done': n < current }" aria-hidden="true">{{ n }}</span>
  </p>
</template>
