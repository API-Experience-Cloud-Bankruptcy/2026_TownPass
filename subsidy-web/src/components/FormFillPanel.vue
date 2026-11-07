<script setup lang="ts">
// 一筆資源的「填寫申請表」面板：選表單 → 一鍵帶入城市通資料並產生 PDF → 下載／分享。
// 由資源詳情按需載入，關閉面板即釋放本人資料與 PDF。
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { createFilledForm, type FilledForm } from '../domain/form-fill-client';
import { formAvailability, formPdfUrl } from '../domain/form-fields';
import { profileFromAccount } from '../domain/form-profile';
import { sharePdfFile } from '../domain/pdf-file';
import type { Subsidy, Target } from '../domain/types';
import { getUserInfo, isInTownPass, type Account } from '../townpass';
import ExternalLink from './ExternalLink.vue';
import Expand from './motion/Expand.vue';

const props = withDefaults(defineProps<{
  item: Subsidy;
  target: Target | null;
  /** 測試或呼叫端可替換；預設走城市通橋接。 */
  loadAccount?: () => Promise<Account | null>;
}>(), { loadAccount: getUserInfo });

const availability = computed(() => formAvailability(props.item));
const forms = computed(() => (availability.value.kind === 'fillable' ? availability.value.forms : []));
const selectedId = ref('');
const form = computed(() => forms.value.find((f) => f.id === selectedId.value) ?? forms.value[0] ?? null);
const busy = ref(false);
const sharing = ref(false);
const status = ref('');
const result = ref<FilledForm | null>(null);
const pdfUrl = ref('');
// 轉成完整網址：App 內要交給原生開新頁，相對路徑在那裡無法解析。
const blankUrl = computed(() => {
  const path = form.value?.entry.localFile ? formPdfUrl(form.value.entry.localFile) : null;
  return path ? new URL(path, typeof location === 'undefined' ? 'http://localhost/' : location.href).href : null;
});
let revision = 0;
let mounted = true;

const EXTERNAL_TEXT: Record<string, string> = {
  online_system: '這項要在官方線上系統辦理，沒有可填的紙本表單。',
  office_file_only: '官方表單是 Word／ODT 格式，本服務不能自動填寫，請下載後自行填寫。',
  scanned_image_pdf: '官方表單是掃描檔，本服務不能自動填寫，請下載後手寫。',
  text_unreadable: '官方表單的文字無法讀取，本服務不能自動填寫，請下載後手寫。',
  analysis_error: '這份表單無法自動分析，請下載後自行填寫。',
  download_failed: '官方表單連結目前無法取得，請到官方頁面確認。',
};

function release() {
  if (pdfUrl.value) URL.revokeObjectURL(pdfUrl.value);
  pdfUrl.value = '';
  result.value = null;
}
// 換表單、換資源、換人或資料變動：舊的已填檔不可留著被分享。
watch(selectedId, () => { revision++; release(); status.value = ''; }, { flush: 'sync' });
watch([() => props.item, () => props.target], () => {
  revision++; release(); status.value = ''; selectedId.value = '';
}, { deep: true, flush: 'sync' });
onBeforeUnmount(() => { mounted = false; revision++; release(); });

async function generate() {
  if (busy.value || !form.value || props.target !== 'self') return;
  const current = revision;
  busy.value = true;
  status.value = '正在讀取城市通資料並填寫，第一次需載入中文字型。';
  try {
    const profile = profileFromAccount(await props.loadAccount());
    if (!mounted || current !== revision) return;
    if (!Object.keys(profile).length) { status.value = '城市通沒有可帶入的資料（可能尚未登入），請開啟空白表單自行填寫。'; return; }
    const out = await createFilledForm(form.value, profile, props.target);
    if (!mounted || current !== revision) return;
    release();
    result.value = out;
    pdfUrl.value = URL.createObjectURL(out.file);
    status.value = isInTownPass() ? '已帶入你的城市通資料，請檢查後再儲存或分享。' : '目前不在城市通內，填入的是模擬資料。';
  } catch (e) {
    if (mounted && current === revision) status.value = e instanceof Error && e.message ? `填寫失敗：${e.message}` : '填寫失敗，請重新嘗試。';
  } finally { busy.value = false; }
}

async function share() {
  if (!result.value || sharing.value) return;
  sharing.value = true;
  try {
    const outcome = await sharePdfFile(result.value.file);
    status.value = outcome === 'presented' ? '已要求開啟分享畫面，請在手機上完成儲存或分享，並確認檔案是否存好。'
      : outcome === 'cancelled' ? '已取消分享。'
      : outcome === 'unsupported' ? '這個瀏覽器不能直接分享檔案，請改用下載。'
      : '未能確認分享結果。若沒有出現分享畫面，請改用下載或開啟 PDF。';
  } finally { sharing.value = false; }
}
</script>

