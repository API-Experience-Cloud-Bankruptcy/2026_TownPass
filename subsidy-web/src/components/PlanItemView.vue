<script setup lang="ts">
// 單張行動單：主要是一步一步做，完成到哪一步存在本人行動單；補助內容另開詳情。
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { prefersReducedMotion } from '../chat/typing';
import { mergeDocuments, OTHER_REGION_TITLE, regionText } from '../domain/documents';
import { buildPlanText } from '../domain/export';
import { PLAN_STATUS_LABEL, planProgress } from '../domain/plan-progress';
import { buildRoute } from '../domain/route';
import { applicationStatusAlert, benefitLabel, progressText, sourceExcerpt } from '../presentation';
import {
  itemsById, openDetail, openHelp, planConditions, planItems, planResults,
  removeFromPlan, resetSteps, state, toggleDoc, toggleStep,
} from '../store';
import ConfirmDialog from './ConfirmDialog.vue';
import ExternalLink from './ExternalLink.vue';
import LinkedText from './LinkedText.vue';
import Expand from './motion/Expand.vue';
import PlanExport from './PlanExport.vue';

const FormFillPanel = defineAsyncComponent(() => import('./FormFillPanel.vue'));

const item = computed(() => (state.planItemId && state.personalPlan.planIds.includes(state.planItemId) ? itemsById.value.get(state.planItemId) : undefined));
const answers = computed(() => state.personalPlan.answers);
const route = computed(() => (item.value ? buildRoute(item.value, answers.value) : null));
const progress = computed(() => item.value
  ? planProgress(item.value, answers.value, state.personalPlan.stepDone, state.personalPlan.docChecks)
  : null);
const percent = computed(() => (progress.value?.total ? Math.round((progress.value.doneCount / progress.value.total) * 100) : 0));
const statusAlert = computed(() => applicationStatusAlert(route.value?.applicationStatus ?? ''));

// 文件以全部行動單合併，才知道同一份文件還用在哪幾張。
const merged = computed(() => mergeDocuments(planItems.value, answers.value));
const ownDocs = computed(() => merged.value.documents.filter((d) => d.usedBy.some((u) => u.id === item.value?.id)));
const ownOtherRegion = computed(() => merged.value.otherRegion.filter((d) => d.usedBy.some((u) => u.id === item.value?.id)));
const docsMissing = computed(() => merged.value.incomplete.some((m) => m.id === item.value?.id));
function alsoUsedIn(usedBy: { id: string; name: string }[]): string {
  return usedBy.filter((u) => u.id !== item.value?.id).map((u) => u.name).join('、');
}

// 完成一步後，焦點移到下一步，並朗讀結果。
const announce = ref('');
const stepRefs = ref<HTMLElement[]>([]);
const popIndex = ref(-1);
let popFrame = 0;
function markPop(index: number) {
  popIndex.value = -1;
  cancelAnimationFrame(popFrame);
  popFrame = requestAnimationFrame(() => { popIndex.value = index; });
}
const stepBump = ref(false);
const docBump = ref(false);
const docPop = ref('');
function pulse(flag: { value: boolean }) {
  flag.value = false;
  requestAnimationFrame(() => { flag.value = true; });
}
watch(() => progress.value?.doneCount, (next, prev) => {
  if (prev === undefined || next === prev) return;
  pulse(stepBump);
});
watch(() => progress.value?.docsDone, (next, prev) => {
  if (prev === undefined || next === prev) return;
  pulse(docBump);
});
async function complete(index: number) {
  if (!item.value || !progress.value) return;
  const wasDone = progress.value.done.has(index);
  if (!wasDone) markPop(index);
  toggleStep(item.value.id, index);
  await nextTick();
  const p = progress.value;
  if (wasDone) announce.value = `第 ${index + 1} 步改回未完成`;
  else if (p.current === -1) announce.value = `第 ${index + 1} 步完成，步驟都完成了`;
  else announce.value = `第 ${index + 1} 步完成，下一步是第 ${p.current + 1} 步`;
  if (!wasDone && p.current >= 0) {
    const el = stepRefs.value[p.current];
    el?.focus({ preventScroll: true });
    el?.closest('.task-step')?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'nearest' });
  }
}
function onDoc(key: string) {
  toggleDoc(key);
  docPop.value = '';
  requestAnimationFrame(() => { docPop.value = key; });
}
function clearDocPop(event: AnimationEvent, key: string) {
  if ((event.target as HTMLElement).tagName !== 'INPUT' || docPop.value !== key) return;
  docPop.value = '';
}
function restart() {
  if (!item.value) return;
  resetSteps(item.value.id);
  announce.value = '步驟已全部改回未完成';
}

const confirmRemove = ref(false);
const leaving = ref(false);
let leaveTimer = 0;
function remove() {
  confirmRemove.value = false;
  const id = item.value?.id;
  if (!id) return;
  if (prefersReducedMotion()) { removeFromPlan(id); return; }
  leaving.value = true;
  window.clearTimeout(leaveTimer);
  leaveTimer = window.setTimeout(() => { if (leaving.value) removeFromPlan(id); }, 180);
}
function onLeave(event: AnimationEvent) {
  if (event.target !== event.currentTarget || !leaving.value || !item.value) return;
  window.clearTimeout(leaveTimer);
  removeFromPlan(item.value.id);
}
onBeforeUnmount(() => { window.clearTimeout(leaveTimer); cancelAnimationFrame(popFrame); });

