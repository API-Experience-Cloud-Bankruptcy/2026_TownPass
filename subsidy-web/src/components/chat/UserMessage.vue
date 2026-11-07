<script setup lang="ts">
// 使用者的回答。可修改時整個泡泡是按鈕，點了回到那一題。
defineProps<{ text: string; editLabel?: string }>();
const emit = defineEmits<{ edit: [] }>();
</script>

<template>
  <div class="msg msg--user">
    <button v-if="editLabel" type="button" class="bubble bubble--user bubble--edit" @click="emit('edit')">
      <span>{{ text }}</span>
      <span class="bubble__hint">{{ editLabel }}</span>
    </button>
    <p v-else class="bubble bubble--user">{{ text }}</p>
  </div>
</template>
