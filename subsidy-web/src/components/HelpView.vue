<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { buildHelpText } from '../domain/export';
import { stuckAdvice, STUCK_OPTIONS, type StuckReason } from '../domain/route';
import { isInTownPass, call1999 } from '../townpass';
import { back, helpConditions, itemsById, planItems, state } from '../store';
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
  const list = state.helpContext.target === 'other' ? [] : [...planItems.value];
  const ctx = state.helpContext.itemId ? itemsById.value.get(state.helpContext.itemId) : undefined;
  if (ctx && !list.some((i) => i.id === ctx.id)) list.unshift(ctx);
  return list;
});
const item = computed(() => (itemId.value ? itemsById.value.get(itemId.value) ?? null : null));
const advice = computed(() => (item.value && reason.value ? stuckAdvice(item.value, reason.value, stepText.value, state.helpContext.target ?? 'self') : null));
const conditionLines = computed(() => helpConditions.value.map(c => c.line));
const includedValid = computed(() => helpConditions.value.filter(c => included.value.includes(c.line)));

const helpText = computed(() =>
  reason.value
    ? buildHelpText({
        meta: {
          catalogVersion: state.catalog?.version ?? '未載入',
          sourceLabel: state.catalog?.sourceLabel ?? '未載入',
          generatedAt: new Date(),
        },
        target: state.helpContext.target ?? 'self',
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
    <div class="view-head">
      <div class="topbar">
        <button type="button" class="btn btn--text" @click="previous"><span aria-hidden="true">‹</span> 返回</button>
      </div>
      <h1 id="view-title" class="view-title" tabindex="-1">找人幫忙</h1>
      <p class="muted">幫你整理要問的話，不會替你建立案件或轉介。</p>
    </div>

    <section v-if="stage === 'reason'" class="actions" aria-labelledby="help-reason-h">
      <h2 id="help-reason-h" ref="stageHeading" tabindex="-1" class="stage-title">卡在哪裡？</h2>
      <p v-if="item" class="muted">{{ item.name }}<template v-if="stepText">・{{ stepText }}</template></p>
      <ul class="rows">
        <li v-for="o in STUCK_OPTIONS" :key="o.id">
          <button type="button" class="row" @click="chooseReason(o.id)">
            <span class="row__main"><span class="row__title">{{ o.label }}</span></span>
            <span class="row__chev" aria-hidden="true">›</span>
          </button>
        </li>
      </ul>
    </section>

    <section v-else-if="stage === 'resource'" class="actions" aria-labelledby="help-item-h">
      <h2 id="help-item-h" ref="stageHeading" tabindex="-1" class="stage-title">要問哪一項？</h2>
      <label class="field" for="help-item">
        <span class="field__label">項目</span>
        <select id="help-item" v-model="itemId" class="input" @change="onItemChange">
          <option value="">還沒有特定項目</option>
          <option v-for="i in choices" :key="i.id" :value="i.id">{{ i.name }}</option>
        </select>
      </label>
      <button type="button" class="btn btn--primary btn--block" @click="confirmResource">下一步</button>
    </section>

    <section v-else-if="stage === 'advice'" class="actions" aria-labelledby="advice-h">
      <h2 id="advice-h" ref="stageHeading" tabindex="-1" class="stage-title">可以這樣做</h2>
      <p class="muted">{{ item?.name ?? '一般詢問' }}<template v-if="stepText">・{{ stepText }}</template></p>
      <template v-if="advice">
        <p class="next__text">{{ advice.found[0] ?? advice.notFound[0] }}</p>
        <p class="muted">實際辦法以承辦機關答覆為準。</p>
      </template>
      <p v-else class="next__text">可以先打 1999，說明{{ state.helpContext.target === 'other' ? '對方' : '你' }}的狀況，問問該找哪個窗口。</p>
      <button type="button" class="btn btn--primary btn--block" @click="setStage('export')">整理要問的話</button>
      <div class="more-group">
        <details v-if="advice" class="more">
          <summary>資料裡的其他方法</summary>
          <div class="more__body">
            <ul v-if="advice.found.length"><li v-for="f in advice.found" :key="f">{{ f }}</li></ul>
            <p v-for="n in advice.notFound" :key="n">{{ n }}</p>
          </div>
        </details>
        <details class="more">
          <summary>市政諮詢 1999</summary>
          <div class="more__body">
            <p>臺北市民當家熱線，可以詢問市政問題。它不是這項補助的受理窗口，也不代表已轉介。</p>
            <button v-if="inApp" type="button" class="btn btn--block" @click="call1999()">撥打 1999（會先請你同意條款）</button>
            <a v-else class="btn btn--block" href="tel:1999">撥打 1999</a>
          </div>
        </details>
      </div>
      <button type="button" class="btn btn--text" @click="changeResource">換一個項目</button>
    </section>

    <section v-else class="actions" aria-labelledby="help-export-h">
      <h2 id="help-export-h" ref="stageHeading" tabindex="-1" class="sr-only">要問的話</h2>
      <ShareBox v-model:included="included" title="要問的話" :body="helpText" filename="求助詢問文字.txt" :conditions="conditionLines" />
    </section>
  </div>
</template>
