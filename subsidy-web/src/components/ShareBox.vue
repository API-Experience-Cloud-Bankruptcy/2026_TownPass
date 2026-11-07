<script setup lang="ts">
// 輸出預覽與動作：複製、純文字下載、系統分享、列印／另存 PDF。
// 分享取消與失敗分開提示；所有失敗都保留可選取文字備援。
import { computed, ref } from 'vue';
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
  const ok = await copyText(props.body);
  status.value = ok ? '已複製文字。' : '無法自動複製，已顯示文字，請長按選取複製。';
  if (!ok) showRaw.value = true;
}

function onDownload() {
  const ok = downloadText(props.filename, props.body);
  status.value = ok
    ? '已觸發下載純文字檔。若 App 內沒有出現檔案，請改用複製。'
    : '此環境無法下載，已顯示文字，請長按選取複製。';
  if (!ok) showRaw.value = true;
}

async function onShare() {
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
    <h2 :id="`${previewId}-h`" class="section-title">分享前預覽</h2>
    <fieldset v-if="hasConditions" class="share__conds">
      <legend>要加入哪些已填條件？（預設不加入）</legend>
      <label v-for="line in conditions" :key="line" class="check">
        <input type="checkbox" :checked="included.includes(line)" @change="toggle(line)" />
        <span>{{ line }}</span>
      </label>
    </fieldset>
    <p v-else class="muted">內容不含個人條件。</p>
    <p class="muted">不含姓名、身分證、精確收入或住址。分享後由接收者持有。</p>

    <pre :id="previewId" class="share__preview selectable" tabindex="0" :aria-label="`${title}預覽`">{{ body }}</pre>

    <div class="btn-row">
      <button type="button" class="btn btn--primary" @click="onCopy">複製文字</button>
      <button type="button" class="btn" @click="onDownload">下載純文字</button>
      <button type="button" class="btn" @click="onShare">分享</button>
      <button v-if="printable" type="button" class="btn" @click="onPrint">列印／另存 PDF</button>
    </div>
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
