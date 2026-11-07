<script setup lang="ts">
// 使用者的回答。可修改時整個泡泡是按鈕，點了回到那一則重新選。
// 畫面上一律寫「修改」配鉛筆圖示，長輩一看就懂；editLabel 只給讀屏說明改的是什麼（例：修改對象）。
defineProps<{ text: string; editLabel?: string }>();
const emit = defineEmits<{ edit: [] }>();
</script>

<template>
  <div class="msg msg--user">
    <button v-if="editLabel" type="button" class="bubble bubble--user bubble--edit" :aria-label="`${editLabel}：${text}`" @click="emit('edit')">
      <span>{{ text }}</span>
      <span class="bubble__hint" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4z" /><path d="M14 6l4 4" /></svg>
        修改
      </span>
    </button>
    <p v-else class="bubble bubble--user">{{ text }}</p>
  </div>
</template>
