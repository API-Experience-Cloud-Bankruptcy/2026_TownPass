<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, ref, watch } from 'vue';
import { formResources } from '../domain/form-resources';
import type { Subsidy, Target } from '../domain/types';
import { prefersReducedMotion } from '../chat/typing';
import ExternalLink from './ExternalLink.vue';

const FormFillPanel = defineAsyncComponent(() => import('./FormFillPanel.vue'));
const props = defineProps<{ item: Subsidy; target: Target | null; request?: { id: string } | null }>();
const resources = computed(() => formResources(props.item));
const root = ref<HTMLElement>();
const selectedForm = ref('');
const editor = ref<HTMLElement>();
function absolute(url: string) {
  return new URL(url, typeof location === 'undefined' ? 'http://localhost/' : location.href).href;
}
function moveTo(element?: HTMLElement | null) {
  if (!element) return;
  const main = element.closest<HTMLElement>('.app-main');
  if (!main) return;
  element.focus({ preventScroll: true });
  // scrollIntoView 也會捲動 overflow:hidden 的 #app，讓 WebView 頁首消失、底部留白。
  // 只移動內容區；外層尺寸與頁首位置保持不動。
  main.scrollTo({
    top: main.scrollTop + element.getBoundingClientRect().top - main.getBoundingClientRect().top
      - main.clientTop - (parseFloat(getComputedStyle(main).paddingTop) || 0),
    behavior: prefersReducedMotion() ? 'instant' : 'smooth',
  });
}
async function navigate() {
  await nextTick();
  if (props.request) moveTo(root.value?.querySelector<HTMLElement>(`[data-resource="${resources.value.find(r => r.id === props.request?.id)?.id ?? ''}"]`));
}
async function fill(id: string) {
  if (selectedForm.value === id) {
    await nextTick();
    moveTo(editor.value);
    return;
  }
  selectedForm.value = id;
  // 首次載入的非同步元件尚未渲染；由 ready 通知後再對準完整表單。
}
watch(() => props.request, navigate);
watch(() => props.item.id, () => { selectedForm.value = ''; });
onMounted(navigate);
</script>

<template>
  <div ref="root" class="form-resources">
    <p class="muted">申請表與附件可在這裡開啟或下載；證明文件仍須自行準備。請核對來源網站的最新版本。</p>
    <section v-for="resource in resources" :key="resource.id" :data-resource="resource.id" class="card form-resource" tabindex="-1" :aria-label="resource.label">
      <h3 class="sub-title">{{ resource.label }}</h3>
      <p class="muted">{{ resource.formId ? '可帶入本人資料，其他欄位與簽名請自行完成。' : resource.kind === 'online' ? '請到線上系統辦理。' : resource.kind === 'source' ? '請到來源頁面確認可下載的表單。' : '請開啟檔案後自行填寫或列印。' }}</p>
      <div class="actions">
        <button v-if="resource.formId && target === 'self'" type="button" class="btn btn--primary" @click="fill(resource.formId)">填寫這份表單</button>
        <ExternalLink :url="absolute(resource.url)" :label="resource.kind === 'online' ? '前往線上申辦' : resource.kind === 'source' ? '前往表單來源' : '開啟／下載原始檔案'" />
        <ExternalLink v-if="resource.sourceUrl && resource.sourceUrl !== resource.url" :url="resource.sourceUrl" label="來源網站原檔" />
      </div>
    </section>
    <p v-if="!resources.length" class="muted">目前沒有收錄可下載的表單，請依辦理步驟向受理窗口確認；不代表免附文件。</p>
    <section v-if="selectedForm" ref="editor" class="form-resource" tabindex="-1" aria-label="填寫所選申請表">
      <FormFillPanel :key="`${item.id}:${selectedForm}`" :item="item" :target="target" :initial-form-id="selectedForm" @ready="moveTo(editor)" />
    </section>
  </div>
</template>

<style scoped>
.form-resources { display: grid; gap: var(--space-4); }
.form-resource { scroll-margin-top: 5rem; }
.form-resource:focus { outline: 2px solid var(--accent); outline-offset: 4px; }
</style>
