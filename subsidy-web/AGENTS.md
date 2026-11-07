# 補助專區微服務：開發技術說明

給接手的人與 AI agent。讀完這份就能開始開發，不需要再看賽前工作坊的「2026 城市通入門指引」投影片：其中的技術細節與規則都整理在這裡，並對照本 repo 的實際程式碼校正過。

- 競賽：2026 臺北秋季程式設計節・城市通微服務大黑客松（主辦：臺北市政府資訊局）
- 本資料夾：`subsidy-web/`，城市通「服務 › 熱門 › 補助專區」開啟的微服務網頁
- 目前整合分支：`clean-ver`（已整合福利通前後端與 UI 規劃）
- 使用說明見同資料夾 `README.md`；這份是技術背景、規則與陷阱

## 1. 競賽規則（會影響技術選擇）

| 規則 | 對開發的意義 |
|---|---|
| 作品以 AGPL-3.0 開源，repo 公開，得獎後維持公開至少一年 | 不要放任何金鑰、`.env`、個資進 repo |
| 只用開源、免費的套件 | 選套件先看 LICENSE：MIT、BSD、Apache-2.0 可用；「僅供個人使用」「不得再散布」不可用 |
| 地圖須用開源方案 | Leaflet 或 MapLibre，搭配 OpenStreetMap 或國土測繪中心圖資。**不可**用 Google Maps、Mapbox、`google_maps_flutter` |
| 執行時的 AI 推論須在裝置端 | 不可在執行時呼叫雲端 LLM API（含使用者輸入的推論）。開發階段用雲端 AI 寫程式沒問題。評審可能關網路現場測試 |
| 禁用危害國家資通安全清單上的 AI 工具與模型（含大陸廠牌） | 選模型時排除 |
| 核心資料須為合法開放資料並註明出處 | 非核心資料可用模擬資料，但 README 與 Demo 要標明 |
| 不得使用臺北市政府 logo 或宣稱為官方服務 | UI 文案注意 |
| 發表時投影作品實際運作畫面，不用簡報 | Demo 流程：開 App → 服務 → 補助專區 → 完成一條流程 |

繳交項目：所有原始碼（微服務、後端、修改後的 TownPass）、AGPL-3.0 授權聲明、README（照著做就能建置）、資料來源清單（名稱＋連結，標明模擬資料）、第三方套件清單（名稱＋授權）、有用 AI 時揭露模型名稱、版本、量化格式、推論框架、來源。

## 2. 整體架構

```
城市通 App（Flutter）  ⇄  微服務網頁（本資料夾，在 WebView 中執行）  →  後端 API（選配）  →  開放資料
        雙向溝通：window.flutterObject                                    data.taipei / data.gov.tw / TDX
```

- 網頁語言、框架不限；本專案用 Vue 3 + Vite + TypeScript（與官方範例同為 Vue 3）。
- App 不一定要改，但新增原生能力時要寫 Flutter Handler（第 5 節）。
- 需要存資料或伺服器邏輯時才加後端，語言不限；網頁在 `web.app`、API 在 `run.app` 屬不同網域，後端要設 CORS。

## 3. 開發環境

| 項目 | 版本或設定 | 備註 |
|---|---|---|
| Flutter | `.fvmrc` 指定 3.47.6（本機目前 3.47.8 也可建置） | 有 FVM 時用 `fvm flutter …` |
| Dart SDK | `>=3.13.0`（`pubspec.yaml`） | |
| iOS | 最低 15.0，UIScene lifecycle，iOS 外掛優先選支援 Swift Package Manager 的 | 建置需 Mac＋Xcode |
| Android | AGP 9.1.0、Kotlin 2.4.0、Gradle 9.3.1，電腦需 Java 17 | build 有問題先 `flutter clean` |
| 網頁 | Node.js 20 以上 | `npm install` 會依 `package-lock.json` 安裝 |

App 建置步驟（在 repo 根目錄）：

```bash
flutter pub get
dart run build_runner build --delete-conflicting-outputs   # 產生 lib/gen/assets.gen.dart 與 JSON 序列化程式碼
flutter run                                                # 開模擬器或接手機
```

