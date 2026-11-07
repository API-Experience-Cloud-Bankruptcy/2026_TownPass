<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { buildChecklist } from '../domain/checklist';
import { mergeDocuments, OTHER_REGION_TITLE, regionText } from '../domain/documents';
import { copyText, type PlanInput } from '../domain/export';
import { sharePdfFile } from '../domain/pdf-file';
import { answeredRegion, conditionLines, openDetail, pickConditions, planItems, results, state, tab, toggleDoc, togglePlan } from '../store';
import { isInTownPass } from '../townpass';

const included = ref<string[]>([]);
const generatedAt = new Date();
const input = computed<PlanInput>(() => ({
  meta: { catalogVersion: state.catalog?.version ?? '未載入', sourceLabel: state.catalog?.sourceLabel ?? '未載入', generatedAt },
  target: 'other', items: planItems.value, results: results.value,
  conditions: pickConditions(included.value), docChecks: state.session.docChecks, stepDone: state.session.stepDone, region: answeredRegion.value,
}));
const checklist = computed(() => buildChecklist(input.value));
const merged = computed(() => mergeDocuments(planItems.value, answeredRegion.value));
const previewOpen = ref(false);
const busy = ref(false);
const sharing = ref(false);
const status = ref('');
const pdfUrl = ref('');
const file = ref<File | null>(null);
const previewHeading = ref<HTMLElement | null>(null);
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
  if (busy.value) return;
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
    status.value = 'PDF 已製作。請先確認下方全文，再下載或分享。';
    await nextTick();
    previewHeading.value?.focus();
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
    status.value = outcome === 'presented' ? '已提出開啟系統分享；請自行完成儲存或分享，這不代表已送件。'
      : outcome === 'cancelled' ? '已取消或未開啟分享，檔案仍可下載。'
      : outcome === 'unsupported' ? '這裡無法分享 PDF，請使用下載或開啟 PDF。'
      : '未能確認分享結果。請先查看手機分享畫面；若未開啟，可改用下載或開啟 PDF。';
  } finally { sharing.value = false; }
}
function downloaded() { status.value = '已提出下載；若未出現檔案，請用「儲存／分享 PDF」或「開啟 PDF」。'; }
const fullText = computed(() => [checklist.value.title, checklist.value.subtitle, ...checklist.value.metaLines,
  checklist.value.privacyNotice, ...checklist.value.conditions,
  ...checklist.value.sections.flatMap(s => [s.title, ...s.blocks.map(b => `${b.kind === 'check' ? (b.checked ? '[已準備] ' : '[ ] ') : ''}${b.text}${b.url && !b.text.includes(b.url) ? `\n${b.url}` : ''}`)]),
].join('\n'));
async function copy() { status.value = await copyText(fullText.value) ? '已複製完整檢核表文字。' : '無法自動複製，請長按下方全文選取。'; }
</script>

