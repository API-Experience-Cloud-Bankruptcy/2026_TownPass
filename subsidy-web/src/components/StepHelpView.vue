<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { back, itemsById, state, tab } from '../store';
import { buildStepHelp, type StepProblem } from '../domain/step-help';
import { regionText } from '../domain/documents';
import { SOURCE_KIND_LABEL } from '../domain/route';
import ExternalLink from './ExternalLink.vue';
import LinkedText from './LinkedText.vue';
import Expand from './motion/Expand.vue';

const item = computed(() => state.planItemId && state.personalPlan.planIds.includes(state.planItemId) ? itemsById.value.get(state.planItemId) : undefined);
const help = computed(() => item.value && state.helpStep !== null ? buildStepHelp(item.value, state.helpStep) : null);
const selected = ref<StepProblem | null>(null);
const copyStatus = ref('');
const inquiry = computed(() => help.value ? help.value.askText(selected.value ?? help.value.suggested[0]!) : '');
watch(() => [state.planItemId, state.helpStep, selected.value], () => { copyStatus.value = ''; });
async function copyInquiry() {
  try {
    await navigator.clipboard.writeText(inquiry.value);
    copyStatus.value = '已複製，可以貼給承辦窗口。';
  } catch {
    copyStatus.value = '無法自動複製，請長按下方文字選取複製。';
  }
}
</script>

<template>
  <article v-if="help" class="help-page" aria-labelledby="view-title">
    <header class="help-page__header">
      <p class="help-page__eyebrow">步驟協助 <span aria-hidden="true">/</span> <template v-if="help.stepNumber">第 {{ help.stepNumber }} 步，共 {{ help.route.steps.length }} 步</template><template v-else>確認辦理方向</template></p>
      <h1 id="view-title" tabindex="-1">這一步，我們一起拆開做</h1>
      <p class="help-page__name">{{ help.name }}</p>
      <div class="help-page__context"><span>你目前卡在</span><p><LinkedText v-if="help.step" :text="help.step" /><template v-else>收錄資料尚未提供辦理流程，先確認第一步。</template></p></div>
    </header>

    <section class="help-page__guide" aria-labelledby="guide-title">
      <p class="help-page__eyebrow">先做一件事</p>
      <h2 id="guide-title">{{ help.guide?.title ?? '先確認這一步要交付的內容' }}</h2>
      <ol v-if="help.guide" class="help-page__actions">
        <li v-for="(action, index) in help.guide.actions" :key="index"><span aria-hidden="true">{{ index + 1 }}</span><p>{{ action }}</p></li>
      </ol>
      <template v-else>
        <p>這個步驟尚無可用的專屬教學，或來源已更新。請先從以下方案來源核對目前流程，再用下方詢問文字確認卡住的部分。</p>
        <ExternalLink v-for="link in help.route.links.filter(link => link.kind === 'program')" :key="link.url" :url="link.url" :label="link.label" />
      </template>
      <div v-if="help.primaryLink" class="help-page__resource">
        <ExternalLink :url="help.primaryLink.url" :label="help.primaryLink.label" />
        <span class="muted">{{ SOURCE_KIND_LABEL[help.primaryLink.sourceKind] }}</span>
      </div>
      <p class="help-page__note">操作建議依收錄資料整理；申辦要求以受理單位最新說明為準。</p>
    </section>

    <details v-if="help.documents.length" class="more help-page__documents">
      <summary>這一步會用到的文件（{{ help.documents.length }} 項）</summary>
      <ul class="more__body help-page__doc-list">
        <li v-for="(doc, index) in help.documents" :key="index">
          <strong>{{ doc.name }}{{ doc.required === false ? '（非必要）' : '' }}</strong>
          <p v-if="doc.condition || doc.notes || doc.regions"><LinkedText :text="[doc.condition, doc.notes, regionText(doc.regions), doc.region_evidence].filter(Boolean).join('；')" /></p>
        </li>
      </ul>
      <p class="muted">依各文件的條件與地區核對；這裡只列本步驟相關項目，完整清單在行動單。</p>
    </details>

    <section class="help-page__problems" aria-labelledby="problems-title">
      <h2 id="problems-title">還是卡住了？</h2>
      <p class="muted">選擇你遇到的情況，再看排除方法。</p>
      <div class="help-page__choices">
        <button v-for="problem in help.suggested" :key="problem.id" type="button" class="btn" :aria-pressed="selected?.id === problem.id" @click="selected = problem">{{ problem.label }}</button>
      </div>
      <details class="more">
        <summary>其他困難</summary>
        <div class="more__body help-page__choices">
          <button v-for="problem in help.others" :key="problem.id" type="button" class="btn" :aria-pressed="selected?.id === problem.id" @click="selected = problem">{{ problem.label }}</button>
        </div>
      </details>
      <!-- 第一次選擇時建議區塊由高度 0 展開，下方內容跟著滑下去；之後換選項才在原位淡出淡入。
           外框以負邊距抵掉格線間距，展開時間距由 padding 一起長出來，不會先跳 12px。 -->
      <div class="help-page__advice-slot">
        <Expand>
          <div v-if="selected" class="help-page__advice-wrap">
            <Transition name="rise" mode="out-in">
              <div :key="selected.id" class="help-page__advice" role="status">
                <h3>{{ selected.label }}</h3>
                <p>{{ selected.action }}</p>
                <p v-if="selected.id === 'visit' && help.route.methods.length" class="muted">此方案列出的方式：{{ help.route.methods.join('、') }}。這一步能否改用其他方式，仍須確認。</p>
                <p v-if="selected.id === 'deadline' && help.route.deadline"><LinkedText :text="help.route.deadline" /></p>
              </div>
            </Transition>
          </div>
        </Expand>
      </div>
    </section>

    <section class="help-page__contact" aria-labelledby="contact-title">
      <h2 id="contact-title">需要問人時，直接這樣說</h2>
      <p class="help-page__inquiry">{{ inquiry }}</p>
      <button type="button" class="btn" @click="copyInquiry">複製詢問文字</button>
      <p v-if="copyStatus" role="status" class="muted">{{ copyStatus }}</p>
      <div class="help-page__channel">
        <h3>這個方案的窗口</h3>
        <p v-if="help.route.channel || help.route.agency"><LinkedText :text="help.route.channel || help.route.agency" /></p>
        <p v-else class="muted">收錄資料未提供窗口，請從方案來源確認聯絡方式。</p>
      </div>
    </section>

    <details class="more help-page__sources">
      <summary>方案入口與資料來源</summary>
      <div class="more__body actions">
        <p class="muted">查核日期：{{ help.route.checkedDate || '未提供' }}。目前受理情形請以最新公告為準。</p>
        <ExternalLink v-for="link in help.route.links" :key="`${link.kind}-${link.url}`" :url="link.url" :label="`${link.label}（${SOURCE_KIND_LABEL[link.sourceKind]}）`" />
        <ExternalLink v-for="source in help.route.sources.filter(source => !help?.route.links.some(link => link.url === source.url))" :key="source.url" :url="source.url" :label="source.role || '資料來源'" />
        <p v-if="!help.route.sources.length && !help.route.links.length" class="muted">收錄資料沒有可開啟的來源網址。</p>
      </div>
    </details>
    <footer class="help-page__footer"><button type="button" class="btn btn--primary btn--block" @click="back">回到這一步，繼續準備</button><p class="muted">回去後再依實際進度標記完成。</p></footer>
  </article>
  <section v-else class="help-page">
    <h1 id="view-title" tabindex="-1">這個步驟已變更</h1>
    <p>方案已移出行動單，或流程內容已更新。請回到行動單確認目前步驟。</p>
    <button type="button" class="btn btn--primary" @click="tab('plan')">回到行動單</button>
  </section>
