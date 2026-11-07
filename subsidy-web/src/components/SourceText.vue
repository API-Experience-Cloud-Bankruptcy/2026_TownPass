<script setup lang="ts">
import { computed } from 'vue';
import { sourceParagraphs } from '../domain/source-content';
import LinkedText from './LinkedText.vue';
const props = defineProps<{ text: string }>();
const paragraphs = computed(() => sourceParagraphs(props.text));
</script>

<template>
  <div class="source-text selectable">
    <p v-for="(paragraph, i) in paragraphs" :key="i"><LinkedText :text="paragraph" /></p>
  </div>
</template>

<style scoped>
.source-text { min-width: 0; overflow-wrap: anywhere; line-height: 1.85; }
.source-text p { margin: 0; white-space: pre-wrap; }
.source-text p + p { margin-top: var(--space-3); }
</style>
