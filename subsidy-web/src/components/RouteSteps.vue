<script setup lang="ts">
import { computed, ref } from 'vue';
import { buildRoute, SOURCE_KIND_LABEL } from '../domain/route';
import type { Subsidy } from '../domain/types';
import { openHelp, state, toggleStep } from '../store';
import ExternalLink from './ExternalLink.vue';

const props = defineProps<{ item: Subsidy }>();
const route = computed(() => buildRoute(props.item));
const done = computed(() => new Set(state.session.stepDone[props.item.id] ?? []));
const currentIndex = computed(() => route.value.steps.findIndex((_, i) => !done.value.has(i)));
const expanded = ref(false);
const listId = `steps-${props.item.id}`;
</script>

<template>
  <section class="card route" :aria-labelledby="`route-h-${item.id}`">
    <h2 :id="`route-h-${item.id}`" class="section-title">辦理路線</h2>
    <p class="muted">
      依資料原文整理{{ route.splitFromArrow ? '，按原文箭頭分步' : '；原文未分步，整段顯示' }}。
      勾選只代表你的準備進度，不代表已送件或受理。
    </p>

    <dl class="facts">
      <div v-if="route.agency"><dt>主管／承辦</dt><dd>{{ route.agency }}</dd></div>
      <div v-if="route.channel"><dt>受理窗口（原文）</dt><dd>{{ route.channel }}</dd></div>
      <div v-if="route.methods.length"><dt>辦理方式</dt><dd>{{ route.methods.join('、') }}</dd></div>
      <div v-if="route.deadline"><dt>期限</dt><dd>{{ route.deadline }}</dd></div>
      <div v-if="route.applicationStatus"><dt>受理狀態</dt><dd>{{ route.applicationStatus }}</dd></div>
    </dl>

    <div v-if="currentIndex >= 0 && route.steps.length" class="now-step">
      <p class="now-step__label">現在先做這一步</p>
      <p class="now-step__text">{{ currentIndex + 1 }}. {{ route.steps[currentIndex] }}</p>
      <div class="btn-row">
        <button type="button" class="btn btn--primary" @click="toggleStep(item.id, currentIndex)">
          我已準備好這一步
        </button>
        <button type="button" class="btn" @click="openHelp(item.id, route.steps[currentIndex])">
          這一步做不到
        </button>
      </div>
    </div>
    <p v-else-if="route.steps.length" class="now-step" role="status">
      你已標記所有步驟準備好。請依官方方式送件並保存收件證明；這裡不代表已受理。
    </p>

    <button
      v-if="route.steps.length > 1"
      type="button"
      class="btn btn--ghost btn--block"
      :aria-expanded="expanded"
      :aria-controls="listId"
      @click="expanded = !expanded"
    >
      {{ expanded ? '收合完整流程' : `展開完整流程（${route.steps.length} 步）` }}
    </button>
    <ol v-show="expanded || route.steps.length === 1" :id="listId" class="steps">
      <li v-for="(step, i) in route.steps" :key="i" class="step" :class="{ 'step--current': i === currentIndex }">
        <label class="check">
          <input type="checkbox" :checked="done.has(i)" @change="toggleStep(item.id, i)" />
          <span>{{ step }}</span>
        </label>
        <button type="button" class="btn btn--link" @click="openHelp(item.id, step)">
          這一步做不到<span class="sr-only">：{{ step }}</span>
        </button>
      </li>
    </ol>

    <h3 class="sub-title">文件（原文）</h3>
    <ul v-if="route.documents.length" class="doc-list">
      <li v-for="(d, i) in route.documents" :key="i">
        <strong>{{ d.name }}</strong>
        <span v-if="d.required === false">（非必要）</span>
        <span v-if="d.condition && d.condition !== d.name" class="muted">條件：{{ d.condition }}</span>
        <span v-if="d.notes" class="muted">備註：{{ d.notes }}</span>
      </li>
    </ul>

    <h3 class="sub-title">網站</h3>
    <ul class="link-list">
      <li v-for="l in route.links" :key="l.kind">
        <ExternalLink :url="l.url" :label="l.label" :tag="SOURCE_KIND_LABEL[l.sourceKind]" />
      </li>
    </ul>
    <p v-if="route.rejectedUrls" class="muted">有 {{ route.rejectedUrls }} 個網址不是 http/https，已略過。</p>

    <h3 class="sub-title">資料缺口</h3>
    <ul class="note-list">
      <li v-for="m in route.missing" :key="m">{{ m }}</li>
    </ul>
  </section>
</template>