- `lib/gen/`、`*.g.dart` 是產生檔，不進 git。**新增 SVG 或改 `@JsonSerializable` 類別後必須重跑 build_runner**，否則編譯失敗（`Error when reading 'lib/gen/assets.gen.dart'`）。
- 首次 iOS 建置很慢；首次對某個 iOS 版本除錯時還會複製 Device Support symbols，無線連線要好幾分鐘。

### 本機 iPhone 建置的注意事項（只適用這台電腦）

- 實機 elevenbook（iPhone 16，iOS 26.6.2）用 **Wi-Fi 無線**連線；目前沒有可傳資料的 USB 線。裝置 ID：`00008140-000A093A1E13001C`。
- 為了用自己的 Apple 開發者帳號簽署，本機改了 `ios/Runner.xcodeproj/project.pbxproj`（`DEVELOPMENT_TEAM = S3DSU79C4X`、Bundle ID `com.felix0901.townpass`），CocoaPods 也改了 `ios/Podfile.lock`。**這兩個檔案不要 commit**：上游原本是 `ZLLDAN62HX` 與 `com.example.townpass`。
- **debug 版無法在這台用**：無線 debug 需要終端機（herdr）有 macOS「系統設定 › 隱私權與安全性 › 區域網路」權限，目前沒有，會出現 `Flutter could not access the local network`。所以沒有 hot reload，改用 release 版安裝（裝好就能獨立執行）：

  ```bash
  flutter run --release --no-resident -d 00008140-000A093A1E13001C \
    --dart-define=SUBSIDY_URL=http://<電腦區網 IP>:5173
  ```

  改 Flutter 程式要重新建置（約 1 分鐘）；改網頁不用，關掉補助專區頁面再打開即可。

  上述網頁即時更新僅適用 Vite 開發伺服器。持續實機試用可改用 [後端說明](../backend/README.md) 的 macOS 常駐服務：提供建置後網頁與 API，更新內容須重新建置並安裝。不能將 Mac 本機限定網址視為 iPhone 可連線網址；服務停止、Mac 睡眠與 IP 變更須分別排查。

## 4. 微服務網頁開發

```bash
cd subsidy-web
npm install
npm run dev     # http://localhost:5173，host: true 對區網開放
npm test        # vitest，雙向溝通測試
npm run build   # vue-tsc 型別檢查 + 輸出 dist/
```

在 App 內開啟開發伺服器：

1. 電腦與手機同一網路；`ipconfig getifaddr en0` 查電腦 IP（目前是 `172.20.10.4`，iPhone 個人熱點網段，換網路會變）。
2. 用 `--dart-define=SUBSIDY_URL=http://<IP>:5173` 建置 App（見上節）。網址在 `lib/page/city_service/model/trending_service_model.dart` 的 `TrendingServiceModel.subsidyUrl` 讀取；未指定時入口不開啟任何頁面（`TPRoute.openUri` 遇空字串直接返回）。
3. App 允許開發時以 http 連區網：iOS `ios/Runner/Info.plist` 的 `NSAppTransportSecurity › NSAllowsLocalNetworking`，Android 只在 `android/app/src/debug/AndroidManifest.xml` 設 `usesCleartextTraffic`。**正式網址必須 HTTPS**。

檔案結構：

```
subsidy-web/
├─ index.html            lang=zh-Hant-TW，title「補助專區」
├─ vite.config.ts        dev server 5173（strictPort）、vitest 設定
├─ firebase.json         Firebase Hosting：public=dist，SPA rewrite
└─ src/
   ├─ main.ts / App.vue  福利通逐頁流程與三入口導覽
   ├─ store.ts           對象、需求、題目、行動單與導覽狀態
   ├─ components/       ChatView（對話式：選對象→需求→問答→結果）、詳情、行動單、求助頁
   │  └─ chat/          BotMessage（打字效果）、UserMessage（點擊改答案）、WheelPicker（年齡滾輪）
   ├─ chat/typing.ts    打字速度（字多加快但仍逐字，整則上限 3.5 秒）、已播放紀錄、自動往下捲（長訊息停在開頭）
   ├─ domain/           資料讀取、保守規則、固定題庫與完整輸出
   ├─ tokens.css         設計 token：--tp-*（對照 Flutter）＋語意層（--accent、--fs-*…）
   ├─ style.css          元件樣式，只用語意 token
   └─ townpass/          與 App 溝通的封裝（第 5 節）
      ├─ bridge.ts       底層：isInTownPass、send、request、parseMessage
      ├─ index.ts        型別化 API：getUserInfo、getLocation…
      ├─ types.ts        Account、Position 型別
      ├─ mock.ts         一般瀏覽器使用的模擬資料
      └─ bridge.test.ts
```

