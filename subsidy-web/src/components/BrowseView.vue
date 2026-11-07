<script setup lang="ts">
// 補助總覽：可查看全部、選分類或送出關鍵字，均保留整份資料的時效標示。
// 受理時間待確認、已截止與尚未開放的項目都列出（後兩者排在最後、以灰字標示）。
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { BROWSE_CATEGORIES, browseCatalog, browseCategory, browseStatus, browseStatusLabel, isInactive } from '../domain/browse';
import { plainLanguageFor } from '../domain/plain-language';
import { sourceExcerpt } from '../presentation';
import { state, openDetail } from '../store';

const SHOW_ALL = { includeUncertain: true, includeClosed: true } as const;

const showAll = ref(false);
const category = ref<string | null>(null);
const query = ref('');
/** 已送出的關鍵字；打字當下不搜尋，按 Enter 或放大鏡才套用。 */
const applied = ref('');
const today = ref('');
function updateDate() { today.value = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' }); }
updateDate();
let timer: ReturnType<typeof setInterval>;
onMounted(() => { timer = setInterval(updateDate, 60_000); });
onUnmounted(() => clearInterval(timer));

const heading = ref<HTMLElement | null>(null);
const all = computed(() => browseCatalog(state.catalog?.items ?? [], { today: today.value, ...SHOW_ALL }));
const categories = computed(() => BROWSE_CATEGORIES.map(c => ({ ...c, count: all.value.filter(i => browseCategory(i) === c.id).length })));
const selected = computed(() => BROWSE_CATEGORIES.find(c => c.id === category.value));
const showingItems = computed(() => showAll.value || !!category.value || !!applied.value);
const items = computed(() => browseCatalog(state.catalog?.items ?? [], { today: today.value, category: category.value, query: applied.value, ...SHOW_ALL }));

async function focusHeading() { await nextTick(); heading.value?.focus(); }
function search() {
  const q = query.value.trim();
  if (!q) return;
  showAll.value = false;
  category.value = null;
  applied.value = q;
  (document.activeElement as HTMLElement | null)?.blur(); // 收起手機鍵盤
  focusHeading();
}
function chooseCategory(id: string) { showAll.value = false; category.value = id; applied.value = ''; query.value = ''; focusHeading(); }
function reset() { showAll.value = false; category.value = null; applied.value = ''; query.value = ''; }
function chooseAll() { reset(); showAll.value = true; focusHeading(); }
// 清空搜尋框（含輸入框內建的 ✕）就回到分類。
watch(query, (q) => { if (!q.trim() && applied.value) applied.value = ''; });
</script>

<template>
  <div class="view browse-view">
    <h1 id="view-title" class="sr-only" tabindex="-1">補助總覽</h1>
    <form class="browse-search" role="search" @submit.prevent="search">
      <label class="sr-only" for="browse-query">搜尋補助</label>
      <input id="browse-query" v-model="query" class="browse-search__input" type="search" enterkeyhint="search" placeholder="輸入關鍵字，例如租屋、育兒" />
      <button type="submit" class="browse-search__btn">
        <span class="sr-only">搜尋</span>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2" /><path d="M15.5 15.5 20 20" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" /></svg>
      </button>
    </form>

    <p v-if="state.loading" role="status">正在載入補助資料…</p>
    <template v-else-if="!showingItems">
      <button type="button" class="btn btn--secondary btn--block" @click="chooseAll">查看全部 {{ all.length }} 項福利與補助</button>
      <p class="muted">可以依分類找，也能查看全部項目，包含已截止、尚未開放及受理時間待確認的補助。</p>
      <ul class="browse-grid" aria-label="補助分類">
        <li v-for="c in categories" :key="c.id">
          <button type="button" class="browse-category" @click="chooseCategory(c.id)">
            <span class="browse-category__top"><span>{{ c.count }} 項</span><span aria-hidden="true">↗</span></span>
            <span class="browse-category__title">{{ c.label }}</span>
            <span class="browse-category__hint">{{ c.hint }}</span>
          </button>
        </li>
      </ul>
    </template>
    <section v-else class="browse-section" aria-labelledby="browse-results-heading">
      <div class="browse-section-head">
        <button type="button" class="btn btn--text" @click="reset">‹ 全部分類</button>
        <h2 id="browse-results-heading" ref="heading" tabindex="-1" class="section-title">
          {{ showAll ? '全部福利與補助' : selected?.label ?? `「${applied}」` }}<span class="browse-count" role="status">{{ items.length }} 項</span>
        </h2>
      </div>
      <ul v-if="items.length" class="rows browse-results">
        <li v-for="item in items" :key="item.id">
          <button type="button" class="row" @click="openDetail(item.id)">
            <span class="row__main">
              <span class="row__sub">{{ item.classification.category }}</span>
              <span class="row__title">{{ item.name }}</span>
              <span class="row__sub">{{ item.provider.name }}</span>
              <span v-if="plainLanguageFor(item)" class="row__sub">白話導讀：{{ plainLanguageFor(item)!.support }}</span>
              <span v-else-if="item.benefit.raw" class="row__sub">內容節錄：{{ sourceExcerpt(item.benefit.raw, 72) }}</span>
              <span class="browse-status" :class="{ 'browse-status--inactive': isInactive(browseStatus(item, today)) }">{{ browseStatusLabel(item, today) }}</span>
            </span>
            <span class="row__chev" aria-hidden="true">›</span>
          </button>
        </li>
      </ul>
      <p v-else class="browse-empty" role="status">找不到符合的補助，試試較短的關鍵字。</p>
    </section>
  </div>
</template>

<style scoped>
.browse-view { display: grid; gap: var(--space-5); }
.browse-search { position: relative; }
.browse-search__input {
  width: 100%; min-height: 52px; padding: 0 calc(var(--touch) + var(--space-2)) 0 var(--space-4);
  border: 1px solid var(--line-input); border-radius: var(--radius-pill);
  background: var(--bg); color: var(--text); font: inherit; box-shadow: var(--shadow-card);
}
.browse-search__input:focus { border-color: var(--accent-fill); box-shadow: 0 0 0 3px var(--brand-soft); outline: none; }
.browse-search__input:focus-visible { outline: 3px solid var(--focus); outline-offset: 2px; }
.browse-search__input::placeholder { color: var(--muted); }
.browse-search__btn {
  position: absolute; top: 50%; right: 2px; transform: translateY(-50%);
  display: grid; place-items: center; width: var(--touch); height: var(--touch);
  border: 0; border-radius: 50%; background: transparent; color: var(--accent); cursor: pointer;
}
.browse-search__btn:active { background: var(--accent-soft); }
.browse-section { display: grid; gap: var(--space-3); }
.browse-section-head { display: grid; justify-items: start; gap: var(--space-1); }
.browse-count { margin-left: var(--space-2); color: var(--text-2); font-size: var(--fs-small); font-weight: normal; }
.browse-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); padding: 0; list-style: none; }
.browse-grid > li { margin: 0; min-width: 0; }
.browse-category { display: flex; flex-direction: column; align-items: stretch; gap: var(--space-2); width: 100%; height: 100%; padding: var(--space-4); border: 1px solid var(--line); border-radius: var(--radius-panel); background: var(--bg); box-shadow: var(--shadow-card); color: var(--text); font: inherit; text-align: left; cursor: pointer; transition: background-color var(--dur) var(--ease), border-color var(--dur) var(--ease); }
.browse-category:hover, .browse-category:active { background: var(--accent-soft); border-color: var(--reply-line); }
.browse-category__top { display: flex; justify-content: space-between; align-items: center; color: var(--accent); font-size: var(--fs-body); font-weight: var(--fw-medium); }
.browse-category__top > span:first-child { padding: 2px 10px; border-radius: var(--radius-pill); background: var(--brand-soft); font-size: var(--fs-small); font-weight: var(--fw-bold); }
.browse-category__title { font-size: var(--fs-section); font-weight: 600; }
.browse-category__hint { color: var(--muted); font-size: var(--fs-body); }
.browse-status { color: var(--accent); font-size: var(--fs-small); }
.browse-status--inactive { color: var(--text-2); }
.browse-results { padding: 0; list-style: none; }
.browse-empty { padding: var(--space-6) var(--space-4); border-radius: var(--radius); background: var(--raised); text-align: center; }
@media (max-width: 359px) { .browse-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
