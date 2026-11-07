<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch, watchEffect } from 'vue';
import { followBottom } from './chat/typing';
import ChatView from './components/ChatView.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import DetailView from './components/DetailView.vue';
import HelpView from './components/HelpView.vue';
import PlanView from './components/PlanView.vue';
import { modelAdapter, type ModelStatus } from './domain/model';
import {
  back,
  confirmPending,
  init,
  pendingSwitch,
  planItems,
  questions,
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

const CHAT_VIEWS: View[] = ['home', 'needs', 'search', 'questions', 'results'];
const isChat = computed(() => CHAT_VIEWS.includes(state.view));

// 換頁或換題時把焦點移到新的標題或最新一則提問，讓讀屏與鍵盤使用者知道位置。
// 對話頁捲到最下面；一般頁捲回頂端。動態題目可能在同一個 qIndex 換成別題，所以也看題目 id。
watch(
  () => [state.view, state.detailId, state.qIndex, state.view === 'questions' ? questions.value[state.qIndex]?.id : null],
  async () => {
    settingsOpen.value = false;
    await nextTick();
    const title = document.getElementById('view-title');
    if (isChat.value) {
      title?.focus({ preventScroll: true });
      followBottom(true);
    } else {
      window.scrollTo?.(0, 0);
      title?.focus();
    }
  },
);

const navItems: { view: View; label: string; match: View[] }[] = [
  { view: 'home', label: '找資源', match: ['home', 'needs', 'search', 'questions', 'results', 'detail'] },
  { view: 'plan', label: '行動單', match: ['plan'] },
  { view: 'help', label: '找人幫忙', match: ['help'] },
];

const targetLabel = computed(() =>
  state.session.target === 'self' ? '幫自己找' : state.session.target === 'other' ? '幫別人找' : '尚未選擇',
);


const dialogTitle = computed(() =>
  pendingSwitch.value === 'clear' ? '清除這次的資料？' : '換人嗎？',
);
</script>

<template>
  <a class="skip-link" href="#main">跳到主要內容</a>
  <header class="app-header no-print">
    <div class="app-header__row">
      <div class="brand">
        <span class="avatar avatar--lg" aria-hidden="true">福</span>
        <span class="brand__text">
          <span class="brand__name">福利通</span>
          <span class="brand__sub">{{ state.session.target ? `${targetLabel}・非官方服務` : '非官方服務，資格以承辦機關為準' }}</span>
        </span>
      </div>
      <button
        type="button"
        class="btn btn--text"
        :aria-expanded="settingsOpen"
        aria-controls="settings-panel"
        @click="settingsOpen = !settingsOpen"
      >
        {{ settingsOpen ? '關閉設定' : '設定' }}
      </button>
    </div>
    <section v-show="settingsOpen" id="settings-panel" class="settings" aria-label="設定">
      <label class="check">
        <input v-model="state.prefs.largeText" type="checkbox" />
        <span>字放大</span>
      </label>
      <label class="check">
        <input v-model="state.prefs.highContrast" type="checkbox" />
        <span>高對比</span>
      </label>
      <div class="inline-actions">
        <button type="button" class="btn btn--text" @click="requestNewPerson">換人（清除前一位）</button>
        <button type="button" class="btn btn--text" @click="pendingSwitch = 'clear'">清除這次的資料</button>
      </div>
      <p class="muted">填寫的內容只留在這個分頁，不會送出；關閉分頁後通常會清除。</p>
      <details class="more more--single settings__meta">
        <summary>資料來源</summary>
        <dl class="more__body facts">
          <div><dt>資料</dt><dd>{{ state.catalog?.sourceLabel ?? '載入中' }}</dd></div>
          <div><dt>版本</dt><dd>{{ state.catalog?.version ?? '載入中' }}</dd></div>
          <div v-if="state.catalog?.fallbackReason"><dt>改用快照原因</dt><dd>{{ state.catalog.fallbackReason }}</dd></div>
          <div><dt>題目</dt><dd>{{ state.bank ? (state.bank.origin === 'api' ? `後端題庫（${state.bank.version}）` : '本機題庫') : '載入中' }}</dd></div>
          <div><dt>裝置端模型</dt><dd>{{ modelStatus?.state === 'unavailable' ? modelStatus.reason : modelStatus?.state ?? '確認中' }}</dd></div>
          <div><dt>說明</dt><dd>本服務非政府官方服務；查核標記沿用資料原有狀態。</dd></div>
        </dl>
      </details>
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
        {{ n.view === 'plan' && state.session.target === 'other' ? '家人檢核表' : n.label }}<span v-if="n.view === 'plan' && planItems.length" class="tabs__count">{{ planItems.length }}<span class="sr-only"> 項</span></span>
      </button>
    </nav>
  </header>

  <main id="main" class="app-main" :class="{ 'app-main--chat': isChat, 'app-main--page': state.view === 'detail' || state.view === 'plan' }">
    <p v-if="state.loadError" class="status-line status-line--error" role="alert">
      {{ state.loadError }}
      <button type="button" class="btn btn--text" @click="init">重試</button>
    </p>
    <p v-if="state.notice" class="status-line no-print" role="status">
      {{ state.notice }}
      <button type="button" class="btn btn--text" @click="state.notice = ''">知道了</button>
    </p>
    <p v-if="state.catalog?.origin === 'snapshot'" class="muted no-print">暫用已保存的資料，官方網站仍需連線</p>

    <div v-if="state.view === 'detail'" class="topbar no-print">
      <button type="button" class="btn btn--text back-chat" @click="back">
        <span aria-hidden="true">‹</span>
        <span class="avatar avatar--sm" aria-hidden="true">福</span>
        回到對話
      </button>
    </div>
    <ChatView v-if="isChat" />
    <DetailView v-else-if="state.view === 'detail'" :key="state.detailId ?? ''" />
    <PlanView v-else-if="state.view === 'plan'" />
    <HelpView v-else-if="state.view === 'help'" />
  </main>

  <ConfirmDialog
    :open="pendingSwitch !== null"
    :title="dialogTitle"
    :confirm-label="pendingSwitch === 'clear' ? '清除' : '換人並清除'"
    danger
    @confirm="confirmPending"
    @cancel="pendingSwitch = null"
  >
    <p>會清除目前填的答案、行動單／檢核表和勾選進度。字放大與高對比設定會保留。</p>
  </ConfirmDialog>
</template>
