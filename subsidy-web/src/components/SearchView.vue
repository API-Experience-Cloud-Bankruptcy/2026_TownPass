<script setup lang="ts">
import { ref } from 'vue';
import { searchResources, state } from '../store';
import StepDots from './StepDots.vue';

const query = ref(state.session.query);
</script>

<template>
  <div class="view">
    <div class="view-head">
      <StepDots :current="2" :total="3" />
      <h1 id="view-title" class="view-title" tabindex="-1">想找什麼？</h1>
    </div>
    <form class="actions" @submit.prevent="searchResources(query)">
      <label class="field" for="resource-search">
        <span class="field__label">關鍵字</span>
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
      <button type="submit" class="btn btn--primary btn--block" :disabled="state.loading || !query.trim()">下一步</button>
    </form>
  </div>
</template>
