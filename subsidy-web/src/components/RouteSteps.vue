<script setup lang="ts">
import { computed } from 'vue';
import { buildRoute, SOURCE_KIND_LABEL } from '../domain/route';
import type { Subsidy } from '../domain/types';
import { currentStepIndex, progressText } from '../presentation';
import { openHelp, state, toggleStep } from '../store';
import ExternalLink from './ExternalLink.vue';

/** hideDeadline：詳情頁已在「要先注意」列出期限時不重複。 */
const props = defineProps<{ item: Subsidy; hideDeadline?: boolean }>();
const route = computed(() => buildRoute(props.item));
const done = computed(() => new Set(state.session.stepDone[props.item.id] ?? []));
const total = computed(() => route.value.steps.length);
const current = computed(() => currentStepIndex(total.value, done.value));
const doneCount = computed(() => route.value.steps.filter((_, i) => done.value.has(i)).length);
</script>

<template>
  <section class="next card" :aria-labelledby="`next-h-${item.id}`">
    <h2 :id="`next-h-${item.id}`" class="sr-only">辦理步驟</h2>
    <template v-if="total && current >= 0">
      <p class="next__head">
        <span class="dot dot--on" aria-hidden="true">{{ current + 1 }}</span>
        <span>下一步・{{ progressText(doneCount, total) }}</span>
      </p>
      <p class="next__text">{{ route.steps[current] }}</p>
      <div class="actions">
        <button type="button" class="btn btn--block" @click="toggleStep(item.id, current)">這步準備好了</button>
        <button type="button" class="btn btn--text" @click="openHelp(item.id, route.steps[current])">這一步做不到</button>
      </div>
      <p class="muted">勾選只記錄準備，不會送件</p>
    </template>
    <template v-else-if="total">
      <p class="next__head"><span class="dot dot--done" aria-hidden="true">✓</span><span>{{ progressText(doneCount, total) }}</span></p>
      <p>請照官方方式送件，並留下收件證明。這裡的勾選不代表已受理。</p>
    </template>
    <template v-else>
      <p class="next__text">原文沒有列出辦理步驟，請先問承辦窗口</p>
      <button type="button" class="btn btn--text" @click="openHelp(item.id)">不知道怎麼問</button>
    </template>
    <p v-if="route.deadline && !hideDeadline" class="note">期限：{{ route.deadline }}</p>
  </section>

  <div class="more-group card card--list">
    <details v-if="total" class="more">
      <summary>全部步驟（{{ total }}）</summary>
      <div class="more__body">
        <p class="muted">勾選只記錄你的準備，不代表送件</p>
        <ol class="steps">
          <li v-for="(step, i) in route.steps" :key="i">
            <label class="check">
              <input type="checkbox" :checked="done.has(i)" @change="toggleStep(item.id, i)" />
              <span class="check__body">
                <span v-if="i === current">{{ i + 1 }}. 上方的下一步</span>
                <span v-else>{{ i + 1 }}. {{ step }}</span>
              </span>
            </label>
            <button v-if="i !== current" type="button" class="btn btn--text" @click="openHelp(item.id, step)">
              做不到<span class="sr-only">：{{ step }}</span>
            </button>
          </li>
        </ol>
        <p v-if="!route.splitFromArrow" class="muted">原文沒有分步，整段列出</p>
      </div>
    </details>

    <details class="more">
      <summary>要帶的文件（{{ route.documents.length }}）</summary>
      <div class="more__body">
        <p v-if="!route.documents.length">原文沒有列出文件，不代表不用帶，請先問承辦窗口</p>
        <ul v-else class="steps">
          <li v-for="(d, i) in route.documents" :key="i" class="row-static">
            <span>{{ d.name }}<span v-if="d.required === false" class="muted">（非必要）</span></span>
            <span v-if="d.condition && d.condition !== d.name" class="muted">條件：{{ d.condition }}</span>
            <span v-if="d.notes && d.notes !== d.name" class="muted">備註：{{ d.notes }}</span>
          </li>
        </ul>
      </div>
    </details>

    <details class="more">
      <summary>去哪裡辦</summary>
      <div class="more__body">
        <dl class="facts">
          <div v-if="route.channel"><dt>受理窗口</dt><dd>{{ route.channel }}</dd></div>
          <div v-if="route.agency"><dt>主管或承辦單位</dt><dd>{{ route.agency }}</dd></div>
          <div v-if="route.methods.length"><dt>辦理方式</dt><dd>{{ route.methods.join('、') }}</dd></div>
          <div v-if="route.applicationStatus"><dt>受理情形</dt><dd>{{ route.applicationStatus }}</dd></div>
        </dl>
        <ul v-if="route.links.length" class="link-list">
          <li v-for="l in route.links" :key="l.kind">
            <ExternalLink :url="l.url" :label="l.label" :tag="SOURCE_KIND_LABEL[l.sourceKind]" />
          </li>
        </ul>
        <p v-if="route.rejectedUrls" class="muted">有 {{ route.rejectedUrls }} 個網址格式不安全，已略過</p>
        <ul class="note-list">
          <li v-for="m in route.missing" :key="m" class="muted">{{ m }}</li>
        </ul>
      </div>
    </details>
  </div>
</template>
