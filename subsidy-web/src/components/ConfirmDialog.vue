<script setup lang="ts">
import { nextTick, ref, useId, watch } from 'vue';

const props = defineProps<{ open: boolean; title: string; confirmLabel: string; cancelLabel?: string; danger?: boolean; dismissOnEscape?: boolean }>();
const emit = defineEmits<{ confirm: []; cancel: []; dismiss: [] }>();
const dialog = ref<HTMLDialogElement | null>(null);
const titleId = useId();
let opener: HTMLElement | null = null;

watch(
  () => props.open,
  async (open) => {
    const el = dialog.value;
    if (!el) return;
    if (open && !el.open) {
      opener = document.activeElement as HTMLElement | null;
      if (typeof el.showModal === 'function') el.showModal();
      else el.setAttribute('open', '');
      await nextTick();
      // 焦點放在對話框本身：讀屏會報讀標題，按鈕不會一打開就被畫上焦點粗框，Enter 也不會誤觸。
      el.focus();
    } else if (!open && el.open) {
      // 先播離場動畫再關；減少動態效果或不支援動畫時直接關。
      const closing = typeof el.getAnimations === 'function' && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (closing) {
        el.classList.add('dialog--closing');
        await new Promise((resolve) => setTimeout(resolve, 150));
        el.classList.remove('dialog--closing');
        if (props.open) return; // 播放期間又被打開
      }
      el.close();
      opener?.focus?.();
    }
  },
);

function onCancel(event: Event) {
  event.preventDefault();
  if (props.dismissOnEscape) emit('dismiss'); else emit('cancel');
}
</script>

<template>
  <dialog ref="dialog" class="dialog" tabindex="-1" autofocus :aria-labelledby="titleId" @cancel="onCancel">
    <h2 :id="titleId" class="dialog__title">{{ title }}</h2>
    <div class="dialog__body"><slot /></div>
    <div class="dialog__actions">
      <button type="button" class="btn btn--ghost" @click="emit('cancel')">{{ cancelLabel ?? '取消' }}</button>
      <button type="button" class="btn" :class="danger ? 'btn--danger' : 'btn--primary'" @click="emit('confirm')">
        {{ confirmLabel }}
      </button>
    </div>
  </dialog>
</template>
