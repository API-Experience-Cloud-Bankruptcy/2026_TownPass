<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { buildChecklist } from '../domain/checklist';
import { mergeDocuments } from '../domain/documents';
import { copyText, type PlanInput } from '../domain/export';
import { sharePdfFile } from '../domain/pdf-file';
import { conditionLines, pickConditions, results, state } from '../store';
import type { Subsidy } from '../domain/types';
import { isInTownPass } from '../townpass';
import Expand from './motion/Expand.vue';

const props = defineProps<{ item: Subsidy }>();
const planItems = computed(() => [props.item]);
const docChecks = ref<Record<string, boolean>>({});
function toggleDoc(key: string) { docChecks.value = { ...docChecks.value, [key]: !docChecks.value[key] }; }
const included = ref<string[]>([]);
const generatedAt = new Date();
const input = computed<PlanInput>(() => ({
  meta: { catalogVersion: state.catalog?.version ?? '未載入', sourceLabel: state.catalog?.sourceLabel ?? '未載入', generatedAt },
  target: 'other', items: planItems.value, results: results.value,
  conditions: pickConditions(included.value), docChecks: docChecks.value, stepDone: {}, documentAnswers: state.session.answers,
}));
const checklist = computed(() => buildChecklist(input.value));
const merged = computed(() => mergeDocuments(planItems.value, state.session.answers));
const previewOpen = ref(false);
const busy = ref(true);
const sharing = ref(false);
const status = ref('正在製作 A4 PDF，第一次需載入中文字型。');
let previewStarted = false;
const pdfUrl = ref('');
const file = ref<File | null>(null);
const previewHeading = ref<HTMLElement | null>(null);
const textDetails = ref<HTMLDetailsElement | null>(null);
const filename = `福利行動檢核表-${[generatedAt.getFullYear(), String(generatedAt.getMonth() + 1).padStart(2, '0'), String(generatedAt.getDate()).padStart(2, '0')].join('-')}.pdf`;
let revision = 0;
let mounted = true;
function releasePdf() {
  if (pdfUrl.value) URL.revokeObjectURL(pdfUrl.value);
  pdfUrl.value = '';
  file.value = null;
}
watch(input, () => {
  revision++;
  previewOpen.value = false;
  releasePdf();
  status.value = '內容已更新，請重新預覽檢核表。';
}, { deep: true, flush: 'sync' });
onBeforeUnmount(() => { mounted = false; revision++; releasePdf(); });

async function preview() {
  if (busy.value && previewStarted) return;
  previewStarted = true;
  const wasOpen = previewOpen.value;
  const current = revision;
  busy.value = true;
  status.value = '正在製作 A4 PDF，第一次需載入中文字型。';
  // 固定本次輸出資料，避免製作途中改答案或換人後交付舊檔。
  const snapshot: PlanInput = {
    ...JSON.parse(JSON.stringify(input.value)),
    meta: { ...input.value.meta, generatedAt },
    results: new Map(JSON.parse(JSON.stringify([...input.value.results]))),
  };
  try {
    const { createChecklistPdf } = await import('../domain/checklist-pdf');
    const bytes = await createChecklistPdf(snapshot);
    if (!mounted || current !== revision) return;
    releasePdf();
    file.value = new File([new Uint8Array(bytes)], filename, { type: 'application/pdf' });
    pdfUrl.value = URL.createObjectURL(file.value);
    previewOpen.value = true;
    status.value = 'PDF 已做好。請先確認下方全文，再儲存或分享。';
    await nextTick();
    previewHeading.value?.focus();
    const details = textDetails.value;
    if (!wasOpen && details?.animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const summary = details.querySelector('summary');
      const from = summary?.offsetHeight ?? 0;
      const to = details.getBoundingClientRect().height;
      if (to - from > 4) {
        details.style.overflow = 'hidden';
        const anim = details.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: 300, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' });
        anim.onfinish = () => { details.style.overflow = ''; };
      }
    }
  } catch {
    if (mounted && current === revision) status.value = 'PDF 製作失敗，請重新嘗試。下方仍可查看完整檢核表。';
  } finally { busy.value = false; }
}
async function share() {
  if (!file.value || sharing.value) return;
  sharing.value = true;
  status.value = '';
  try {
    const outcome = await sharePdfFile(file.value);
    if (!mounted) return;
    status.value = outcome === 'presented' ? '已要求開啟分享畫面，請在手機上完成儲存或分享；這不代表已送件。'
      : outcome === 'cancelled' ? '已取消或未開啟分享，檔案仍可下載。'
      : outcome === 'unsupported' ? '這裡無法分享 PDF，請使用下載或開啟 PDF。'
      : '未能確認分享結果。請先查看手機分享畫面；若未開啟，可改用下載或開啟 PDF。';
  } finally { sharing.value = false; }
}
function downloaded() { status.value = '已要求下載；若沒有出現檔案，請用「分享 PDF」或「開啟 PDF」。'; }
const fullText = computed(() => [checklist.value.title, checklist.value.subtitle, ...checklist.value.metaLines,
  checklist.value.privacyNotice, ...checklist.value.conditions,
  ...checklist.value.sections.flatMap(s => [s.title, ...s.blocks.map(b => `${b.kind === 'check' ? (b.checked ? '[已準備] ' : '[ ] ') : ''}${b.text}${b.url && !b.text.includes(b.url) ? `\n${b.url}` : ''}`)]),
].join('\n'));
async function copy() { status.value = await copyText(fullText.value) ? '已複製完整檢核表文字。' : '無法自動複製，請長按下方全文選取。'; }
onMounted(() => { void preview(); });
</script>

