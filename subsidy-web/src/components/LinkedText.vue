<script setup lang="ts">
// 原文照列；其中的網址、電話可以直接點（App 內由全域連結處理改走城市通開啟／撥號）。
import { computed } from 'vue';
import { segmentText } from '../domain/channel-text';
import { safeUrl } from '../domain/url';

const props = defineProps<{ text: string }>();
const segments = computed(() => segmentText(props.text));
</script>

<template>
  <span class="selectable"><template v-for="(s, i) in segments" :key="i"
    ><a v-if="s.kind === 'url' && safeUrl(s.url)" class="inline-link" :href="safeUrl(s.url)!" target="_blank" rel="noopener noreferrer">{{ s.text }}<span class="sr-only">（開啟外部網站）</span></a
    ><a v-else-if="s.kind === 'phone'" class="inline-link" :href="`tel:${s.dial}`">{{ s.text }}<span class="sr-only">（撥打電話）</span></a
    ><template v-else>{{ s.text }}</template></template></span>
</template>
