<script setup lang="ts">
import { computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted, ref, watch, watchEffect, type Component } from 'vue';
import { followBottom } from './chat/typing';
import ChatView from './components/ChatView.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import DetailView from './components/DetailView.vue';
import HelpView from './components/HelpView.vue';
import LogoMark from './components/LogoMark.vue';
import { dismissSplash, SPLASH_MAX_WAIT_MS } from './brand/splash';
import BrowseView from './components/BrowseView.vue';
import PlanItemView from './components/PlanItemView.vue';
import PlanView from './components/PlanView.vue';
import Expand from './components/motion/Expand.vue';
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
  PLAN_VIEWS,
  questions,
  requestNewPerson,
  state,
  tab,
  type View,
} from './store';

const settingsOpen = ref(false);
const modelStatus = ref<ModelStatus | null>(null);
const modelStateLabel: Record<ModelStatus['state'], string> = {
  unavailable: '目前無法使用',
  not_downloaded: '尚未下載',
  downloading: '下載中',
  downloaded: '已下載，準備啟用',
  loading: '啟用中',
  ready: '可以使用',
  error: '啟用失敗',
};

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
function focusView(chat: boolean) {
  const title = document.getElementById('view-title');
  if (chat) {
    title?.focus({ preventScroll: true });
    followBottom(true);
  } else {
    document.getElementById('main')?.scrollTo?.(0, 0);
    title?.focus({ preventScroll: true });
  }
}

// ── 換頁轉場 ──
// 每個「頁」一個 key；key 變了就由 <Transition> 換頁，焦點與捲動等新頁進場時才處理（見 onPageBeforeEnter/onPageEntered）。
// 同一頁內（對話換題、換需求）沿用原本的即時處理。
const pageKey = computed(() =>
  isChat.value ? `chat-${conversationEpoch.value}`
  : state.view === 'detail' ? `detail-${state.detailId ?? ''}`
  : state.view === 'planItem' ? `planItem-${state.planItemId ?? ''}`
  : state.view,
);
/** 目前畫面上（已進場）的頁；main 的版面 class 跟著它，離場中的舊頁不會先換版面。 */
const shownKey = ref(pageKey.value);
const shownView = ref<View>(state.view);
const shownChat = computed(() => CHAT_VIEWS.includes(shownView.value));

type Section = 'find' | 'plan' | 'browse';
const SECTION_ORDER: Record<Section, number> = { find: 0, plan: 1, browse: 2 };
function sectionOf(view: View): Section {
  if (CHAT_VIEWS.includes(view)) return 'find';
  if (view === 'plan' || view === 'planItem') return 'plan';
  if (view === 'browse') return 'browse';
  // 詳情、求助頁屬於開啟它的分頁（返回紀錄的最底層；tab() 會清空紀錄）
  const root = state.history[0];
  return root && root !== 'detail' && root !== 'help' ? sectionOf(root) : 'find';
}
const pageTransition = ref('page-fade');
let lastSection = sectionOf(state.view);
let lastDepth = state.history.length;
watch(
  pageKey,
  () => {
    const section = sectionOf(state.view);
    const depth = state.history.length;
    pageTransition.value =
      section !== lastSection ? (SECTION_ORDER[section] > SECTION_ORDER[lastSection] ? 'page-next' : 'page-prev')
      : depth > lastDepth ? 'page-push'
      : depth < lastDepth ? 'page-pop'
      : 'page-fade';
    lastSection = section;
    lastDepth = depth;
    settingsOpen.value = false;
  },
  { flush: 'pre' },
);
function onPageBeforeEnter() {
  shownKey.value = pageKey.value;
  shownView.value = state.view;
  if (!isChat.value) document.getElementById('main')?.scrollTo?.(0, 0);
}
function onPageEntered() {
  focusView(isChat.value);
}

watch(
  () => [state.view, state.detailId, state.planItemId, state.qIndex, state.view === 'questions' ? questions.value[state.qIndex]?.id : null],
  async () => {
    settingsOpen.value = false;
    await nextTick();
    // 換頁的焦點交給轉場完成後處理；同一頁內換題、換需求才在這裡處理。
    if (pageKey.value !== shownKey.value) return;
    shownView.value = state.view;
    focusView(isChat.value);
  },
);

