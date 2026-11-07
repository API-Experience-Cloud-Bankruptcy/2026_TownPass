<script setup lang="ts">
// 福利連 Logo。thinking 時線條收成一個轉動的圓圈（像在想），結束後再變回原本的筆畫。
// 變形用 SVG <animate>（WebKit 不支援用 CSS 動畫改 d）；to 只給終點，中途切換會從目前形狀接續。
// 純裝飾，讀屏不念；減少動態效果時維持靜態 Logo。
import { computed, onMounted, ref, watch } from 'vue';
import { LOGO_PATH, RING_PATH, logoViewBox } from '../brand/logo';

const props = withDefaults(defineProps<{ stroke?: number; thinking?: boolean }>(), {
  stroke: 80,
  thinking: false,
});
const viewBox = computed(() => logoViewBox(props.stroke));

const toRing = ref<SVGAnimationElement | null>(null);
const toLine = ref<SVGAnimationElement | null>(null);
const ring = ref(false);

function calm(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function morph(thinking: boolean) {
  if (calm()) return;
  ring.value = thinking;
  (thinking ? toRing : toLine).value?.beginElement?.();
}

watch(() => props.thinking, morph);
onMounted(() => {
  if (props.thinking) morph(true);
});
</script>

<template>
  <svg class="logo" :class="{ 'logo--ring': ring }" :viewBox="viewBox" aria-hidden="true" focusable="false">
    <path class="logo__ink" :d="LOGO_PATH" :stroke-width="stroke" pathLength="1">
      <animate
        ref="toRing"
        attributeName="d"
        :to="RING_PATH"
        dur="0.42s"
        begin="indefinite"
        fill="freeze"
        calcMode="spline"
        keyTimes="0;1"
        keySplines="0.5 0 0.2 1"
      />
      <animate
        ref="toLine"
        attributeName="d"
        :to="LOGO_PATH"
        dur="0.5s"
        begin="indefinite"
        fill="freeze"
        calcMode="spline"
        keyTimes="0;1"
        keySplines="0.3 0 0.2 1"
      />
    </path>
  </svg>
</template>
