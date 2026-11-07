<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue';
import { followBottom } from './chat/typing';
import ChatView from './components/ChatView.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import DetailView from './components/DetailView.vue';
import HelpView from './components/HelpView.vue';
import LogoMark from './components/LogoMark.vue';
import { dismissSplash, SPLASH_MAX_WAIT_MS } from './brand/splash';
import BrowseView from './components/BrowseView.vue';
import PlanView from './components/PlanView.vue';
import { modelAdapter, type ModelStatus } from './domain/model';
import {
  back,
  confirmPending,
  continueConversation,
  conversationEpoch,
  init,
  pendingSwitch,
  pendingResume,
  newConversation,
  planSync,
  planItems,
  questions,
  requestNewPerson,
  state,
  tab,
  type View,
} from './store';

const settingsOpen = ref(false);
const modelStatus = ref<ModelStatus | null>(null);

// iOS 鍵盤可能只縮小 visualViewport；外框跟著可見高度，輸入框留在鍵盤上方。
function syncViewport() {
  const viewport = window.visualViewport;
  document.documentElement.style.setProperty('--app-height', `${viewport?.height ?? window.innerHeight}px`);
  document.documentElement.style.setProperty('--app-top', `${viewport?.offsetTop ?? 0}px`);
}

onMounted(async () => {
  syncViewport();
  window.visualViewport?.addEventListener('resize', syncViewport);
  window.visualViewport?.addEventListener('scroll', syncViewport);
  window.addEventListener('resize', syncViewport);
  // 開場畫面等資料載入完（最多等 SPLASH_MAX_WAIT_MS）才收起。
  const loaded = init();
  void Promise.race([loaded, new Promise((r) => setTimeout(r, SPLASH_MAX_WAIT_MS))]).then(dismissSplash);
  modelStatus.value = await modelAdapter.status();
});
onBeforeUnmount(() => {
  window.visualViewport?.removeEventListener('resize', syncViewport);
  window.visualViewport?.removeEventListener('scroll', syncViewport);
  window.removeEventListener('resize', syncViewport);
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
      document.getElementById('main')?.scrollTo?.(0, 0);
      title?.focus({ preventScroll: true });
    }
  },
);

const navItems: { view: View; label: string; match: View[] }[] = [
  { view: 'home', label: '找資源', match: ['home', 'needs', 'search', 'questions', 'results', 'detail'] },
  { view: 'plan', label: '行動單', match: ['plan'] },
  { view: 'browse', label: '補助總覽', match: ['browse'] },
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
        <span class="brand__logo" aria-hidden="true"><LogoMark :stroke="52" /></span>
        <span class="brand__text">
          <span class="brand__name">福利連</span>
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
      <p class="muted">對話與填答只留在本分頁；行動單項目、文件勾選與步驟進度會存入資料庫，關閉後可再開啟。</p>
      <p v-if="planSync.state.profile" class="muted">虛擬測試者：{{ planSync.state.profile.realName }}（非真實台北通登入）</p>
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
        :aria-current="n.match.includes(state.view === 'detail' && state.history[state.history.length - 1] === 'browse' ? 'browse' : state.view) ? 'page' : undefined"
        @click="tab(n.view)"
      >
        {{ n.label }}<span v-if="n.view === 'plan' && planItems.length" class="tabs__count">{{ planItems.length }}<span class="sr-only"> 項</span></span>
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
    <p v-if="planSync.state.phase === 'error' || planSync.state.phase === 'conflict'" class="status-line status-line--error no-print" role="alert">
      {{ planSync.state.error }}
      <button v-if="planSync.state.phase === 'conflict'" type="button" class="btn btn--text" @click="planSync.load(true)">載入最新行動單（取代本頁修改）</button>
      <button v-else type="button" class="btn btn--text" @click="planSync.retry()">重試保存</button>
    </p>
    <p v-if="state.catalog?.origin === 'snapshot'" class="muted no-print">暫用已保存的資料，官方網站仍需連線</p>
    <p v-if="state.view === 'plan' && !['error', 'conflict'].includes(planSync.state.phase)" class="status-line no-print" role="status">{{ planSync.state.phase === 'saved' ? '已存入資料庫，離開後可繼續準備' : planSync.state.phase === 'saving' ? '正在保存行動單…' : '正在讀取已保存的行動單…' }}</p>

    <div v-if="state.view === 'detail'" class="topbar no-print">
      <button type="button" class="btn btn--text back-chat" @click="back">
        <span aria-hidden="true">‹</span>
        <span class="avatar avatar--sm" aria-hidden="true"><LogoMark /></span>
        {{ state.history[state.history.length - 1] === 'browse' ? '回到補助總覽' : '返回上一頁' }}
      </button>
    </div>
    <KeepAlive :max="1"><ChatView v-if="isChat" :key="conversationEpoch" /></KeepAlive>
    <DetailView v-if="state.view === 'detail'" :key="state.detailId ?? ''" />
    <PlanView v-if="state.view === 'plan'" />
    <KeepAlive><BrowseView v-if="state.view === 'browse'" /></KeepAlive>
    <HelpView v-if="state.view === 'help'" />
  </main>

  <ConfirmDialog
    :open="pendingResume"
    title="要接著上次的對話嗎？"
    confirm-label="繼續對話"
    cancel-label="開新對話"
    dismiss-on-escape
    @confirm="continueConversation"
    @cancel="newConversation"
    @dismiss="pendingResume = false"
  >
    <p>可以繼續上次的查詢，或重新開始。已加入的行動單會保留。</p>
  </ConfirmDialog>

  <ConfirmDialog
    :open="pendingSwitch !== null"
    :title="dialogTitle"
    :confirm-label="pendingSwitch === 'clear' ? '清除' : '換人並清除'"
    danger
    @confirm="confirmPending"
    @cancel="pendingSwitch = null"
  >
    <p>{{ pendingSwitch === 'clear' ? '會清除這次填答、自己的行動單和勾選進度。' : '會清除前一位的查詢答案，自己的行動單與準備進度會保留。' }}字放大與高對比設定會保留。</p>
  </ConfirmDialog>
</template>