</template>

<style scoped>
.help-page { width: 100%; max-width: 720px; margin-inline: auto; display: grid; gap: 24px; padding-block: 8px 24px; overflow-wrap: anywhere; }
.help-page h1 { font-size: var(--fs-page-title); line-height: 1.45; margin: 8px 0 12px; }
.help-page h2 { font-size: var(--fs-section); margin: 0 0 12px; }
.help-page h3 { font-size: var(--fs-body); margin: 0 0 8px; }
.help-page p { margin: 0; line-height: 1.8; }
.help-page__eyebrow { color: var(--accent); font-size: var(--fs-small); font-weight: 600; display: flex; gap: 12px; }
.help-page__name { color: var(--text-2); }
.help-page__context { margin-top: 20px; border-left: 3px solid var(--brand); padding: 4px 0 4px 16px; }
.help-page__context > span { font-size: var(--fs-small); color: var(--muted); }
.help-page__guide { background: var(--accent-soft); border: 1px solid var(--brand-line); border-radius: var(--radius-panel); padding: 24px; }
.help-page__guide h2 { margin-top: 8px; }
.help-page__actions { list-style: none; padding: 0; margin: 20px 0; display: grid; gap: 20px; }
.help-page__actions li { display: flex; gap: 12px; align-items: baseline; }
.help-page__actions li > span { flex: 0 0 28px; height: 28px; border-radius: 50%; background: var(--brand-soft); color: var(--accent); text-align: center; line-height: 28px; font-weight: 600; }
.help-page__note { font-size: var(--fs-small); color: var(--muted); margin-top: 16px !important; }
.help-page__resource { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding-top: 16px; border-top: 1px solid var(--brand-line); }
.help-page__doc-list { padding-left: 24px; }
.help-page__doc-list li + li { margin-top: 16px; }
.help-page__problems, .help-page__contact { display: grid; gap: 12px; }
.help-page__choices { display: flex; flex-wrap: wrap; gap: 8px; }
.help-page .btn { white-space: normal; min-height: 48px; }
.help-page__choices .btn[aria-pressed="true"] { border-color: var(--accent); color: var(--accent); background: var(--accent-soft); }
.help-page__advice-slot { margin-top: -12px; }
.help-page__advice-wrap { padding-top: 12px; }
.help-page__advice { padding: 20px; background: var(--highlight-soft); border-radius: var(--radius-panel); }
.help-page__contact { border-top: 1px solid var(--line); padding-top: 24px; }
.help-page__inquiry { padding: 20px; background: var(--surface-brand); border-radius: var(--radius-panel); user-select: text; }
.help-page__contact > .btn { justify-self: start; }
.help-page__channel { padding-top: 8px; }
.help-page__footer { display: grid; gap: 8px; text-align: center; }
@media (max-width: 420px) { .help-page__guide { padding: 20px 16px; } .help-page__choices { display: grid; } }
</style>
