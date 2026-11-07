# 臺北市福利補助自己查｜開發設計書

版本 1.0｜2026-11-07｜審閱對象：全隊｜審閱方式：在本 PR 逐行留言，或在對應議題留言

本文件是開發的單一依據。產品定位見 `docs/microservice-design.md`；協作規則見 `AGENTS.md`；Town Pass 介面約定見 `docs/contracts/bridge.md`。三份文件與本文件衝突時，以合約與本文件為準，並由 PM 修正其他文件。

## 1. 結論

- 作品是 Town Pass 內的網頁微服務：市民以類別問答或一句話描述狀況，查出可申請的福利補助，並拿到「要帶什麼、去哪裡辦、找誰幫忙」。
- 前端為 Expo Router 輸出的靜態網頁，資格比對在裝置上完成，不需要後端即可 Demo；Town Pass 以 WebView 開啟，透過 `flutterObject` 取得使用者資料、撥號、定位、開啟連結。
- 與新北市「福利補助自己查」的差異是結果可行動：每一項都列出符合原因、還需要確認的條件、應備文件與最近據點，並可一鍵請人代辦。

## 2. 範圍

### 2.1 本次交付

| 編號 | 功能 | 對應議題 | 狀態 |
|---|---|---|---|
| F1 | 9 類入口與首頁 | — | 完成 |
| F2 | 一句話查詢（文字、語音，關鍵字規則） | — | 完成 |
| F3 | 一頁一題問答、每題可跳過、出生年分兩步選 | — | 完成 |
| F4 | 資格比對：很可能符合／再確認一件事／不符合 | #9 補「或」條件 | 完成，待擴充 |
| F5 | 結果卡與詳情頁 | — | 完成 |
| F6 | 一覽表（分類、搜尋） | — | 完成 |
| F7 | 帶去臨櫃清單（合併去重、打勾、列印） | #8 補文件 | 完成，資料待補 |
| F8 | 請人幫我（家人、里長、社工、1999） | #12 撥號改走 Town Pass | 完成，待接 App |
| F9 | 字級三段、高對比、朗讀 | — | 完成 |
| F10 | Town Pass 資料預填、撥號、開啟連結 | #7、#12 | 進行中 |
| F11 | 附近 3 個據點與導航 | #10、#13 | 待辦 |
| F12 | 全國性與民間補助、獎助學金 | #11、#16 | 待辦 |
| F13 | Town Pass 服務入口 | #6 | 待辦 |
| F14 | 部署 HTTPS 網址 | #5 | 待辦 |
| F15 | Demo 情境「獨居的陳阿嬤」 | #14 | 待辦 |

### 2.2 不做

- 真實送件、身分驗證、儲存個人資料的後端。
- 接入大型語言模型（一句話查詢先用關鍵字規則，介面保留替換點）。
- 其他縣市的地方補助、節能家電補助。

## 3. 系統架構

```
Town Pass（Flutter）
 ├─ 城市服務入口「福利補助自己查」 lib/page/city_service/model/my_service_model.dart
 └─ TPWebView 開啟微服務網址
      └─ flutterObject（tp_web_message_listener.dart）
           userinfo / phone_call / location / open_link / launch_map

微服務（microservice/welfare，Expo Router → 靜態網頁）
 ├─ src/app/            頁面路由
 ├─ src/components/     共用元件（item-card、ui-kit）
 ├─ src/lib/            邏輯：match、intake、describe、chosen、speech、phone、app-state、townpass（#12）
 ├─ src/data/           welfare-items、questions、welfare-schema、places（#10）
 └─ tests/              node:test 單元測試
```

- 執行環境：Town Pass WebView（Android 為主）與一般手機瀏覽器，兩者行為一致；Town Pass 專屬能力不存在時自動退回瀏覽器做法。
- 資料隨版本發布：補助、題庫、據點都是程式內的結構化檔案，改資料等於發新版。
- 無後端：比對、狀態、設定都在裝置上。正式導入時的 API 見第 10 節。

## 4. 頁面規格

| 路由 | 頁面 | 主要內容 | 進入點 |
|---|---|---|---|
| `/` | 首頁 | 標題、「說說你的狀況」（文字、語音）、9 類大格、查資格、一覽表、底部「請人幫我」 | Town Pass 入口 |
| `/quiz` | 問答 | 進度點、題目、大按鈕選項、「不知道／跳過」、上一題 | 首頁類別、查資格 |
| `/results` | 結果 | 「你告訴我們的」摘要、念給我聽、修改答案、兩組結果卡、帶去臨櫃、請人幫我、附近據點（#13） | 問答完成、一句話查詢 |
| `/item/[id]` | 詳情 | 白話說明、金額、資格、還需要確認、文件、申辦方式、來源與查核日 | 結果卡、一覽表 |
| `/list` | 一覽表 | 依類別分組、搜尋；#11 後再依臺北市／全國／民間分組 | 首頁 |
| `/checklist` | 帶去臨櫃 | 合併文件、打勾、列印、要去的地點 | 結果頁 |
| `/help` | 請人幫我 | 選對象、狀況摘要、同意勾選、分享或複製、撥 1999 | 每頁底部 |

