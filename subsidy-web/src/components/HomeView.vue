<script setup lang="ts">
import { requestTarget, state } from '../store';
</script>

<template>
  <div class="view">
    <div class="view-head">
      <h1 id="view-title" class="view-title" tabindex="-1">這次要幫誰找？</h1>
      <p class="lead">回答幾個簡單問題，從補助、津貼、獎助與服務中，縮小到值得先看的幾項。</p>
    </div>
    <ul class="rows" aria-label="查詢對象">
      <li>
        <button type="button" class="row" aria-label="幫自己找" aria-describedby="target-self-sub" :aria-pressed="state.session.target === 'self'" @click="requestTarget('self')">
          <span class="row__main">
            <span class="row__title">幫自己找</span>
            <span id="target-self-sub" class="row__sub">依你的情況回答，存成線上行動單</span>
          </span>
          <span class="row__chev" aria-hidden="true">›</span>
        </button>
      </li>
      <li>
        <button type="button" class="row" aria-label="幫家人或別人找" aria-describedby="target-other-sub" :aria-pressed="state.session.target === 'other'" @click="requestTarget('other')">
          <span class="row__main">
            <span class="row__title">幫家人或別人找</span>
            <span id="target-other-sub" class="row__sub">依對方的情況回答，製作可列印的 A4 檢核表</span>
          </span>
          <span class="row__chev" aria-hidden="true">›</span>
        </button>
      </li>
    </ul>

    <section class="intro" aria-labelledby="intro-h">
      <h2 id="intro-h" class="section-title">可以幫你做什麼</h2>
      <ol class="intro__list">
        <li>不知道從哪裡找，也可以一步步帶你縮小範圍</li>
        <li>每項列出能提供什麼、限制與受理情形</li>
        <li>整理辦理步驟與文件，自己線上準備，或印成檢核表交給家人</li>
        <li>卡住時整理要問窗口的話</li>
      </ol>
      <p class="muted">結果是可能相關的資源，不是核准；能不能領由承辦機關審核。答案只留在這個分頁。</p>
    </section>
  </div>
</template>
