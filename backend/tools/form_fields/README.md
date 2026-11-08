# 表單欄位分析工具

把福利紀錄的申請表 PDF 找出來、偵測欄位位置，寫回 `subsidies.json` 的 `application.form_fields`。
需要 PyMuPDF（建議獨立 venv：`python3 -m venv /tmp/tp_venv && /tmp/tp_venv/bin/pip install pymupdf requests pillow jsonschema`）。

## 流程

1. `download.py`：下載 `application.urls.form` 並依檔頭判斷真實格式（連結副檔名不可靠，約一半其實是網頁）。
2. 找附件：`urls.form` 為空或指向網頁的紀錄，需爬公告頁的「相關附件」「下載專區」才找得到表單（本次以多個代理人工爬取，未寫成腳本；結果的 URL 與原因都記在 JSON 內的 `source_url` / `found_on` / `reason`）。
3. `cands.py` → `manifest.py`：彙整所有 PDF，依 sha256 去重，建立 `manifest.json`。
4. `analyze_all.py`（用 `extract_fields.py`）→ `refine.py`：逐份偵測欄位；只保留真有姓名／身分證／電話／地址等欄位的頁面，偵測亂碼字型、掃描檔。
5. `build.py`：每筆紀錄挑一份主表單放 `form_fields`，其餘 PDF 放 `form_fields.attachments`；沒有 PDF 的記錄原因；PDF 複製到 `data/forms/<sha12>.pdf`。
6. `audit_prefill.py <backend/data>`：**build.py 之後必跑**。把預填收緊到「只填申請人本人的資料，且絕不填簽名」（規則見下）。可重複執行。
7. `overlay.py <backend/data> <ID> <頁> <out.png>`：目視檢查，把偵測框畫在 PDF 上（綠=會預填，橘=被擋下的個資候選，紫=簽名，藍=其他）。

## 預填規則（audit_prefill.py）
`prefill: true` 只在能確認欄位屬於申請人本人時成立，並帶 `subject: applicant` 與 `subject_evidence`（依據）。判斷順序：標籤自帶角色（申請人／本人）→ 左側列標題 → 上方欄標題（含直排標題）→ 與最近姓名欄同一區塊 → 所屬區塊標題 → 整頁只有一個人。
- 代理人、受款人、配偶、子女、聯絡人、負責人、公司、學校等一律不預填（`other_person` / `organization`）。
- 學生、病人、被保險人、授權人、承租人這類角色不一定是申請人，不預填（`subject_unclear`），app 可用 `candidate_key` 向使用者確認。
- 近處與遠處標題的角色互相矛盾時視為不確定。
- 簽名／蓋章欄（含「立書人」「聲明人」等簽署欄）永遠不預填（`type: signature`，`signature_mode`）。
- PDF 內寫明親簽（親簽、親筆、不得代簽…）時，`signature_policy.requires_handwritten = true`，並連簽名欄旁的印刷姓名欄也不預填。「親自簽名或蓋章」允許蓋章，不算。
- 被擋下的欄位保留 `candidate_key` 與 `blocked_reason`；位置仍保留，可作為一般輸入框。

腳本內路徑固定為 `/tmp/tp_work`、`/tmp/tp_audit`，換環境需自行修改。
座標單位為 PDF point，原點在「顯示後頁面」左上（已處理頁面旋轉）。偵測為啟發式，輸出需抽查。
`urls.form` 本身不會被修改（規則檔的指紋包含它）；`form_fields` 不參與指紋計算。

## 尚未處理
ODT／DOCX／XLS 表單（`status: office_file_only`，URL 在 `office_files`）、掃描 PDF 與亂碼字型 PDF（需 OCR）。
