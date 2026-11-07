# 福利通後端

提供公開福利資料、固定題庫與明確選用的保守初篩 API。核心流程不依賴 AI，也不呼叫執行時模型。前端應下載 catalog／questions，在使用者裝置本機處理答案；不預設呼叫 `/api/match` 或上傳個人條件。

## 啟動與環境參數

需要支援 edition 2021 的 Rust stable、Cargo 及 rustfmt。於 `backend/` 執行：

```sh
cargo run --locked --release
```

預設監聽 `127.0.0.1:8080`。以下變數僅作用於該次程序：

| 變數 | 預設 | 意義 |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | 綁定 IP；暴露外部服務前須另行配置部署安全措施 |
| `PORT` | `8080` | 監聽埠 |
| `SUBSIDY_DATA` | 編譯內嵌 `data/subsidies.json` | 啟動時讀取的替代 JSON 路徑；相對路徑依程序工作目錄解析 |

```sh
HOST=127.0.0.1 PORT=8081 cargo run --locked --release
# 有經審核的替代資料時才設定：
SUBSIDY_DATA=./data/subsidies.json cargo run --locked --release
```

資料於啟動時載入，不即時監看檔案；更新替代資料後須重啟。無效 JSON、不相容的索引欄位、重複／空白／缺少 ID 都會使啟動失敗。內嵌資料更新須重新編譯。現有 CORS 為 permissive，無帳號、資料庫、正式申辦或遠端部署設定；本機成功不代表已完成公開部署驗收。

## 資料完整性與版本

正式輸入共 **217 筆**，資料原有狀態為 `verified` 125、`partial` 90、`unverified` 2；本次沒有逐筆重新查核，不將這些狀態當作當期政策有效或已核准的證明。原資料檔與 schema 均不修改。

每筆保留完整的原始 JSON 值，Rust 型別只供內部搜尋／索引使用。catalog、單筆詳情、列表 `view=full` 與 match `view=full` 都從保留的 JSON 輸出，不將型別重新序列化成資料原文。因此 `income.period`、`year`、`multiplier_base`、`multiplier_value`，以及各層未識別欄位、空值、來源與原文仍保留。JSON 空白排版及物件鍵順序不屬於保留承諾；summary 是有意精簡的視圖。

`catalog.version` 為 `catalog-v1-<FNV-1a 64-bit 指紋>`，由實際載入檔案的位元組計算；排版改變也會換版。這是穩定的快照識別，並非密碼學簽章、查核日期或政策有效性證明。題庫版本為 `questions-v1/<catalog.version>`；模板調整時須更新題庫版本前綴。離線快照應保存相同 items 結構並自行清楚標示來源版本。

## API

回應為 JSON；公開讀取 API 不需要個人答案。

| 方法／路徑 | 回應與用途 |
| --- | --- |
| `GET /health` | `{status:"ok", records:217}`，只證明程序與資料載入 |
| `GET /api/catalog` | `{version:string, items:Subsidy[]}`，完整資料、原順序、不分頁 |
| `GET /api/questions` | `{version:string, questions:Question[]}`，資料支持的固定模板題庫 |
| `GET /api/subsidies` | `{total, limit, offset, items}`，預設 summary |
| `GET /api/subsidies/{id}` | 完整原始資料；未知 ID 回傳 HTTP 404 `{error:"not_found", id}` |
| `GET /api/facets` | scope／region／category／benefit_type／applicant_type／verification_status／method／extension_keys 的計數 |
| `POST /api/match` | 明確選用的合成情境測試／初篩；分頁 items 額外附 `match` |

列表參數：`q`（以空白切詞，所有詞皆須出現）、`scope`、`region`、`category`、`benefit_type`、`applicant_type`（逗號分隔，任一符合）、`verification_status`、`method`（逗號分隔）、`has_documents`（boolean）、`age`、`extension`、`view`、`limit`、`offset`。

`GET /api/subsidies?region=...` 是 **scope 資料分類篩選**，並非戶籍資格判斷，也不自動包含全國項目。戶籍初篩需使用本機評估或明確選用的 match；不可把搜尋未出現當成不符合。列表 `age` 僅移除可確定排除的獨立年齡規則。

`view` 僅接受 `summary`／`full`；`limit` 預設 20，數字夾在 1–200（0 視為 1）；`offset` 預設 0，超過筆數回傳空陣列。catalog 不受 200 筆上限影響。scope 僅接受 `central`／`taipei`／`private_national`／`mixed`，查核狀態僅接受三種既有狀態。格式錯誤、負數分頁、無效 view／狀態／scope 及未知列表／match 輸入欄位回傳 HTTP 400 `{error:"invalid_input", message:string}`。

match JSON 可用欄位：`age`、`region`、`annual_income`、`monthly_income`、`is_student`、`household_type`、`applicant_types`（字串陣列）、`q`、`include_ineligible`（預設 false）、`view`、`limit`、`offset`。所有個人欄位選填；不知道／略過請不傳值，不用 false 或 `general` 代替未知。`age` 必須為 0–130 的有限歲數，不是出生年；`region` 是戶籍地，接受「臺北市」「其他縣市」或具名外縣市，不接受空白；`is_student` 為 JSON boolean。`household_type` 僅接受 `low_income`／`mid_low_income`／`general`。收入欄位為非負有限數字，但目前不作資格核算；預設題庫不詢問收入。