const formOpen = ref(false);
const exportOpen = ref(false);
const included = ref<string[]>([]);
const planText = computed(() => item.value ? buildPlanText({
  meta: {
    catalogVersion: state.catalog?.version ?? '未載入',
    sourceLabel: state.catalog?.sourceLabel ?? '未載入',
    generatedAt: new Date(),
  },
  target: 'self',
  items: [item.value],
  results: planResults.value,
  conditions: planConditions.value.filter((c) => included.value.includes(c.line)),
  docChecks: state.personalPlan.docChecks,
  stepDone: state.personalPlan.stepDone,
  documentAnswers: answers.value,
}) : '');
</script>

<template>
  <div v-if="item && route && progress" class="view" :class="{ 'task-leave': leaving }" @animationend="onLeave">
    <div class="card card--hero task-head">
      <p class="task-head__badge" :class="`task-head__badge--${progress.status}`">{{ PLAN_STATUS_LABEL[progress.status] }}</p>
      <h1 id="view-title" class="view-title" tabindex="-1">{{ item.name }}</h1>
      <p v-if="benefitLabel(item)" class="lead">{{ benefitLabel(item) }}</p>
      <template v-if="progress.total">
        <span
          class="progress progress--lg"
          role="progressbar"
          aria-label="步驟進度"
          :aria-valuenow="progress.doneCount"
          aria-valuemin="0"
          :aria-valuemax="progress.total"
          :aria-valuetext="progressText(progress.doneCount, progress.total)"
        ><span class="progress__bar" :style="{ width: `${percent}%` }" /></span>
        <p class="muted">
          <template v-if="progress.doneCount >= progress.total"><span class="num" :class="{ bump: stepBump }">{{ progress.total }}</span> 步都準備好了</template>
          <template v-else>已準備 <span class="num" :class="{ bump: stepBump }">{{ progress.doneCount }}</span>／{{ progress.total }} 步</template>
        </p>
      </template>
      <p v-if="route.deadline" class="alert">期限：{{ route.deadline }}</p>
      <p v-if="statusAlert" class="alert">{{ statusAlert }}</p>
      <button type="button" class="btn btn--block task-head__detail" @click="openDetail(item.id)">
        看補助詳細內容<span class="task-head__chev" aria-hidden="true">›</span>
      </button>
    </div>

    <p class="sr-only" role="status" aria-live="polite">{{ announce }}</p>

    <section class="card" aria-labelledby="task-steps-h">
      <h2 id="task-steps-h" class="section-title">辦理步驟</h2>

      <template v-if="progress.total">
        <ol class="task-steps">
          <li
            v-for="(step, i) in progress.steps"
            :key="i"
            class="task-step"
            :class="{ 'is-done': progress.done.has(i), 'is-current': i === progress.current }"
          >
            <button
              type="button"
              class="task-step__mark"
              :aria-pressed="progress.done.has(i)"
              @click="complete(i)"
            >
              <span class="task-step__glyph" :class="{ 'is-pop': popIndex === i }" aria-hidden="true">{{ progress.done.has(i) ? '✓' : i + 1 }}</span>
              <span class="sr-only">第 {{ i + 1 }} 步{{ progress.done.has(i) ? '已完成，按一下改回未完成' : '，標記為完成' }}</span>
            </button>
            <div class="task-step__body">
              <p :ref="(el) => { if (el) stepRefs[i] = el as HTMLElement }" class="task-step__text" tabindex="-1">
                <span class="task-step__line">
                  <span v-if="i === progress.current" class="task-step__now">現在做這步</span>
                  {{ sourceExcerpt(step) }}
                </span>
              </p>
              <details v-if="sourceExcerpt(step) !== step" class="more more--inline">
                <summary>看完整原文</summary>
                <div class="more__body"><p><LinkedText :text="step" /></p></div>
              </details>
              <Expand>
                <div v-if="i === progress.current" class="task-step__actions">
                  <button type="button" class="btn btn--primary btn--block" @click="complete(i)">這步完成了</button>
                  <button type="button" class="btn btn--text" @click="openHelp(item.id, step)">這一步做不到</button>
                </div>
              </Expand>
            </div>
          </li>
        </ol>
        <p v-if="!route.splitFromArrow" class="muted">原文沒有分步，這裡將整段列為一步。</p>

        <Transition name="rise">
          <div v-if="progress.status === 'done'" class="task-done">
            <p class="task-done__title">步驟都完成了</p>
            <p>請照官方方式送件，並留下收件證明。這裡的勾選不代表已受理。</p>
            <button type="button" class="btn btn--text" @click="restart">全部改回未完成</button>
          </div>
        </Transition>
        <p v-if="progress.status !== 'done'" class="muted">點左邊圓圈可以勾選或取消；勾選只記錄你的準備，不會送件。</p>
      </template>

      <template v-else>
        <p>原文沒有列出辦理步驟，請先問承辦窗口。</p>
        <button type="button" class="btn btn--block" @click="openHelp(item.id)">不知道怎麼問</button>
      </template>
    </section>

    <section class="card task-docs" aria-labelledby="task-docs-h">
      <h2 id="task-docs-h" class="section-title">要帶的文件</h2>
      <p v-if="ownDocs.length" class="muted">已準備 <span class="num" :class="{ bump: docBump }">{{ progress.docsDone }}</span>／{{ progress.docsTotal }}</p>
      <p v-else-if="docsMissing">原文沒有列出文件，不代表不用帶，請先問承辦窗口。</p>
      <p v-else>目前沒有可直接列為準備項目的文件，請向承辦窗口確認。</p>
      <ul v-if="ownDocs.length" class="rows">
        <li v-for="d in ownDocs" :key="d.key">
          <label class="check" :class="{ 'is-pop': docPop === d.key }" @animationend="clearDocPop($event, d.key)">
            <input type="checkbox" :checked="!!state.personalPlan.docChecks[d.key]" @change="onDoc(d.key)" />
            <span class="check__body">
              <span>{{ d.name }}<span v-if="d.required === false" class="muted">（非必要）</span></span>
              <span v-if="d.hasVariant" class="muted">同名但要求不同，請分開準備</span>
              <span v-if="d.condition" class="muted">條件：{{ d.condition }}</span>
              <span v-if="d.notes && d.notes !== d.name" class="muted">備註：{{ d.notes }}</span>
              <span v-if="alsoUsedIn(d.usedBy)" class="muted">也用在：{{ alsoUsedIn(d.usedBy) }}</span>
            </span>
          </label>
        </li>
      </ul>
      <details v-if="ownOtherRegion.length" class="more">
        <summary>{{ OTHER_REGION_TITLE }}（{{ ownOtherRegion.length }}）</summary>
        <ul class="rows">
          <li v-for="d in ownOtherRegion" :key="d.key">
            <label class="check" :class="{ 'is-pop': docPop === d.key }" @animationend="clearDocPop($event, d.key)">
              <input type="checkbox" :checked="!!state.personalPlan.docChecks[d.key]" @change="onDoc(d.key)" />
              <span class="check__body">
                <span>{{ d.name }}<span v-if="d.required === false" class="muted">（非必要）</span></span>
                <span class="muted">{{ regionText(d.regions) }}</span>
                <span v-if="d.condition" class="muted">條件：{{ d.condition }}</span>
                <span v-if="d.notes && d.notes !== d.name" class="muted">備註：{{ d.notes }}</span>
              </span>
            </label>
          </li>
        </ul>
      </details>
      <p v-for="notice in route.notices" :key="notice" class="muted">{{ notice }}</p>
    </section>

    <section v-if="route.channel || route.agency || route.methods.length || route.links.length" class="card" aria-labelledby="task-where-h">
      <h2 id="task-where-h" class="section-title">去哪裡辦</h2>
      <dl class="facts">
        <div v-if="route.channel"><dt>受理窗口</dt><dd><LinkedText :text="route.channel" /></dd></div>
        <div v-if="route.agency"><dt>主管或承辦單位</dt><dd>{{ route.agency }}</dd></div>
        <div v-if="route.methods.length"><dt>辦理方式</dt><dd>{{ route.methods.join('、') }}</dd></div>
      </dl>
      <ul v-if="route.links.length" class="link-list">
        <li v-for="l in route.links" :key="l.kind"><ExternalLink :url="l.url" :label="l.label" /></li>
      </ul>
    </section>

    <div class="more-group card card--list">
      <details class="more" :open="formOpen" @toggle="formOpen = ($event.target as HTMLDetailsElement).open">
        <summary>申請表與填寫</summary>
        <div class="more__body">
          <FormFillPanel v-if="formOpen" :key="item.id" :item="item" target="self" />
        </div>
      </details>
      <details class="more" :open="exportOpen" @toggle="exportOpen = ($event.target as HTMLDetailsElement).open">
        <summary>下載這張行動單 PDF</summary>
        <div v-if="exportOpen" class="more__body">
          <PlanExport :items="[item]" :preview="false" />
        </div>
      </details>
    </div>

    <button type="button" class="btn btn--text task-remove" @click="confirmRemove = true">
      移除這張行動單<span class="sr-only">：{{ item.name }}</span>
    </button>
    <pre class="print-sheet" aria-hidden="true">{{ planText }}</pre>

    <ConfirmDialog
      :open="confirmRemove"
      title="移除這張行動單？"
      confirm-label="移除"
      danger
      @confirm="remove"
      @cancel="confirmRemove = false"
    >
      <p>「{{ item.name }}」的步驟進度，以及只用在這張的文件勾選，會一起清除。</p>
    </ConfirmDialog>
  </div>
  <div v-else class="view">
    <div class="card">
      <h1 id="view-title" class="view-title" tabindex="-1">找不到這張行動單</h1>
      <p>可能已移除，或資料更新後不再提供。</p>
    </div>
  </div>
</template>
