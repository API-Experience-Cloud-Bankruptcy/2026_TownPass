<script setup lang="ts">
// 打字輸入的一來一往：使用者原句＋福利連的回覆。回覆和其他訊息一樣用泡泡、頭像與打字效果，
// 讓整段對話像同一個人在回。回覆文字更新時換新的 key，重新播放。
import BotMessage from './BotMessage.vue';
import UserMessage from './UserMessage.vue';

defineProps<{ turns: { id: number; text: string; reply: string }[] }>();
</script>

<template>
  <template v-for="t in turns" :key="t.id">
    <UserMessage :text="t.text" />
    <BotMessage v-if="t.reply" :key="`turn:${t.id}:${t.reply}`" :msg-key="`turn:${t.id}:${t.reply}`" :lines="[{ text: t.reply }]" live />
  </template>
</template>
