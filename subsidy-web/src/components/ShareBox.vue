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
  status.value = '內容已更新，請重新確認全文。';
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
  status.value = '內容已更新，分享前請再確認一次全文。';
}

async function onCopy() {
  if (!previewOpen.value) return;
  const ok = await copyText(props.body);
  status.value = ok ? '已複製' : '無法自動複製，請長按下方文字選取';
  if (!ok) showRaw.value = true;
}

function onDownload() {
  if (!previewOpen.value) return;
  const ok = downloadText(props.filename, props.body);
  status.value = ok
    ? '已開始下載；如果 App 裡沒看到檔案，請改用複製'
    : '這裡不能下載，請長按下方文字選取';
  if (!ok) showRaw.value = true;
}

async function onShare() {
  if (!previewOpen.value) return;
  const outcome = await shareText(props.title, props.body);
  if (outcome === 'shared') status.value = '已開啟分享，是否送出由你選的 App 決定';
  else if (outcome === 'cancelled') status.value = '已取消，沒有送出';
  else if (outcome === 'unsupported') {
    status.value = '這裡不能分享，請改用複製';
    showRaw.value = true;
  } else {
    status.value = '分享失敗，請改用複製';
    showRaw.value = true;
  }
}

function onPrint() {
  if (!previewOpen.value) return;
  try {
    window.print();
    status.value = '已開啟列印；要存 PDF，請在列印畫面選「另存為 PDF」';
  } catch {
    status.value = '這裡不能列印，請改用下載文字檔';
  }
}
</script>

<template>
  <section class="share" :aria-labelledby="`${previewId}-h`">
    <h2 ref="settingsHeading" tabindex="-1" :id="`${previewId}-h`" class="stage-title">{{ title }}</h2>
    <p class="muted">不含姓名、身分證、收入或住址；分享後由對方保存。</p>

    <details v-if="hasConditions" class="more more--single">
      <summary>要不要附上填寫的條件</summary>
      <fieldset class="more__body">
        <legend class="muted">預設不附上，勾選才會加入。</legend>
        <label v-for="line in conditions" :key="line" class="check">
          <input type="checkbox" :checked="included.includes(line)" @change="toggle(line)" />
          <span>{{ line }}</span>
        </label>
      </fieldset>
    </details>

    <button v-if="!previewOpen" type="button" class="btn btn--primary btn--block" @click="openPreview">先看全文</button>
    <template v-if="previewOpen">
      <h3 ref="previewHeading" class="section-title" tabindex="-1">全文</h3>
      <pre :id="previewId" class="share__preview selectable" tabindex="0" :aria-label="`${title}全文`">{{ body }}</pre>
      <button type="button" class="btn btn--primary btn--block" @click="onCopy">複製文字</button>
      <div class="share__grid">
        <button type="button" class="btn" @click="onShare">分享</button>
        <button type="button" class="btn" @click="onDownload">下載文字檔</button>
        <button v-if="printable" type="button" class="btn" @click="onPrint">列印／另存 PDF</button>
      </div>
      <button type="button" class="btn btn--text" @click="closePreview">返回設定</button>
    </template>
    <p class="status-text note" role="status" aria-live="polite">{{ status }}</p>
    <textarea v-if="showRaw" class="share__raw" readonly :value="body" aria-label="可選取的文字內容" rows="8"></textarea>
  </section>
</template>