## 5. 與 App 雙向溝通

### 協定

- App 在 WebView 載入時注入 JS 物件 `window.flutterObject`（`lib/util/tp_web_view.dart` 呼叫 `addWebMessageListener`；底層是 `flutter_inappwebview` 的 `WebMessageListener`）。
- 網頁送出：`flutterObject.postMessage(JSON.stringify({ name, data }))`，**必須是字串**。
- App 端 `TPWebMessageListener`（`lib/util/web_message_handler/tp_web_message_listener.dart`）`jsonDecode` 後，依 `name` 找到 `TPWebMessageHandler` 執行。
- App 回覆：`flutterObject` 的 `message` 事件，`event.data` 是 JSON 字串 `{ name, data }`（`TPWebStringMessageReply`）。回覆沒有請求 ID，只能用 `name` 對應，所以**同一個 name 同時只發一個請求**。
- 一般瀏覽器沒有 `flutterObject`；要先判斷，必要時用模擬資料。雙向溝通只有在 App 內才能實測。
- 監聽器用完要 `removeEventListener`，否則會重複觸發。

### 網頁端用法

一律透過 `src/townpass/`，不要在頁面直接呼叫 `postMessage`：

```ts
import { getUserInfo, getLocation, notify, isInTownPass } from './townpass';

const account = await getUserInfo();   // 未登入時 null
const position = await getLocation();  // 無權限時 null
notify('補助專區', '有新的補助可以申請');
```

- `request<T>(name, data, { timeoutMs })`：送出並等同名回覆，預設 10 秒逾時，`0` 為不逾時；逾時以 `TownPassError` `code: 'TIMEOUT'` 拒絕。不在 App 內時回傳 `mock.ts` 的資料，沒有對應資料則 `code: 'NOT_IN_APP'`。
- `send(name, data)`：只送不等，用於成功時 App 不回覆的能力。

### 內建能力（對照 `lib/util/web_message_handler/tp_web_message_handler.dart` 的實作）

| name | 送出 data | App 回覆 data | 封裝函式 | 實作細節與陷阱 |
|---|---|---|---|---|
| `userinfo` | 無 | `Account` 物件；沒有帳號時 `[]` | `getUserInfo()` → `Account \| null` | 資料來自 `assets/mock_data/account.json`（假資料） |
| `location` | 無 | geolocator `Position.toJson()`；失敗時 `[]` | `getLocation()` → `Position \| null` | 欄位：`latitude`、`longitude`、`timestamp`（epoch 毫秒）、`accuracy`、`altitude`、`heading`、`speed`、`is_mocked`… |
| `deviceinfo` | 無 | 裝置資訊物件；失敗時 `[]` | `getDeviceInfo()` | 欄位依平台不同 |
| `qr_code_scan` | 無 | 掃到的字串；使用者返回時 `null` | `scanQRCode()` | 開 App 掃碼頁，等使用者操作，不設逾時 |
| `phone_call` | 電話號碼字串 | `true`/`false`（能否撥號） | `phoneCall(n)` | data 為 null 時會回 `false` 但接著拋例外 |
| `launch_map` | 網址字串 | `true`/`false` | `launchMap(url)` | 同上，data 非字串時回 `false` 後拋例外 |
| `1999agree` | 任意非 null | 失敗時 `false`，**成功不回覆** | `call1999()` | 會先要求同意使用條款，再跳撥號對話框 |
| `notify` | `{ title, content }` | 失敗時 `false`，**成功不回覆** | `notify(t, c)` | content 符合「已訂閱X」「已取消訂閱X」時會同步更新 App 的訂閱清單 |
| `open_link` | 網址字串 | 失敗時 `false`，**成功不回覆** | `openLink(url)` | 在 App 內以新的 WebView 頁面開啟 |

### 擴充 App 能力（自訂 Handler）

