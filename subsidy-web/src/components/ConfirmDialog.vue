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
      el.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    } else if (!open && el.open) {
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
  <dialog ref="dialog" class="dialog" :aria-labelledby="titleId" @cancel="onCancel">
    <h2 :id="titleId" class="dialog__title">{{ title }}</h2>
    <div class="dialog__body"><slot /></div>
    <div class="dialog__actions">
      <button type="button" class="btn btn--ghost" data-autofocus @click="emit('cancel')">{{ cancelLabel ?? '取消' }}</button>
      <button type="button" class="btn" :class="danger ? 'btn--danger' : 'btn--primary'" @click="emit('confirm')">
        {{ confirmLabel }}
      </button>
    </div>
  </dialog>
</template>
