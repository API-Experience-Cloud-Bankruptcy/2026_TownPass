<script setup lang="ts">
import { computed, ref } from 'vue';
import { safeUrl } from '../domain/url';
import { isInTownPass, openLink } from '../townpass';

const props = defineProps<{ url: string | null | undefined; label: string }>();
const safe = computed(() => safeUrl(props.url));
const failed = ref(false);

// App 內以新 WebView 開啟；App 成功時不回覆，因此只能捕捉送出失敗，並一律保留網址文字備援。
function onClick(event: MouseEvent) {
  if (!safe.value || !isInTownPass()) return;
  event.preventDefault();
  failed.value = false;
  try {
    openLink(safe.value);
  } catch {
    failed.value = true;
  }
}
</script>

<template>
  <span v-if="safe" class="ext">
    <a class="ext__link" :href="safe" target="_blank" rel="noopener noreferrer" @click="onClick">
      <span class="ext__label">{{ label }}</span>
      <svg class="ext__icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M14 5h5v5M19 5 10 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /><path d="M17 13.5V18a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1h4.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
      <span class="sr-only">（開啟外部網站）</span>
    </a>
    <span v-if="failed" class="ext__fallback" role="status">
      無法在 App 內開啟，請複製網址：<span class="selectable">{{ safe }}</span>
    </span>
  </span>
  <span v-else class="muted">{{ label }}：未提供可開啟的網址</span>
</template>
