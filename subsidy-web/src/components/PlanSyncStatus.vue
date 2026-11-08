<script setup lang="ts">
// 行動單的儲存狀態。放在行動單各頁裡面，跟著頁面一起換頁進出場：
// 若放在換頁轉場外面，離場淡出時仍佔位置，新頁面會先往下、淡出結束再跳回原位。
// 錯誤與衝突由 App.vue 的全域提示處理，這裡只顯示讀取、儲存中與已儲存。
import { planSync } from '../store';
</script>

<template>
  <p v-if="!['error', 'conflict'].includes(planSync.state.phase)" class="status-line no-print" role="status">
    <span class="sync-dot" :class="`sync-dot--${planSync.state.phase}`" aria-hidden="true"></span>
    <Transition name="fade" mode="out-in"><span :key="planSync.state.phase">{{ planSync.state.phase === 'saved' ? '已存入資料庫，離開後可繼續準備' : planSync.state.phase === 'saving' ? '正在儲存行動單…' : '正在讀取已儲存的行動單…' }}</span></Transition>
  </p>
</template>
