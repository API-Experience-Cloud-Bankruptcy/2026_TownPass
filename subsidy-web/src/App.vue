<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch, watchEffect } from 'vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import DetailView from './components/DetailView.vue';
import HelpView from './components/HelpView.vue';
import HomeView from './components/HomeView.vue';
import PlanView from './components/PlanView.vue';
import QuestionsView from './components/QuestionsView.vue';
import ResultsView from './components/ResultsView.vue';
import { modelAdapter, type ModelStatus } from './domain/model';
import {
  confirmPending,
  init,
  pendingSwitch,
  planItems,
  requestNewPerson,
  state,
  tab,
  type View,
} from './store';

const settingsOpen = ref(false);
const modelStatus = ref<ModelStatus | null>(null);

onMounted(async () => {
  void init();
  modelStatus.value = await modelAdapter.status();
});

watchEffect(() => {
  const root = document.documentElement;
  root.classList.toggle('is-large', state.prefs.largeText);
  root.classList.toggle('is-contrast', state.prefs.highContrast);
});

// 換頁時把焦點移到新頁標題，讓讀屏與鍵盤使用者知道位置。
watch(
  () => [state.view, state.detailId],
  async () => {
    await nextTick();
    window.scrollTo?.(0, 0);
    document.getElementById('view-title')?.focus();
  },
);

const navItems: { view: View; label: string; match: View[] }[] = [
  { view: 'home', label: '找資源', match: ['home', 'questions', 'results', 'detail'] },
  { view: 'plan', label: '我的行動單', match: ['plan'] },
  { view: 'help', label: '找人幫忙', match: ['help'] },
];

const targetLabel = computed(() =>
  state.session.target === 'self' ? '自己' : state.session.target === 'other' ? '家人或其他人' : '尚未選擇',
);

const dialogTitle = computed(() =>
  pendingSwitch.value === 'clear' ? '清除這次的資料？' : '換人並清除前一位的資料？',
);
</script>

<template>
  <a class="skip-link" href="#main">跳到主要內容</a>
  <header class="app-header no-print">
    <div class="app-header__row">
      <p class="brand">福利通<span class="brand__sub">把資源變成下一步</span></p>
      <button
        type="button"
        class="btn btn--small"
        :aria-expanded="settingsOpen"
        aria-controls="settings-panel"
        @click="settingsOpen = !settingsOpen"
      >
        顯示與資料
      </button>
    </div>
    <div class="app-header__row app-header__target">
      <p>查詢對象：<strong>{{ targetLabel }}</strong></p>
      <button type="button" class="btn btn--small btn--ghost" @click="requestNewPerson">換人</button>
    </div>

    <section v-show="settingsOpen" id="settings-panel" class="settings" aria-label="顯示與資料設定">
      <label class="check">
        <input v-model="state.prefs.largeText" type="checkbox" />
        <span>大字</span>
      </label>
      <label class="check">
        <input v-model="state.prefs.highContrast" type="checkbox" />
        <span>高對比</span>
      </label>
      <p class="muted">
        答案、行動單與進度只保存在本分頁的這次工作階段，不會送到伺服器；關閉分頁後通常會清除，共用裝置用完請按清除。
      </p>
      <button type="button" class="btn btn--danger btn--block" @click="pendingSwitch = 'clear'">清除這次的資料</button>
      <dl class="facts">
        <div><dt>資料來源</dt><dd>{{ state.catalog?.sourceLabel ?? '載入中' }}</dd></div>
        <div v-if="state.catalog?.fallbackReason">
          <dt>改用快照原因</dt><dd>{{ state.catalog.fallbackReason }}</dd>
        </div>
        <div><dt>題庫</dt><dd>{{ state.bank ? (state.bank.origin === 'api' ? `後端 /api/questions（${state.bank.version}）` : '本機固定模板') : '載入中' }}</dd></div>
        <div>
          <dt>裝置端模型</dt>
          <dd>{{ modelStatus?.state === 'unavailable' ? modelStatus.reason : modelStatus?.state ?? '確認中' }}</dd>
        </div>
      </dl>
      <p class="muted">本服務非政府官方服務；資料查核標記沿用資料原有狀態。</p>
    </section>

    <nav class="tabs" aria-label="主要功能">
      <button
        v-for="n in navItems"
        :key="n.view"
        type="button"
        class="tabs__item"
        :aria-current="n.match.includes(state.view) ? 'page' : undefined"
        @click="tab(n.view)"
      >
        {{ n.label }}<span v-if="n.view === 'plan' && planItems.length" class="tabs__badge">{{ planItems.length }}</span>
      </button>
    </nav>
  </header>

  <main id="main" class="app-main">
    <p v-if="state.catalog?.origin === 'snapshot'" class="banner no-print" role="status">
      後端暫時無法連線（{{ state.catalog.fallbackReason }}），目前使用建置時打包的原始資料快照（{{ state.catalog.version }}）。
      這不是完整離線模式，外部網站仍需網路。
    </p>
    <p v-if="state.notice" class="banner banner--ok no-print" role="status">
      {{ state.notice }}
      <button type="button" class="btn btn--link" @click="state.notice = ''">知道了</button>
    </p>
    <p v-if="state.loadError" class="banner banner--error" role="alert">
      {{ state.loadError }}
      <button type="button" class="btn btn--small" @click="init">重試</button>
    </p>

    <HomeView v-if="state.view === 'home'" />
    <QuestionsView v-else-if="state.view === 'questions'" />
    <ResultsView v-else-if="state.view === 'results'" />
    <DetailView v-else-if="state.view === 'detail'" :key="state.detailId ?? ''" />
    <PlanView v-else-if="state.view === 'plan'" />
    <HelpView v-else-if="state.view === 'help'" />
  </main>

  <footer class="app-footer no-print">
    <p>申辦準備摘要，非核准或送件證明。資料：{{ state.catalog?.version ?? '載入中' }}</p>
  </footer>

  <ConfirmDialog
    :open="pendingSwitch !== null"
    :title="dialogTitle"
    :confirm-label="pendingSwitch === 'clear' ? '清除' : '換人並清除'"
    danger
    @confirm="confirmPending"
    @cancel="pendingSwitch = null"
  >
    <p>會清除目前的答案、行動單與準備進度，避免和下一位的資料混在一起。大字與高對比設定會保留。</p>
  </ConfirmDialog>
</template>
