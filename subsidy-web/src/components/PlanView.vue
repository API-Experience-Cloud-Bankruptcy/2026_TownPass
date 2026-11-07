<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { mergeDocuments } from '../domain/documents';
import { buildPlanText, DISCLAIMER } from '../domain/export';
import { buildRoute } from '../domain/route';
import { conditionLines, pickConditions, openDetail, planItems, results, state, tab, toggleDoc, togglePlan } from '../store';
import ShareBox from './ShareBox.vue';

const merged = computed(() => mergeDocuments(planItems.value));
const included = ref<string[]>([]);
const stage = ref<'resources' | 'documents' | 'export'>('resources');
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
  <div class="view">
    <h1 id="view-title" class="view-title" tabindex="-1">我的行動單</h1>
    <p class="notice-line">{{ DISCLAIMER }}</p>

    <div v-if="planItems.length === 0" class="card">
      <p>還沒有加入任何資源。</p>
      <button type="button" class="btn btn--primary btn--block" @click="tab('home')">開始找資源</button>
    </div>

    <template v-else>
      <section v-if="stage === 'resources'" class="card no-print" aria-labelledby="plan-items-h">
        <h2 id="plan-items-h" ref="stageHeading" tabindex="-1" class="section-title">已選資源（{{ planItems.length }} 項）</h2>
        <ul class="plan-list">
          <li v-for="item in planItems" :key="item.id" class="plan-item">
            <p class="plan-item__name">{{ item.name }}</p>
            <p class="muted">
              步驟準備 {{ progressOf(item.id).done }}／{{ progressOf(item.id).total }}
            </p>
            <div class="btn-row">
              <button type="button" class="btn" @click="openDetail(item.id)">
                辦理路線<span class="sr-only">：{{ item.name }}</span>
              </button>
              <button type="button" class="btn btn--ghost" @click="togglePlan(item.id)">
                移除<span class="sr-only">：{{ item.name }}</span>
              </button>
            </div>
          </li>
        </ul>
        <button type="button" class="btn btn--primary btn--block" @click="setStage('documents')">下一步：準備文件</button>
        <button type="button" class="btn btn--ghost btn--block" @click="setStage('export')">匯出行動單</button>
      </section>

      <section v-else-if="stage === 'documents'" class="card no-print" aria-labelledby="docs-h">
        <button type="button" class="btn btn--ghost" @click="setStage('resources')">返回已選資源</button>
        <h2 id="docs-h" ref="stageHeading" tabindex="-1" class="section-title">文件準備清單</h2>
        <p class="muted">
          只有名稱與條件完全相同的文件才合併；勾選只代表你準備好了。已準備 {{ preparedDocs }}／{{ merged.documents.length }}。
        </p>
        <ul class="doc-checklist">
          <li v-for="d in merged.documents" :key="d.key">
            <label class="check">
              <input type="checkbox" :checked="!!state.session.docChecks[d.key]" @change="toggleDoc(d.key)" />
              <span>
                <strong>{{ d.name }}</strong>
                <span v-if="d.required === false">（非必要）</span>
                <span v-if="d.hasVariant" class="tag tag--plain">同名但要求不同，分開準備</span>
                <span v-if="d.condition" class="block muted">條件：{{ d.condition }}</span>
                <span v-if="d.notes" class="block muted">備註：{{ d.notes }}</span>
                <span class="block muted">用於：{{ d.usedBy.map((u) => u.name).join('、') }}</span>
              </span>
            </label>
          </li>
        </ul>
        <p v-for="m in merged.incomplete" :key="m.id" class="warn">
          「{{ m.name }}」文件清單尚未補齊，不代表免附文件。
        </p>
        <button type="button" class="btn btn--primary btn--block" @click="setStage('export')">下一步：匯出行動單</button>
      </section>

      <div v-else class="no-print">
        <button type="button" class="btn btn--ghost" @click="setStage('documents')">返回準備文件</button>
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
