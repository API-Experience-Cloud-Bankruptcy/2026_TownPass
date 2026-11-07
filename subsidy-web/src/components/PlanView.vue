<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { mergeDocuments, OTHER_REGION_TITLE, regionText } from '../domain/documents';
import { buildPlanText } from '../domain/export';
import { buildRoute } from '../domain/route';
import { conditionLines, pickConditions, openDetail, planItems, results, state, tab, toggleDoc, togglePlan } from '../store';
import { progressText } from '../presentation';
import ShareBox from './ShareBox.vue';
import StepDots from './StepDots.vue';
import ChecklistView from './ChecklistView.vue';

const merged = computed(() => mergeDocuments(planItems.value, state.session.answers));
const included = ref<string[]>([]);
const stage = ref<'resources' | 'documents' | 'export'>('resources');
const stageNo = computed(() => ({ resources: 1, documents: 2, export: 3 })[stage.value]);
const stageHeading = ref<HTMLElement | null>(null);
async function setStage(next: typeof stage.value) {
  stage.value = next;
  await nextTick();
  stageHeading.value?.focus();
}
const includedValid = computed(() => pickConditions(included.value));

const planText = computed(() =>
  buildPlanText({
    meta: {
      catalogVersion: state.catalog?.version ?? '未載入',
      sourceLabel: state.catalog?.sourceLabel ?? '未載入',
      generatedAt: new Date(),
    },
    target: state.session.target ?? 'self',
    items: planItems.value,
    results: results.value,
    conditions: includedValid.value,
    docChecks: state.session.docChecks,
    stepDone: state.session.stepDone,
    documentAnswers: state.session.answers,
  }),
);

function progressOf(id: string) {
  const item = planItems.value.find((i) => i.id === id);
  const total = item ? buildRoute(item).steps.length : 0;
  const done = (state.session.stepDone[id] ?? []).filter((n) => n < total).length;
  return { total, done };
}
const preparedDocs = computed(() => merged.value.documents.filter((d) => state.session.docChecks[d.key]).length);
</script>

<template>
  <ChecklistView v-if="state.session.target === 'other'" />
  <div v-else class="view">
    <div class="view-head card card--hero no-print">
      <h1 id="view-title" class="view-title" tabindex="-1">行動單</h1>
      <p class="muted">準備用的清單，不是核准或送件證明</p>
    </div>

    <div v-if="planItems.length === 0" class="actions card">
      <p>還沒有加入資源。看到想申請的項目時，按「加入行動單」。</p>
      <button type="button" class="btn btn--primary btn--block" @click="tab('home')">開始找資源</button>
    </div>

    <template v-else>
      <StepDots class="no-print step-dots--page" :current="stageNo" :total="3" label="行動單步驟" />

      <section v-if="stage === 'resources'" class="actions card no-print" aria-labelledby="plan-items-h">
        <h2 id="plan-items-h" ref="stageHeading" tabindex="-1" class="stage-title">要申請的項目（{{ planItems.length }}）</h2>
        <ul class="rows">
          <li v-for="item in planItems" :key="item.id" class="row-static">
            <span class="row__title">{{ item.name }}</span>
            <span class="row__sub">{{ progressText(progressOf(item.id).done, progressOf(item.id).total) }}</span>
            <span class="inline-actions">
              <button type="button" class="btn btn--text" @click="openDetail(item.id)">看步驟<span class="sr-only">：{{ item.name }}</span></button>
              <button type="button" class="btn btn--text" @click="togglePlan(item.id)">移除<span class="sr-only">：{{ item.name }}</span></button>
            </span>
          </li>
        </ul>
        <button type="button" class="btn btn--primary btn--block" @click="setStage('documents')">下一步：準備文件</button>
        <button type="button" class="btn btn--text" @click="setStage('export')">直接匯出</button>
      </section>

      <section v-else-if="stage === 'documents'" class="actions card no-print" aria-labelledby="docs-h">
        <button type="button" class="btn btn--text btn--back" @click="setStage('resources')"><span aria-hidden="true">‹</span> 返回項目</button>
        <h2 id="docs-h" ref="stageHeading" tabindex="-1" class="stage-title">要帶的文件</h2>
        <p class="muted">已準備 {{ preparedDocs }}／{{ merged.documents.length }}・勾選只記錄你的準備</p>
        <ul class="rows">
          <li v-for="d in merged.documents" :key="d.key">
            <label class="check">
              <input type="checkbox" :checked="!!state.session.docChecks[d.key]" @change="toggleDoc(d.key)" />
              <span class="check__body">
                <span>{{ d.name }}<span v-if="d.required === false" class="muted">（非必要）</span></span>
                <span v-if="d.hasVariant" class="muted">同名但要求不同，請分開準備</span>
                <span v-if="d.condition" class="muted">條件：{{ d.condition }}</span>
                <span v-if="d.notes && d.notes !== d.name" class="muted">備註：{{ d.notes }}</span>
                <span v-if="planItems.length > 1" class="muted">用在：{{ d.usedBy.map((u) => u.name).join('、') }}</span>
              </span>
            </label>
          </li>
        </ul>
        <details v-if="merged.otherRegion.length" class="more">
          <summary>{{ OTHER_REGION_TITLE }}（{{ merged.otherRegion.length }}）</summary>
          <ul class="rows">
            <li v-for="d in merged.otherRegion" :key="d.key">
              <label class="check">
                <input type="checkbox" :checked="!!state.session.docChecks[d.key]" @change="toggleDoc(d.key)" />
                <span class="check__body">
                  <span>{{ d.name }}<span v-if="d.required === false" class="muted">（非必要）</span></span>
                  <span class="muted">{{ regionText(d.regions) }}</span>
                  <span v-if="d.condition" class="muted">條件：{{ d.condition }}</span>
                  <span v-if="d.notes && d.notes !== d.name" class="muted">備註：{{ d.notes }}</span>
                  <span v-if="planItems.length > 1" class="muted">用在：{{ d.usedBy.map((u) => u.name).join('、') }}</span>
                </span>
              </label>
            </li>
          </ul>
        </details>
        <p v-for="m in merged.incomplete" :key="m.id" class="note">「{{ m.name }}」原文沒有列出文件，不代表不用帶</p>
        <button type="button" class="btn btn--primary btn--block" @click="setStage('export')">下一步：匯出</button>
      </section>

      <div v-else class="actions card no-print">
        <button type="button" class="btn btn--text btn--back" @click="setStage('documents')"><span aria-hidden="true">‹</span> 返回文件</button>
        <h2 ref="stageHeading" tabindex="-1" class="sr-only">匯出行動單</h2>
        <ShareBox
          v-model:included="included"
          title="福利行動單"
          :body="planText"
          filename="福利行動單.txt"
          :conditions="conditionLines"
          printable
        />
      </div>
      <pre class="print-sheet" aria-hidden="true">{{ planText }}</pre>
    </template>
  </div>
</template>
