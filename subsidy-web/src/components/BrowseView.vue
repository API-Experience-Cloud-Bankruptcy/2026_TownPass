<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue';
import { BROWSE_CATEGORIES, browseCatalog, browseCategory, browseStatus } from '../domain/browse';
import { state, openDetail } from '../store';

const category = ref<string | null>(null);
const query = ref('');
const includeUncertain = ref(false);
const today = ref('');
function updateDate() { today.value = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Taipei' }); }
updateDate();
let timer: ReturnType<typeof setInterval>;
onMounted(() => { timer = setInterval(updateDate, 60_000); });
onUnmounted(() => clearInterval(timer));
const heading = ref<HTMLElement | null>(null);
const available = computed(() => browseCatalog(state.catalog?.items ?? [], { today: today.value, includeUncertain: includeUncertain.value }));
const categories = computed(() => BROWSE_CATEGORIES.map(c => ({ ...c, count: available.value.filter(i => browseCategory(i) === c.id).length })));
const selected = computed(() => BROWSE_CATEGORIES.find(c => c.id === category.value));
const searching = computed(() => !!query.value.trim());
const showingItems = computed(() => !!category.value || searching.value);
const items = computed(() => browseCatalog(state.catalog?.items ?? [], { today: today.value, category: category.value, query: query.value, includeUncertain: includeUncertain.value }));
async function chooseCategory(id: string | null) {
  category.value = id;
  await nextTick();
  heading.value?.focus();
}
function reset() { query.value = ''; chooseCategory(null); }
</script>

<template>
  <div class="view browse-view">
    <div class="view-head">
      <p class="browse-eyebrow">依需求，慢慢找</p>
      <h1 id="view-title" class="view-title" tabindex="-1">補助總覽</h1>
      <p class="muted">先選一個類別，或用關鍵字找補助。</p>
    </div>
    <div class="browse-search">
      <label class="field" for="browse-query">
        <span class="field__label">搜尋補助</span>
        <input id="browse-query" v-model="query" class="input" type="search" placeholder="例如：租屋、育兒、獎學金" aria-describedby="browse-search-hint" />
      </label>
      <p id="browse-search-hint" class="muted">{{ selected ? `搜尋「${selected.label}」；返回分類可搜尋全部。` : '可搜尋補助名稱、關鍵字或內容，多個詞以空格分開。' }}</p>
      <label class="check">
        <input v-model="includeUncertain" type="checkbox" />
        <span>也查看受理時間待確認的項目</span>
      </label>
    </div>
    <p class="muted browse-note">依目前收錄資料隱藏已截止與尚未開放的項目。受理名額、經費與個人資格仍須向承辦機關確認。</p>

    <p v-if="state.loading" role="status">正在載入補助資料…</p>
    <section v-else-if="!showingItems" aria-labelledby="browse-heading" class="browse-section">
      <div class="browse-section-head">
        <h2 id="browse-heading" ref="heading" tabindex="-1" class="section-title">按類別瀏覽</h2>
        <span class="muted">{{ available.length }} 項資源</span>
      </div>
      <ul class="browse-grid">
        <li v-for="c in categories" :key="c.id">
          <button type="button" class="browse-category" @click="chooseCategory(c.id)">
            <span class="browse-category__top"><span class="browse-category__count">{{ c.count }} 項</span><span aria-hidden="true">↗</span></span>
            <span class="browse-category__title">{{ c.label }}</span>
            <span class="browse-category__hint">{{ c.hint }}</span>
          </button>
        </li>
      </ul>
    </section>
    <section v-else aria-labelledby="browse-results-heading" class="browse-section">
      <button type="button" class="btn btn--text" @click="reset">‹ 返回全部分類</button>
      <div class="browse-section-head">
        <h2 id="browse-results-heading" ref="heading" tabindex="-1" class="section-title">{{ selected?.label ?? '搜尋結果' }}</h2>
        <span class="muted" role="status" aria-live="polite">{{ items.length }} 項</span>
      </div>
      <p v-if="searching" class="muted">關鍵字：{{ query.trim() }}</p>
      <ul v-if="items.length" class="rows browse-results">
        <li v-for="item in items" :key="item.id">
          <button type="button" class="row" @click="openDetail(item.id)">
            <span class="row__main">
              <span class="row__sub">{{ item.classification.category }}</span>
              <span class="row__title">{{ item.name }}</span>
              <span class="row__sub">{{ item.provider.name }}</span>
              <span class="browse-status">{{ browseStatus(item, today) === 'uncertain' ? '受理時間待確認' : item.application.deadline.type === 'rolling' ? '依個案期限申請' : '受理期間內・資格另審' }}</span>
            </span>
            <span class="row__chev" aria-hidden="true">›</span>
          </button>
        </li>
      </ul>
      <div v-else class="browse-empty" role="status">
        <p>目前沒有符合的補助</p>
        <p class="muted">試試較短的關鍵字、返回其他分類，或查看受理時間待確認的項目。</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.browse-view { display: grid; gap: var(--space-6); }
.browse-eyebrow { color: var(--accent); font-size: var(--fs-body); }
.browse-search { display: grid; gap: var(--space-3); padding: var(--space-4); background: var(--raised); border-radius: var(--radius-panel); }
.browse-note { border-left: 3px solid var(--line-strong); padding-left: var(--space-3); }
.browse-section { display: grid; gap: var(--space-4); }
.browse-section-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: var(--space-2); }
.browse-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); padding: 0; list-style: none; }
.browse-grid > li { margin: 0; min-width: 0; }
.browse-category { display: flex; flex-direction: column; align-items: stretch; gap: var(--space-2); width: 100%; height: 100%; padding: var(--space-4); border: 1px solid var(--line-strong); border-radius: var(--radius-panel); background: var(--bg); color: var(--text); font: inherit; text-align: left; cursor: pointer; }
.browse-category:hover { background: var(--accent-soft); border-color: var(--accent); }
.browse-category__top { display: flex; justify-content: space-between; color: var(--accent); }
.browse-category__count, .browse-category__hint { font-size: var(--fs-body); }
.browse-category__title { font-size: var(--fs-section); font-weight: 600; }
.browse-category__hint { color: var(--muted); }
.browse-status { color: var(--accent); font-size: var(--fs-small); }
.browse-results { padding: 0; list-style: none; }
.browse-empty { display: grid; gap: var(--space-2); padding: var(--space-6) var(--space-4); background: var(--raised); border-radius: var(--radius); }
@media (max-width: 359px) { .browse-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
