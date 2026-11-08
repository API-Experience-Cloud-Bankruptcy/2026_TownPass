<script setup lang="ts">
// 展開收合：包住一個 v-if／v-show 的元素，高度從 0 長到實際高度、內容淡入；收合反過來。
// 中途反向時從目前高度接續。減少動態效果時直接切換。
// 用法：<Expand><div v-show="open">…</div></Expand>
import { prefersReducedMotion } from '../../chat/typing';

const DURATION = 300;
const EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
const running = new WeakMap<Element, Animation>();

type Box = { height: string; paddingTop: string; paddingBottom: string; marginTop: string; marginBottom: string };
const COLLAPSED: Box = { height: '0px', paddingTop: '0px', paddingBottom: '0px', marginTop: '0px', marginBottom: '0px' };

function box(el: HTMLElement): Box {
  const cs = getComputedStyle(el);
  return { height: `${el.getBoundingClientRect().height}px`, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, marginTop: cs.marginTop, marginBottom: cs.marginBottom };
}

function run(el: Element, done: () => void, opening: boolean) {
  const node = el as HTMLElement;
  if (!node.animate || prefersReducedMotion()) return done();
  const prev = running.get(node);
  // 反向時以目前（動畫中）的尺寸為起點
  const current = prev ? box(node) : null;
  prev?.cancel();
  const full = box(node);
  const from = current ?? (opening ? COLLAPSED : full);
  const to = opening ? full : COLLAPSED;
  node.style.overflow = 'hidden';
  const anim = node.animate(
    [{ ...from, opacity: opening ? 0 : 1 }, { ...to, opacity: opening ? 1 : 0 }],
    { duration: DURATION, easing: EASING },
  );
  running.set(node, anim);
  anim.onfinish = () => {
    node.style.overflow = '';
    running.delete(node);
    done();
  };
  anim.oncancel = () => {
    if (running.get(node) === anim) running.delete(node);
  };
}
</script>

<template>
  <Transition :css="false" @enter="(el, done) => run(el, done, true)" @leave="(el, done) => run(el, done, false)">
    <slot />
  </Transition>
</template>
