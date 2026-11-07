<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from 'vue';
import { text } from '../domain/match';
import { buildRoute, SOURCE_ROLE } from '../domain/route';
import { planProgress } from '../domain/plan-progress';
import { benefitLabel, itemFlags, progressText, sourceExcerpt, statusPlain } from '../presentation';
import { detailAnswers, detailResults, inPlan, itemsById, openPlanItem, state, togglePlan } from '../store';
import ExternalLink from './ExternalLink.vue';
import RouteSteps from './RouteSteps.vue';
import SourceText from './SourceText.vue';
import { plainLanguageFor } from '../domain/plain-language';
import { sourceConditions } from '../domain/source-content';

const FormFillPanel = defineAsyncComponent(() => import('./FormFillPanel.vue'));
const ChecklistView = defineAsyncComponent(() => import('./ChecklistView.vue'));
const pdfOpen = ref(false);
const formOpen = ref(false);
watch([() => state.detailId, () => state.session.target], () => { formOpen.value = false; });

const item = computed(() => (state.detailId ? itemsById.value.get(state.detailId) : undefined));
const plain = computed(() => item.value ? plainLanguageFor(item.value) : null);
const result = computed(() => (item.value ? detailResults.value.get(item.value.id) : undefined));
const route = computed(() => (item.value ? buildRoute(item.value, detailAnswers.value) : null));
const sub = computed(() => (item.value ? [benefitLabel(item.value), text(item.value.provider?.name)].filter(Boolean).join('・') : ''));
const benefit = computed(() => text(item.value?.benefit?.raw));
const benefitPreview = computed(() => sourceExcerpt(benefit.value, 100));
const conditionGroups = computed(() => item.value ? sourceConditions(item.value) : []);
const summary = computed(() => text(item.value?.eligibility?.raw_summary));
const flags = computed(() => (item.value ? itemFlags(item.value, result.value) : []));
/** 受理情形原文；已在提醒列出時不重複。 */
const statusText = computed(() => {
  const s = route.value?.applicationStatus ?? '';
  return s && !flags.value.some((f) => f.includes(s)) ? s : '';
});
const added = computed(() => (item.value ? inPlan(item.value.id) : false));
const planStepText = computed(() => {
  if (!item.value) return '';
  const p = planProgress(item.value, state.personalPlan.answers, state.personalPlan.stepDone, state.personalPlan.docChecks);
  return p.total ? progressText(p.doneCount, p.total) : '原文沒有列出步驟';
});
function addToPlan() {
  if (!item.value) return;
  togglePlan(item.value.id);
  openPlanItem(item.value.id);
}
/** 申請方法連結：先找申請入口，沒有才用說明頁。 */
const applyLink = computed(() => route.value?.links.find((l) => l.kind === 'apply') ?? route.value?.links.find((l) => l.kind === 'program') ?? null);
</script>

