<script setup lang="ts">
import { computed, reactive } from 'vue';
import type { Subsidy } from '../domain/types';
import { distinctGroups, rangeLine } from '../presentation';
import {
  canRefine,
  closedCandidates,
  continueQuestions,
  go,
  otherCandidates,
  planItems,
  questionInsight,
  recommendedCandidates,
  results,
  sortedCandidates,
  startExplore,
  startQuestions,
  state,
  tab,
  uncertainCandidates,
} from '../store';
import ResultCard from './ResultCard.vue';

const PAGE = 10;
const shown = reactive<Record<string, number>>({ general: PAGE, uncertain: PAGE, closed: PAGE, ineligible: PAGE });
const notIneligible = (i: Subsidy) => results.value.get(i.id)?.fit !== 'ineligible';

// 分組以 store 為準；畫面只負責不重複（先出現的組優先）與把明確不符的項目移到最後一組。
const groups = computed(() => {
  const [recommended, closed, uncertain, general] = distinctGroups([
    recommendedCandidates.value.filter(notIneligible),
    closedCandidates.value.filter(notIneligible),
    uncertainCandidates.value.filter(notIneligible),
    otherCandidates.value.filter(notIneligible),
  ]);
  return { recommended, closed, uncertain, general };
});
const ineligible = computed(() => sortedCandidates.value.filter((i) => !notIneligible(i)));
const sections = computed(() => [
  { key: 'general', title: '其他相關資源', note: '沒有列在上面，但可能和你的情況有關，不代表不能申請。', list: groups.value.general },
  { key: 'uncertain', title: '受理時間需確認', note: '資料沒有寫清楚現在是否受理，請看原文或問承辦窗口。', list: groups.value.uncertain },
  { key: 'closed', title: '目前已截止', note: '依資料原文的受理情形或期限；之後可能再開放，請看官方公告。', list: groups.value.closed },
].filter((s) => s.list.length));

const answered = computed(() => questionInsight.value?.answeredCount ?? 0);
const range = computed(() => rangeLine(questionInsight.value));
const recommended = computed(() => groups.value.recommended);
const nothing = computed(() => recommended.value.length === 0 && sections.value.length === 0);
const exploring = computed(() => !state.session.situation && !state.session.query);
</script>

<template>
  <div class="view">
    <div class="view-head">
      <h1 id="view-title" class="view-title" tabindex="-1">
        {{ recommended.length ? '先從這幾項了解' : nothing ? '目前沒有找到' : '可以看看這些資源' }}
      </h1>
      <p class="lead">相關不等於符合資格，能不能領由承辦機關審核。</p>
      <p v-if="range && answered" class="muted">{{ range }}</p>
      <p v-if="answered === 0 && !nothing" class="note">還沒有回答問題，下面依需求列出資料，不是依你的情況挑選。</p>
    </div>

    <ul v-if="recommended.length" class="rows" aria-label="先從這幾項了解">
      <li v-for="item in recommended" :key="item.id">
        <ResultCard :item="item" :result="results.get(item.id)" />
      </li>
    </ul>

    <p v-if="nothing">這次沒有找到，不代表沒有可以申請的福利。可以換個需求、改答案，或找人幫忙。</p>

    <section class="actions" aria-labelledby="next-move-h">
      <h2 id="next-move-h" class="sr-only">接下來</h2>
      <button v-if="canRefine" type="button" class="btn btn--primary btn--block" @click="continueQuestions">
        {{ answered ? '再回答幾題，繼續縮小' : '回答幾題，縮小範圍' }}
      </button>
      <p v-if="!nothing" class="muted">目前仍有條件需要確認，請在每一項的詳情看原文。</p>
      <div class="inline-actions">
        <button v-if="answered" type="button" class="btn btn--text" @click="startQuestions">改答案</button>
        <button type="button" class="btn btn--text" @click="go('needs')">換需求</button>
        <button v-if="!exploring && state.session.target" type="button" class="btn btn--text" @click="startExplore">還不確定，帶我找</button>
        <button type="button" class="btn btn--text" @click="tab('help')">找人幫忙</button>
      </div>
    </section>

    <div class="more-group">
      <details v-for="s in sections" :key="s.key" class="more">
        <summary>{{ s.title }}（{{ s.list.length }}）</summary>
        <div class="more__body">
          <p class="muted">{{ s.note }}</p>
          <ul class="rows" :aria-label="s.title">
            <li v-for="item in s.list.slice(0, shown[s.key])" :key="item.id">
              <ResultCard :item="item" :result="results.get(item.id)" />
            </li>
          </ul>
          <button v-if="shown[s.key] < s.list.length" type="button" class="btn btn--block" @click="shown[s.key] += PAGE">
            再看 {{ Math.min(PAGE, s.list.length - shown[s.key]) }} 項<span class="sr-only">：{{ s.title }}</span>
          </button>
        </div>
      </details>

      <details v-if="ineligible.length" class="more" :open="state.showIneligible" @toggle="state.showIneligible = ($event.target as HTMLDetailsElement).open">
        <summary>依填寫的條件不符（{{ ineligible.length }}）</summary>
        <div class="more__body">
          <p class="muted">只依你填的答案判斷；填錯或情況改變，可以改答案再看。</p>
          <ul class="rows" aria-label="依填寫的條件不符">
            <li v-for="item in ineligible.slice(0, shown.ineligible)" :key="item.id">
              <ResultCard :item="item" :result="results.get(item.id)" />
            </li>
          </ul>
          <button v-if="shown.ineligible < ineligible.length" type="button" class="btn btn--block" @click="shown.ineligible += PAGE">
            再看 {{ Math.min(PAGE, ineligible.length - shown.ineligible) }} 項<span class="sr-only">：依填寫的條件不符</span>
          </button>
        </div>
      </details>
    </div>

    <button v-if="planItems.length" type="button" class="btn btn--block" @click="tab('plan')">
      看行動單（{{ planItems.length }} 項）
    </button>
  </div>
</template>
