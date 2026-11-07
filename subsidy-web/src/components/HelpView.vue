<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { buildHelpText } from '../domain/export';
import { stuckAdvice, STUCK_OPTIONS, type StuckReason } from '../domain/route';
import { isInTownPass, call1999 } from '../townpass';
import { back, conditionLines, pickConditions, itemsById, planItems, state } from '../store';
import ShareBox from './ShareBox.vue';

const reason = ref<StuckReason | null>(null);
const itemId = ref<string>(state.helpContext.itemId ?? '');
const stepText = ref<string | undefined>(state.helpContext.stepText);
const included = ref<string[]>([]);
const inApp = isInTownPass();
const stage = ref<'reason' | 'resource' | 'advice' | 'export'>('reason');
const stageHeading = ref<HTMLElement | null>(null);
const stageHistory = ref<(typeof stage.value)[]>([]);
async function setStage(next: typeof stage.value) {
  if (next !== stage.value) stageHistory.value.push(stage.value);
  stage.value = next;
  await nextTick();
  stageHeading.value?.focus();
}
function chooseReason(value: StuckReason) {
  reason.value = value;
  included.value = [];
  setStage(itemId.value ? 'advice' : 'resource');
}
async function previous() {
  const prior = stageHistory.value.pop();
  if (!prior) { back(); return; }
  stage.value = prior;
  await nextTick();
  stageHeading.value?.focus();
}


watch(
  () => state.helpContext,
  (ctx) => {
    itemId.value = ctx.itemId ?? '';
    stepText.value = ctx.stepText;
    reason.value = null;
    included.value = [];
    stageHistory.value = [];
    stage.value = 'reason';
  },
);

const choices = computed(() => {
  const list = [...planItems.value];
  const ctx = state.helpContext.itemId ? itemsById.value.get(state.helpContext.itemId) : undefined;
  if (ctx && !list.some((i) => i.id === ctx.id)) list.unshift(ctx);
  return list;
});
const item = computed(() => (itemId.value ? itemsById.value.get(itemId.value) ?? null : null));
const advice = computed(() => (item.value && reason.value ? stuckAdvice(item.value, reason.value, stepText.value) : null));
const includedValid = computed(() => pickConditions(included.value));

const helpText = computed(() =>
  reason.value
    ? buildHelpText({
        meta: {
          catalogVersion: state.catalog?.version ?? '未載入',
          sourceLabel: state.catalog?.sourceLabel ?? '未載入',
          generatedAt: new Date(),
        },
        target: state.session.target ?? 'self',
        reason: reason.value,
        item: item.value,
        stepText: stepText.value,
        conditions: includedValid.value,
      })
    : '',
);

function confirmResource() {
  setStage('advice');
}
function changeResource() {
  setStage('resource');
}
function onItemChange() {
  stepText.value = undefined;
  included.value = [];
}
</script>

<template>
  <div class="view">
    <button type="button" class="btn btn--ghost" @click="previous">返回</button>
    <h1 id="view-title" class="view-title" tabindex="-1">找人幫忙</h1>
    <p class="muted">協助整理詢問文字，不會建立案件或轉介。</p>

    <section v-if="stage === 'reason'" class="card" aria-labelledby="help-reason-h">
      <h2 id="help-reason-h" ref="stageHeading" tabindex="-1" class="section-title">遇到什麼問題？</h2>
      <p v-if="item" class="muted">{{ item.name }}</p>
      <div class="option-list" role="group" aria-labelledby="help-reason-h">
        <button v-for="o in STUCK_OPTIONS" :key="o.id" type="button" class="btn btn--option" @click="chooseReason(o.id)">{{ o.label }}</button>
      </div>
    </section>

    <section v-else-if="stage === 'resource'" class="card" aria-labelledby="help-item-h">
      <h2 id="help-item-h" ref="stageHeading" tabindex="-1" class="section-title">想詢問哪一項資源？</h2>
      <label class="field" for="help-item">
        <span class="field__label">選擇資源</span>
        <select id="help-item" v-model="itemId" class="input" @change="onItemChange">
          <option value="">還沒有特定資源，一般詢問</option>
          <option v-for="i in choices" :key="i.id" :value="i.id">{{ i.name }}</option>
        </select>
      </label>
      <button type="button" class="btn btn--primary btn--block" @click="confirmResource">看下一步</button>
    </section>

    <template v-else-if="stage === 'advice'">
      <section class="card" aria-labelledby="advice-h">
        <h2 id="advice-h" ref="stageHeading" tabindex="-1" class="section-title">接下來可以這樣做</h2>
        <p>{{ item?.name ?? '一般詢問' }}</p>
        <p v-if="stepText" class="muted">卡住的步驟：{{ stepText }}</p>
        <template v-if="advice">
          <p>{{ advice.found[0] ?? advice.notFound[0] }}</p>
          <p class="muted">可向資料列出的窗口詢問，實際辦法以機關答覆為準。</p>
          <details>
            <summary>查看資料列出的完整方法與缺口</summary>
            <ul v-if="advice.found.length"><li v-for="f in advice.found" :key="f">{{ f }}</li></ul>
            <p v-for="n in advice.notFound" :key="n" class="warn">{{ n }}</p>
          </details>
        </template>
        <p v-else>可先向一般市政諮詢說明遇到的問題，確認應詢問的窗口。</p>
        <button type="button" class="btn btn--primary btn--block" @click="setStage('export')">產生詢問文字</button>
        <button type="button" class="btn btn--ghost btn--block" @click="changeResource">更換詢問資源</button>
      </section>
      <details class="card">
        <summary>一般市政諮詢：1999</summary>
        <p>臺北市民當家熱線 1999 可詢問市政問題；不是該補助的受理窗口，也不代表已轉介。</p>
        <button v-if="inApp" type="button" class="btn btn--block" @click="call1999()">撥打 1999（需先同意條款）</button>
        <a v-else class="btn btn--block" href="tel:1999">撥打 1999</a>
      </details>
    </template>

    <section v-else aria-labelledby="help-export-h">
      <h2 id="help-export-h" ref="stageHeading" tabindex="-1" class="sr-only">確認詢問文字</h2>
      <ShareBox v-model:included="included" title="求助詢問文字" :body="helpText" filename="求助詢問文字.txt" :conditions="conditionLines" />
    </section>
  </div>
</template>
