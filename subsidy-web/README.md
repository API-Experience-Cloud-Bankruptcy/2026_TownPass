# 福利通｜補助專區微服務

城市通「服務 › 熱門 › 補助專區」開啟的網頁。Vue 3 + Vite + TypeScript，建置為靜態檔，在城市通 WebView 中執行。

逐頁選擇查詢對象 → 選「還不確定，帶我找」、生活情境或名稱搜尋 → 一頁一題的動態問答 → 建議先看的幾項＋可展開的其他候選 → 詳情與辦理路線 → 準備文件／預覽並輸出行動單。卡住時逐步選擇困難與資源，再產生求助文字。**本服務非政府官方服務**；產生的內容是申辦準備摘要，**不是核准或送件證明**。

## 介面原則

- 每頁只處理一個決定；本人與替他人共用流程，問句依查詢對象調整，不推測資格。
- 需求頁有三條入口：醒目的「還不確定，帶我找」（`startExplore`）、生活情境分類、名稱或關鍵字搜尋；切換時清掉另一條的篩選。
- 問答不顯示固定總題數：題目由 store 依前面答案重新決定，畫面只說「已回答 N 題・目前聚焦 N 項」。「目前聚焦」是依填答去掉明確不符、再依探索方向收斂後的筆數，不是符合資格的數量；偏好收斂不說成資格排除。每題直接顯示這題的用處（`description`），可「不知道，先跳過」（不當成「否」）、「上一題」改答案、「先看目前結果」。回答後以一行文字如實回饋聚焦數是否變少（比較作答前後的 `questionInsight.remainingCount`），不預測下一題會縮小多少；題目問完時說明「目前仍有條件需要確認」。
- 結果頁先列「先從這幾項了解」（`recommendedCandidates`），其餘收在可展開區：「其他相關資源」、「受理時間需確認」（`uncertainCandidates`）、「目前已截止」（`closedCandidates`）、「依填寫的條件不符」。分組依 store，畫面不自行判斷截止或資格；同一項只出現在一組（建議 → 已截止 → 受理時間需確認 → 其他），各組數量為實際列出筆數。「再回答幾題，繼續縮小」呼叫 `continueQuestions()`（接續本次，延長題數）；「改答案」呼叫 `startQuestions()`（從頭檢視、保留答案）。全部略過時仍可看資料，但標明不是依個人情況挑選。
- 清單列與詳情都標示填寫條件不符、期限可能已過、受理情形原文提到截止或未開放。
- 詳情依序為「能提供什麼」（補助內容原文全文）→「要先注意」（提醒、適用對象原文、受理情形、期限）→「想申請的話」（加入行動單、申請方法連結）→ 辦理步驟、文件、窗口；完整初篩說明及來源可展開。
- 行動單分成概覽、文件準備與匯出；完整輸出預覽不再預設攤開，開啟預覽後才可分享或下載。
- 簡化的是畫面資訊量；原始條件、來源及完整匯出內容保留。返回修改不清除同一人的答案，換人仍需確認。
- 白底、留白與細分隔取代彩色提示框及深色側邊線。短句先說明下一步，官文按需展開；不以簡化文案取代正式資格。

## 開發

需要 Node.js 20 以上。

```bash
cd subsidy-web
npm install
npm run dev        # http://localhost:5173，同時對區域網路開放
npm test           # Vitest 單元測試
npm run build      # vue-tsc 型別檢查並輸出 dist/
```

## 資料來源與 API

| 設定 | 說明 |
|---|---|
| 開發 | `npm run dev` 時 `/api` 由 Vite proxy 轉到 `http://127.0.0.1:8080`（先啟動 `backend/`） |
| 正式 | 建置時設定 `VITE_API_BASE_URL=https://<後端網域>`，網頁會讀 `${VITE_API_BASE_URL}/api/catalog` 與 `/api/questions` |