const navItems: { view: View; label: string; match: View[] }[] = [
  { view: 'home', label: '找資源', match: ['home', 'needs', 'search', 'questions', 'results', 'detail'] },
  { view: 'plan', label: '行動單', match: ['plan', 'planItem'] },
  { view: 'browse', label: '補助總覽', match: ['browse'] },
];

// 詳情頁依來源標示目前分頁：從總覽來算補助總覽、從行動單來算行動單。
const activeView = computed<View>(() => {
  if (state.view !== 'detail') return state.view;
  const from = state.history[state.history.length - 1];
  return from === 'browse' ? 'browse' : from && PLAN_VIEWS.includes(from) ? 'plan' : 'detail';
});
const activeTabIndex = computed(() => navItems.findIndex((n) => n.match.includes(activeView.value)));
const backLabel = computed(() => {
  const from = state.history[state.history.length - 1];
  return from === 'browse' ? '回到補助總覽' : from === 'planItem' ? '回到行動單' : from === 'plan' ? '回到行動單列表' : from === 'detail' ? '回到補助內容' : from === 'results' ? '回到查詢結果' : state.view === 'planItem' ? '行動單列表' : '返回上一頁';
});

const targetLabel = computed(() =>
  state.session.target === 'self' ? '幫自己找' : state.session.target === 'other' ? '幫別人找' : '尚未選擇',
);