```dart
class GreetingMessageHandler extends TPWebMessageHandler {
  @override
  String get name => 'greeting';

  @override
  Future<void> handle({
    required Object? message,
    required WebUri? sourceOrigin,
    required bool isMainFrame,
    required Function(WebMessage reply)? onReply,
  }) async {
    onReply?.call(replyWebMessage(data: '哈囉，$message！'));
  }
}
```

1. 繼承 `TPWebMessageHandler`（寫在 `tp_web_message_handler.dart` 或新檔）。去年叫 `CPWebMessageHandler`，網路上的舊範例要改名。
2. `name` 不可與內建名稱重複。
3. 加入 `TPWebMessageListener._cachedMessageHandlers`。
4. 網頁端：`request<string>('greeting', '市民')`，並在 `mock.ts` 補模擬回覆。
5. 用到原生權限時：iOS `Info.plist` 填用途說明，Android `AndroidManifest.xml` 加權限。套件從 pub.dev 選 MIT／BSD／Apache。

可擴充的方向：NFC、藍牙、陀螺儀、健康資料、音訊、IoT、Wi-Fi、AR/VR、裝置端 AI。往屆案例：2024 ParkFlow 在 App 端自訂 `timer_set` Handler，用本機通知排程，網頁關閉後仍能提醒。

### WebView 注意事項

- iOS 預設會擋彈出視窗，Android 要自行處理，兩個平台都要測。
- 切換頁面或 App 進背景時，釋放 WebView 資源。
- 開發時可用 Chrome DevTools 裝置模擬看版面，但完成後要在 App 內實測。

## 6. 在 App 中的入口設定

「服務」頁（`lib/page/city_service/`）有四個區塊：我的服務（使用者置頂）、更多／新增（服務列表）、服務拼貼（中央四張卡片）、熱門。

| 位置 | 檔案 | 做法 |
|---|---|---|
| 熱門 | `model/trending_service_model.dart` | 在 `serviceList` 加 `TrendingService(title, icon, url, forceWebViewTitle?)`。一列兩個，依序由左至右、由上至下。**補助專區已在第 4 個（施工資訊右邊）** |
| 服務列表／我的服務 | `model/my_service_model.dart` | ① `MyServiceItemId` enum 加 id；② `MyServiceIdExt` 的 switch 加 `MyServiceItem(title, description, icon, category, destinationUrl, forceWebViewTitle?)`；③ App 內「服務 › 更多」加入 |
| 服務拼貼 | `widget/official_service_card/` | 四張卡片各為一個 Widget，`onTap` 仍為 TODO，填網址即可 |

`MyServiceCategory` 五個分類：市政服務、防疫醫療、城市生活、探索臺北、其他服務。

### 圖示

1. SVG 放 `assets/svg/`，檔名 snake_case（例 `icon_subsidy.svg`）。
2. 跑 build_runner。
3. 程式中用 `Assets.svg.iconSubsidy.svg()`。

熱門圖示的樣式：48×48、`#5AB4C5` 圓形底（`rx="24"`）、白色圖案約佔中央 24×24、線條 `stroke-width="1.8"` 圓角端點。補助專區用的 `icon_subsidy.svg` 依此設計（白色線條優惠券＋「$」）。

## 7. 設計規範

- Figma：Town Pass UI Kit（45+ 畫面、100+ 元件），開發文件首頁有連結，搜「Town Pass Design Tokens」。
- 色票（`lib/util/tp_colors.dart`，網頁完整寫成 `src/tokens.css` 的 `--tp-*`，元件只用其語意層）：Primary 500 `#5AB4C5`、Secondary 500 `#F5BA4B`、Grayscale 500 `#738995`，各有 50–950 階。
  - 白字放在 primary-500 上對比不足（約 2.4:1）；本專案按鈕底色用 primary-700 `#356C77`，次要文字用 grayscale-700。
- 字體：中文 PingFang TC，英數 Roboto。
- 字級（`TPTextStyles`）：h1 36、h2 24、title 18、h3 16、body 14、caption 12。

### 無障礙（城市通 12 類規範）

