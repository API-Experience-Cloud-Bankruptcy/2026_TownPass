<script setup lang="ts">
import { computed, ref } from 'vue';
import { mergeDocuments } from '../domain/documents';
import { buildPlanText, DISCLAIMER } from '../domain/export';
import { buildRoute } from '../domain/route';
import { conditionLines, pickConditions, openDetail, planItems, results, state, tab, toggleDoc, togglePlan } from '../store';
import ShareBox from './ShareBox.vue';

const merged = computed(() => mergeDocuments(planItems.value));
const included = ref<string[]>([]);
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
      <section class="card no-print" aria-labelledby="plan-items-h">
        <h2 id="plan-items-h" class="section-title">已選資源（{{ planItems.length }} 項）</h2>
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
      </section>

      <section class="card no-print" aria-labelledby="docs-h">
        <h2 id="docs-h" class="section-title">文件準備清單</h2>
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
      </section>

      <div class="no-print">
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
