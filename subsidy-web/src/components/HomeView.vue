<script setup lang="ts">
import { computed } from 'vue';
import { SITUATIONS } from '../domain/situations';
import { candidates, planItems, requestTarget, startQuestions, state, tab } from '../store';

const target = computed(() => state.session.target);
const ask = computed(() => (target.value === 'other' ? '對方' : '你'));

function pickSituation(id: string) {
  state.session.situation = state.session.situation === id ? null : id;
}
</script>

<template>
  <div class="view">
    <h1 id="view-title" class="view-title" tabindex="-1">找適合的資源</h1>

    <p v-if="planItems.length" class="card card--soft">
      你有 {{ planItems.length }} 項正在準備。
      <button type="button" class="btn btn--link" @click="tab('plan')">繼續準備申請</button>
    </p>

    <section class="card" aria-labelledby="target-h">
      <h2 id="target-h" class="section-title">這次要幫誰找資源？</h2>
      <div class="choice-grid" role="group" aria-labelledby="target-h">
        <button
          type="button"
          class="choice"
          :aria-pressed="target === 'self'"
          @click="requestTarget('self')"
        >
          <span class="choice__title">自己</span>
          <span class="choice__desc">由我自己填寫</span>
        </button>
        <button
          type="button"
          class="choice"
          :aria-pressed="target === 'other'"
          @click="requestTarget('other')"
        >
          <span class="choice__title">家人或其他人</span>
          <span class="choice__desc">填對方的情況，不帶入我的帳號資料</span>
        </button>
      </div>
      <p v-if="target === 'other'" class="muted">
        替他人查詢不代表取得代理權或可代為送件。
      </p>
    </section>

    <section class="card" aria-labelledby="need-h">
      <h2 id="need-h" class="section-title">{{ ask }}需要哪方面的協助？</h2>
      <p class="muted">可以選一項，也可以直接搜尋。</p>
      <div class="situation-grid" role="group" aria-labelledby="need-h">
        <button
          v-for="s in SITUATIONS"
          :key="s.id"
          type="button"
          class="situation"
          :aria-pressed="state.session.situation === s.id"
          @click="pickSituation(s.id)"
        >
          <span class="situation__label">{{ s.label }}</span>
          <span class="situation__hint">{{ s.hint }}</span>
        </button>
      </div>

      <label class="field" for="search-input">
        <span class="field__label">用文字搜尋（選填）</span>
        <input
          id="search-input"
          v-model.trim="state.session.query"
          class="input"
          type="search"
          inputmode="search"
          maxlength="100"
          placeholder="例如：租屋、助學金、輔具"
          aria-describedby="search-help"
        />
      </label>
      <p id="search-help" class="muted">可輸入多個詞，用空格分開。</p>
    </section>

    <div class="sticky-cta">
      <p class="sticky-cta__count" role="status" aria-live="polite">
        <template v-if="state.loading">資料載入中…</template>
        <template v-else>符合需求的資料 {{ candidates.length }} 筆</template>
      </p>
      <button
        type="button"
        class="btn btn--primary btn--block"
        :disabled="state.loading || candidates.length === 0 || !target"
        :aria-describedby="!target ? 'cta-why' : undefined"
        @click="startQuestions"
      >
        下一步：回答幾個問題
      </button>
      <p v-if="!target" id="cta-why" class="muted">請先選擇要幫誰找資源。</p>
      <p v-else-if="!state.loading && candidates.length === 0" class="muted">
        沒有符合的資料，請換個關鍵字或取消分類。這不代表沒有任何福利。
      </p>
    </div>
  </div>
</template>
