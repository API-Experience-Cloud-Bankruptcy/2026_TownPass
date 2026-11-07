/// <reference types="vitest/config" />
import { defineConfig, type Plugin } from 'vite';
import vue from '@vitejs/plugin-vue';

const SNAPSHOT_ID = 'virtual:catalog-snapshot';
const RESOLVED_SNAPSHOT_ID = `\0${SNAPSHOT_ID}`;

/**
 * 建置快照：把 backend/data/subsidies.json 原始檔逐字包成虛擬模組（預設匯出 JSON 字串）。
 * 開發與建置走同一路徑，不需開放 dev server 讀取專案外檔案，也不受 JSON MIME 影響。
 */
function catalogSnapshot(): Plugin {
  let file = '';
  return {
    name: 'catalog-snapshot',
    configResolved(config) {
      file = `${config.root}/../backend/data/subsidies.json`;
    },
    resolveId(id) {
      return id === SNAPSHOT_ID ? RESOLVED_SNAPSHOT_ID : null;
    },
    async load(id) {
      if (id !== RESOLVED_SNAPSHOT_ID) return null;
      const fs = (await import('node:' + 'fs')) as { readFileSync(path: string, encoding: 'utf8'): string };
      this.addWatchFile(file);
      return `export default ${JSON.stringify(fs.readFileSync(file, 'utf8'))};`;
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), catalogSnapshot()],
  server: {
    // 對區域網路開放，讓實機上的城市通能以 http://<電腦 IP>:5173 開啟
    host: true,
    port: 5173,
    strictPort: true,
    // 開發時 /api 轉到本機後端；正式環境以 VITE_API_BASE_URL 指定
    proxy: {
      '/api': 'http://127.0.0.1:8080',
    },
  },
  preview: {
    host: true,
    port: 4173,
    proxy: {
      '/api': 'http://127.0.0.1:8080',
    },
  },
  test: {
    environment: 'node',
  },
});