替代文字（圖示可朗讀、裝飾圖隱藏）、不自動播放影音、通知與對話框可朗讀、**觸控目標至少 48×48**、焦點順序上到下左到右、表單欄位標籤清楚、連結描述明確、不閃爍、每頁一個標題、內容順序合乎邏輯、**文字放大 200% 仍可閱讀**、導覽與圖示一致。目標使用者包含長者與視障者。

## 8. 資料

| 來源 | 網址 | 備註 |
|---|---|---|
| 臺北市資料大平臺 | data.taipei | 優先使用 |
| 政府資料開放平臺 | data.gov.tw | 全國資料 |
| TDX 運輸資料流通服務 | tdx.transportdata.tw | 需註冊取得金鑰（金鑰不可進 repo） |
| 臺北城市儀表板 | dashboard.gov.taipei | 開源：github.com/tpe-doit/Taipei-City-Dashboard |

- App 的假資料在 `assets/mock_data/`：`account.json`（userinfo）、`activity.json`、`home_banner.json`、`message.json`、`subscription.json`。要展示「非市民」或「長者」情境，改 `account.json` 的 `citizen`、`birthday`。
- AI 會編造看似正確的 API 網址、資料集名稱與欄位，每一項都要實際打開來源確認。

## 9. 部署

| 對象 | 平台 | 指令 |
|---|---|---|
| 網頁（靜態檔） | Firebase Hosting（亦可 GitHub Pages、Cloudflare Pages、Vercel，須 HTTPS） | `npm run build && firebase deploy --only hosting` |
| 後端（若有） | Cloud Run（亦可 Render、Fly.io；比賽期間可用 ngrok） | `gcloud run deploy <服務名> --source . --region asia-east1` |

- Firebase 首次：`npm install -g firebase-tools`、`firebase login`、`firebase use --add`。`firebase.json` 已設定好，不需要 `firebase init`（若重跑 init：public 填 `dist`、SPA 選 Yes、不覆蓋 index.html）。
- Cloud Run：附 Dockerfile 以利資訊局接手；服務要監聽環境變數 `PORT`；Container Registry（gcr.io）已於 2025/3 關閉，改用 Artifact Registry；區域選 `asia-east1`（彰化）。
- 部署後以 `--dart-define=SUBSIDY_URL=https://<專案>.web.app/` 建置 App，從 App 內開啟並實測雙向溝通。
- 免費方案即可。

## 10. 裝置端 AI（選用）

目前架構：網頁透過帶 requestId 的 `llm_status`／`llm_prepare`／`llm_interpret` → 原生 `LlmMessageHandler` → 手機 LiteRT-LM → 回覆候選語意。僅允許 `SUBSIDY_URL` 同源主框架。首次進入會詢問是否下載模型，使用者同意後才下載；已有模型則每次進入自動載入，自然語句不會自動開始大型下載。模型推論在手機完成，資格依既有規則與使用者確認；完整網頁離線仍須另驗收。

| Flutter 套件 | 支援 | 授權 |
|---|---|---|
| `flutter_edge_ai`（原 flutter_gemma） | Gemma 4 E2B/E4B、Gemma 3n、Phi-4 Mini；`.litertlm`、`.task`、`.onnx` | MIT |
| `llamadart` | GGUF（llama.cpp）、`.litertlm`；需 Dart 3.10+、Flutter 3.38+ | MIT |

已接入原版 Gemma 4 E2B-it 的 LiteRT-LM bundle（Apache 2.0，2,588,147,712 bytes），不用本專案未通過的微調 adapter。固定 revision、SHA-256、量化來源、原生套件版本、建置及實機測試方法見 [裝置端模型說明](../docs/device-llm-runtime.md)。模型檔不進 repo；首次下載校驗後保留在 App 私有儲存，重啟須重新載入。Demo 前仍須預熱並以飛航模式驗收完整使用流程。

## 11. 本專案慣例

- UI 文案用繁體中文，不寫贅句；手機寬 375px 不可水平捲動。
- commit 格式：`<Type>: <繁體中文短描述，約 20 字內>`，Type 為 `Feat`、`Fix`、`Refactor`、`Docs`、`Test`、`Chore`、`Style`。一個 commit 一件事。
- 不 commit：`node_modules/`、`dist/`、`lib/gen/`、`*.g.dart`、金鑰、`.env`，以及第 3 節提到的本機簽署檔。
- 改網頁後跑 `npm test` 與 `npm run build`；改 Flutter 後跑 `flutter analyze`。

