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

`catalog.version` 為 `catalog-v1-<FNV-1a 64-bit 指紋>`，由實際載入檔案的位元組計算；排版改變也會換版。這是穩定的快照識別，並非密碼學簽章、查核日期或政策有效性證明。題庫版本為 `questions-v2/<catalog.version>/<review.version>`；規則版本另包含共享 sidecar 的內容指紋，模板或規則變更會使前端舊準備進度失效。離線快照應保存相同 items 結構並自行清楚標示來源版本。

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

`GET /api/subsidies?region=...` 是 **scope 資料分類篩選**，並非戶籍資格判斷，也不自動包含全國項目。戶籍初篩需使用本機評估或明確選用的 match；不可把搜尋未出現當成不符合。列表 `age` 僅移除來源仍有效、經逐筆審閱之必要年齡條件明確不符的資料。

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

match 新增 `personal` 標記含自述資訊的 reasons／blocked_by，供匯出時按欄位同意移除；原 fit／reasons／warnings／blocked_by 介面保留。match 不儲存或記錄答案，錯誤不回顯提交值；但呼叫本身仍會將內容傳到伺服器，不可宣稱此 API 是裝置端處理。

## 固定題庫

Question 欄位為 `id`、`field`、`kind`、`title`、`description`、選用 `options`／`min`／`max`，以及可追溯的 `resource_ids`。不使用 LLM 產生題目。

| field | kind | 出題依據 |
| --- | --- | --- |
| `age` | `number`，0–130 | 來源綁定且已逐筆審閱的必要年齡條件（含藏在其他原文欄位的條件），先問目前已滿實歲，不問虛歲 |
| `region` | `single` | 已審閱本人必要設籍；目前為「臺北市／臺北市以外」，後者 value 維持 `其他縣市` |
| `is_student` | `boolean` | 已審閱本人在學或未就學必要條件；boolean false 不等於略過 |
| `household_type` | `single` | 已審閱必要核定家戶身分，保留 low_income／mid_low_income／general；未知略過 |

`resource_ids` 只指向來源仍有效且有相應必要規則的資源，不因 scope、facet 或有 student 陣列就出題。前端忽略版本／支撐集合不符的舊 API 題庫，改用同一 sidecar 的本機固定模板。

本輪題目池與已走過的題目 ID 保留；每次回答只重算尚有可能的候選與未來題序。若年齡已明確排除全部候選，直接顯示結果，不再問無作用的在學／身分。返回修改先前答案後會恢復相關後續題，不會因 computed 陣列縮短而跳錯題。先前保留的未來答案不會隱藏其自身修改題。

## 來源綁定規則與審閱覆蓋

共享檔案為 `rules/eligibility-reviewed.json`，Rust 編譯內嵌，TypeScript 匯入同一份檔案；不修改 `data/subsidies.json`、不引入執行時 AI、不自動解析中文 AND／OR。

- **217 筆全文已盤點**：掃描所有 JSON 字串，包括 eligibility、taipei_applicability、benefit、application、extensions、source_meta 與 search；數字年齡／出生日期片語命中 95 筆，其中 30 筆沒有 age 陣列。各筆留下 `full_text_age_mentions` 的原文路徑及 `review_note` 採用／保留原因。線索掃描不代表完整自然語言理解，未命中也不代表沒有年齡條件。
- 已建立 **27 筆必要年齡、8 筆在學／未就學、9 筆家戶身分、6 筆必要設籍**。原有 69 筆非空 age 陣列中 26 筆已編碼、43 筆保留逐筆理由；另外 WEL-0031 的 age 陣列雖空，完整記錄明定本人年滿20至未滿46歲，已編碼並納入題庫。
- 每條必要條件記錄來源 JSON Pointer、逐字引文、來源 URL 及整筆原始資料的 canonical FNV-1a 64-bit 指紋。物件鍵排序、陣列順序保留、整數值統一；這是變更偵測，不是對抗惡意碰撞的密碼學證明。任何原文、來源、未知條件或其他欄位改動，該筆舊規則即停用並回到待確認，不沿用硬排除；沒有自動補寫／重綁規則。
- 兩端都要求有規則的記錄具非空 `source_urls`，且各 URL 仍屬該筆 `source_meta.sources` 的 official 來源。新增規則必須先逐筆審閱主體、必要性、例外及替代途徑，再更新引文、來源與指紋，不能只為了讓測試通過而重算指紋。

本輪保留資料既有 verified／partial／unverified，沒有宣稱重新向官方查核全部資料。未結構化的資格、文件、時效、同質補助、收入、財產、國籍與審核仍須查原文。

## 匹配界線

對外維持 `fit: likely|possible|ineligible`。目前**不產生 likely**；單項必要條件相符不代表整項資格相符或核准。

