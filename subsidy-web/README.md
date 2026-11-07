# 補助專區微服務

城市通「服務 › 熱門 › 補助專區」開啟的網頁。Vue 3 + Vite + TypeScript，建置為靜態檔，在城市通的 WebView 中執行，透過 `window.flutterObject` 與 App 雙向溝通。

## 開發

需要 Node.js 20 以上。

```bash
cd subsidy-web
npm install
npm run dev        # http://localhost:5173，同時對區域網路開放
npm test           # 雙向溝通單元測試
npm run build      # 型別檢查並輸出 dist/
```

在一般瀏覽器開啟時沒有 `flutterObject`，頁面會顯示「瀏覽器模式」，`userinfo`、`location` 等改用 `src/townpass/mock.ts` 的模擬資料（取自 App 的 `assets/mock_data/account.json`）。雙向溝通須在 App 內實測。

## 在實機的城市通裡開啟

1. 電腦與手機連同一個網路，`npm run dev`。
2. 查電腦的區網 IP：`ipconfig getifaddr en0`（macOS）。
3. 在專案根目錄以該網址建置城市通：

   ```bash
   flutter run --dart-define=SUBSIDY_URL=http://<電腦 IP>:5173
   ```

4. App 內進入「服務」頁，點熱門的「補助專區」。

App 端已允許開發時以 http 連到區域網路：iOS 在 `ios/Runner/Info.plist` 設 `NSAllowsLocalNetworking`，Android 在 debug 版的 `AndroidManifest.xml` 設 `usesCleartextTraffic`。正式網址須為 HTTPS。

## 雙向溝通

`src/townpass/` 封裝了與 App 的溝通，頁面只需匯入：

```ts
import { getUserInfo, getLocation, notify } from './townpass';

const account = await getUserInfo();   // 未登入時為 null
const position = await getLocation();  // 沒有權限時為 null
notify('補助專區', '有新的補助可以申請');
```

| 函式 | App 訊息 name | 回覆 |
|---|---|---|
| `getUserInfo()` | `userinfo` | 帳號資料，型別見 `types.ts` |
| `getLocation()` | `location` | 經緯度等定位資料 |
| `getDeviceInfo()` | `deviceinfo` | 裝置資訊 |
| `scanQRCode()` | `qr_code_scan` | 掃到的文字，不逾時 |
| `phoneCall(number)` | `phone_call` | 能否撥號 |
| `launchMap(url)` | `launch_map` | 能否開啟 |
| `call1999()` | `1999agree` | 成功時不回覆 |
| `notify(title, content)` | `notify` | 成功時不回覆 |
| `openLink(url)` | `open_link` | 成功時不回覆 |

格式：網頁 `flutterObject.postMessage(JSON.stringify({ name, data }))`；App 以 `message` 事件回覆 JSON 字串 `{ name, data }`，以 `name` 對應請求。App 端實作在 `lib/util/web_message_handler/`。

新增 App 能力時，在 App 端繼承 `TPWebMessageHandler`、加入 `TPWebMessageListener._cachedMessageHandlers`，網頁端以 `request('<name>', data)` 或 `send('<name>', data)` 呼叫。

## 部署（Firebase Hosting）

```bash
npm install -g firebase-tools
firebase login
firebase use --add          # 選擇 Firebase 專案
npm run build
firebase deploy --only hosting
```

`firebase.json` 已設定輸出目錄 `dist` 與單頁應用的路由。取得 `https://<專案>.web.app/` 後，以 `--dart-define=SUBSIDY_URL=<網址>` 建置 App。