<template>
  <div class="view checklist-view">
    <div class="view-head card card--hero">
      <h2 class="section-title">申請準備 PDF</h2>
      <p class="muted">檢核表不是核准或送件證明。</p>
    </div>
    <template v-if="planItems.length">
      <details v-if="merged.documents.length" class="more more--single card card--list">
        <summary>已經準備好的文件（選填）</summary>
        <div class="more__body">
          <label v-for="doc in merged.documents" :key="doc.key" class="check">
            <input type="checkbox" :checked="!!docChecks[doc.key]" @change="toggleDoc(doc.key)" />
            <span class="check__body">
              <span>{{ doc.name }}{{ doc.required === false ? '（非必要）' : '' }}</span>
              <span v-if="doc.hasVariant" class="muted">同名但要求不同，請分開準備</span>
              <span v-if="doc.condition" class="muted">條件：{{ doc.condition }}</span>
              <span v-if="doc.notes" class="muted">{{ doc.notes }}</span>
              <span class="muted">用於：{{ doc.usedBy.map(u => u.name).join('、') }}</span>
            </span>
          </label>
        </div>
      </details>
      <details v-if="conditionLines.length" class="more more--single card card--list">
        <summary>要不要附上對方的填答條件</summary>
        <fieldset class="more__body">
          <legend class="muted">預設不附上，勾選才會寫進 PDF；交給別人前請確認。</legend>
          <label v-for="line in conditionLines" :key="line" class="check">
            <input v-model="included" type="checkbox" :value="line" />
            <span>{{ line }}</span>
          </label>
        </fieldset>
      </details>
      <div class="actions card" :aria-busy="busy">
        <button type="button" class="btn btn--primary btn--block" :disabled="busy" @click="preview">
          <Transition name="fade" mode="out-in">
            <span :key="busy ? 'busy' : previewOpen ? 'again' : 'idle'">{{ busy ? '正在製作 PDF…' : previewOpen ? '重新製作 PDF' : '預覽 A4 檢核表' }}</span>
          </Transition>
        </button>
      </div>
      <Transition name="fade" mode="out-in">
        <p v-if="status" :key="status" class="status-text note" role="status">{{ status }}</p>
      </Transition>
      <Expand>
      <section v-if="previewOpen && file" class="actions card" aria-labelledby="checklist-preview-h">
        <h2 id="checklist-preview-h" ref="previewHeading" tabindex="-1" class="stage-title">確認檢核表全文</h2>
        <p class="muted">{{ planItems.length }} 項資源 · A4 直式 · {{ (file.size / 1024).toFixed(0) }} KB</p>
        <div class="share__grid">
          <button v-if="isInTownPass()" type="button" class="btn btn--primary" :disabled="sharing" @click="share">{{ sharing ? '等待手機分享…' : '儲存／分享 PDF' }}</button>
          <a v-if="!isInTownPass()" :href="pdfUrl" :download="filename" class="btn btn--primary" @click="downloaded">下載 A4 PDF</a>
          <button v-if="!isInTownPass()" type="button" class="btn" :disabled="sharing" @click="share">分享 PDF</button>
          <a v-if="!isInTownPass()" :href="pdfUrl" target="_blank" rel="noopener" class="btn">開啟 PDF<span class="sr-only">（新視窗）</span></a>
        </div>
        <details class="more more--single">
          <summary>查看 A4 PDF 排版</summary>
          <div class="more__body"><iframe :src="pdfUrl" class="pdf-preview" title="A4 行動檢核表 PDF 預覽"></iframe></div>
        </details>
      </section>
      </Expand>
      <details ref="textDetails" class="more more--single card card--list" :open="previewOpen">
        <summary>完整檢核表文字</summary>
        <article class="checklist-paper selectable">
          <header class="checklist-paper__head">
            <p class="muted">福利連 · 申辦準備用</p>
            <h2 class="section-title">{{ checklist.title }}</h2>
            <p>{{ checklist.subtitle }}</p>
            <p v-for="line in checklist.metaLines" :key="line" class="muted">{{ line }}</p>
            <p class="muted">{{ checklist.privacyNotice }}</p>
            <p v-for="line in checklist.conditions" :key="line">{{ line }}</p>
          </header>
          <section v-for="section in checklist.sections" :key="section.id" class="checklist-paper__section">
            <h3 class="section-title">{{ section.title }}</h3>
            <template v-for="(block, index) in section.blocks" :key="index">
              <h4 v-if="block.kind === 'heading'" class="sub-title">{{ block.text }}</h4>
              <p v-else-if="block.kind === 'check'" class="paper-check"><span class="paper-check__box" aria-hidden="true">{{ block.checked ? '✓' : '' }}</span><span><span class="sr-only">{{ block.checked ? '已勾選：' : '未勾選：' }}</span>{{ block.text }}</span></p>
              <p v-else-if="block.kind === 'link'"><a :href="block.url" target="_blank" rel="noopener noreferrer">{{ block.text }}<span class="sr-only">（新視窗）</span></a></p>
              <p v-else :class="{ 'paper-notes': block.kind === 'notes' }">{{ block.text }}</p>
            </template>
          </section>
        </article>
        <button type="button" class="btn btn--text" @click="copy">複製完整文字</button>
      </details>
    </template>
  </div>
</template>