<template>
  <section class="form-fill" aria-labelledby="form-fill-h">
    <h2 id="form-fill-h" class="section-title">申請表</h2>

    <template v-if="availability.kind === 'fillable' && form">
      <div class="actions card">
        <template v-if="forms.length > 1">
          <fieldset class="field">
            <legend class="field__label">要填哪一份</legend>
            <label v-for="f in forms" :key="f.id" class="check">
              <input v-model="selectedId" type="radio" name="form-pick" :value="f.id" :checked="f.id === form.id" />
              <span class="check__body">{{ f.label }}{{ f.main ? '（主要申請表）' : '' }}</span>
            </label>
          </fieldset>
        </template>
        <p v-else class="muted">{{ form.label }}</p>
        <p v-if="form.entry.requiresHandwritten" class="alert">這份表單要求本人親筆簽名；本服務不會代簽。填好後請列印，並由本人親自簽名。<span v-if="form.entry.handwrittenEvidence[0]" class="muted selectable">原文：{{ form.entry.handwrittenEvidence[0] }}</span></p>
        <p v-if="form.entry.fields.some(f => f.blocked_reason === 'position_unverified')" class="alert">這份表單的姓名欄位置尚待確認，會保留空白，請自行手寫。</p>
        <p class="muted">按下按鈕會用你的城市通帳號資料（姓名、身分證、手機、地址）填進格子並產生 PDF；資料只在這台裝置上處理，不會上傳。其餘欄位、勾選和簽名請自行完成。填好的檔案不是核准或送件證明；請以官方最新版表單為準。</p>
        <ExternalLink v-if="blankUrl" :url="blankUrl" label="開啟空白表單" />
      </div>

      <div v-if="target === 'self'" class="actions card" :aria-busy="busy">
        <button type="button" class="btn btn--primary btn--block" :disabled="busy" @click="generate">
          <Transition name="fade" mode="out-in">
            <span :key="busy ? 'busy' : result ? 'again' : 'go'">{{ busy ? '正在填寫…' : result ? '重新產生' : '帶入資料，產生申請表' }}</span>
          </Transition>
        </button>
      </div>
      <p v-else class="alert">目前不是替自己申請，不會自動填入任何個人資料。請改選「幫自己找」，或把空白表單列印後手寫。</p>
      <Transition name="fade" mode="out-in">
        <p v-if="status" :key="status" class="status-text note" role="status">{{ status }}</p>
      </Transition>

      <Expand>
      <section v-if="result" class="actions card" aria-labelledby="form-fill-result-h">
        <h3 id="form-fill-result-h" class="sub-title">已帶入資料</h3>
        <ul>
          <li>已填入 {{ result.summary.drawn }} 欄。</li>
          <li v-if="result.summary.signatures">{{ result.summary.signatures }} 處簽名／蓋章欄未填，請本人簽署。</li>
          <li v-if="result.summary.checkboxes">{{ result.summary.checkboxes }} 個勾選框請自行勾選。</li>
          <li v-if="result.summary.otherBlanks">另有 {{ result.summary.otherBlanks }} 個欄位需要自行填寫或沒有自動填入。</li>
          <li v-for="s in result.report.skipped.filter((x) => x.reason === 'too_wide' || x.reason === 'prefix_mismatch')" :key="`${s.field.box.page}-${s.field.box.x}-${s.field.box.y}`">
            「{{ s.field.label || '未命名欄位' }}」{{ s.reason === 'too_wide' ? '內容太長放不進格子，請手寫。' : '表單上預印的地址與你的地址不同，請手寫。' }}
          </li>
        </ul>
        <p class="muted">欄位位置由程式推算，個別表單可能有偏差，列印前建議開啟 PDF 看一下。</p>
        <div class="share__grid">
          <button v-if="isInTownPass()" type="button" class="btn btn--primary" :disabled="sharing" @click="share">{{ sharing ? '等待手機分享…' : '儲存／分享 PDF' }}</button>
          <a v-if="!isInTownPass()" :href="pdfUrl" :download="result.file.name" class="btn btn--primary">下載 PDF</a>
          <button v-if="!isInTownPass()" type="button" class="btn" :disabled="sharing" @click="share">分享 PDF</button>
          <a v-if="!isInTownPass()" :href="pdfUrl" target="_blank" rel="noopener" class="btn">開啟 PDF<span class="sr-only">（新視窗）</span></a>
        </div>
        <details class="more more--single">
          <summary>在這裡預覽</summary>
          <div class="more__body"><iframe :src="pdfUrl" class="pdf-preview" title="已填申請表預覽"></iframe></div>
        </details>
      </section>
      </Expand>
    </template>

    <div v-else-if="availability.kind === 'external'" class="actions card">
      <p>{{ EXTERNAL_TEXT[availability.status] ?? '本服務不能自動填寫這份表單。' }}</p>
      <ExternalLink v-if="availability.url" :url="availability.url" label="前往官方表單或入口" />
      <p v-if="availability.reason" class="muted selectable">{{ availability.reason }}</p>
    </div>
    <div v-else class="actions card">
      <p class="muted">沒有可用的申請表，請依「辦理步驟」向承辦窗口確認。</p>
    </div>
  </section>
</template>

<style scoped>
.form-fill { display: grid; gap: var(--space-4); }
</style>
