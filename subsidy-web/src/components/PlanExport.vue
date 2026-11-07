<script setup lang="ts">
// 行動單匯出：一次看一張（左右滑或按上一張／下一張），內容分成好讀的區塊；
// 下載的是 A4 PDF，可以只下載正在看的那一張，或全部一起。
// 預設不含個人條件；勾選才會寫進 PDF。
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { buildChecklist, type FormField } from '../domain/checklist';
import { mergeDocuments } from '../domain/documents';
import { copyText, type PlanInput } from '../domain/export';
import { sharePdfFile } from '../domain/pdf-file';
import type { Subsidy } from '../domain/types';
import { planConditionLines, planConditions, planResults, state } from '../store';
import { isInTownPass } from '../townpass';

/** preview：單張行動單頁面本身就是內容，不再重複預覽。 */
const props = withDefaults(defineProps<{ items: Subsidy[]; start?: number; preview?: boolean }>(), { preview: true });

const included = ref<string[]>([]);
const index = ref(Math.min(Math.max(props.start ?? 0, 0), Math.max(props.items.length - 1, 0)));
const many = computed(() => props.items.length > 1);
const current = computed(() => props.items[index.value]);

function planInput(items: Subsidy[]): PlanInput {
  return {
    meta: { catalogVersion: state.catalog?.version ?? '未載入', sourceLabel: state.catalog?.sourceLabel ?? '未載入', generatedAt: new Date() },
    target: 'self',
    items,
    results: planResults.value,
    conditions: planConditions.value.filter((c) => included.value.includes(c.line)),
    docChecks: state.personalPlan.docChecks,
    stepDone: state.personalPlan.stepDone,
    documentAnswers: state.personalPlan.answers,
  };
}

// 預覽與 PDF 用同一份結構，畫面看到的就是 PDF 的內容。
const form = computed(() => buildChecklist(planInput(props.items)).form);
const merged = computed(() => mergeDocuments(props.items, state.personalPlan.answers));
const pages = computed(() => form.value.resources.map((r) => {
  const docs = [...merged.value.documents, ...merged.value.otherRegion]
    .filter((d) => d.usedBy.some((u) => u.id === r.id))
    .map((d) => ({
      key: d.key,
      name: d.name,
      optional: d.required === false,
      checked: !!state.personalPlan.docChecks[d.key],
      also: d.usedBy.filter((u) => u.id !== r.id).map((u) => u.name).join('、'),
      note: [d.condition && `條件：${d.condition}`, d.notes !== d.name && d.notes].filter(Boolean).join('；'),
    }));
  const pick = (label: string) => r.summary.find((f) => f.label.startsWith(label))?.text ?? '';
  return {
    ...r,
    docs,
    docsIncomplete: merged.value.incomplete.some((m) => m.id === r.id),
    screening: pick('初篩結果'),
    deadline: pick('申請期限'),
    benefit: pick('資源利益'),
    stepsDone: r.steps.filter((s) => s.done).length,
    links: r.contact.filter((f) => f.url),
    contact: r.contact.filter((f) => !f.url && f.label !== '地址' && f.label !== '電話'),
    details: r.summary.filter((f) => !/^(初篩結果|申請期限|資源利益)/u.test(f.label)),
  };
}));

// ── 左右滑：橫向捲動＋吸附；捲到哪一張就更新頁碼 ──
const track = ref<HTMLElement | null>(null);
let scrollFrame = 0;
function onScroll() {
  cancelAnimationFrame(scrollFrame);
  scrollFrame = requestAnimationFrame(() => {
    const el = track.value;
    if (!el || !el.clientWidth) return;
    const i = Math.round(el.scrollLeft / el.clientWidth);
    if (i !== index.value && i >= 0 && i < props.items.length) index.value = i;
  });
}
// 外框高度跟著正在看的那一張，短的那張下面不留一大片空白。
const trackHeight = ref<number | null>(null);
let sizer: ResizeObserver | null = null;
function measure() {
  const el = track.value?.children[index.value] as HTMLElement | undefined;
  trackHeight.value = many.value && el ? el.offsetHeight : null;
}
watch([index, track], () => {
  sizer?.disconnect();
  const el = track.value?.children[index.value];
  if (el && typeof ResizeObserver !== 'undefined') { sizer = new ResizeObserver(measure); sizer.observe(el); }
  measure();
}, { flush: 'post' });
function goTo(i: number) {
  if (i < 0 || i >= props.items.length) return;
  index.value = i;
  const el = track.value;
  if (el) el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
}
watch(() => props.items.length, (n) => { if (index.value >= n) goTo(Math.max(n - 1, 0)); });

