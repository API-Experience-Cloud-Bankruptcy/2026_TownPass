<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';

const props = defineProps<{ open: boolean; title: string; confirmLabel: string; danger?: boolean }>();
const emit = defineEmits<{ confirm: []; cancel: [] }>();
const dialog = ref<HTMLDialogElement | null>(null);
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
  emit('cancel');
}
</script>

<template>
  <dialog ref="dialog" class="dialog" aria-labelledby="dialog-title" @cancel="onCancel">
    <h2 id="dialog-title" class="dialog__title">{{ title }}</h2>
    <div class="dialog__body"><slot /></div>
    <div class="dialog__actions">
      <button type="button" class="btn btn--ghost" data-autofocus @click="emit('cancel')">取消</button>
      <button type="button" class="btn" :class="danger ? 'btn--danger' : 'btn--primary'" @click="emit('confirm')">
        {{ confirmLabel }}
      </button>
    </div>
  </dialog>
</template>