- 明確必要條件不符可獨立排除，即使所得或其他條件未知。`CT-0129` 的兩條年齡經逐筆確認為 AND：18歲以上且未滿25歲。落在共同必要範圍內仍為 possible。
- `WEL-0082` 按116年度、民國76至98年出生處理。由注入的台北日期與目前實歲推得可能出生年集合；所有可能均不合才排除、部分相交保留未知。它不是普通當下18至40歲。`WEL-0058` 也按出生期間；`WEL-0089` 按接種年減出生年。
- `WEL-0128` 按資料明列的截止日期比較可能年齡，出生月日不明時使用保守範圍。`CT-0076` 開訓日不明，未確認下限或相符；僅當目前已超過上限，未來開訓也無法恢復資格時排除。無效／未知日期不執行出生年或參考日期推算。前後端預設均使用 Asia/Taipei 日期，測試可注入日期。
- `WEL-0125` 三途徑共同必要範圍為成年18至65歲；WEL-0099／0100／0101 已確認的各途徑共同上限可排除99歲，不臆測未解析的最低年齡。CT-0130 的學年度下限保留待確認。
- CT-0019 的青年僅為租補加碼；CT-0148 有65歲以上榮家途徑；WEL-0032 女性生育延長未有上限；CT-0099 有身障替代途徑；WEL-0042 針對親屬至少一人；WEL-0077 的 subject 與有在學子女家戶原文衝突；CT-0150／0151 為參與者或機構代表分支，均不直接套查詢人排除。WEL-0093／0094 明示兒童受助者與家長主體尚未區分，不套家長年齡。
- scope 不是戶籍規則；只有已審閱必要設籍才判定。對只允許臺北市的必要規則，「臺北市以外」（value `其他縣市`）是不符；對多縣市集合，此概括答案仍未知。跨縣市就學、外國居留等未編必要設籍的途徑保留 possible。已因必要戶籍排除時，不再顯示「不據此排除」的矛盾提醒。
- WEL-0110／0111 明列「未就學」，回答在學為必要條件不符，回答否與未回答區分。WEL-0031 的 enrollment_required=false 原文為畢業／同等學力，不當成禁止在學；CT-0076 只排除日間部，不以通用在學題硬排除。子女在學不套到父母本人。
- 家戶類型 tag 不能代表完整資格；只有逐筆確認無其他替代途徑的必要核定身分才比較。一般戶遇仍有其他身分或評估途徑的資源保留 possible；不把個人收入當家戶所得。
- 個人答案仍在前端本機評估，UI 不自動 POST。新理由標記 personal，預設匯出移除未同意欄位的自述年齡、在學及身分訊息。

文字搜尋要求名稱、關鍵字或內文實際包含完整查詢詞，移除「查詢詞反向包含較短關鍵字」的過寬命中。「青年藝術」不因「青年」而混入留學貸款。工作情境也不再以「青年」泛詞代替就業分類；全庫與關鍵字搜尋仍保留217筆入口。

## 驗證

於 `backend/` 執行：

```sh
cargo fmt --check
cargo test --locked
```

測試包含：217 筆與原查核狀態、逐筆完整 JSON 對等、各層未知欄位與 income 未建模欄位、穩定版本及錯誤資料、年齡邊界／主體／單位／例外／替代途徑、跨縣市就學、所得與家戶區別、原文未評估不得 likely、題庫來源與略過／否的區別；HTTP 路由涵蓋 health、catalog、questions、詳情、facets、分頁、match、無 ID 與錯誤輸入。路由測試使用 Axum Router，不依賴占用固定埠。

前後端完整 HTTP parity 使用另一個可用埠，前端命令於 repo 根目錄執行，只有合成測試條件會明確 POST：

```sh
# 終端一，於 backend/；保留既有服務埠
PORT=18081 cargo run --locked
# 終端二，於 repo 根目錄
npm --prefix subsidy-web test
WELFARE_TEST_API=http://127.0.0.1:18081 npm --prefix subsidy-web test -- src/domain/__tests__/parity.http.test.ts
```

一般 npm test 會略過需明確提供測試 API 的 HTTP 項；啟用後驗證17組合成條件 × 217筆（3,689次 fit 比較）、完整原始 catalog 及題庫支撐集合。純規則回歸包含0／17／18／29／40／41／65／99、逐筆數字上下界、出生年及參考日期、例外主體、不回答／否、來源失效、預設匯出隱私、資料／規則換版、題目 identity 與返回改答。效能測試記錄完整217筆耗時，但桌面 Node 的數值不能代替手機效能驗收。

實際啟動後可另用上列 curl 驗證監聽與 HTTP；這不替代前端整合、真實政策／資格查核、手機 WebView、公開部署或機關受理驗收。

## 授權

本次新增後端程式（含 `src/reviewed_rules.rs`、`src/questions.rs`、`src/tests.rs`）以 **GNU AGPL-3.0-only** 聲明，全文見 [GNU AGPL v3](https://www.gnu.org/licenses/agpl-3.0.html)。既有上游程式與根目錄 `LICENSE` 的 **GPL v3** 聲明維持原狀，不以新增模組聲明重新授權上游。福利資料與官方內容的來源／權利應依各筆 `source_meta` 及原提供者確認，程式授權不代表已取得資料再授權。
