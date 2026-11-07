<script setup lang="ts">
// 補助總覽：可查看全部、選分類或輸入關鍵字，均保留整份資料的時效標示。
// 受理時間待確認與尚未開放的項目都列出（後者排在最後、以灰字標示）；已截止的案件不列出。
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { BROWSE_CATEGORIES, browseCatalog, browseCategory, browseStatus, browseStatusLabel, isInactive } from '../domain/browse';
import { plainLanguageFor } from '../domain/plain-language';
import { sourceExcerpt } from '../presentation';
import { state, openDetail } from '../store';

const showAll = ref(false);
const category = ref<string | null>(null);
const query = ref('');
/** 已套用的關鍵字。輸入停一下才更新清單，避免每打一字就整頁重畫。 */
const applied = ref('');
const today = ref('');
function updateDate() { today.value = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' }); }
updateDate();
let timer: ReturnType<typeof setInterval>;
let searchTimer = 0;
onMounted(() => { timer = setInterval(updateDate, 60_000); });
onUnmounted(() => { clearInterval(timer); window.clearTimeout(searchTimer); });

const heading = ref<HTMLElement | null>(null);
const pendingFocus = ref(false);
const all = computed(() => browseCatalog(state.catalog?.items ?? [], { today: today.value, includeUncertain: true, includeUpcoming: true }));
const categories = computed(() => BROWSE_CATEGORIES.map(c => ({ ...c, count: all.value.filter(i => browseCategory(i) === c.id).length })));
const selected = computed(() => BROWSE_CATEGORIES.find(c => c.id === category.value));
const showingItems = computed(() => showAll.value || !!category.value || !!applied.value);
const items = computed(() => browseCatalog(state.catalog?.items ?? [], { today: today.value, category: category.value, query: applied.value, includeUncertain: true, includeUpcoming: true }));
const headingText = computed(() => {
  const q = applied.value ? `・「${applied.value}」` : '';
  if (showAll.value) return `全部福利與補助${q}`;
  if (selected.value) return `${selected.value.label}${q}`;
  return `「${applied.value}」`;
});

function syncQuery(immediate = false) {
  window.clearTimeout(searchTimer);
  const apply = () => { applied.value = query.value.trim(); };
  if (immediate || !query.value.trim()) apply();
  else searchTimer = window.setTimeout(apply, 220);
}
watch(query, () => syncQuery(false));

function focusHeading() {
  if (heading.value) heading.value.focus();
  else pendingFocus.value = true;
}
function onPaneEnter() {
  if (!pendingFocus.value) return;
  pendingFocus.value = false;
  heading.value?.focus();
}
function search() {
  if (!query.value.trim()) return;
  syncQuery(true);
  (document.activeElement as HTMLElement | null)?.blur();
  focusHeading();
}
function clearQuery() {
  window.clearTimeout(searchTimer);
  query.value = '';
  applied.value = '';
  document.getElementById('browse-query')?.focus();
}
function chooseCategory(id: string) {
  window.clearTimeout(searchTimer);
  showAll.value = false;
  category.value = id;
  applied.value = '';
  query.value = '';
  focusHeading();
}
function reset() {
  window.clearTimeout(searchTimer);
  showAll.value = false;
  category.value = null;
  applied.value = '';
  query.value = '';
}
function chooseAll() { reset(); showAll.value = true; focusHeading(); }
</script>

<template>
  <div class="view browse-view">
    <h1 id="view-title" class="sr-only" tabindex="-1">補助總覽</h1>
    <form class="browse-search" :class="{ 'browse-search--filled': query }" role="search" @submit.prevent="search">
      <label class="sr-only" for="browse-query">搜尋補助</label>
      <input id="browse-query" v-model="query" class="browse-search__input" type="search" enterkeyhint="search" autocomplete="off" placeholder="輸入關鍵字，例如租屋、育兒" />
      <button v-if="query" type="button" class="browse-search__clear" @click="clearQuery">
        <span class="sr-only">清除搜尋</span>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" /></svg>
      </button>
      <button type="submit" class="browse-search__btn">
        <span class="sr-only">搜尋</span>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2" /><path d="M15.5 15.5 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" /></svg>
      </button>
    </form>

    <Transition name="rise" mode="out-in" @after-enter="onPaneEnter">
      <p v-if="state.loading" key="loading" role="status">正在載入補助資料…</p>
      <div v-else-if="!showingItems" key="home" class="browse-home">
        <button type="button" class="btn btn--secondary btn--block" @click="chooseAll">查看全部 {{ all.length }} 項福利與補助</button>
        <ul class="browse-grid" aria-label="補助分類">
          <li v-for="c in categories" :key="c.id">
            <button type="button" class="browse-category" @click="chooseCategory(c.id)">
              <span class="browse-category__top">
                <span class="browse-category__count">{{ c.count }} 項</span>
                <svg class="browse-category__go" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M7 17 17 7M9 7h8v8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" /></svg>
              </span>
              <span class="browse-category__title">{{ c.label }}</span>
              <span class="browse-category__hint">{{ c.hint }}</span>
            </button>
          </li>
        </ul>
      </div>
      <section v-else key="results" class="browse-section" aria-labelledby="browse-results-heading">
        <div class="browse-section-head">
          <button type="button" class="btn btn--text browse-back" @click="reset">
            <span class="browse-back__chev" aria-hidden="true">‹</span>
            全部分類
          </button>
          <h2 id="browse-results-heading" ref="heading" tabindex="-1" class="section-title">
            {{ headingText }}<span class="browse-count"><span :key="items.length" class="bump">{{ items.length }}</span> 項</span>
          </h2>
        </div>
        <Transition name="fade" mode="out-in">
          <TransitionGroup v-if="items.length" key="list" name="list" tag="ul" class="rows browse-results">
            <li v-for="item in items" :key="item.id">
              <button type="button" class="row" @click="openDetail(item.id)">
                <span class="row__main">
                  <span class="row__sub">{{ item.classification.category }}</span>
                  <span class="row__title">{{ item.name }}</span>
                  <span class="row__sub">{{ item.provider.name }}</span>
                  <span v-if="plainLanguageFor(item)" class="row__sub">{{ plainLanguageFor(item)!.summary }}</span>
                  <span v-else-if="item.benefit.raw" class="row__sub">內容節錄：{{ sourceExcerpt(item.benefit.raw, 72) }}</span>
                  <span class="browse-status" :class="{ 'browse-status--inactive': isInactive(browseStatus(item, today)) }">{{ browseStatusLabel(item, today) }}</span>
                </span>
                <span class="row__chev" aria-hidden="true">›</span>
              </button>
            </li>
          </TransitionGroup>
          <p v-else key="empty" class="browse-empty" role="status">找不到符合的補助，試試較短的關鍵字。</p>
        </Transition>
      </section>
    </Transition>
  </div>
</template>

<style scoped>
.browse-view { display: grid; gap: var(--space-5); }
.browse-home { display: grid; gap: var(--space-5); align-content: start; }
.browse-search { position: relative; }
.browse-search__input {
  width: 100%; min-height: 52px; padding: 0 var(--touch) 0 var(--space-4);
  border: 1px solid var(--line-input); border-radius: var(--radius-pill);
  background: var(--bg); color: var(--text); font: inherit; box-shadow: var(--shadow-card);
}
.browse-search--filled .browse-search__input { padding-right: calc(var(--touch) * 2 + 4px); }
.browse-search__input::-webkit-search-decoration,
.browse-search__input::-webkit-search-cancel-button { -webkit-appearance: none; appearance: none; display: none; }
.browse-search__input:focus { border-color: var(--accent-fill); box-shadow: 0 0 0 3px var(--brand-soft); outline: none; }
.browse-search__input:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
.browse-search__input::placeholder { color: var(--muted); }
.browse-search__clear,
.browse-search__btn {
  position: absolute; top: 50%; transform: translateY(-50%);
  display: grid; place-items: center; width: var(--touch); height: var(--touch);
  border: 0; border-radius: 50%; background: transparent; color: var(--accent); cursor: pointer;
}
.browse-search__btn { right: 2px; }
.browse-search__clear { right: var(--touch); }
.browse-search__btn:active,
.browse-search__clear:active { background: var(--accent-soft); }
.browse-section { display: grid; gap: var(--space-3); }
.browse-section-head { display: grid; justify-items: start; gap: var(--space-1); }
.browse-back { gap: 2px; }
.browse-back__chev { display: inline-flex; align-items: center; justify-content: center; width: 1em; line-height: 1; }
.browse-count { margin-left: var(--space-2); color: var(--text-2); font-size: var(--fs-small); font-weight: normal; font-variant-numeric: tabular-nums; }
.browse-count .bump { display: inline-block; }
.browse-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); padding: 0; list-style: none; align-items: stretch; }
.browse-grid > li { display: flex; margin: 0; min-width: 0; }
.browse-category { display: flex; flex: 1; flex-direction: column; align-items: stretch; gap: var(--space-2); width: 100%; min-height: 100%; padding: var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-panel); background: var(--bg); box-shadow: var(--shadow-card); color: var(--text); font: inherit; text-align: left; cursor: pointer; transition: background-color var(--dur) var(--ease), border-color var(--dur) var(--ease); }
.browse-category:hover, .browse-category:active { background: var(--accent-soft); border-color: var(--reply-line); }
.browse-category__top { display: flex; align-items: center; justify-content: space-between; gap: var(--space-2); min-height: 28px; color: var(--accent); }
.browse-category__title { font-size: var(--fs-section); font-weight: 600; line-height: var(--lh-tight); }
.browse-category__count { display: inline-flex; align-items: center; justify-content: center; min-height: 24px; padding: 2px 10px; border-radius: var(--radius-pill); background: var(--brand-soft); font-size: var(--fs-small); font-weight: var(--fw-bold); line-height: 1; font-variant-numeric: tabular-nums; }
.browse-category__go { display: block; flex: none; }
.browse-category__hint { color: var(--muted); font-size: var(--fs-body); }
.browse-status { color: var(--accent); font-size: var(--fs-small); }
.browse-status--inactive { color: var(--text-2); }
.browse-results { position: relative; padding: 0; list-style: none; }
.browse-empty { display: grid; justify-items: center; gap: var(--space-2); padding: var(--space-6) var(--space-4); border-radius: var(--radius); background: var(--raised); text-align: center; }
@media (max-width: 359px) { .browse-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