<template>
  <div v-if="item && route" class="view">
    <div class="view-head card card--hero">
      <h1 id="view-title" class="view-title" tabindex="-1">{{ item.name }}</h1>
      <p v-if="sub" class="lead">{{ sub }}</p>
    </div>

    <section v-if="plain" class="block card" aria-labelledby="d-plain-h">
      <h2 id="d-plain-h" class="section-title">先看重點</h2>
      <p class="muted">這是依現有資料整理的白話導讀，完整條件與來源在下方；是否符合資格仍須審核。</p>
      <dl class="facts">
        <div><dt>誰可以先了解</dt><dd>{{ plain.audience }}</dd></div>
        <div><dt>能得到什麼幫助</dt><dd>{{ plain.support }}</dd></div>
        <div><dt>第一步怎麼做</dt><dd>{{ plain.firstStep }}</dd></div>
      </dl>
      <h3 class="sub-title">申請前先確認</h3>
      <ul><li v-for="caution in plain.cautions" :key="caution">{{ caution }}</li></ul>
    </section>

    <section class="block card" aria-labelledby="d-benefit-h">
      <h2 id="d-benefit-h" class="section-title">能提供什麼</h2>
      <SourceText v-if="benefitPreview" :text="benefitPreview" />
      <p v-else>資料未提供給付內容，請看來源說明頁或問承辦窗口。</p>
      <details v-if="benefitPreview !== benefit" class="more">
        <summary>完整給付內容與條件（原文）</summary>
        <div class="more__body"><SourceText :text="benefit" /></div>
      </details>
      <p v-if="benefitPreview !== benefit" class="muted">以上為原文節錄，金額、適用項目與條件請展開確認。</p>
    </section>

    <section class="block card" aria-labelledby="d-limit-h">
      <h2 id="d-limit-h" class="section-title">要先注意</h2>
      <p v-for="f in flags" :key="f" class="alert">{{ f }}</p>
      <dl class="facts">
        <div v-if="summary"><dt>適用對象（原文）</dt><dd><SourceText :text="summary" /></dd></div>
        <div v-if="statusText"><dt>受理情形</dt><dd><SourceText :text="statusText" /></dd></div>
        <div v-if="route.deadline"><dt>期限</dt><dd><SourceText :text="route.deadline" /></dd></div>
      </dl>
      <template v-if="result?.blocked_by.length">
        <h3 class="sub-title">與填寫條件不符的部分</h3>
        <ul><li v-for="r in result.blocked_by" :key="r">{{ r }}</li></ul>
      </template>
      <p class="muted">是否符合這項補助的資格，須由承辦機關審核；本服務不計算所得。</p>
    </section>

    <section class="block card" aria-labelledby="d-start-h">
      <h2 id="d-start-h" class="section-title">想申請的話</h2>
      <div class="actions">
        <button v-if="state.detailTarget === 'other'" type="button" class="btn btn--primary btn--block" :aria-expanded="pdfOpen" aria-controls="detail-pdf" @click="pdfOpen = !pdfOpen">{{ pdfOpen ? '關閉 PDF 預覽' : '匯出申請準備 PDF' }}</button>
        <button v-else-if="!added" type="button" class="btn btn--primary btn--block" @click="addToPlan">加入行動單，開始準備</button>
        <template v-else>
          <button type="button" class="btn btn--primary btn--block btn--tall" @click="openPlanItem(item.id)">
            <span class="btn__stack">
              <span>打開行動單，照步驟準備</span>
              <span class="btn__sub">{{ planStepText }}</span>
            </span>
          </button>
          <button type="button" class="btn btn--text" @click="togglePlan(item.id)">從行動單移除<span class="sr-only">：{{ item.name }}</span></button>
        </template>
        <ExternalLink v-if="applyLink" :url="applyLink.url" :label="`看申請方法：${applyLink.label}`" />
      </div>
    </section>

    <section v-if="pdfOpen && state.detailTarget === 'other'" id="detail-pdf" aria-label="匯出這項補助的申請準備 PDF">
      <ChecklistView :item="item" />
    </section>

    <div class="card-stack">
      <RouteSteps :item="item" hide-deadline />
      <details class="more card card--list" :open="formOpen" @toggle="formOpen = ($event.target as HTMLDetailsElement).open">
        <summary>申請表與填寫</summary>
        <div class="more__body">
          <FormFillPanel v-if="formOpen" :key="`${item.id}:${state.detailTarget}`" :item="item" :target="state.detailTarget" />
        </div>
      </details>
      <div class="more-group card card--list">
        <details class="more">
          <summary>誰能申請：完整條件與初篩說明</summary>
          <div class="more__body">
            <p class="muted">以下依資料原文分組。請一併確認各子方案、擇一條件與例外，以免漏看適用限制。</p>
            <div v-if="text(item.eligibility?.taipei_applicability)">
              <h3>臺北市適用說明</h3>
              <SourceText :text="text(item.eligibility?.taipei_applicability)" />
            </div>
            <div v-for="(group, index) in conditionGroups" :key="index" class="condition-group">
              <h3>{{ group.label }}（原文）</h3>
              <ul><li v-for="(entry, i) in group.entries" :key="i"><SourceText :text="entry" /></li></ul>
            </div>
            <p v-if="!conditionGroups.length" class="muted">資料未另列條件明細，請向承辦窗口確認完整資格。</p>
            <template v-if="result?.reasons.length">
              <h3>與填寫條件相符的部分</h3>
              <ul><li v-for="r in result.reasons" :key="r">{{ r }}</li></ul>
            </template>
            <template v-if="result?.pending?.length">
              <h3>要向窗口問清楚（{{ result.pending.length }}）</h3>
              <ul><li v-for="r in result.pending" :key="r">{{ r }}</li></ul>
            </template>
            <template v-if="result?.warnings.length">
              <h3>提醒</h3>
              <ul><li v-for="r in result.warnings" :key="r">{{ r }}</li></ul>
            </template>
            <p class="muted">本服務不計算所得，能不能領由承辦機關審核。</p>
          </div>
        </details>

        <details class="more">
          <summary>資料來源</summary>
          <div class="more__body">
            <p class="muted">{{ statusPlain(route.status, route.checkedDate) }}；沿用資料原有標記，本服務未重新查核。</p>
            <div v-if="text(item.source_meta?.verification_note)"><h3>資料查核說明</h3><SourceText :text="text(item.source_meta?.verification_note)" /></div>
            <div v-if="text(item.source_meta?.notes)"><h3>資料備註</h3><SourceText :text="text(item.source_meta?.notes)" /></div>
            <ul class="link-list">
              <li v-for="s in route.sources" :key="s.url + s.role">
                <ExternalLink :url="s.url" :label="SOURCE_ROLE[s.role] ?? (s.role || '來源')" />
                <span v-if="s.sourceDate" class="muted">來源日期：{{ s.sourceDate }}</span>
                <span v-if="s.checkedDate" class="muted">資料原有查核日期：{{ s.checkedDate }}</span>
              </li>
            </ul>
          </div>
        </details>
      </div>
    </div>
  </div>
  <div v-else class="view">
    <div class="card">
    <h1 id="view-title" class="view-title" tabindex="-1">找不到這筆資料</h1>
    <p>資料可能更新了，請回到結果重新選。</p>
    </div>
  </div>
</template>
