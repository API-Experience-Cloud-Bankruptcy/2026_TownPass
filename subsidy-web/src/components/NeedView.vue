<script setup lang="ts">
import { computed, ref } from 'vue';
import { SITUATIONS } from '../domain/situations';
import { searchResources, selectNeed, startExplore, state } from '../store';

const ask = computed(() => (state.session.target === 'other' ? '對方' : '你'));
const query = ref(state.session.query);
const busy = computed(() => state.loading || !state.catalog);
</script>

<template>
  <div class="view">
    <div class="view-head">
      <h1 id="view-title" class="view-title" tabindex="-1">{{ ask }}需要哪方面的幫忙？</h1>
      <p v-if="state.session.target === 'other'" class="muted">幫別人查，不代表可以替對方申請</p>
    </div>
    <p v-if="state.loading" class="muted" role="status">資料載入中</p>

    <div class="actions">
      <button type="button" class="btn btn--primary btn--block btn--tall" :disabled="busy" @click="startExplore">
        <span class="btn__stack">
          <span>還不確定，帶我找</span>
          <span class="btn__sub">從簡單的問題開始，逐步縮小範圍</span>
        </span>
      </button>
    </div>

    <section class="actions" aria-labelledby="need-list-h">
      <h2 id="need-list-h" class="section-title">或選一個情況</h2>
      <ul class="rows">
        <li v-for="s in SITUATIONS" :key="s.id">
          <button
            type="button"
            class="row"
            :disabled="busy"
            :aria-pressed="state.session.situation === s.id && !state.session.query"
            @click="selectNeed(s.id)"
          >
            <span class="row__main">
              <span class="row__title">{{ s.label }}</span>
              <span v-if="s.hint" class="row__sub">{{ s.hint }}</span>
            </span>
            <span class="row__chev" aria-hidden="true">›</span>
          </button>
        </li>
      </ul>
    </section>

    <form class="actions" role="search" aria-labelledby="need-search-h" @submit.prevent="searchResources(query)">
      <h2 id="need-search-h" class="section-title">知道名稱就直接找</h2>
      <label class="field" for="need-search">
        <span class="field__label">名稱或關鍵字</span>
        <input
          id="need-search"
          v-model="query"
          class="input"
          type="search"
          inputmode="search"
          maxlength="100"
          placeholder="例如：租金補貼、助學金、輔具"
          aria-describedby="need-search-hint"
        />
      </label>
      <p id="need-search-hint" class="muted">多個詞用空格分開</p>
      <button type="submit" class="btn btn--block" :disabled="busy || !query.trim()">搜尋</button>
    </form>
  </div>
</template>
