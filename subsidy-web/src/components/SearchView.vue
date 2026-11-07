<script setup lang="ts">
import { ref } from 'vue';
import { searchResources, state } from '../store';

const query = ref(state.session.query);
</script>

<template>
  <div class="view">
    <div class="view-head">
      <h1 id="view-title" class="view-title" tabindex="-1">想找什麼？</h1>
      <p class="lead">輸入名稱或關鍵字，接著只問和這些項目有關的問題。</p>
    </div>
    <form class="actions" role="search" @submit.prevent="searchResources(query)">
      <label class="field" for="resource-search">
        <span class="field__label">名稱或關鍵字</span>
        <input
          id="resource-search"
          v-model="query"
          class="input"
          type="search"
          inputmode="search"
          maxlength="100"
          placeholder="例如：租屋、助學金、輔具"
          aria-describedby="search-hint"
        />
      </label>
      <p id="search-hint" class="muted">多個詞用空格分開</p>
      <button type="submit" class="btn btn--primary btn--block" :disabled="state.loading || !query.trim()">搜尋</button>
    </form>
  </div>
</template>