<template>
  <div class="view checklist-view">
    <div class="view-head">
      <h1 id="view-title" class="view-title" tabindex="-1">家人行動檢核表</h1>
      <p class="lead">整理成 A4 PDF，交給家人照著準備、逐項打勾。</p>
      <p class="muted">可合併多項資源，內容較多會自動分頁。檢核表不是核准或送件證明。</p>
    </div>
    <div v-if="!planItems.length" class="actions">
      <p>尚未選擇資源。到資源詳情按「加入家人檢核表」，再回來製作 PDF。</p>
      <button type="button" class="btn btn--primary btn--block" @click="tab('home')">開始找資源</button>
    </div>
    <template v-else>
      <section class="actions" aria-labelledby="checklist-items-h">
        <h2 id="checklist-items-h" class="section-title">要放進 PDF 的資源（{{ planItems.length }}）</h2>
        <ul class="rows">
          <li v-for="item in planItems" :key="item.id" class="row-static">
            <span class="row__title">{{ item.name }}</span>
            <span class="inline-actions">
              <button type="button" class="btn btn--text" @click="openDetail(item.id)">查看內容<span class="sr-only">：{{ item.name }}</span></button>
              <button type="button" class="btn btn--text" @click="togglePlan(item.id)">移除<span class="sr-only">：{{ item.name }}</span></button>
            </span>
          </li>
        </ul>
        <button type="button" class="btn btn--text" @click="tab('results')">繼續選資源</button>
      </section>
      <details v-if="merged.documents.length" class="more more--single">
        <summary>已經準備好的文件（選填）</summary>
        <div class="more__body">
          <p class="muted">勾選會帶到 PDF；未勾選的項目保留空格，讓家人在紙上打勾。</p>
          <label v-for="doc in merged.documents" :key="doc.key" class="check">
            <input type="checkbox" :checked="!!state.session.docChecks[doc.key]" @change="toggleDoc(doc.key)" />
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
      <details v-if="merged.otherRegion.length" class="more more--single">
        <summary>{{ OTHER_REGION_TITLE }}（{{ merged.otherRegion.length }}）</summary>
        <div class="more__body">
          <label v-for="doc in merged.otherRegion" :key="doc.key" class="check">
            <input type="checkbox" :checked="!!state.session.docChecks[doc.key]" @change="toggleDoc(doc.key)" />
            <span class="check__body">
              <span>{{ doc.name }}{{ doc.required === false ? '（非必要）' : '' }}</span>
              <span class="muted">{{ regionText(doc.regions) }}</span>
              <span v-if="doc.condition" class="muted">條件：{{ doc.condition }}</span>
              <span v-if="doc.notes" class="muted">{{ doc.notes }}</span>
              <span class="muted">用於：{{ doc.usedBy.map(u => u.name).join('、') }}</span>
            </span>
          </label>
        </div>
      </details>
      <details v-if="conditionLines.length" class="more more--single">
        <summary>要不要附上對方的填答條件</summary>
        <fieldset class="more__body">
          <legend class="muted">預設不附上，勾選才會寫進 PDF；交給別人前請確認。</legend>
          <label v-for="line in conditionLines" :key="line" class="check">
            <input v-model="included" type="checkbox" :value="line" />
            <span>{{ line }}</span>
          </label>
        </fieldset>
      </details>
      <div class="actions" :aria-busy="busy">
        <p class="muted">紙本包含：文件清單、辦理步驟、資格與期限提醒、窗口與來源、求助問句、手寫紀錄欄。</p>
        <button type="button" class="btn btn--primary btn--block" :disabled="busy" @click="preview">{{ busy ? '正在製作 PDF…' : previewOpen ? '重新製作 PDF' : '預覽 A4 檢核表' }}</button>
      </div>
      <p class="status-text note" role="status" aria-live="polite">{{ status }}</p>
      <section v-if="previewOpen && file" class="actions" aria-labelledby="checklist-preview-h">
        <h2 id="checklist-preview-h" ref="previewHeading" tabindex="-1" class="stage-title">確認檢核表全文</h2>
        <p class="muted">{{ planItems.length }} 項資源 · A4 直式 · {{ (file.size / 1024).toFixed(0) }} KB</p>
        <div class="share__grid">
          <button v-if="isInTownPass()" type="button" class="btn btn--primary" :disabled="sharing" @click="share">{{ sharing ? '等待手機分享…' : '儲存／分享 PDF' }}</button>
          <a :href="pdfUrl" :download="filename" class="btn" :class="{ 'btn--primary': !isInTownPass() }" @click="downloaded">下載 A4 PDF</a>
          <button v-if="!isInTownPass()" type="button" class="btn" :disabled="sharing" @click="share">分享 PDF</button>
          <a :href="pdfUrl" target="_blank" rel="noopener" class="btn">開啟 PDF<span class="sr-only">（新視窗）</span></a>
        </div>
        <details class="more more--single">
          <summary>查看 A4 PDF 排版</summary>
          <div class="more__body"><p class="muted">若這裡無法顯示，請用上方「開啟 PDF」。下方另有完整文字。</p><iframe :src="pdfUrl" class="pdf-preview" title="A4 行動檢核表 PDF 預覽"></iframe></div>
        </details>
      </section>
      <details class="more more--single" :open="previewOpen">
        <summary>完整檢核表文字</summary>
        <article class="checklist-paper selectable">
          <header class="checklist-paper__head">
            <p class="muted">福利通 · 申辦準備用</p>
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
