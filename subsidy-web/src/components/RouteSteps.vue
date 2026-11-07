<script setup lang="ts">
// 詳情頁的辦理方式：唯讀。實際一步一步勾選在本人行動單（PlanItemView）。
import { computed } from 'vue';
import { buildRoute } from '../domain/route';
import type { Subsidy } from '../domain/types';
import { sourceExcerpt } from '../presentation';
import { detailAnswers } from '../store';
import ExternalLink from './ExternalLink.vue';
import LinkedText from './LinkedText.vue';

/** hideDeadline：詳情頁已在「要先注意」列出期限時不重複。 */
const props = defineProps<{ item: Subsidy; hideDeadline?: boolean }>();
const route = computed(() => buildRoute(props.item, detailAnswers.value));
const documentGroups = computed(() => [
  { label: '地區或判斷依據待確認', documents: route.value.pendingDocuments },
  { label: '其他縣市的規定', documents: route.value.otherDocuments },
].filter((group) => group.documents.length));
const total = computed(() => route.value.steps.length);
</script>

<template>
  <div class="more-group card card--list">
    <details class="more">
      <summary>辦理步驟（{{ total || '原文未列' }}）</summary>
      <div class="more__body">
        <p v-if="!total">原文沒有列出辦理步驟，請先問承辦窗口。</p>
        <ol v-else class="steps steps--numbered">
          <li v-for="(step, i) in route.steps" :key="i">
            <p>{{ i + 1 }}. {{ sourceExcerpt(step) }}</p>
            <details v-if="sourceExcerpt(step) !== step" class="more">
              <summary>第 {{ i + 1 }} 步完整原文</summary>
              <div class="more__body"><p><LinkedText :text="step" /></p></div>
            </details>
          </li>
        </ol>
        <p v-if="total && !route.splitFromArrow" class="muted">原文沒有分步，這裡保留整段內容。</p>
        <p v-if="route.deadline && !hideDeadline" class="note">期限：{{ route.deadline }}</p>
      </div>
    </details>

    <details class="more">
      <summary>要帶的文件（{{ route.documents.length }}）</summary>
      <div class="more__body">
        <p v-if="!route.documents.length">目前沒有可直接列為準備項目的文件，不代表不用帶，請先問承辦窗口。</p>
        <p v-for="notice in route.notices" :key="notice" class="muted">{{ notice }}</p>
        <ul v-if="route.documents.length" class="steps">
          <li v-for="(d, i) in route.documents" :key="i" class="row-static">
            <span>{{ d.name }}<span v-if="d.required === false" class="muted">（非必要）</span></span>
            <span v-if="d.condition && d.condition !== d.name" class="muted">條件：{{ d.condition }}</span>
            <span v-if="d.notes && d.notes !== d.name" class="muted">備註：{{ d.notes }}</span>
            <span v-if="d.regions?.length" class="muted">原文地區：{{ d.regions.join('、') }}</span>
          </li>
        </ul>
      </div>
    </details>

    <details v-if="documentGroups.length" class="more">
      <summary>其他縣市或地區待確認的規定（原文）</summary>
      <div class="more__body">
        <p class="muted">以下保留原始文件規定，不列入目前的準備清單；不能用來判定其他縣市適用或不適用，請向受理窗口確認。</p>
        <section v-for="group in documentGroups" :key="group.label">
          <h3>{{ group.label }}</h3>
          <ul class="steps">
            <li v-for="(d, i) in group.documents" :key="i" class="row-static">
              <span>{{ d.name }}<span v-if="d.required === false" class="muted">（非必要）</span></span>
              <span v-if="d.regions?.length" class="muted">原文地區：{{ d.regions.join('、') }}</span>
              <span v-if="d.condition && d.condition !== d.name" class="muted">條件：{{ d.condition }}</span>
              <span v-if="d.notes && d.notes !== d.name" class="muted">備註：{{ d.notes }}</span>
            </li>
          </ul>
        </section>
      </div>
    </details>

    <details class="more">
      <summary>去哪裡辦</summary>
      <div class="more__body">
        <dl class="facts">
          <div v-if="route.channel"><dt>受理窗口</dt><dd><LinkedText :text="route.channel" /></dd></div>
          <div v-if="route.agency"><dt>主管或承辦單位</dt><dd>{{ route.agency }}</dd></div>
          <div v-if="route.methods.length"><dt>辦理方式</dt><dd>{{ route.methods.join('、') }}</dd></div>
          <div v-if="route.applicationStatus"><dt>受理情形</dt><dd>{{ route.applicationStatus }}</dd></div>
        </dl>
        <ul v-if="route.links.length" class="link-list">
          <li v-for="l in route.links" :key="l.kind">
            <ExternalLink :url="l.url" :label="l.label" />
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
