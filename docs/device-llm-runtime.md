# 裝置端原版 Gemma 4 E2B

TownPass 使用原版 instruction-tuned Gemma 4 E2B（`google/gemma-4-E2B-it` 的 LiteRT-LM 量化發布），未套用 `training/` 的任何 adapter。模型只整理輸入語意與待確認資料；資格仍由版本化資料與既有規則處理。

## 目前原生解讀契約

原版權重不變。`llm_interpretation.dart` 與 `llm_fact_candidates.dart` 是手機服務與本機檢查共用的純 Dart 契約。Gemma 以 `record_situation` 選擇至多三個既有需求方向；只有當前問卷題目存在時才提供對應的 `answer_choice` 或 `answer_number`。工具不執行外部動作，只有一筆合法候選才交回前端確認。

明確說要的服務會優先於父母、失業等背景聯想；若另有已表達的困難或需求，仍保留模型提出的多方向供確認。這層只調整需求方向，不處理資格。

模型不生成 facts／evidence／人物稱呼。程式只從當次明確原文整理候選，未支援或不確定的描述保持未知；戶籍與居住地、法定家戶身分與經濟困難分開核對。已確認答案、舊搜尋與重複分類索引不再送入模型，避免背景污染新需求。只有原文被明確條件完整涵蓋且沒有需求或疑問時，才直接提供 facts-only 候選。

每次模型請求與最多一次格式重試各用新 session；固定 greedy sampling（temperature=0、topK=1、topP=1、seed=42），4,096-token 視窗、最多768個輸出 tokens。預先計算提示、工具定義及 payload，超過3,000 tokens時省略分類提示，再超過則回 INPUT_TOO_LONG，原文不截斷。僅接受單一合法工具回覆；`clarify`／`off_topic` 兩種無參數控制文字可精確轉換，不從任意文章擷取或修補資料。

本輪結果與未完成項目見 [本機穩定性紀錄](ai-evaluation/2026-11-08/README.md)。

### 本機重現

模型與 Python 環境放在 Git 忽略的 `output/local-gemma/`，不加入 App 或網頁 bundle。以固定來源下載下節同一個 `.litertlm` 並核對 SHA-256，再建立獨立環境：

```sh
python3 -m venv output/local-gemma/venv
output/local-gemma/venv/bin/pip install -r tool/requirements-local-llm.txt
output/local-gemma/venv/bin/python tool/evaluate_local_gemma.py \
  --model output/local-gemma/models/gemma-4-E2B-it.litertlm \
  --report output/local-gemma/acceptance.json
```

預設在 Mac 本機 CPU 執行，使用與手機相同權重及 Dart 提示／輸出驗證；不是雲端推論。題目與預期在 `tool/fixtures/llm_acceptance.json`，記錄每次實際工具輸出、schema 拒絕、語意預期差異、來源雜湊、生成設定與耗時。題目由 AI 編寫，作開發回歸，不能當一般模型正確率或未見基準測試。

`tool/serve_local_gemma.py` 和 `tool/local_gemma_bridge.js` 僅用於隔離瀏覽器的本機整合檢查：服務綁127.0.0.1，只接受指定測試 origin，橋接腳本由測試工具注入，不在產品中載入。對話推論不會呼叫公開模型 API；正常 App 仍只使用原生裝置引擎。檢查結束停止本機測試服務。

## 固定模型與授權

