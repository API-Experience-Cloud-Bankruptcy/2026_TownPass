<script setup lang="ts">
// 輸出預覽與動作：複製、純文字下載、系統分享、列印／另存 PDF。
// 分享取消與失敗分開提示；所有失敗都保留可選取文字備援。
import { computed, nextTick, ref, watch } from 'vue';
import { copyText, downloadText, shareText } from '../domain/export';

const props = defineProps<{
  title: string;
  body: string;
  filename: string;
  conditions: string[];
  printable?: boolean;
}>();
const included = defineModel<string[]>('included', { required: true });

const status = ref('');
const showRaw = ref(false);
const previewOpen = ref(false);
const previewHeading = ref<HTMLElement | null>(null);
const settingsHeading = ref<HTMLElement | null>(null);
async function closePreview() {
  previewOpen.value = false;
  showRaw.value = false;
  await nextTick();
  settingsHeading.value?.focus();
}
watch(() => props.body, () => {
  previewOpen.value = false;
  showRaw.value = false;
  status.value = '內容已變更，請重新開啟預覽。';
});
async function openPreview() {
  previewOpen.value = true;
  status.value = '';
  await nextTick();
  previewHeading.value?.focus();
}
const uid = Math.random().toString(36).slice(2, 8);
const previewId = `preview-${uid}`;

const hasConditions = computed(() => props.conditions.length > 0);

function toggle(line: string) {
  included.value = included.value.includes(line)
    ? included.value.filter((l) => l !== line)
    : [...included.value, line];
  status.value = '內容已變更，分享前請再看一次預覽。';
}

async function onCopy() {
  if (!previewOpen.value) return;
  const ok = await copyText(props.body);
  status.value = ok ? '已複製文字。' : '無法自動複製，已顯示文字，請長按選取複製。';
  if (!ok) showRaw.value = true;
}

function onDownload() {
  if (!previewOpen.value) return;
  const ok = downloadText(props.filename, props.body);
  status.value = ok
    ? '已觸發下載純文字檔。若 App 內沒有出現檔案，請改用複製。'
    : '此環境無法下載，已顯示文字，請長按選取複製。';
  if (!ok) showRaw.value = true;
}

async function onShare() {
  if (!previewOpen.value) return;
  const outcome = await shareText(props.title, props.body);
  if (outcome === 'shared') status.value = '已交給系統分享。實際是否送出由你選的 App 決定。';
  else if (outcome === 'cancelled') status.value = '已取消分享，內容未送出。';
  else if (outcome === 'unsupported') {
    status.value = '此環境不支援系統分享，請改用複製或下載。';
    showRaw.value = true;
  } else {
    status.value = '分享失敗，請改用複製或下載。';
    showRaw.value = true;
  }
}

function onPrint() {
  if (!previewOpen.value) return;
  try {
    window.print();
    status.value = '已開啟列印。要存成 PDF，請在列印畫面選「另存為 PDF」；App 內是否支援需實機確認。';
  } catch {
    status.value = '此環境無法列印，請改用下載純文字。';
  }
}
</script>

<template>
  <section class="share" :aria-labelledby="`${previewId}-h`">
    <h2 ref="settingsHeading" tabindex="-1" :id="`${previewId}-h`" class="section-title">{{ title }}匯出</h2>
    <details v-if="hasConditions">
      <summary>加入已填條件（預設不加入）</summary>
    <fieldset class="share__conds">
      <legend>要加入哪些已填條件？（預設不加入）</legend>
      <label v-for="line in conditions" :key="line" class="check">
        <input type="checkbox" :checked="included.includes(line)" @change="toggle(line)" />
        <span>{{ line }}</span>
      </label>
    </fieldset>
    </details>
    <p v-else class="muted">內容不含個人條件。</p>
    <p class="muted">不含姓名、身分證、精確收入或住址。分享後由接收者持有。</p>

    <p class="muted">先查看完整文字，再複製、下載或分享。</p>
    <button v-if="!previewOpen" type="button" class="btn btn--primary btn--block" @click="openPreview">查看完整預覽</button>
    <template v-if="previewOpen">
    <h3 ref="previewHeading" class="sub-title" tabindex="-1">完整文字預覽</h3>
    <pre :id="previewId" class="share__preview selectable" tabindex="0" :aria-label="`${title}預覽`">{{ body }}</pre>

    <div class="btn-row">
      <button type="button" class="btn btn--primary" @click="onCopy">複製文字</button>
      <button type="button" class="btn" @click="onDownload">下載純文字</button>
      <button type="button" class="btn" @click="onShare">分享</button>
      <button v-if="printable" type="button" class="btn" @click="onPrint">列印／另存 PDF</button>
    </div>
    <button type="button" class="btn btn--ghost" @click="closePreview">返回匯出設定</button>
    </template>
    <p class="status-text" role="status" aria-live="polite">{{ status }}</p>
    <textarea
      v-if="showRaw"
      class="share__raw"
      readonly
      :value="body"
      aria-label="可選取的文字內容"
      rows="8"
    ></textarea>
  </section>
</template>

<style scoped>
.share__preview { max-height: none; overflow: visible; }
</style>