- `GET /api/catalog` 回傳 `{version, items}` 完整原始資料（217 筆）；前端逐筆驗證實際用到的欄位（scope、search、application、eligibility 陣列等），任何一筆不符、逾時（8 秒）或連不上，就改用**建置快照**。
- 建置快照是 `backend/data/subsidies.json` 原始檔逐字打包（`vite.config.ts` 的 `virtual:catalog-snapshot`，獨立 chunk、按需載入），結構與 API 相同。版本 `catalog-v1-<FNV-1a 64>` 以原始文字計算，與後端一致；資料版本變更時會重新判斷並重設準備進度。
- 使用快照時頁面會明示「暫用已保存的資料，官方網站仍需連線」。這只是 API 備援，**不是完整離線模式**：沒有 Service Worker，網頁本身與外部官方網站仍需網路。
- `GET /api/questions` 不可用時使用本機共用模板題庫（`backend/rules/question-templates.json`），出題依據與後端相同。探索映射與必要資格條件分開；每次回答依剩餘候選重排有用題目與探索選項，並處理略過、返回、改答及分支失效。`startQuestions()` 重新檢視答案，`continueQuestions()` 接續未問的題目。題目不由 AI 生成，不保證回答固定題數即可確認資格。
- 查核標記（verified／partial／unverified）與查核日期都是**資料原有狀態**，本服務未重新查核。各筆的來源網址列於詳情頁，依 `source_meta.sources[].type` 標示官方、第三方或「來源類型未標示」。

## 隱私：答案只在本機

- 答案、行動單、勾選進度預設只存在**本分頁的這次工作階段**（`sessionStorage`，`welfare-tong:session:v1`），重新整理可繼續；關閉分頁後由瀏覽器清除，WebView 關閉後是否一定清除依平台而定，尚未實機驗證。答案在瀏覽器端評估，**不送後端**；後端 `POST /api/match` 不會被自動呼叫。本版不提供長期保存。
- 「設定 › 清除這次的資料」可立即清除，同時移除舊版曾寫入 `localStorage` 的同名資料（啟動時也會清掉）；切換查詢對象或按「換人」前會確認並清除前一位的資料。大字／高對比偏好存於 `localStorage`，不含個資。
- 啟動時 catalog 與題庫都載入成功後，才一次套用新資料與版本遷移；資格規則、探索映射及題目模板皆納入引擎版本。版本變更時重設受影響的探索答案、已問題紀錄與準備進度；載入失敗則保留原狀態並顯示重試。
- 不讀取城市通 `userinfo`（其內容為 App 的模擬帳號）作為任何人的資格條件。
- 輸出（行動單、求助文字）預設不含填答條件；勾選加入的條件才會出現，含填答值的初篩說明也只在對應條件勾選後輸出。

## 資格初篩規則（保守）

`src/domain/match.ts`，與後端 `matcher.rs` 對齊：

- 結果只有「還有條件待確認」與「目前條件不符」。`likely` 保留在型別中但現階段不發出。
- 兩端共用 `backend/rules/eligibility-reviewed.json` 的來源綁定必要條件。明確必備條件不符時可排除，不會因所得或文件尚待確認而忽略已知不符。每條規則保留證據位置與原文，資料變更即停用舊規則。
- `backend/rules/adaptive-reviewed.json` 保存 217 筆逐筆探索分類、證據與未能自動判斷的原文；探索方向不合只影響聚焦與排序，不改成資格不符。新增學制、失業事實、承租／所有權、身障證明等必要條件只對經審閱的個別方案生效；當期資格與完整例外仍須確認。
- 不把其他家庭成員的年齡套到本人；年度、出生年、生日邊界與替代途徑分開處理。無法確定的主體或例外保留待確認。
- 只有已審閱的必要戶籍、在學、家庭身分可排除；不能由分類、scope 或欄位存在推定必備。所得與財產仍不比較。未回答與明確回答否不同。
- 每筆的 `raw_summary`、所得、財產、身障、就業、國籍、排除條件、擴充原文都列為「還要確認」。

## 辦理路線與交付

- 步驟只在 `process_text` 有明確箭頭時拆分，否則整段顯示；窗口、文件、網址都取自原文，不補造電話、地址或窗口。網址只允許 http/https。
- 「這一步做不到」只列原文明確的替代方式（例：不方便到場只認線上、郵寄、委託），沒有就如實說明並給詢問文字。1999 標示為一般市政諮詢，不是受理窗口或轉介。
- 行動單文件只在名稱、條件、備註、必要性完全相同時合併，並保留用途；同名不同要求分列。勾選只代表自己準備好，不代表送件。
- 已審閱的文件條件修正以來源綁定 overlay 套用至路線、合併清單及匯出；原始 JSON 保留。選附文件的「非必要」標記也保留在文字與列印內容中。
- 輸出：複製文字、下載純文字（.txt）、系統分享（取消與失敗分開提示）、「列印／另存 PDF」。PDF 依賴瀏覽器列印對話框，**不是原生 PDF 匯出**；WebView 內的下載、分享、列印都**尚未實機驗證**，失敗時會顯示可選取的文字備援。

