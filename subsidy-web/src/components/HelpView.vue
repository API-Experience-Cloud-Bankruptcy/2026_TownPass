<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { buildHelpText } from '../domain/export';
import { stuckAdvice, STUCK_OPTIONS, type StuckReason } from '../domain/route';
import { isInTownPass, call1999 } from '../townpass';
import { conditionLines, pickConditions, itemsById, planItems, state } from '../store';
import ShareBox from './ShareBox.vue';

const reason = ref<StuckReason | null>(null);
const itemId = ref<string>(state.helpContext.itemId ?? '');
const stepText = ref<string | undefined>(state.helpContext.stepText);
const included = ref<string[]>([]);
const inApp = isInTownPass();

watch(
  () => state.helpContext,
  (ctx) => {
    itemId.value = ctx.itemId ?? '';
    stepText.value = ctx.stepText;
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

function onItemChange() {
  stepText.value = undefined;
}
</script>

<template>
  <div class="view">
    <h1 id="view-title" class="view-title" tabindex="-1">找人幫忙</h1>
    <p class="muted">不必完成問答也能使用。這裡只產生詢問文字與資料列出的聯絡資訊，不會替你建立案件或轉介。</p>

    <section class="card" aria-labelledby="help-item-h">
      <h2 id="help-item-h" class="section-title">哪一項資源？</h2>
      <label class="field" for="help-item">
        <span class="field__label">選擇資源（選填）</span>
        <select id="help-item" v-model="itemId" class="input" @change="onItemChange">
          <option value="">還沒有特定資源</option>
          <option v-for="i in choices" :key="i.id" :value="i.id">{{ i.name }}</option>
        </select>
      </label>
      <p v-if="stepText" class="muted">卡住的步驟：{{ stepText }}</p>
    </section>

    <section class="card" aria-labelledby="help-reason-h">
      <h2 id="help-reason-h" class="section-title">這一步有哪裡做不到？</h2>
      <div class="option-list" role="group" aria-labelledby="help-reason-h">
        <button
          v-for="o in STUCK_OPTIONS"
          :key="o.id"
          type="button"
          class="btn btn--option"
          :aria-pressed="reason === o.id"
          @click="reason = o.id"
        >
          {{ o.label }}
        </button>
      </div>
    </section>

    <section v-if="advice" class="card" aria-labelledby="advice-h" aria-live="polite">
      <h2 id="advice-h" class="section-title">資料裡可以找到的方法</h2>
      <ul v-if="advice.found.length"><li v-for="f in advice.found" :key="f">{{ f }}</li></ul>
      <p v-for="n in advice.notFound" :key="n" class="warn">{{ n }}</p>
    </section>

    <section class="card" aria-labelledby="hotline-h">
      <h2 id="hotline-h" class="section-title">一般市政諮詢</h2>
      <p>臺北市民當家熱線 1999 可詢問市政問題；這不是該補助的受理窗口，也不代表已轉介。</p>
      <button v-if="inApp" type="button" class="btn btn--block" @click="call1999()">撥打 1999（會先請你同意條款）</button>
      <a v-else class="btn btn--block" href="tel:1999">撥打 1999</a>
    </section>

    <ShareBox
      v-if="reason"
      v-model:included="included"
      title="求助詢問文字"
      :body="helpText"
      filename="求助詢問文字.txt"
      :conditions="conditionLines"
    />
    <p v-else class="muted">選一個問題後，會產生可以照著唸或傳給別人的詢問文字。</p>
  </div>
</template>