共通規則：

- 375px 寬無橫向捲動；觸控目標 ≥ 48px；字級三段（1、1.2、1.45 倍）與高對比全站生效。
- 每頁頁尾：「本服務為黑客松原型，資料以各機關公告為準」。不使用市府標誌。
- 文案只有標題、標籤、數值與錯誤訊息；結果卡的白話說明屬於資料內容，不是說明文字。

## 5. 資料模型

定義於 `src/data/welfare-schema.ts`，變更須走 `contract` PR。

### 5.1 現行

| 型別 | 欄位 |
|---|---|
| `Profile` | `birthYear`、`residentMonths`、`identities[]`、`livesAlone`、`childrenUnder[]`、`employed`、`student`、`renter` |
| `Eligibility` | `ageMin`、`ageMax`、`residentMonthsMin`、`identitiesAny[]`、`livesAlone`、`childAgeMax`、`employed`、`student[]`、`renter`、`notes[]` |
| `WelfareItem` | `id`、`name`、`plain`、`categories[]`、`agency`、`amount?`、`eligibility`、`documents[]`、`apply{online?,counter?,phone?}`、`source`、`checkedAt` |

### 5.2 本次變更

| 變更 | 議題 | 內容 |
|---|---|---|
| 「或」條件 | #9 | `Eligibility.anyOf?: Omit<Eligibility,'notes'|'anyOf'>[]`；任一組全部符合即符合 |
| 補助層級 | #11 | `WelfareItem.level: 'city' | 'national' | 'private'`；既有 45 項為 `city` |
| 據點 | #10 | 新檔 `src/data/places.ts`：`{id,name,type,address,phone?,lat,lng,source}` |

合併順序：#9 → #11 → #16 → #8（都改 `welfare-items.ts`，每次開工前 rebase）。

### 5.3 資料品質規則

- 每筆附實際開過的官方網址與 `checkedAt`；第三方彙整（例如 `data-source/subsidy-gap-121.csv`）只當待查清單。
- 無法用欄位表達或讀不到的條件寫進 `notes`，不猜。
- 中央與臺北市同一政策合併為一筆，`notes` 說明差異。

## 6. 資格比對

實作於 `src/lib/match.ts`（`matchItem`、`matchAll`）。

1. 逐條件判斷：符合、不符合、未知（使用者跳過或沒問到）。
2. 任一條件不符合 → `no`。
3. 全部符合且沒有 `notes` → `match`。
4. 其他 → `maybe`，未知條件與 `notes` 顯示為「還需要確認」。
5. `anyOf`（#9）：各組分別判斷；任一組 `match` 則該部分符合；全部組都 `no` 則不符合；其餘為未知。
6. 排序：`match` 在前；同組依已知條件數由多到少，再依名稱。
7. 年齡以「今年減出生年」計，可能差一歲，「還需要確認」會註明以實際生日為準。

## 7. 一句話查詢

- `src/lib/intake.ts` 的 `interpretSituation(text)` 回傳類別、`Profile` 片段與「我聽到的是」摘要，使用者確認後才套用。
- 現行為關鍵字規則（類別、年齡含民國年、身分、獨居、租屋、就業）。
- 替換為模型時只改這個函式，介面與頁面不動；模型輸出必須經過同一個型別檢查，未知欄位丟棄。

## 8. Town Pass 整合

### 8.1 微服務端（#12）

`src/lib/townpass.ts`：

| 函式 | Town Pass 內 | 一般瀏覽器 |
|---|---|---|
| `isInTownPass()` | `typeof flutterObject !== 'undefined'` | false |
| `getUserInfo()` | `userinfo` 回覆 | null |
| `call(phone)` | `phone_call` | `tel:` |
| `openLink(url)` | `open_link` | `window.open` |
| `getLocation()` | `location` 回覆 | `navigator.geolocation`，拒絕時 null |
| `openMap(url)` | `launch_map` | 開地圖網址 |

- 訊息格式：`flutterObject.postMessage(JSON.stringify({ name, data }))`；回覆以 `name` 對應，逾時 3 秒視為無回覆。
- `userinfo` 預填的欄位顯示「已帶入台北通資料」，使用者可改。

### 8.2 App 端（#5、#6、#7）

- 服務入口：`MyServiceItemId` 新增一項，`destinationUrl` 為部署網址；開發時用 `http://10.0.2.2:8081` 連本機。
- 合約：#7 在 `docs/contracts/bridge.md` 寫明 `userinfo`、`location` 的 JSON 欄位，Web 依此實作。
- 新增 App 能力（例如分享摘要）時，Handler、Listener 註冊與合約在同一個 PR。

