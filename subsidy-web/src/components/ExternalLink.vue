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
      <span>{{ label }}</span>
      <span class="sr-only">（開啟外部網站）</span>
    </a>
    <span v-if="failed" class="ext__fallback" role="status">
      無法在 App 內開啟，請複製網址：<span class="selectable">{{ safe }}</span>
    </span>
  </span>
  <span v-else class="muted">{{ label }}：網址無效或未提供，已略過</span>
</template>
