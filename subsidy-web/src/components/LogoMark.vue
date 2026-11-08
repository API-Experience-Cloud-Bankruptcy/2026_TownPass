<script setup lang="ts">
// 福利連 Logo。thinking 時一支筆在原地一直畫圓圈（像在想）；結束後筆移到起筆處，一筆把 Logo 寫出來再離開。
// 筆尖位置要逐格跟著線條走，所以用 requestAnimationFrame 直接改屬性，不經過 Vue 重繪。
// 純裝飾，讀屏不念；減少動態效果時維持靜態 Logo、不出現筆。
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { LOGO_PATH, LOGO_START, RING_PATH, logoViewBox } from '../brand/logo';

const props = withDefaults(defineProps<{ stroke?: number; thinking?: boolean }>(), {
  stroke: 80,
  thinking: false,
});
const viewBox = computed(() => logoViewBox(props.stroke));

/** 筆身往右上斜（像右手握筆），整段動畫角度固定，不跟著圓圈轉。 */
const PEN_ANGLE = -55;
/** 畫一圈的時間；圓圈畫滿 TRAIL 後，尾端開始跟著擦掉，形成一直在畫的感覺。 */
const LAP_MS = 720;
const TRAIL = 0.8;
/** 收尾：圓圈淡出、筆移到起筆處 → 一筆寫出 Logo → 筆抬起離開。 */
const GLIDE_MS = 200;
const WRITE_MS = 700;
const LIFT_MS = 240;

const ink = ref<SVGPathElement | null>(null);
const ring = ref<SVGPathElement | null>(null);
const pen = ref<SVGGElement | null>(null);
/** 用過 thinking 才放圓圈與筆，頁首等靜態 Logo 不多畫元素。 */
const live = ref(props.thinking);

type Phase = 'still' | 'ring' | 'write';
let phase: Phase = 'still';
let start = 0;
let raf = 0;
let at = { x: LOGO_START.x, y: LOGO_START.y };
let glideFrom = at;

function calm(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

const easeOut = (k: number) => 1 - (1 - k) ** 3;
const easeInOut = (k: number) => (k < 0.5 ? 4 * k ** 3 : 1 - (-2 * k + 2) ** 3 / 2);

function pointAt(path: SVGPathElement, p: number) {
  const pt = path.getPointAtLength(path.getTotalLength() * p);
  return { x: pt.x, y: pt.y };
}

/** lift：沿筆身方向往上提的距離（座標單位），0 代表筆尖貼在紙上。 */
function placePen(x: number, y: number, lift: number, opacity: number) {
  at = { x, y };
  const el = pen.value;
  if (!el) return;
  el.setAttribute('transform', `translate(${x} ${y}) rotate(${PEN_ANGLE}) translate(${lift} 0)`);
  el.style.opacity = String(opacity);
}

function drawRing(t: number) {
  const r = ring.value;
  const i = ink.value;
  if (!r || !i) return;
  const laps = t / LAP_MS;
  const len = Math.min(TRAIL, laps);
  r.style.opacity = '1';
  r.style.strokeDasharray = `${len} ${1 - len}`;
  r.style.strokeDashoffset = String(len - laps);
  i.style.opacity = '0';
  const { x, y } = pointAt(r, laps % 1);
  const enter = easeOut(Math.min(1, t / 160));
  placePen(x, y, (1 - enter) * 90, enter);
}

/** 回傳 false 代表收尾動畫已結束。 */
function drawWrite(t: number): boolean {
  const r = ring.value;
  const i = ink.value;
  if (!r || !i) return false;
  if (t < GLIDE_MS) {
    const k = easeInOut(t / GLIDE_MS);
    r.style.opacity = String(1 - k);
    i.style.opacity = '0';
    const x = glideFrom.x + (LOGO_START.x - glideFrom.x) * k;
    const y = glideFrom.y + (LOGO_START.y - glideFrom.y) * k;
    placePen(x, y, Math.sin(Math.PI * k) * 80, 1);
    return true;
  }
  r.style.opacity = '0';
  if (t < GLIDE_MS + WRITE_MS) {
    const p = easeInOut((t - GLIDE_MS) / WRITE_MS);
    // 用「p 長的實線＋夠長的空白」寫出來；避開 offset 寫法在路徑尾端多出一個圓頭點。
    i.style.opacity = '1';
    i.style.strokeDasharray = `${p} 2`;
    const { x, y } = pointAt(i, p);
    placePen(x, y, 0, 1);
    return true;
  }
  i.style.strokeDasharray = '';
  if (t < GLIDE_MS + WRITE_MS + LIFT_MS) {
    const k = (t - GLIDE_MS - WRITE_MS) / LIFT_MS;
    placePen(at.x, at.y, easeOut(k) * 160, 1 - k);
    return true;
  }
  return false;
}

function rest() {
  cancelAnimationFrame(raf);
  phase = 'still';
  const i = ink.value;
  if (i) {
    i.style.opacity = '';
    i.style.strokeDasharray = '';
  }
  if (ring.value) ring.value.style.opacity = '0';
  if (pen.value) pen.value.style.opacity = '0';
}

function frame(now: number) {
  const t = now - start;
  if (phase === 'ring') drawRing(t);
  else if (phase !== 'write' || !drawWrite(t)) return rest();
  raf = requestAnimationFrame(frame);
}

function run(next: Phase) {
  cancelAnimationFrame(raf);
  phase = next;
  start = performance.now();
  raf = requestAnimationFrame(frame);
}

async function think(thinking: boolean) {
  if (calm()) return;
  if (thinking) {
    live.value = true;
    await nextTick();
    if (!props.thinking) return;
    if (typeof ink.value?.getPointAtLength !== 'function') return;
    run('ring');
  } else if (phase === 'ring') {
    glideFrom = at;
    run('write');
  }
}

watch(() => props.thinking, think);
onMounted(() => {
  if (props.thinking) think(true);
});
onBeforeUnmount(() => cancelAnimationFrame(raf));
</script>

<template>
  <svg class="logo" :viewBox="viewBox" aria-hidden="true" focusable="false">
    <path ref="ink" class="logo__ink" :d="LOGO_PATH" :stroke-width="stroke" pathLength="1" />
    <template v-if="live">
      <path ref="ring" class="logo__ring" :d="RING_PATH" :stroke-width="stroke" pathLength="1" />
      <!-- 鉛筆：筆尖在原點、筆身沿 +x，放到位置後再整支轉 PEN_ANGLE。 -->
      <g ref="pen" class="logo__pen">
        <path class="logo__pen-wood" d="M0,0 L120,-54 L120,54 Z" />
        <path class="logo__pen-lead" d="M0,0 L44,-20 L44,20 Z" />
        <rect class="logo__pen-body" x="116" y="-58" width="290" height="116" rx="10" />
        <rect class="logo__pen-band" x="396" y="-60" width="40" height="120" rx="8" />
        <rect class="logo__pen-eraser" x="428" y="-58" width="60" height="116" rx="28" />
      </g>
    </template>
  </svg>
</template>
