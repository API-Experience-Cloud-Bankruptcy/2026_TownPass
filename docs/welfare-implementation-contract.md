# 福利通前後端實作契約

此文件為 clean-ver 本次實作的介面與驗收依據；產品需求見 welfare-service-product-plan.md。使用者授權實作及分階段 commit，未授權 push／部署。原始資料 backend/data/ 不修改。既有兩個 iOS 本機設定不修改、不提交。禁止代理自行分派或 git commit／切換分支。

## 實作範圍與責任

- 後端代理：僅 backend/src、backend/Cargo.toml、Cargo.lock、backend/README.md 與 backend/tests。保留資料原文，補保守匹配、題庫、完整資料提供、測試與 API 說明。
- 前端代理：僅 subsidy-web/（不改 AGENTS），實作 Vue 使用者流程、資料讀取與本機匹配、題庫、路線、交付、樣式、測試、README。不更換框架。
- 獨立檢查代理：唯讀來源／規範／契約與測試覆蓋檢查，初期不編輯。
- 主代理：介面決策、檢查差異、整合驗收、文件及 commit。不同代理不可重疊編輯。

## 資料與介面

現有 217 筆 subsidies.json 為正式輸入；verified／partial／unverified 是資料原有狀態，不冒稱本次重新查核。全欄位原文應保留，包含 income 的 period/year 等未知欄位，不因 Rust 型別裁切而遺失。

保留既有 GET /health、GET /api/subsidies（view=full、limit、offset）、GET /api/subsidies/{id}、GET /api/facets、POST /api/match；新增 GET /api/catalog 回傳 {version:string, items:Subsidy[]}，完整原始資料，不含個人資料。新增 GET /api/questions 回傳 {version:string, questions:Question[]}。

Question = {id:string, field:string, kind:'single'|'boolean'|'number', title:string, description?:string, options?:{label:string,value:string|boolean}[], min?:number,max?:number, resource_ids:string[]}。題目由固定模板及資料中存在的條件決定，禁止 LLM 生成。穩定 fields：age、region、is_student、household_type。region 明示選戶籍地，不把居住地推定為戶籍；特殊居住／就學條件仍待確認。household_type 選項 low_income、mid_low_income、general；未知用略過不傳值。預設不詢問精確收入。resource_ids 指出支撐題目的資源；題庫支援數字填答、是非、選擇。前端按選定候選資料篩題。

前端從 /api/catalog 讀資料（開發 Vite /api proxy 到 127.0.0.1:8080；VITE_API_BASE_URL 可設），可用原始 JSON 的建置快照作離線／API 不通備援，清楚標示版本與資料來源。兩種資料必須同結構。個人答案預設不送後端，前端本機評估；後端 match 保留供測試與明確選用，不自動提交個資。

匹配對外維持 fit: likely|possible|ineligible, reasons:string[], warnings:string[], blocked_by:string[]；新增欄位可選。未知、原文關鍵條件、partial/unverified、無法解讀的例外不能產生確定符合。scope 不是完整戶籍規則，不能只因區域不同就一律排除可能以就學／就業地適用的資源。年齡只有明確 applicant/year 無例外且可判斷時才排除；兒童／配偶／月齡條件不套到申請人。不把個人所得與家戶所得比較成已符合。保守結果可全部 possible，解釋已知與待查事項比虛假 likely 重要。

## 前端交付

以 TownPass 風格的清楚、溫暖、簡潔繁中介面實作：三入口、本人／他人、情境分類與文字搜尋、動態固定題庫、結果與詳情、辦理路線、行動單、求助文字。包含大字／高對比、鍵盤焦點與 48px 按鈕；375px 無橫向溢出。

路線由 application.process_text（明確箭頭才拆分）、channel_text、required_documents、urls 與 source_meta 產生。資料不足說明待確認，不自行發明窗口／電話／地址。官方資訊與表單入口區別標示。URLs 僅允許 http/https；不使用 Google/Mapbox，不自建地圖。必要時只提供已有地址與官方網站。

行動單可多選資源，文件僅完整要求相同時合併，保留條件與用途。準備勾選不等於送件。求助內容預覽／可移除個人條件，分享取消與失敗區分，純文字下載／複製以及列印版需可用；PDF 若借瀏覽器另存明確標示「列印／另存 PDF」，不假裝原生檔案輸出已驗證。

session 保存答案／進度，偏好 localStorage，提供清除與換人確認。無帳號必填，不套用 mock userinfo 到本人資格。輸出摘要附來源／日期／非核准聲明。

本次不接 LLM；提供 typed ModelAdapter 接口及 unavailable 實作，不呼叫雲端、不假裝模型已下載。題庫與資格均不依賴 AI。離線殼與快照可行時實作，不把單純 API fallback 稱為完整離線。

## 驗收

後端 cargo fmt --check、cargo test；HTTP 健康／完整 catalog／questions／錯誤輸入／無 id；原資料筆數與未裁切欄位證明。前端 npm test、npm run build；代表資料、未知條件、家庭與個人區別、文件合併、危險 URL、換人重設測試。主代理另以本機 HTTP 與瀏覽器走長者及學生兩條路徑，檢查 375px、大字與分享備援；未實機驗證明示限制。

每階段由代理回報修改、命令、結果及未完成事項，主代理審查後才 commit。任何契約變更先回報，不自行改其他代理檔案。