```sh
curl -fsS http://127.0.0.1:8080/health
curl -fsS http://127.0.0.1:8080/api/catalog
curl -fsS http://127.0.0.1:8080/api/questions
curl -fsS 'http://127.0.0.1:8080/api/subsidies?view=full&limit=200&offset=200'
curl -fsS http://127.0.0.1:8080/api/subsidies/CT-0113
# 以下僅使用合成情境；前端不應自動提交個人答案。
curl -fsS http://127.0.0.1:8080/api/match \
  -H 'Content-Type: application/json' \
  -d '{"age":72,"region":"其他縣市","view":"full","include_ineligible":true}'
```

match 不儲存或記錄答案，錯誤不回顯提交值；但呼叫本身仍會將內容傳到伺服器，不可宣稱此 API 是裝置端處理。

## 固定題庫

Question 欄位為 `id`、`field`、`kind`、`title`、`description`、選用 `options`／`min`／`max`，以及可追溯的 `resource_ids`。不使用 LLM 產生題目。

| field | kind | 出題依據 |
| --- | --- | --- |
| `age` | `number`，0–130 | 資料有明示申請人、year 的年齡欄位；不以子女／配偶／月齡充當申請人年齡 |
| `region` | `single` | 有明示 `registered_required=true` 的條件；縣市選項取自這些條件，另有「其他縣市」 |
| `is_student` | `boolean` | 有 student 條件；是／否的 value 為 boolean |
| `household_type` | `single` | 有明示低收入戶／中低收入戶類型；一般戶是回答選項，不代表不符合 |

目前四題都存在。沒有資料支持的題目不輸出；`resource_ids` 去重並排序，指向支持該題的資源，前端可依已選候選篩題。問題與選項僅提供可回答的基本資訊，不表示回答後可完整判定資格；就學地、設籍期間、家庭成員與證明等仍須查原文。

## 保守匹配與限制

對外保留 `fit: likely|possible|ineligible`、`reasons:string[]`、`warnings:string[]`、`blocked_by:string[]`。目前不產生 `likely`：資料沒有完整可執行的資格群組，單項相符不能代表全部已確認；verified 也不會跳過原文、例外與時效檢查。

- `possible` 表示未證明排除且仍待確認，不代表推薦、符合、核准機率或完整覆蓋所有福利。缺答、回答否、低收入戶／一般戶自述均不能替代原文資格審核。
- scope 不能當戶籍規則；跨縣市或「其他縣市」不硬排除可能以就學／就業／居住地適用的資源。同地區也不產生「符合戶籍條件」結論。
- 只有單一、明示申請人／year、原文完全屬於可識別年齡範圍，且沒有額外未解析資格、備註、未知年齡欄位或擴充規則時，才可依歲數排除。含其他主體、不同單位、多路徑、生日／特定年度基準或例外的條件保留未知。未滿採不含上界，以下採含上界。
- 所得主體、家戶合計、平均每人、期間、年度及例外不可由個人數字推定；目前所有 income 條件均明示未評估，不給出「所得符合」。
- 在學僅可記錄自述，學制／學校／成績仍待查；家戶證明、財產、國籍、障礙、就業、排除與擴充原文均列為未評估。未解析 `allOf`／`anyOf` 等未知規則不執行、不猜測。
- 排序依狀態、搜尋關聯度、ID；不以條件相符數當核准機率。`applicant_types` 及文字搜尋是使用者選用的資料篩選，不是資格排除。

因此目前 217 筆資料可全部回傳 `possible`；此限制是誠實保留未評估條件，不是完整規則引擎或最新政策查核成果。

## 驗證

於 `backend/` 執行：

```sh
cargo fmt --check
cargo test --locked
```

測試包含：217 筆與原查核狀態、逐筆完整 JSON 對等、各層未知欄位與 income 未建模欄位、穩定版本及錯誤資料、年齡邊界／主體／單位／例外／替代途徑、跨縣市就學、所得與家戶區別、原文未評估不得 likely、題庫來源與略過／否的區別；HTTP 路由涵蓋 health、catalog、questions、詳情、facets、分頁、match、無 ID 與錯誤輸入。路由測試使用 Axum Router，不依賴占用固定埠。

實際啟動後可另用上列 curl 驗證監聽與 HTTP；這不替代前端整合、真實政策／資格查核、手機 WebView、公開部署或機關受理驗收。

## 授權

本次新增後端程式（`src/questions.rs`、`src/tests.rs`）以 **GNU AGPL-3.0-only** 聲明，全文見 [GNU AGPL v3](https://www.gnu.org/licenses/agpl-3.0.html)。既有上游程式與根目錄 `LICENSE` 的 **GPL v3** 聲明維持原狀，不以新增模組聲明重新授權上游。福利資料與官方內容的來源／權利應依各筆 `source_meta` 及原提供者確認，程式授權不代表已取得資料再授權。
