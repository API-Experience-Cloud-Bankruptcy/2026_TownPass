<script setup lang="ts">
// 福利通的訊息泡泡：新訊息先顯示「輸入中」再逐字打出；播放過的直接顯示全文。
// 讀屏讀的是完整文字（sr-only），逐字顯示的部分對讀屏隱藏，避免一個字一個字被念出。
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { charsAt, isTyped, markTyped, prefersReducedMotion, type Line } from '../../chat/typing';

const props = defineProps<{ msgKey: string; lines: Line[]; active?: boolean; wide?: boolean }>();
const emit = defineEmits<{ done: [] }>();

const content = computed(() => props.lines.filter((l) => l.text));
const total = computed(() => content.value.reduce((n, l) => n + l.text.length, 0));
const shown = ref(isTyped(props.msgKey) ? Number.POSITIVE_INFINITY : 0);
const waiting = ref(!isTyped(props.msgKey));
const done = computed(() => shown.value >= total.value && !waiting.value);

let frame = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

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

onMounted(() => {
  if (isTyped(props.msgKey)) return;
  if (prefersReducedMotion() || total.value === 0) {
    finish();
    return;
  }
  // 先顯示「輸入中」一下，再開始打字。
  timer = setTimeout(() => {
    waiting.value = false;
    const start = performance.now();
    const tick = (now: number) => {
      shown.value = charsAt(now - start, total.value);
      if (shown.value >= total.value) finish();
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  }, 380);
});

onBeforeUnmount(() => {
  cancelAnimationFrame(frame);
  clearTimeout(timer);
});

/** 每一行目前要顯示的文字。 */
const visible = computed(() => {
  let left = shown.value;
  return content.value.map((l) => {
    const text = l.text.slice(0, Math.max(0, left));
    left -= l.text.length;
    return { ...l, visible: text, started: text.length > 0 };
  });
});
</script>

<template>
  <div class="msg msg--bot" :class="{ 'msg--wide': wide }">
    <span class="avatar" aria-hidden="true">福</span>
    <div class="msg__col">
      <div
        :id="active ? 'view-title' : undefined"
        class="bubble bubble--bot"
        :tabindex="active ? -1 : undefined"
        @click="!done && finish()"
      >
        <span v-if="waiting" class="typing" aria-hidden="true"><i></i><i></i><i></i></span>
        <template v-else>
          <p
            v-for="(l, i) in visible"
            v-show="l.started"
            :key="i"
            class="bubble__line"
            :class="l.tone ? `bubble__line--${l.tone}` : ''"
            aria-hidden="true"
          >{{ l.visible }}<span v-if="!done && l.visible.length < l.text.length && l.started" class="caret"></span></p>
        </template>
        <span class="sr-only">{{ content.map((l) => l.text).join('。') }}</span>
        <div v-if="done && $slots.default" class="bubble__extra">
          <slot />
        </div>
      </div>
      <div v-if="done && $slots.after" class="msg__after">
        <slot name="after" />
      </div>
    </div>
  </div>
</template>