- 模型：`litert-community/gemma-4-E2B-it-litert-lm`，Apache-2.0。
- revision：`3d48132a00cf76de57d926de30f5c5c5ed9b8c0d`。
- 檔案：`gemma-4-E2B-it.litertlm`，2,588,147,712 bytes，LiteRT-LM 公布的 mobile 混合2/4/8-bit量化 bundle；未自行重算量化、未加入訓練 adapter。
- SHA-256：`181938105e0eefd105961417e8da75903eacda102c4fce9ce90f50b97139a63c`。
- 引擎：`flutter_edge_ai 2.5.6`、`flutter_edge_ai_litertlm 1.19.2`，MIT；原生 LiteRT-LM，手機 GPU，文字輸入，不啟用視覺/音訊。
- [Google AI Edge 的 LiteRT-LM](https://github.com/google-ai-edge/LiteRT-LM)；[固定模型來源](https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm/tree/3d48132a00cf76de57d926de30f5c5c5ed9b8c0d)；[Flutter 引擎文件](https://flutteredge.ai/codelabs/getting-started-flutter-gemma)。

## 初次準備

首次進入微服務時會詢問是否下載模型，同意後下載約 2.59 GB 並自動載入。請保留足夠空間與網路，下載期間保持 App 在前景。下載有進度、失敗提示與 Range 續傳；檔案完成後核對大小與完整 SHA-256，再交給原生引擎。下載寫入每4MB等待磁碟，不整份載入 Dart 記憶體。

檔案在 App Application Support 的 `models/<revision>/`，不進 Git、不放前端 bundle，也不送使用者輸入到模型服務。模型載入後推論不需要網路；網頁與政策資料離線可用性是另一個範圍，需另行驗收。重裝同 Bundle ID 保留 App 資料，但不能卸載再裝，卸載會刪除模型。首次校驗和載入需要等待；App 重啟後須重新載入權重。

iOS 15+ 配置記憶體 entitlement；本機簽署檔原有帳號/Bundle ID 變更不可提交。Android minSdk 30（LiteRT-LM native runtime 下限）及 INTERNET 權限；目前本輪實測以 iPhone 為主，未宣稱 Android 驗收。

## WebView 能力

`llm_status`、`llm_prepare`、`llm_interpret` 都必須帶 `requestId`，回覆會帶相同 ID。僅允許 `SUBSIDY_URL` 的同 scheme/host/port 主框架，不接受其他外部網站或 iframe 使用模型。

`llm_interpret` 僅在模型 ready 時執行；不會因輸入文字自行開始大型下載。輸入最多2000字，整個 JSON 最多18000字。完整 schema 與前端互動見 [對話輸入](conversation-input.md)。模型每次使用新 session，避免跨人輸入或前一次內容污染；只允許一個原生推論工作，完成後關閉 session。

原生與前端都核對欄位、有效 ID、數值範圍、證據原文與人物稱呼；不合法輸出不寫入問卷。模型並非政策事實來源，人工確認仍必須保留。輸出 schema 校驗不等於語意正確。

## 檢查

```sh
flutter test test/local_llm_contract_test.dart
flutter analyze lib/service/local_llm_service.dart lib/util/web_message_handler/llm_message_handler.dart tool/device_llm_probe.dart
flutter build ios --release --target tool/device_llm_probe.dart --dart-define=SUBSIDY_URL=http://<LAN IP>:5173
```

`tool/device_llm_probe.dart` 是明確的實機檢查入口，會顯示下載/載入進度，使用14筆合成案例（原始7筆加7筆新轉述）實際推論，保存原始文字、解析回覆與逐項預期結果到手機 Documents 的 `townpass-llm-device-probe.json`。這些不是單元測試 mock，也不是完整模型品質評測。檢查後須改回預設 `lib/main.dart` 建置正常 TownPass。

## 2026-11-08 前一版實機紀錄

在 iPhone 16（iOS 26.6.2）以 release 模式實際下載、完整 SHA-256 校驗、載入原版模型並執行推論。第一次從下載開始到載入完成約151秒；後續重啟由手機快取校驗與載入約15秒，未重下模型。模型引擎採 Metal GPU 推論，runtime 日誌表示採 CPU sampling，不能宣稱全部運算都在 GPU。

首版提示7筆只有1筆通過本輪格式/預期檢查。加入不同文字、人物與數值的完整格式範例後，原始7筆及新增7筆轉述題合計9/14通過；再加入最多一次由模型自行重輸出完整 JSON 的修復回合，最終11/14通過本輪檢查。原始模型權重始終不變；這是14筆合成案例的小型診斷，不是完整品質驗收、一般正確率或安全保證。部分負例檢查只驗證沒有錯誤戶籍/低收候選，不等於所有需求都被完整理解。

最終三筆仍拒絕：40歲操作者/72歲媽媽案例一直缺每筆 fact 的 evidence；工作租屋/新北戶籍案例未將縣市名稱轉成允許值；要求忽略規則並宣稱一定通過補助的內容產生不合法 answer/null。兩次輸出都經相同嚴格檢查，不合法結果不寫入問卷，不由程式補造事實或證據。前端仍允許直接按選項繼續。

本機原始紀錄（僅合成輸入）在 `output/device-llm/first-probe.json`、`probe-seven-cases.json`、`probe-fewshot.json`、`probe-with-retry.json`；最後一份保留每次 rawOutputs。這些檢查入口不代表正常 App 的完整 WebView 問答、確認、返回與離線流程已驗收；本輪未再增加特殊橋接測試建置。

最後已於00:49:14改回正常 `lib/main.dart`、安裝並啟動 TownPass，建置 `SUBSIDY_URL` 為當時可用的本機 LAN 服務；保留模型與 App 資料，未卸載。正常 App 的模型尚須在補助專區按準備/載入，由既有快取重載約15秒。最終 Runner 執行檔 SHA-256：`9640ad07ba55fb148dc04839451b3ee3eecf6a680e9ea81e04cbedc1adaabc8a`。安裝與啟動結果記錄在 `output/device-llm/normal-app-install.json`、`normal-app-launch.json`。

相關14項單元測試通過，新增原生服務/handler/probe 的 scoped `flutter analyze` 無問題；完整 `flutter analyze` 仍有原有未使用匯入及樣式等訊息。全套 `flutter test` 的原始 `widget_test.dart` counter 範本失敗，原因是實際 App 未初始化 Get 服務且已沒有預設計數器；本輪未擴修這份舊測試。沒有 commit、push 或公開部署。


## 後續對話流程調整（未執行測試）

依使用者要求，後續修改不執行自動測試、模型 probe、analyze 或額外驗證迴圈；僅重新建置並安裝正常 TownPass 供人工試用。前述11/14只屬前一版提示與推論回合，不代表目前版本結果。

新版讓只提供年齡、戶籍或就學背景的句子回傳 facts-only 候選（situationIds 為空），不由年齡推論學生身分或補助方向；下一步由前端確認資料並詢問需求。模型接收已確認 knownAnswers、currentNeed 與最多9個服務方向的 situationIndex，不接收整份政策內文；已確認答案不成為這次新增的模型事實。每次解讀及最多一次格式重試分別建立並關閉 session，避免重試累積整份舊 context 或把舊模型輸出當作已知資料。原版權重、校驗、裝置端推論、嚴格輸出欄位與使用者確認邊界保持。

本次正常 `lib/main.dart` release 於01:06:14覆蓋安裝並啟動，沿用原 Bundle ID 與模型儲存路徑，未卸載、刪除或重新下載模型，亦未執行快取探測或模型驗證。建置採同一 LAN 微服務網址。安裝/啟動證據：`output/device-llm/normal-app-install-dialogue.json`、`normal-app-launch-dialogue.json`；Runner SHA-256：`bf3195916423e6ef3a153b93464ea23a4fd1c3c6782efc985dd2ad9eb7362d5a`。

此版會先去除重複選項描述，透過引擎 token 計數預留4K視窗的生成空間；有需要才省略重複的豐富分類索引（方向ID/名稱/提示仍保留），不截斷使用者原文。極端長文仍放不下時回 `INPUT_TOO_LONG`，前端保留原文並提示分段。此為產品執行時處理，本輪未自動呼叫模型驗證。

## 微服務自動載入

進入對話頁先查詢原生狀態：尚未下載則顯示下載同意對話框（約2.6GB）；已下載則自動呼叫準備，進行既有校驗與載入；下載或載入中則接續等待同一個原生準備工作；ready直接使用。取消下載不阻擋選項查詢，同一分頁工作階段不反覆詢問。離開頁面取消前端等待，原生已開始的準備可繼續；重新進入再接續狀態。錯誤保留手動重試，不自動反覆下載。此變更只更新網頁，不需重新安裝原生App；依使用者指示未執行測試。
