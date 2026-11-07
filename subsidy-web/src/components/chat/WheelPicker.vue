<script setup lang="ts">
// 滾輪選擇器（年齡）。手指上下滑動，停下時吸附到中間那一格。
// 鍵盤與讀屏：整個滾輪是 spinbutton，上下鍵 ±1、PageUp/PageDown ±10、Home/End 到頭尾。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { prefersReducedMotion } from '../../chat/typing';

const props = defineProps<{ min: number; max: number; unit: string; label: string }>();
const model = defineModel<number>({ required: true });

const list = ref<HTMLUListElement | null>(null);
const values = computed(() => Array.from({ length: props.max - props.min + 1 }, (_, i) => props.min + i));
let settle: ReturnType<typeof setTimeout> | undefined;
let programmatic = false;

function itemHeight(): number {
  return (list.value?.querySelector('li') as HTMLElement | null)?.offsetHeight || 44;
}

function scrollToValue(value: number, smooth: boolean) {
  const el = list.value;
  if (!el) return;
  const top = (value - props.min) * itemHeight();
  if (Math.abs(el.scrollTop - top) < 1) return;
  programmatic = true;
  el.scrollTo({ top, behavior: smooth && !prefersReducedMotion() ? 'smooth' : 'auto' });
  clearTimeout(settle);
  // 程式捲動期間不回寫數值；scrollend 或逾時後恢復跟手。
  settle = setTimeout(() => (programmatic = false), smooth ? 700 : 50);
}

function onScrollEnd() {
  if (!programmatic) return;
  clearTimeout(settle);
  programmatic = false;
}

/** 手指碰到滾輪就交回使用者控制。 */
function takeOver() {
  clearTimeout(settle);
  programmatic = false;
}

function clamp(n: number) {
  return Math.min(props.max, Math.max(props.min, n));
}

function onScroll() {
  const el = list.value;
  if (!el || programmatic) return;
  const value = clamp(props.min + Math.round(el.scrollTop / itemHeight()));
  if (value !== model.value) model.value = value;
  clearTimeout(settle);
  // 停下後對齊（部分瀏覽器的 scroll-snap 不會在慣性結束時完全對齊）。
  settle = setTimeout(() => scrollToValue(model.value, true), 140);
}

function set(value: number) {
  model.value = clamp(value);
  scrollToValue(model.value, true);
}

function onKey(e: KeyboardEvent) {
  const step: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, PageUp: -10, PageDown: 10 };
  if (e.key in step) set(model.value + step[e.key]);
  else if (e.key === 'Home') set(props.min);
  else if (e.key === 'End') set(props.max);
  else return;
  e.preventDefault();
}

onMounted(async () => {
  await nextTick();
  scrollToValue(model.value, false);
});
onBeforeUnmount(() => clearTimeout(settle));
watch(() => [props.min, props.max], () => scrollToValue(model.value, false));
</script>

<template>
  <div
    class="wheel"
    role="spinbutton"
    tabindex="0"
    :aria-label="label"
    :aria-valuenow="model"
    :aria-valuemin="min"
    :aria-valuemax="max"
    :aria-valuetext="`${model} ${unit}`"
    @keydown="onKey"
  >
    <div class="wheel__band" aria-hidden="true"><span class="wheel__unit">{{ unit }}</span></div>
    <ul ref="list" class="wheel__list" aria-hidden="true" @scroll.passive="onScroll" @scrollend="onScrollEnd" @touchstart.passive="takeOver" @wheel.passive="takeOver">
      <li
        v-for="v in values"
        :key="v"
        class="wheel__item"
        :class="{ 'is-on': v === model, 'is-near': Math.abs(v - model) === 1 }"
        @click="set(v)"
      >{{ v }}</li>
    </ul>
  </div>
</template>
