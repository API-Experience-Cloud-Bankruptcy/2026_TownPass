# 台北通資料欄位與虛擬測試者

核對日期：2026-11-08。此處記錄城市通微服務橋接 `userinfo` 的公開介面與本專案實際實作；不是已完成正式台北通登入或取得真實個資的證明。

官方依據：[Town Pass App methods — userinfo](https://townpass.taipei/en/docs/two-way-connection/app_method.html)。本機對照為 `lib/bean/account.dart`、`lib/util/web_message_handler/tp_web_message_handler.dart`、`lib/service/account_service.dart` 與 `subsidy-web/src/townpass/types.ts`。

| 資訊 | 欄位 | 本服務用途 |
|---|---|---|
| 使用者識別碼、登入帳號、暱稱 | `id`、`account`、`username` | 識別測試者；正式服務須由後端驗證登入身分 |
| 姓名、身分證字號 | `realName`、`idNo` | 本人明確要求帶入表單後，逐項確認；不作資格推定 |
| Email、手機 | `email`、`phoneNo` | 模擬個人資料；手機可供本人確認後填表 |
| 生日 | `birthday` | 模擬個人資料；不自動當成本次查詢對象的年齡 |
| 會員類型、實名驗證等級 | `memberType`、`verifyLevel` | 保留介面欄位；前端傳回值不能作後端登入憑證 |
| 通訊地址清單 | `addresses` | 郵遞區號、縣市、區、里、街址、用途、序號與預設註記 |
| 戶籍地址 | `residentAddress` | 與通訊地址分開，供本人確認後填表 |
| 臺北市民、原住民註記 | `citizen`、`nativePeople` | 保留模擬註記；不自動套用資格條件 |
| 舊網路市民識別碼 | `cityInternetUid` | 保留相容欄位，測試值為空 |

公開 `userinfo` 介面沒有獨立性別欄位，也沒有家庭所得、財產、低／中低收入戶核定、身障證明、完整家庭成員或補助申請紀錄。本服務不從帳號、生日或身分證號自行推測這些資格。

正式服務可取得哪些資料仍取決於實際介接規格、核准範圍及使用者授權；不能只因 mock 有欄位就宣稱已取得。[台北通作業要點](https://id.taipei/tpcd/about/policies/terms) 第十點第三款亦限制跨服務蒐集與流用，特定服務所需的提供須符合其同意條件。

## 一份共用的虛擬測試者

`assets/mock_data/account.json` 為唯一測試帳號來源，使用「陳福利（虛擬）」、`welfare_demo`、`welfare-demo@example.test` 及明確標示虛構的地址。身分證字號是介面既有範例值，所有資料僅供測試。

- Flutter `AccountService` 從該檔載入；瀏覽器 `townpass/mock.ts` 直接匯入同一檔，不再另維護一份帳號。
- 後端開啟 `DEMO_MODE=1` 時，把同一份測試資料寫入 SQLite `users`，以固定帳號 id 綁定 `action_plans`。
- 同一 Demo 服務的訪客共用這名虛擬測試者與一份行動單；這不是多人登入、正式台北通認證或跨使用者權限隔離。
- 未啟用 Demo 時不開啟這份帳號資料庫；正式登入應另實作服務端驗證與每人隔離，不能接受前端傳入的 id 作為登入依據。

## 保存與重開

資料庫只保存行動單的資源 id、查詢對象類型、文件勾選、步驟進度與資料／規則版本。不保存聊天原句、資格問答、填表個資或產生的 PDF。關閉分頁後再進入會先還原行動單，問答條件則可能需要重新確認；地區待確認文件仍保留供核對。

加入／移除資源與勾選進度會自動寫入，畫面只有在後端確認成功後才顯示已保存。失敗保留本頁修改並提供重試；其他視窗已更新時禁止直接覆寫，使用者可選擇載入資料庫版本。資料來源或規則換版仍依原有遷移邏輯重設受影響進度。

「開新對話」與「換人」都保留本人行動單；「換人」清除目前查詢答案。「清除這次的資料」才依畫面確認清空本人行動單並同步至資料庫。新版使用 `/api/personal-action-plan`，舊版他人檢核表保留在原表，不混入本人資料。SQLite 路徑應放在持久目錄，不能隨每次建置更換或刪除；設定與 API 見 [後端說明](../backend/README.md)。