## 12. 目前進度與待辦

已完成福利通前後端核心流程，並升級為依答案重排的動態問答：217 筆完整資料 API 與逐筆探索映射、來源綁定必要條件、本機保守初篩、不確定需求的生活情境探索、辦理路線、文件準備、求助及行動單輸出。題目來自共用模板，不由執行時 AI 生成；探索方向與資格判斷分開。詳細範圍及驗證見 `README.md` 與 `../docs/welfare-implementation-contract.md`。

行動單持久化：`domain/action-plan.ts` 透過 `/api/action-plan` 讀寫 SQLite，僅保存資源與準備進度，不傳資格答案／聊天原句。後端須明確啟用 `DEMO_MODE=1`；App、瀏覽器與 DB 共用 `assets/mock_data/account.json` 的虛擬測試者，非正式台北通登入。資料欄位與限制見 `../docs/townpass-profile.md`。保存狀態以後端回覆為準，revision 衝突不得靜默覆寫。`../scripts/install_macos_service.py --demo` 將 DB 放在 release 以外的持久目錄。

頂部品牌／分頁與底部對話輸入列不參與內容捲動；對話在 `.chat__log` 捲動，一般頁在 `.app-main` 捲動。返回找資源時提供續接選擇，初始招呼頁除外；開新對話保留行動單，換人／清除仍依確認內容清除。

UI 維護原則：每頁一個決定，完整資格及來源按需展開；不得因文字精簡刪掉必要提醒、資料原文或匯出條件。切換需求不得混入舊搜尋篩選；換人必須確認並清除舊答案與行動單。題目切換須處理焦點與連點，不用 AI 生成題庫。

動態問答維護須涵蓋返回改答後恢復分支、已略過問題不重複追問、切需求清除不相關探索偏好，以及 catalog／資格／探索／模板版本更新後的工作階段失效。顯示的聚焦筆數不等於符合資格筆數；其他候選、時效不明與已截止項目須保留可查入口。

替他人查詢的交付改為 A4 PDF 檢核表：`checklist.ts` 建共用內容、`checklist-pdf.ts` 本機產生實際 PDF（TTF 完整嵌入以避免閱讀器缺字，不改成未驗證的 subset），`ChecklistView.vue` 預覽／下載；本人線上行動單保留。PDF 需保留完整條件、待確認、來源與文件差異，個人填答沿用欄位揭露控制；內容變更撤銷舊檔。字型為附授權的本站 Noto Sans TC，按需載入，不用 CDN。App 的 `share_pdf` 由 printing 開啟系統分享選單，回覆不代表已保存或送出；新增外掛需重新建置 App。

資源詳情的「申請表與填寫」按需載入 `FormFillPanel`；本人資料須逐項確認，編輯、撤銷、關閉或換資源／對象即清除確認與舊 PDF。`/api/forms/{file}` 提供空白官方 PDF，搬移後端執行檔時須設定 `FORMS_DIR`；macOS 安裝工具會複製空白表單到各 release。已知共用表單的錯位姓名欄禁止自動填入並提示手寫。

待驗收：手機 WebView 的檔案交付、分享、讀屏及完整離線；原版 Gemma 4 E2B 已接入並完成 iPhone 原生載入，語意/schema 與端到端結果依實機紀錄分別判定。安裝 App 不等於全部手機流程已通過；未部署正式公開服務。

## 參考資源

- TownPass 原始碼：github.com/taipei-doit/TownPass
- 開發文件（中英，含「Two-Way Connection on Website」、無障礙設計）：tpe-guideline.web.app
- 活動官網、競賽須知：codefest.taipei/2026-fall
- 往屆整併作品（可參考雙向溝通與 README 寫法）：github.com/taipei-doit/townpass2024-parking（Vue 3＋FastAPI、自訂 Handler）、townpass2025-RideFlow（Vue 3＋FastAPI＋XGBoost）、townpass2024-weather（純 HTML/JS＋Leaflet）
- 官方 Vue 微服務的雙向溝通封裝：`src/composables/useConnectionMessage.ts`、`useHandleConnectionData.ts`
