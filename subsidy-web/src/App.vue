<script setup lang="ts">
import { onMounted, ref } from 'vue';
import {
  call1999,
  getDeviceInfo,
  getLocation,
  getUserInfo,
  isInTownPass,
  notify,
  openLink,
  scanQRCode,
  type Account,
} from './townpass';

const inApp = isInTownPass();
const account = ref<Account | null>(null);
const accountError = ref('');

const busy = ref('');
const resultTitle = ref('');
const resultText = ref('');

onMounted(async () => {
  try {
    account.value = await getUserInfo();
  } catch (error) {
    accountError.value = (error as Error).message;
  }
});

function ageOf(birthday: string): number | null {
  const [y, m, d] = birthday.split('/').map(Number);
  if (!y || !m || !d) return null;
  const today = new Date();
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age -= 1;
  return age;
}

async function run(label: string, task: () => Promise<unknown> | unknown) {
  busy.value = label;
  resultTitle.value = label;
  resultText.value = '等待 App 回覆…';
  try {
    const value = await task();
    resultText.value = value === undefined ? '已送出' : JSON.stringify(value, null, 2);
  } catch (error) {
    resultText.value = `失敗：${(error as Error).message}`;
  } finally {
    busy.value = '';
  }
}

const actions: { label: string; task: () => Promise<unknown> | unknown }[] = [
  { label: '取得使用者資料', task: getUserInfo },
  { label: '取得目前位置', task: getLocation },
  { label: '取得裝置資訊', task: getDeviceInfo },
  { label: '掃描 QR Code', task: scanQRCode },
  { label: '發送測試通知', task: () => notify('補助專區', '這是一則測試通知') },
  { label: '開啟臺北市政府網站', task: () => openLink('https://www.gov.taipei/') },
  { label: '撥打 1999', task: call1999 },
];
</script>

<template>
  <main class="page">
    <header class="header">
      <h1>補助專區</h1>
      <p class="status" :class="inApp ? 'status--app' : 'status--browser'">
        {{ inApp ? '已連上城市通' : '瀏覽器模式：使用模擬資料' }}
      </p>
    </header>

    <section class="card" aria-labelledby="account-title">
      <h2 id="account-title">使用者</h2>
      <p v-if="accountError" class="error">{{ accountError }}</p>
      <p v-else-if="!account">讀取中…</p>
      <dl v-else class="facts">
        <div><dt>姓名</dt><dd>{{ account.realName }}</dd></div>
        <div><dt>年齡</dt><dd>{{ ageOf(account.birthday) ?? '未知' }} 歲</dd></div>
        <div><dt>臺北市民</dt><dd>{{ account.citizen ? '是' : '否' }}</dd></div>
        <div><dt>行政區</dt><dd>{{ account.addresses[0]?.town ?? '未提供' }}</dd></div>
      </dl>
    </section>

    <section class="card" aria-labelledby="bridge-title">
      <h2 id="bridge-title">雙向溝通測試</h2>
      <div class="actions">
        <button
          v-for="action in actions"
          :key="action.label"
          type="button"
          class="button"
          :disabled="busy !== ''"
          @click="run(action.label, action.task)"
        >
          {{ action.label }}
        </button>
      </div>
      <div v-if="resultTitle" class="result" aria-live="polite">
        <h3>{{ resultTitle }}</h3>
        <pre>{{ resultText }}</pre>
      </div>
    </section>
  </main>
</template>

<style scoped>
.page {
  max-width: 600px;
  margin: 0 auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.header h1 {
  margin: 0 0 8px;
  font-size: 24px;
}

.status {
  display: inline-block;
  margin: 0;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 14px;
}

.status--app {
  background: var(--tp-primary-50);
  color: var(--tp-primary-700);
}

.status--browser {
  background: var(--tp-secondary-50);
  color: var(--tp-secondary-800);
}

.card {
  background: var(--tp-white);
  border-radius: 12px;
  padding: 16px;
}

.card h2 {
  margin: 0 0 12px;
  font-size: 18px;
}

.facts {
  margin: 0;
  display: grid;
  gap: 8px;
}

.facts div {
  display: flex;
  justify-content: space-between;
  gap: 16px;
}

.facts dt {
  color: var(--tp-grayscale-700);
}

.facts dd {
  margin: 0;
  font-weight: 600;
}

.actions {
  display: grid;
  gap: 8px;
}

.button {
  min-height: 48px;
  padding: 12px 16px;
  border: none;
  border-radius: 8px;
  background: var(--tp-primary-700);
  color: var(--tp-white);
  font: inherit;
  font-weight: 600;
  text-align: left;
  cursor: pointer;
}

.button:disabled {
  opacity: 0.5;
  cursor: default;
}

.button:focus-visible {
  outline: 3px solid var(--tp-secondary-500);
  outline-offset: 2px;
}

.result {
  margin-top: 16px;
}

.result h3 {
  margin: 0 0 8px;
  font-size: 16px;
}

.result pre {
  margin: 0;
  padding: 12px;
  border-radius: 8px;
  background: var(--tp-grayscale-50);
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
}

.error {
  color: var(--tp-red-500);
}
</style>