// 詳情與單張行動單：返回列跟著頁面一起進出場，標籤在進場時定下來，離場中不會換字。
const BackBar = defineComponent({
  name: 'BackBar',
  setup() {
    const label = backLabel.value;
    return () =>
      h('div', { class: 'topbar no-print' }, [
        h('button', { type: 'button', class: 'btn btn--text back-chat', onClick: back }, [
          h('svg', { class: 'back-chat__chev', viewBox: '0 0 24 24', width: 20, height: 20, 'aria-hidden': 'true', focusable: 'false' }, [
            h('path', { d: 'M15 5l-7 7 7 7', fill: 'none', stroke: 'currentColor', 'stroke-width': 2.4, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
          ]),
          h('span', { class: 'avatar avatar--sm', 'aria-hidden': 'true' }, [h(LogoMark)]),
          h('span', null, label),
        ]),
      ]);
  },
});
function withBackBar(name: string, view: Component) {
  return defineComponent({ name, setup: () => () => h('div', { class: 'page-shell' }, [h(BackBar), h(view)]) });
}
const DetailPage = withBackBar('DetailPage', DetailView);
const PlanItemPage = withBackBar('PlanItemPage', PlanItemView);

const page = computed<Component | null>(() =>
  isChat.value ? ChatView
  : state.view === 'detail' ? DetailPage
  : state.view === 'plan' ? PlanView
  : state.view === 'planItem' ? PlanItemPage
  : state.view === 'browse' ? BrowseView
  : state.view === 'help' ? HelpView
  : null,
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
          <Transition name="fade" mode="out-in">
            <span :key="state.session.target ?? ''" class="brand__sub">{{ state.session.target ? `${targetLabel}・非官方服務` : '非官方服務，資格以承辦機關為準' }}</span>
          </Transition>
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
    <Expand>
    <section v-show="settingsOpen" id="settings-panel" class="settings" aria-label="設定">
      <label class="check">
        <input v-model="state.prefs.largeText" type="checkbox" />
        <span>放大字體</span>
      </label>
      <label class="check">
        <input v-model="state.prefs.highContrast" type="checkbox" />
        <span>高對比</span>
      </label>
      <div class="inline-actions">
        <button type="button" class="btn btn--text" @click="requestNewPerson">換人查詢（清除前一位的答案）</button>
        <button type="button" class="btn btn--text" @click="pendingSwitch = 'clear'">清除這次的資料</button>
      </div>
      <p class="muted">對話與填答只留在本分頁；行動單項目、文件勾選與步驟進度會存入資料庫，關閉後可再開啟。</p>
      <p v-if="planSync.state.profile" class="muted">虛擬測試者：{{ planSync.state.profile.realName }}（非真實台北通登入）</p>
      <details class="more more--single settings__meta">
        <summary>資料來源</summary>
        <dl class="more__body facts">
          <div><dt>資料</dt><dd>{{ state.catalog?.sourceLabel ?? '載入中' }}</dd></div>
          <div><dt>版本</dt><dd>{{ state.catalog?.version ?? '載入中' }}</dd></div>
          <div v-if="state.catalog?.fallbackReason"><dt>為什麼使用備份資料</dt><dd>{{ state.catalog.fallbackReason }}</dd></div>
          <div><dt>題目</dt><dd>{{ state.bank ? (state.bank.origin === 'api' ? `線上題庫（${state.bank.version}）` : '本機題庫') : '載入中' }}</dd></div>
          <div><dt>文字理解功能</dt><dd>{{ modelStatus?.state === 'unavailable' ? modelStatus.reason : modelStatus ? modelStateLabel[modelStatus.state] : '確認中' }}</dd></div>
          <div><dt>說明</dt><dd>本服務非政府官方服務；查核標記沿用資料原有狀態。</dd></div>
        </dl>
      </details>
    </section>
    </Expand>

    <nav class="tabs" :class="{ 'tabs--none': activeTabIndex < 0 }" :style="{ '--tab-index': Math.max(activeTabIndex, 0) }" aria-label="主要功能">
      <button
        v-for="n in navItems"
        :key="n.view"
        type="button"
        class="tabs__item"
        :aria-current="n.match.includes(activeView) ? 'page' : undefined"
        @click="tab(n.view)"
      >
        {{ n.label }}<Transition name="pop"><span v-if="n.view === 'plan' && planItems.length" :key="planItems.length" class="tabs__count bump">{{ planItems.length }}<span class="sr-only"> 項</span></span></Transition>
      </button>
    </nav>
  </header>

  <main id="main" class="app-main" :class="{ 'app-main--chat': shownChat, 'app-main--page': shownView === 'detail' || PLAN_VIEWS.includes(shownView) }">
    <Transition name="fade">
      <p v-if="state.loadError" class="status-line status-line--error" role="alert">
        {{ state.loadError }}
        <button type="button" class="btn btn--text" @click="init">重試</button>
      </p>
    </Transition>
    <Transition name="fade">
      <p v-if="state.notice" class="status-line no-print" role="status">
        {{ state.notice }}
        <button type="button" class="btn btn--text" @click="state.notice = ''">知道了</button>
      </p>
    </Transition>
    <Transition name="fade">
      <p v-if="planSync.state.phase === 'error' || planSync.state.phase === 'conflict'" class="status-line status-line--error no-print" role="alert">
        {{ planSync.state.error }}
        <button v-if="planSync.state.phase === 'conflict'" type="button" class="btn btn--text" @click="planSync.load(true)">載入最新行動單（取代本頁修改）</button>
        <button v-else type="button" class="btn btn--text" @click="planSync.retry()">重新儲存</button>
      </p>
    </Transition>
    <p v-if="state.catalog?.origin === 'snapshot'" class="muted no-print">暫用已儲存的資料；開啟官方網站仍需要網路。</p>
    <Transition name="fade">
      <p v-if="PLAN_VIEWS.includes(shownView) && !['error', 'conflict'].includes(planSync.state.phase)" class="status-line no-print" role="status">
        <span class="sync-dot" :class="`sync-dot--${planSync.state.phase}`" aria-hidden="true"></span>
        <Transition name="fade" mode="out-in"><span :key="planSync.state.phase">{{ planSync.state.phase === 'saved' ? '已存入資料庫，離開後可繼續準備' : planSync.state.phase === 'saving' ? '正在儲存行動單…' : '正在讀取已儲存的行動單…' }}</span></Transition>
      </p>
    </Transition>

    <Transition :name="pageTransition" mode="out-in" @before-enter="onPageBeforeEnter" @after-enter="onPageEntered">
      <KeepAlive :include="['ChatView', 'BrowseView']" :max="2">
        <component :is="page" v-if="page" :key="pageKey" />
      </KeepAlive>
    </Transition>
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
    <p>{{ pendingSwitch === 'clear' ? '會清除這次填答、自己的行動單和勾選進度。' : '會清除前一位的查詢答案，自己的行動單與準備進度會保留。' }}放大字體與高對比設定會保留。</p>
  </ConfirmDialog>
</template>