## 9. 狀態與隱私

| 資料 | 位置 | 保留 |
|---|---|---|
| 字級、高對比 | `localStorage` | 長期 |
| 類別、答案、已選項目 | `sessionStorage` | 分頁關閉即清除；重新整理保留 |
| 請人幫我的摘要 | 不保存 | 使用者勾選同意後才分享或複製 |

- 不收集身分證號、地址門牌、收入金額。
- 微服務不送出任何個人資料到伺服器；Town Pass `userinfo` 只在裝置上使用。

## 10. 正式導入的 API（不在本次範圍）

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/v1/welfare/items?category=&level=` | 補助清單 |
| GET | `/v1/welfare/items/{id}` | 單一補助 |
| GET | `/v1/welfare/questions?category=` | 題庫 |
| POST | `/v1/welfare/match` | 輸入 `Profile`，回傳比對結果；不保存輸入 |
| GET | `/v1/welfare/places?type=&lat=&lng=` | 附近據點 |
| POST | `/v1/welfare/help-requests` | 代辦協助請求；只保存當事人同意的欄位 |

資料維護建議由社會局以結構化格式提供，取代人工整理。

## 11. 部署（#5）

- `npx expo export --platform web` 輸出 `dist/`（不提交）。
- 靜態主機需支援深層網址（`/results`、`/item/AI030`）；設定 SPA fallback 或使用靜態路由輸出。
- 網址確定後寫入 `docs/contracts/bridge.md` 開頭與 Town Pass 服務入口。

## 12. 測試與驗收

| 層級 | 內容 | 指令 | 負責 |
|---|---|---|---|
| 型別 | 全專案 | `npx tsc --noEmit` | 各 PR |
| 單元 | `match`、`intake`、`phone`、`townpass`（#12）、`anyOf`（#9） | `npm test` | Web、Data |
| 介面 | 7 個頁面 375px 截圖，附在 PR | 本機瀏覽器或 headless | Web |
| App | `flutter analyze`、`flutter test`；模擬器點入口開啟微服務 | — | App |
| 資料 | 每個資料 PR 抽查 5 項與官方來源一致 | — | Data |
| 整體 | Demo 腳本完整走過，Town Pass 內與瀏覽器各一次 | — | PM |

## 13. Demo 腳本（3 分鐘）

| 秒數 | 畫面 | 說明重點 |
|---|---|---|
| 0–20 | 問題：新北已有「自己查」，但查到之後長輩仍拿不到 | 承認既有服務，點出缺口 |
| 20–50 | Town Pass 首頁 → 福利補助自己查 | 在台北通內開啟、大字介面 |
| 50–100 | 示範情境：獨居的陳阿嬤（#14） | 預填資料、很可能符合 N 項、符合原因 |
| 100–130 | 還需要確認 → 帶去臨櫃清單 → 最近的區公所 | 一次辦好、不白跑 |
| 130–160 | 請人幫我 → 里長／1999 | 不會操作也拿得到 |
| 160–180 | 資料來源、可擴充、正式導入 API | 可落地 |

## 14. 時程

| 時段 | 里程碑 | 議題 |
|---|---|---|
| 現在 → +1.5 小時 | 合約與資料結構定案；部署網址；Town Pass 入口 | #5、#6、#7、#9 |
| +1.5 → +3 小時 | 橋接、附近據點、資料補齊、Demo 情境 | #8、#10、#11、#12、#13、#14、#16 |
| +3 小時 → 截止前 90 分鐘 | 全頁截圖驗收、Town Pass 內實測 | — |
| 截止前 90 分鐘 | 停止新功能，只修錯、簡報與演練 | — |

## 15. 風險與對策

| 風險 | 影響 | 對策 |
|---|---|---|
| 多個資料議題同改 `welfare-items.ts` | 合併衝突 | 依 5.2 合併順序；PR 小而快；開工前 rebase |
| 部署需要人工登入雲端帳號 | App 入口無網址 | 代理準備設定，人只做登入；備案用本機 `10.0.2.2` Demo |
| `userinfo` 沒有出生日期或戶籍 | 無法預填 | 改由問答取得；畫面不出現「已帶入」 |
| 補助條件整理錯誤 | 評審質疑可信度 | 每項附來源與查核日；不確定的列為「還需要確認」 |
| 代理改到角色以外的檔案 | 互相覆蓋 | `AGENTS.md` 路徑分工；PM 審查時退回越界變更 |

## 16. 審閱重點

請各角色至少確認：

- Web：第 4、6、7、8.1、9 節。
- App：第 3、8.2、11 節與 Demo 腳本中 Town Pass 的步驟。
- Data：第 5 節與資料品質規則。
- 全員：第 2 節範圍與第 13 節 Demo 腳本。

意見請在本 PR 留言；需要改設計時提出替代方案，PM 在一小時內裁決並更新本文件。