// ── 下載 PDF ──
const busy = ref<'' | 'one' | 'all'>('');
const status = ref('');
const lastPdf = ref<{ url: string; name: string } | null>(null);
let mounted = true;
function release() {
  if (lastPdf.value) URL.revokeObjectURL(lastPdf.value.url);
  lastPdf.value = null;
}
onBeforeUnmount(() => { mounted = false; release(); cancelAnimationFrame(scrollFrame); sizer?.disconnect(); });
// 內容改了（勾文件、完成步驟、改附上的條件），舊檔不再提供。
watch(form, () => { if (lastPdf.value) { release(); status.value = '內容有更新，請重新下載 PDF。'; } });

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const safeName = (s: string) => s.replace(/[\\/:*?"<>|\s]+/gu, '').slice(0, 30) || '行動單';

async function download(scope: 'one' | 'all') {
  if (busy.value) return;
  const items = scope === 'all' ? props.items : current.value ? [current.value] : [];
  if (!items.length) return;
  busy.value = scope;
  status.value = '正在製作 PDF，第一次需要載入中文字型…';
  const name = `福利行動單-${scope === 'all' && many.value ? `全部${items.length}張` : safeName(items[0]!.name)}-${today()}.pdf`;
  // 固定這次的內容，製作途中改了勾選也不會混進來。
  const live = planInput(items);
  const snapshot: PlanInput = { ...JSON.parse(JSON.stringify(live)), meta: live.meta, results: new Map(JSON.parse(JSON.stringify([...live.results]))) };
  try {
    const { createChecklistPdf } = await import('../domain/checklist-pdf');
    const bytes = await createChecklistPdf(snapshot);
    if (!mounted) return;
    release();
    const file = new File([new Uint8Array(bytes)], name, { type: 'application/pdf' });
    if (isInTownPass()) {
      // App 內的網頁不能直接存檔，改由手機的儲存畫面存成檔案。
      const outcome = await sharePdfFile(file);
      if (!mounted) return;
      status.value = outcome === 'presented' ? '已開啟手機的儲存畫面，請選「儲存到檔案」把 PDF 存下來。'
        : outcome === 'cancelled' ? '沒有存檔。需要時再按一次下載。'
        : '這支手機目前無法存 PDF，請稍後再試，或改用「複製文字」。';
      return;
    }
    const url = URL.createObjectURL(file);
    lastPdf.value = { url, name };
    const a = document.createElement('a');
    a.href = url; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    status.value = `已下載「${name}」。如果沒看到檔案，可以按下方連結再下載一次。`;
  } catch {
    if (mounted) status.value = 'PDF 製作失敗，請再試一次；也可以改用「複製文字」。';
  } finally {
    if (mounted) busy.value = '';
  }
}

function pageText(p: (typeof pages.value)[number]): string {
  const field = (f: FormField) => `${f.label}：${f.text}`;
  return [
    `【${p.no}】${p.name}`,
    p.screening && `初篩：${p.screening}`,
    p.deadline && `期限：${p.deadline}`,
    p.steps.length ? `辦理步驟：\n${p.steps.map((s) => `${s.done ? '[✓]' : '[ ]'} ${s.no}. ${s.text}`).join('\n')}` : '',
    p.docs.length ? `要準備的文件：\n${p.docs.map((d) => `${d.checked ? '[✓]' : '[ ]'} ${d.name}${d.optional ? '（依個案需要）' : ''}`).join('\n')}` : '',
    p.pending.length ? `還要確認：\n${p.pending.map((x) => `・${x}`).join('\n')}` : '',
    ...p.contact.map(field), ...p.links.map(field),
  ].filter(Boolean).join('\n');
}
async function copyCurrent() {
  const p = pages.value[index.value]; if (!p) return;
  const ok = await copyText(`${pageText(p)}\n\n${form.value.disclaimer}`);
  status.value = ok ? `已複製第 ${index.value + 1} 張的文字。` : '無法自動複製，請改用下載 PDF。';
}

const pagerLabel = computed(() => `第 ${index.value + 1}／${props.items.length} 張`);
const statusEl = ref<HTMLElement | null>(null);
watch(status, async (s) => { if (s) { await nextTick(); statusEl.value?.scrollIntoView?.({ block: 'nearest' }); } });
</script>

<template>
  <section class="pexp" aria-labelledby="pexp-title">
    <h2 id="pexp-title" class="sr-only">下載行動單 PDF</h2>
    <p class="muted">A4 直式，可以印出來帶去辦。不含姓名、身分證、收入或住址。</p>

    <div v-if="many" class="pexp__pager" role="group" aria-label="切換要看的行動單">
      <button type="button" class="pexp__nav" :disabled="index === 0" aria-label="上一張" @click="goTo(index - 1)">‹</button>
      <div class="pexp__where">
        <span class="pexp__count" aria-live="polite">{{ pagerLabel }}</span>
        <span class="pexp__dots" aria-hidden="true">
          <span v-for="(_, i) in items" :key="i" class="pexp__dot" :class="{ 'is-on': i === index }" />
        </span>
      </div>
      <button type="button" class="pexp__nav" :disabled="index === items.length - 1" aria-label="下一張" @click="goTo(index + 1)">›</button>
    </div>
    <p v-if="many" class="pexp__hint muted">左右滑動或按箭頭切換，一次看一張。</p>

    <details v-if="planConditionLines.length" class="more more--single">
      <summary>要不要附上你填的條件</summary>
      <fieldset class="more__body">
        <legend class="muted">預設不附上，勾選才會寫進 PDF。</legend>
        <label v-for="line in planConditionLines" :key="line" class="check">
          <input v-model="included" type="checkbox" :value="line" />
          <span>{{ line }}</span>
        </label>
      </fieldset>
    </details>

    <div class="pexp__actions" :aria-busy="!!busy">
      <button type="button" class="btn btn--primary btn--block" :disabled="!!busy" @click="download('one')">
        {{ busy === 'one' ? '正在製作 PDF…' : many ? `下載這張 PDF（第 ${index + 1} 張）` : '下載 PDF' }}
      </button>
      <button v-if="many" type="button" class="btn btn--block" :disabled="!!busy" @click="download('all')">
        {{ busy === 'all' ? '正在製作 PDF…' : `下載全部 ${items.length} 張（一個 PDF）` }}
      </button>
      <button type="button" class="btn btn--text" @click="copyCurrent">複製{{ many ? '這張的' : '' }}文字</button>
    </div>
    <p ref="statusEl" class="status-text note" role="status" aria-live="polite">{{ status }}</p>
    <a v-if="lastPdf" :href="lastPdf.url" :download="lastPdf.name" class="btn btn--text">再下載一次：{{ lastPdf.name }}</a>
    <div v-if="preview" ref="track" class="pexp__track" :class="{ 'pexp__track--many': many }" :style="trackHeight ? { height: `${trackHeight}px` } : undefined" @scroll.passive="onScroll">
      <article
        v-for="(p, i) in pages"
        :key="p.id"
        class="paper"
        :aria-label="`第 ${i + 1} 張：${p.name}`"
        :aria-hidden="many && i !== index ? 'true' : undefined"
        :inert="many && i !== index ? true : undefined"
      >
        <header class="paper__head">
          <p v-if="many" class="paper__no">第 {{ i + 1 }} 張</p>
          <h3 class="paper__title">{{ p.name }}</h3>
          <div class="paper__tags">
            <span v-if="p.screening" class="paper__tag">{{ p.screening }}</span>
            <span v-if="p.steps.length" class="paper__tag paper__tag--soft">步驟 {{ p.stepsDone }}／{{ p.steps.length }}</span>
          </div>
          <p v-if="p.deadline" class="paper__deadline"><strong>期限</strong>{{ p.deadline }}</p>
        </header>

        <section v-if="p.steps.length" class="paper__sec">
          <h4 class="paper__h">辦理步驟</h4>
          <p v-if="p.stepsNote" class="paper__note">{{ p.stepsNote }}</p>
          <ol class="paper__list">
            <li v-for="s in p.steps" :key="s.no" class="paper__row" :class="{ 'is-done': s.done }">
              <span class="paper__box" aria-hidden="true">{{ s.done ? '✓' : s.no }}</span>
              <span><span class="sr-only">{{ s.done ? '已完成：' : '未完成：' }}</span>{{ s.text }}</span>
            </li>
          </ol>
        </section>
        <section v-else class="paper__sec">
          <h4 class="paper__h">辦理步驟</h4>
          <p class="paper__note">原文沒有列出步驟，請先問承辦窗口。</p>
        </section>

        <section class="paper__sec">
          <h4 class="paper__h">要準備的文件</h4>
          <ul v-if="p.docs.length" class="paper__list">
            <li v-for="d in p.docs" :key="d.key" class="paper__row" :class="{ 'is-done': d.checked }">
              <span class="paper__box paper__box--check" aria-hidden="true">{{ d.checked ? '✓' : '' }}</span>
              <span>
                <span class="sr-only">{{ d.checked ? '已準備：' : '未準備：' }}</span>{{ d.name }}<span v-if="d.optional" class="paper__muted">（依個案需要）</span>
                <span v-if="d.note" class="paper__sub">{{ d.note }}</span>
                <span v-if="d.also" class="paper__sub">也用於：{{ d.also }}</span>
              </span>
            </li>
          </ul>
          <p v-if="!p.docs.length || p.docsIncomplete" class="paper__note">文件清單尚未補齊，不代表免附文件，請向窗口確認。</p>
        </section>

        <section class="paper__sec">
          <h4 class="paper__h">還要確認</h4>
          <ul v-if="p.pending.length" class="paper__bullets">
            <li v-for="x in p.pending" :key="x">{{ x }}</li>
          </ul>
          <p v-else class="paper__note">{{ p.pendingNote }}</p>
        </section>

        <section class="paper__sec">
          <h4 class="paper__h">去哪裡辦</h4>
          <dl class="paper__dl">
            <template v-for="f in p.contact" :key="f.label"><dt>{{ f.label }}</dt><dd>{{ f.text }}</dd></template>
          </dl>
          <ul v-if="p.links.length" class="paper__links">
            <li v-for="l in p.links" :key="l.url"><a :href="l.url" target="_blank" rel="noopener noreferrer">{{ l.label }}<span class="sr-only">（新視窗）</span></a></li>
          </ul>
        </section>

        <section class="paper__sec">
          <h4 class="paper__h">打電話或到窗口時可以這樣說</h4>
          <p class="paper__quote">{{ p.ask[0]?.text }}</p>
        </section>

        <details class="paper__more">
          <summary>補助內容與資格原文</summary>
          <dl class="paper__dl">
            <template v-if="p.benefit"><dt>補助內容</dt><dd>{{ p.benefit }}</dd></template>
            <template v-for="(f, n) in p.details" :key="`d${n}`"><dt>{{ f.label }}</dt><dd>{{ f.text }}</dd></template>
            <template v-for="(e, n) in p.eligibility" :key="`e${n}`"><dt>{{ e.category }}</dt><dd>{{ e.text }}</dd></template>
          </dl>
        </details>
        <details class="paper__more">
          <summary>資料來源與查核</summary>
          <dl class="paper__dl">
            <template v-for="f in p.verification" :key="f.label"><dt>{{ f.label }}</dt><dd>{{ f.text }}</dd></template>
          </dl>
          <ul class="paper__links">
            <li v-for="s in p.sources" :key="s.url"><a :href="s.url" target="_blank" rel="noopener noreferrer">{{ s.category }}<span class="sr-only">（新視窗）</span></a><span class="paper__sub">資料日期 {{ s.sourceDate }}・查核 {{ s.checkedDate }}</span></li>
          </ul>
        </details>
      </article>
    </div>

    <p class="muted">行動單是準備用的清單，不是核准或送件證明；資格以承辦機關審核為準。</p>
  </section>
</template>

<style scoped>
.pexp { display: grid; gap: var(--space-3); min-width: 0; }
.pexp > * { min-width: 0; }

.pexp__pager { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); }
.pexp__nav {
  width: var(--touch); height: var(--touch); flex: none;
  border: 1px solid var(--line-strong); border-radius: 50%; background: var(--raised); color: var(--accent);
  font-size: 1.75rem; line-height: 1; cursor: pointer;
}
.pexp__nav:disabled { color: var(--disabled-text); border-color: var(--line); cursor: default; }
.pexp__where { display: grid; justify-items: center; gap: var(--space-1); }
.pexp__count { font-size: var(--fs-section); font-weight: var(--fw-bold); }
.pexp__dots { display: flex; gap: 6px; }
.pexp__dot { width: 8px; height: 8px; border-radius: 50%; background: var(--line-strong); transition: width var(--dur-fast) var(--ease), background var(--dur-fast) var(--ease); }
.pexp__dot.is-on { width: 20px; border-radius: 4px; background: var(--accent); }
.pexp__hint { margin: 0; text-align: center; font-size: var(--fs-small); }

/* 一張一頁，橫向吸附；外層不會出現水平捲軸。 */
.pexp__track { display: grid; }
.pexp__track--many {
  grid-auto-flow: column; grid-auto-columns: 100%;
  overflow-x: auto; scroll-snap-type: x mandatory; overscroll-behavior-x: contain;
  scrollbar-width: none; -webkit-overflow-scrolling: touch;
  align-items: start; overflow-y: hidden; transition: height var(--dur) var(--ease);
}
.pexp__track--many::-webkit-scrollbar { display: none; }
.pexp__track--many > .paper { scroll-snap-align: start; scroll-snap-stop: always; }

.paper {
  min-width: 0; padding: var(--space-4); border: 1px solid var(--line-strong); border-radius: var(--radius-card);
  background: var(--bg); overflow-wrap: anywhere; display: grid; gap: var(--space-4); align-content: start;
}
.pexp__track--many .paper { margin: 0 2px; }
.paper__head { display: grid; gap: var(--space-2); padding-bottom: var(--space-3); border-bottom: 2px solid var(--accent); }
.paper__no { margin: 0; color: var(--accent); font-size: var(--fs-small); font-weight: var(--fw-bold); }
.paper__title { margin: 0; font-size: var(--fs-section); line-height: var(--lh-tight); }
.paper__tags { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.paper__tag { padding: 2px 10px; border-radius: var(--radius-pill); background: var(--accent-soft); color: var(--accent); font-size: var(--fs-small); font-weight: var(--fw-medium); }
.paper__tag--soft { background: var(--raised); color: var(--text-2); }
.paper__deadline { margin: 0; display: flex; gap: var(--space-2); font-size: var(--fs-small); color: var(--text-2); }
.paper__deadline strong { flex: none; color: var(--warning); }

.paper__sec { display: grid; gap: var(--space-2); }
.paper__h { margin: 0; font-size: var(--fs-body); font-weight: var(--fw-bold); color: var(--text); }
.paper__note { margin: 0; color: var(--muted); font-size: var(--fs-small); }
.paper__list { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-2); }
.paper__row { display: flex; gap: var(--space-3); align-items: flex-start; line-height: var(--lh-body); }
.paper__row.is-done > span:last-child { color: var(--muted); }
.paper__box {
  flex: none; display: inline-grid; place-items: center; width: 26px; height: 26px; margin-top: 1px;
  border: 2px solid var(--line-strong); border-radius: 50%; font-size: var(--fs-small); font-weight: var(--fw-bold); color: var(--text-2);
}
.paper__box--check { border-radius: 6px; }
.is-done > .paper__box { border-color: var(--accent); background: var(--accent); color: var(--on-accent); }
.paper__muted { color: var(--muted); }
.paper__sub { display: block; color: var(--muted); font-size: var(--fs-small); }
.paper__bullets { margin: 0; padding-left: 1.25em; display: grid; gap: var(--space-1); }
.paper__dl { margin: 0; display: grid; gap: var(--space-1); }
.paper__dl dt { color: var(--muted); font-size: var(--fs-small); margin-top: var(--space-2); }
.paper__dl dt:first-child { margin-top: 0; }
.paper__dl dd { margin: 0; line-height: var(--lh-body); }
.paper__links { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--space-2); }
.paper__links a { color: var(--accent); text-underline-offset: 3px; display: inline-flex; align-items: center; min-height: var(--touch); }
.paper__quote { margin: 0; padding: var(--space-3); border-left: 4px solid var(--accent); background: var(--raised); border-radius: 0 var(--radius) var(--radius) 0; line-height: var(--lh-body); }
.paper__more { border-top: 1px solid var(--line); padding-top: var(--space-2); }
.paper__more > summary { min-height: var(--touch); display: flex; align-items: center; cursor: pointer; color: var(--accent); font-weight: var(--fw-medium); }
.paper__more[open] > summary { margin-bottom: var(--space-2); }

.pexp__actions { display: grid; gap: var(--space-2); }
</style>
