# 開發計畫

作品：臺北市福利補助自己查（Town Pass 微服務）。設計見 `docs/microservice-design.md`，介面約定見 `docs/contracts/`。

## 分工

| 角色 | 負責 | 主要路徑 |
|---|---|---|
| PM | 進度、議題拆分、合約、審查與合併、簡報與 Demo 腳本 | `docs/` |
| Web | 微服務頁面：首頁、問答、結果、詳情、一覽表、帶去臨櫃、請人幫我、無障礙 | `microservice/welfare/` |
| App | Town Pass 服務入口、橋接訊息、建置 APK 與 Demo 裝置、部署網址 | `lib/`、部署設定 |
| Data | 臺北市補助項目與條件、問題題庫、附近據點資料、資料查核 | `microservice/welfare/src/data/` |

三人各負責 Web、App、Data 其中一個角色；PM 由隊長兼任。

## 議題（依順序）

| # | 角色 | 議題 | 完成條件 |
|---|---|---|---|
| 1 | PM | 協作規則、合約、計畫入庫 | 本 PR 合併 |
| 2 | Web | 匯入微服務專案到 `microservice/welfare/` | 本機 `npx expo start --web` 可開首頁 |
| 3 | App | 部署微服務靜態網頁（Vercel 或 GitHub Pages），取得 HTTPS 網址 | 手機瀏覽器開得到 |
| 4 | App | Town Pass 新增「福利補助自己查」服務入口，指向第 3 項網址 | APK 內點入口開啟微服務 |
| 5 | App | 寫明 `userinfo`、`location` 回傳 JSON 欄位於 `docs/contracts/bridge.md` | 合約 PR 合併 |
| 6 | Data | 補助項目 30 項以上，每項附官方來源與查核日期 | 型別檢查通過；抽查 5 項與來源一致 |
| 7 | Data | 問題題庫白話化，每題可跳過 | Web 問答頁可載入 |
| 8 | Web | 規則引擎與單元測試（符合／可能符合／不符合） | 測試通過 |
| 9 | Web | 問答、結果、詳情、一覽表頁面 | 375px 截圖 |
| 10 | Web | 帶去臨櫃清單、請人幫我、字級與朗讀 | 375px 截圖 |
| 11 | Web | 接上橋接：`userinfo` 預填、`phone_call` 撥 1999、`location` 附近據點 | 在 Town Pass 內實測 |
| 12 | Data | 附近據點資料（區公所、社福中心、免費上網點） | 結果頁顯示最近 3 處 |
| 13 | PM | 簡報與 3 分鐘 Demo 腳本 | 全隊演練一次 |

## 節奏

- 每小時整點：各自在負責的議題留一則進度（完成、進行中、卡住）。PM 彙整在議題 #1。
- 合併順序：#2 → #3 → #4，之後各角色並行。
- 截止前 90 分鐘停止新功能，只修錯與演練。
