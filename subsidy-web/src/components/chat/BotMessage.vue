<script setup lang="ts">
// 福利連的訊息泡泡：新訊息先顯示「輸入中」再逐字打出；播放過的直接顯示全文。
// 讀屏讀的是完整文字（sr-only），逐字顯示的部分對讀屏隱藏，避免一個字一個字被念出。
// 流暢的關鍵：全文一開始就排好版，還沒打到的字只是隱形，所以打字時泡泡不會一直變寬長高、
// 頁面也不會一行一行跳；泡泡從「輸入中」長成最終大小只發生一次，用遮罩動畫展開。
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import LogoMark from '../LogoMark.vue';
import { splashGone } from '../../brand/splash';
import { charsAt, isTyped, markTyped, prefersReducedMotion, type Line } from '../../chat/typing';

const props = defineProps<{ msgKey: string; lines: Line[]; active?: boolean; wide?: boolean; live?: boolean }>();
const emit = defineEmits<{ done: [] }>();

const content = computed(() => props.lines.filter((l) => l.text));
const total = computed(() => content.value.reduce((n, l) => n + l.text.length, 0));
const shown = ref(isTyped(props.msgKey) ? Number.POSITIVE_INFINITY : 0);
const waiting = ref(!isTyped(props.msgKey));
const done = computed(() => shown.value >= total.value && !waiting.value);

const bubble = ref<HTMLElement | null>(null);
/** 「思考中」停留時間：頭像的筆先畫滿一圈多（LogoMark 一圈 0.72 秒），再開始回覆。 */
const TYPING_INTRO_MS = 800;
let frame = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let unmounted = false;

/** 泡泡從「輸入中」的小尺寸展開到全文大小（只動遮罩，不影響排版）。 */
function grow(from: DOMRect) {
  const el = bubble.value;
  if (!el?.animate) return;
  const to = el.getBoundingClientRect();
  const dx = Math.max(0, to.width - from.width);
  const dy = Math.max(0, to.height - from.height);
  if (dx < 1 && dy < 1) return;
  const round = getComputedStyle(el).borderRadius || '0';
  el.animate(
    [{ clipPath: `inset(0 ${dx}px ${dy}px 0 round ${round})` }, { clipPath: `inset(0 0 0 0 round ${round})` }],
    { duration: Math.min(360, 180 + (dx + dy) / 6), easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' },
  );
}

function finish() {
  cancelAnimationFrame(frame);
  clearTimeout(timer);
  waiting.value = false;
  shown.value = Number.POSITIVE_INFINITY;
  if (!isTyped(props.msgKey)) {
    markTyped(props.msgKey);
    emit('done');
  }
}

onMounted(async () => {
  if (isTyped(props.msgKey)) return;
  if (prefersReducedMotion() || total.value === 0) {
    finish();
    return;
  }
  // 開場畫面還在時先不打字，免得第一則的書寫動畫被蓋住。
  await splashGone;
  if (unmounted) return;
  // 先讓頭像「想一下」：筆一直畫圓圈；開始打字時筆改寫出 Logo，泡泡同時浮現。
  timer = setTimeout(async () => {
    const from = bubble.value?.getBoundingClientRect();
    waiting.value = false;
    await nextTick();
    if (from) grow(from);
    const start = performance.now();
    const tick = (now: number) => {
      shown.value = charsAt(now - start, total.value);
      if (shown.value >= total.value) finish();
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  }, TYPING_INTRO_MS);
});

onBeforeUnmount(() => {
  unmounted = true;
  cancelAnimationFrame(frame);
  clearTimeout(timer);
});

/** 選項、滾輪離場前鎖住高度，收起時才有銜接。 */
function holdHeight(el: Element) {
  const node = el as HTMLElement;
  node.style.maxHeight = `${node.scrollHeight}px`;
}
function releaseHeight(el: Element) {
  (el as HTMLElement).style.maxHeight = '';
}

/** 每一行拆成已打出（visible）與尚未打出（rest，隱形佔位）兩段。 */
const visible = computed(() => {
  let left = shown.value;
  return content.value.map((l) => {
    const cut = Math.min(l.text.length, Math.max(0, left));
    left -= l.text.length;
    return { ...l, visible: l.text.slice(0, cut), rest: l.text.slice(cut), typing: cut > 0 || left + l.text.length === 0 };
  });
});
</script>

<template>
  <div class="msg msg--bot" :class="{ 'msg--wide': wide }" :role="live ? 'status' : undefined">
    <span class="avatar" aria-hidden="true"><LogoMark :thinking="waiting" /></span>
    <div class="msg__col">
      <div
        :id="active ? 'view-title' : undefined"
        ref="bubble"
        class="bubble bubble--bot"
        :class="{ 'bubble--pending': waiting }"
        :tabindex="active ? -1 : undefined"
        @click="!done && finish()"
      >
        <template v-if="!waiting">
          <p
            v-for="(l, i) in visible"
            :key="i"
            class="bubble__line"
            :class="l.tone ? `bubble__line--${l.tone}` : ''"
            aria-hidden="true"
          >{{ l.visible }}<span v-if="!done && l.rest && l.typing" class="caret"></span><span v-if="l.rest" class="bubble__ghost">{{ l.rest }}</span></p>
        </template>
        <span class="sr-only">{{ content.map((l) => l.text).join('。') }}</span>
        <Transition name="chat-out" @before-leave="holdHeight" @after-leave="releaseHeight" @leave-cancelled="releaseHeight">
          <div v-if="done && $slots.default" class="bubble__extra">
            <slot />
          </div>
        </Transition>
      </div>
      <Transition name="chat-out" @before-leave="holdHeight" @after-leave="releaseHeight" @leave-cancelled="releaseHeight">
        <div v-if="done && $slots.after" class="msg__after">
          <slot name="after" />
        </div>
      </Transition>
    </div>
  </div>
</template>
