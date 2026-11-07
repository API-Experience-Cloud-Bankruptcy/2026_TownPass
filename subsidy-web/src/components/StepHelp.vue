<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue';
import { buildStepHelp, type StepProblem } from '../domain/step-help';
import { regionText } from '../domain/documents';
import { SOURCE_KIND_LABEL } from '../domain/route';
import type { Subsidy } from '../domain/types';
import LinkedText from './LinkedText.vue';
import ExternalLink from './ExternalLink.vue';

const props = defineProps<{ item: Subsidy; step: string }>();
const help = computed(() => buildStepHelp(props.item, props.step));
const open = ref(false);
const selected = ref<StepProblem | null>(null);
const id = useId();
const trigger = ref<HTMLButtonElement>();
const heading = ref<HTMLElement>();
const adviceHeading = ref<HTMLElement>();
watch(() => [props.item, props.step], () => { open.value = false; selected.value = null; });
async function toggle() {
  open.value = !open.value;
  if (open.value) { await nextTick(); heading.value?.focus(); }
}
async function choose(problem: StepProblem) {
  selected.value = problem;
  await nextTick();
  adviceHeading.value?.focus();
}
async function close() {
  open.value = false;
  await nextTick();
  trigger.value?.focus();
}
</script>

<template>
  <div v-if="help" class="step-help">
    <button ref="trigger" type="button" class="btn btn--block" :aria-expanded="open" :aria-controls="id" @click="toggle">這一步做不到</button>
    <section v-if="open" :id="id" class="card step-help__panel" :aria-labelledby="`${id}-title`" @keydown.esc.stop="close">
      <h3 :id="`${id}-title`" ref="heading" tabindex="-1">這一步卡在哪裡？</h3>
      <p class="muted">{{ help.name }}・第 {{ help.stepNumber }} 步</p>
      <p><LinkedText :text="help.step" /></p>
      <p class="muted">以下是可能遇到的問題，請選擇符合你情況的一項。</p>
      <div class="actions">
        <button v-for="problem in help.suggested" :key="problem.id" type="button" class="btn btn--block" :aria-pressed="selected?.id === problem.id" @click="choose(problem)">{{ problem.label }}</button>
      </div>
      <details class="more">
        <summary>其他問題</summary>
        <div class="more__body actions">
          <button v-for="problem in help.others" :key="problem.id" type="button" class="btn btn--block" :aria-pressed="selected?.id === problem.id" @click="choose(problem)">{{ problem.label }}</button>
        </div>
      </details>
      <div v-if="selected" class="actions">
        <h4 ref="adviceHeading" tabindex="-1">{{ selected.label }}：可以先這樣做</h4>
        <p>{{ selected.action }}</p>
        <p class="muted">這是處理建議；替代方式是否適用於這一步，仍需由受理窗口確認。</p>
        <details class="more">
          <summary>查看這個方案的相關資料</summary>
          <div class="more__body actions">
            <p v-if="help.process"><strong>完整流程：</strong><LinkedText :text="help.process" /></p>
            <p v-if="help.eligibility"><strong>適用對象：</strong><LinkedText :text="help.eligibility" /></p>
            <p v-if="help.route.methods.length">方案列出的辦理方式：{{ help.route.methods.join('、') }}。不代表每一步均可使用。</p>
            <ul v-if="help.route.documents.length || help.route.pendingDocuments.length || help.route.otherDocuments.length">
              <li v-for="(doc, index) in [...help.route.documents, ...help.route.pendingDocuments, ...help.route.otherDocuments]" :key="index">
                <LinkedText :text="[doc.name, doc.condition, doc.notes, regionText(doc.regions), doc.region_evidence].filter(Boolean).join('；')" />{{ doc.required === false ? '（非必要）' : '' }}
              </li>
            </ul>
            <p class="muted">文件為方案資料，請核對條件及地區；不代表每一步都需要全部文件。</p>
            <p v-for="notice in help.route.notices" :key="notice">{{ notice }}</p>
            <p v-if="help.route.deadline">期限：{{ help.route.deadline }}</p>
            <p v-if="help.route.applicationStatus">受理情形：{{ help.route.applicationStatus }}</p>
            <p v-for="missing in help.route.missing" :key="missing" class="muted">{{ missing }}</p>
          </div>
        </details>
        <p><strong>可以這樣問：</strong>{{ help.askText(selected) }}</p>
        <p v-if="help.route.channel || help.route.agency"><strong>受理窗口：</strong><LinkedText :text="help.route.channel || help.route.agency" /></p>
        <p v-else class="muted">資料未提供窗口，請從方案來源確認聯絡方式。</p>
        <div v-for="link in help.route.links" :key="link.url"><ExternalLink :url="link.url" :label="`${link.label}（${SOURCE_KIND_LABEL[link.sourceKind]}）`" /></div>
        <details class="more">
          <summary>資料來源與查核日期</summary>
          <div class="more__body actions">
            <p>資料查核日期：{{ help.route.checkedDate || '未提供' }}；目前受理情形請以官方公告為準。</p>
            <div v-for="source in help.route.sources" :key="source.url">
              <ExternalLink :url="source.url" :label="source.role || '資料來源'" />
              <p class="muted">{{ source.type || '來源類型未標示' }}・{{ source.checkedDate || '查核日期未提供' }}</p>
            </div>
            <p v-if="!help.route.sources.length" class="muted">沒有可開啟的來源網址。</p>
          </div>
        </details>
      </div>
      <button type="button" class="btn btn--text" @click="close">收起，回到這一步</button>
    </section>
  </div>
</template>

<style scoped>
.step-help { min-width: 0; }
.step-help__panel { margin-top: 12px; display: grid; gap: 16px; overflow-wrap: anywhere; }
.step-help__panel .btn { white-space: normal; min-height: 48px; }
.step-help__panel [aria-pressed="true"] { border-color: var(--accent); color: var(--accent); }
</style>