## 裝置端模型

`src/domain/model.ts` 只提供 typed `ModelAdapter` 接口與 `UnavailableModelAdapter`。**本版未接任何模型**，不呼叫雲端、不下載模型；搜尋為關鍵字比對，題庫與資格判斷都不依賴 AI。

## 無障礙

每頁一個標題、換頁焦點移到標題、跳到主要內容連結、按鈕至少 48px、可見焦點框、大字（根字級 21px）、高對比、確認對話框使用原生 `<dialog>`（Esc 可關閉、焦點回到觸發按鈕）、表單錯誤以 `aria-describedby`／`role="alert"` 連結，375px 寬不水平捲動。讀屏與 200% 放大尚待實機驗證。

## 在實機的城市通裡開啟

1. 電腦與手機連同一個網路，啟動後端與 `npm run dev`。
2. 查電腦的區網 IP：`ipconfig getifaddr en0`（macOS）。
3. 在專案根目錄以該網址建置城市通：`flutter run --dart-define=SUBSIDY_URL=http://<電腦 IP>:5173`
4. App 內進入「服務」頁，點熱門的「補助專區」。

正式網址須為 HTTPS。

## 檔案結構

```
src/
├─ App.vue / store.ts      版頭、三入口導覽、全域狀態
├─ components/             各畫面（Home、Questions、Results、Detail、Plan、Help）與共用元件
├─ domain/                 純邏輯（可單元測試）
│  ├─ catalog.ts           資料讀取、驗證、快照備援、版本指紋
│  ├─ questions.ts         固定模板題庫、API 題目驗證、答案處理
│  ├─ match.ts             保守本機初篩
│  ├─ situations.ts        情境分類與文字搜尋
│  ├─ route.ts             辦理路線、障礙出口
│  ├─ documents.ts         文件合併
│  ├─ export.ts            行動單／求助文字、分享、下載
│  ├─ session.ts           本機保存與換人
│  ├─ model.ts             模型接口（未接）
│  └─ __tests__/           Vitest
└─ townpass/               與 App 雙向溝通的封裝（見下）
```

## 雙向溝通

`src/townpass/` 封裝與 App 的溝通（`window.flutterObject`）。本服務使用 `openLink`（App 內開啟外部網址）與 `call1999`；不使用 `getUserInfo` 作為資格條件。

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

## 部署（Firebase Hosting）

```bash
npm install -g firebase-tools
firebase login
firebase use --add
VITE_API_BASE_URL=https://<後端網域> npm run build
firebase deploy --only hosting
```

## 已知限制

- 未實機驗證：WebView 內的下載、分享、列印／另存 PDF、`openLink`、1999、讀屏與 200% 放大，以及動態問答的換題焦點與回饋朗讀。
- 非完整離線：無 Service Worker；快照只在 API 失敗時作資料備援。
- 資料沒有獨立的電話、地址欄位，路線只顯示窗口原文。
- 快照 chunk 約 1.7 MB（gzip 約 240 KB），首次 API 失敗時才下載。
- 逐筆審閱與探索映射隨主程式載入，目前主程式約 2.64 MB（gzip 約 359 KB），仍有建置大小警告；桌面驗證不代表低階手機載入與反應速度已達標。

## 授權與第三方套件

本資料夾以 AGPL-3.0-only 授權：聲明見 `LICENSE`，完整條文見 `COPYING`（GNU 官方 agpl-3.0.txt）；repo 根目錄的上游 TownPass 授權不變。

介面設計過程參考 [Unslop](https://github.com/heydamir/unslop)（Damir Sokolovsky，CC BY 4.0）及 [UI/UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill)（MIT）的設計指引，依本專案的繁體中文、無障礙與福利服務需求調整；這些是開發工具，不是執行時服務。

| 套件 | 授權 |
|---|---|
| vue | MIT |
| vite | MIT |
| @vitejs/plugin-vue | MIT |
| vitest | MIT |
| vue-tsc | MIT |
| @vue/tsconfig | MIT |
| typescript | Apache-2.0 |
