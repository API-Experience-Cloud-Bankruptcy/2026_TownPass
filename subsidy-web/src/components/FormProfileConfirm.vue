<script setup lang="ts">
// 填申請表前的「本人資料確認」。資料只在這個元件的記憶體裡，不寫入任何儲存空間。
// 只有「使用者按下帶入」才會讀城市通 userinfo；每一項都要自己勾選確認才算數。
// 整合方式見 docs/form-fields-integration.md §12。
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import { confirmProfile, draftFromAccount, PROFILE_FIELDS, validateProfileValue, type ConfirmedProfile, type ProfileKey, type ProfileValues } from '../domain/form-profile';
import type { Target } from '../domain/types';
import { getUserInfo, isInTownPass } from '../townpass';
import type { Account } from '../townpass';

const props = withDefaults(defineProps<{
  /** 只有「替自己申請」才允許帶入與確認本人資料。 */
  target: Target | null;
  /** 測試或呼叫端可替換；預設走城市通橋接。 */
  loadAccount?: () => Promise<Account | null>;
}>(), { loadAccount: getUserInfo });
const emit = defineEmits<{ confirmed: [profile: ConfirmedProfile]; cleared: [] }>();

const values = reactive<ProfileValues>({});
const checked = reactive<Partial<Record<ProfileKey, boolean>>>({});
const loading = ref(false);
const status = ref('');
const simulated = ref(false);
const isSelf = computed(() => props.target === 'self');
const errors = computed(() => Object.fromEntries(PROFILE_FIELDS.map((f) => [f.key, validateProfileValue(f.key, values[f.key] ?? '')])) as Record<ProfileKey, string>);
const confirmedCount = computed(() => Object.keys(confirmProfile(values, checked)).length);

/** 修改內容就取消確認，避免「確認過」的是舊值。 */
let revision = 0;
let mounted = true;
function revoke(message: string) {
  revision++;
  loading.value = false;
  status.value = message;
  emit('cleared');
}
function resetDraft() {
  for (const spec of PROFILE_FIELDS) { delete values[spec.key]; delete checked[spec.key]; }
  simulated.value = false;
}
function edit(key: ProfileKey, value: string) {
  values[key] = value;
  checked[key] = false;
  revoke('資料已變更，請重新核對並使用已確認的資料。');
}
function check(key: ProfileKey, value: boolean) {
  checked[key] = value;
  revoke('確認項目已變更，請按「使用已確認的資料」。');
}
watch(() => props.target, () => {
  resetDraft();
  revoke('查詢對象已變更，已清除本人資料。');
}, { flush: 'sync' });
onBeforeUnmount(() => { mounted = false; revision++; });

async function bringIn() {
  if (loading.value || !isSelf.value) return;
  revoke('');
  const current = revision;
  loading.value = true;
  try {
    const account = await props.loadAccount();
    if (!mounted || current !== revision || !isSelf.value) return;
    const draft = draftFromAccount(account);
    if (!Object.keys(draft).length) { status.value = '城市通沒有可帶入的資料（可能尚未登入），請自行輸入。'; return; }
    emit('cleared');
    resetDraft();
    Object.assign(values, draft);
    simulated.value = !isInTownPass();
    status.value = simulated.value
      ? '目前不在城市通內，帶入的是模擬資料，請改成你自己的資料。請逐項核對並勾選確認。'
      : '已帶入城市通帳號資料。請逐項核對，勾選「確認」的項目才會填進表單。';
  } catch {
    if (mounted && current === revision) status.value = '讀取城市通資料失敗，請自行輸入。';
  } finally { if (mounted && current === revision) loading.value = false; }
}

function use() {
  if (!isSelf.value || loading.value) return;
  const profile = confirmProfile(values, checked);
  status.value = Object.keys(profile).length ? `已確認 ${Object.keys(profile).length} 項。` : '還沒有確認任何項目。';
  emit('confirmed', profile);
}
function clear() {
  resetDraft();
  revoke('已清除這裡的資料。');
}
</script>

<template>
  <section class="actions card" aria-labelledby="profile-confirm-h">
    <h2 id="profile-confirm-h" class="section-title">確認申請人本人資料</h2>
    <template v-if="!isSelf">
      <p class="alert">目前不是替自己申請，不會自動填入任何個人資料。請改用「本人」，或把空白表單列印後手寫。</p>
    </template>
    <template v-else>
      <p class="muted">資料只在這台裝置上處理，不會上傳，也不會長期保存。只有你逐項勾選「確認」的項目會填進表單；簽名欄一律不會代填。</p>
      <button type="button" class="btn btn--block" :disabled="loading" @click="bringIn">{{ loading ? '讀取中…' : '從城市通帶入我的資料' }}</button>
      <div v-for="spec in PROFILE_FIELDS" :key="spec.key" class="field">
        <label class="field__label" :for="`pf-${spec.key}`">{{ spec.label }}</label>
        <select v-if="spec.options" :id="`pf-${spec.key}`" class="input" :value="values[spec.key] ?? ''" @change="edit(spec.key, ($event.target as HTMLSelectElement).value)">
          <option value="">不填</option>
          <option v-for="o in spec.options" :key="o.value" :value="o.value">{{ o.label }}</option>
        </select>
        <input v-else :id="`pf-${spec.key}`" class="input" :inputmode="spec.inputmode" autocomplete="off" :value="values[spec.key] ?? ''"
          :aria-invalid="!!errors[spec.key]" :aria-describedby="`pf-${spec.key}-hint`" @input="edit(spec.key, ($event.target as HTMLInputElement).value)" />
        <p :id="`pf-${spec.key}-hint`" class="muted">{{ errors[spec.key] || spec.hint }}</p>
        <label class="check">
          <input type="checkbox" :checked="!!checked[spec.key]" :disabled="!values[spec.key]?.trim() || !!errors[spec.key]" @change="check(spec.key, ($event.target as HTMLInputElement).checked)" />
          <span class="check__body">確認這是我本人的{{ spec.label }}</span>
        </label>
      </div>
      <button type="button" class="btn btn--primary btn--block" :disabled="loading" @click="use">使用已確認的資料（{{ confirmedCount }} 項）</button>
      <button type="button" class="btn btn--text" @click="clear">清除這裡的資料</button>
    </template>
    <p class="status-text note" role="status" aria-live="polite">{{ status }}</p>
  </section>
</template>
