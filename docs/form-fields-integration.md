# 申請表欄位（form_fields）對接指南

適用對象：subsidy-web（前端）、Flutter 殼（Dart）、後端維護者。
狀態：資料已產出並寫入 `backend/data/subsidies.json`；PDF 送達與填寫流程尚未在 app 內實作，見第 6 節。

## 0. 結論

- 分析結果全部在 `backend/data/subsidies.json` 的 `application.form_fields`；PDF 檔在 `backend/data/forms/`。
- **Dart 不直接讀這份 JSON。** 資料有兩條路進 WebView：
  - 後端 `GET /api/catalog`（完整原始紀錄，含 `form_fields`）與 `GET /api/subsidies/{id}`；
  - subsidy-web 建置時把 `subsidies.json` 打包成 `virtual:catalog-snapshot`（離線快照）。
- Dart 殼只負責 WebView 與原生橋接（例如 `share_pdf` 分享 PDF）。
- **建議：填表放在 subsidy-web 做，Dart 只保留分享。** 前端已有 `pdf-lib`、NotoSansTC 字型與檢核表 PDF 流程（`src/domain/checklist-pdf.ts`），而 Dart 目前沒有任何 PDF 繪製套件。若改由 Dart 填，需新增套件並自行處理 CJK 字型與座標，本指南不涵蓋。

## 1. 資料流

| 階段 | 位置 | 負責 |
|---|---|---|
| 產生 | `backend/tools/form_fields/*.py` | 下載、偵測欄位、寫回 JSON |
| 收緊預填 | `backend/tools/form_fields/audit_prefill.py` | 只保留申請人本人的預填，簽名一律不預填 |
| 服務 | 後端 `include_str!` 內嵌 JSON，或 `SUBSIDY_DATA` 環境變數覆寫 | 資料變更需重建後端 |
| 前端 | subsidy-web 快照 + `/api/catalog` | 讀取 `application.form_fields` |
| 填寫 | subsidy-web（建議）| 讀 PDF、依 `box` 畫字、使用者確認後產生 bytes |
| 分享 | `sharePdf()`（`src/townpass/index.ts`）→ Dart `share_pdf` | 呼叫系統分享面板 |

## 2. 資料結構

`application.form_fields` 的欄位定義見 `backend/data/subsidies.schema.json`（已通過驗證，0 錯誤）。

### 2.1 外層（主表單）

| 欄位 | 說明 |
|---|---|
| `status` | 見下表 |
| `label` / `source_url` / `found_on` / `origin` | 表單名稱、下載網址、連結來源頁、`recorded`（原 `urls.form`）或 `discovered`（另外找到） |
| `local_file` | PDF 路徑，相對於 `backend/data/`，例如 `forms/<sha12>.pdf` |
| `pages` | 每頁 `{page, width, height}`，為**顯示後**尺寸（pt） |
| `form_pages` | 含可填欄位的頁碼；其他頁的欄位不會出現 |
| `fields` | 欄位陣列 |
| `attachments` | 同一紀錄的其他 PDF（切結書、委託書、領據等），結構同主表單 |
| `signature_policy` | `{requires_handwritten, evidence[]}`，文件是否要求親簽 |
| `reason` / `office_files` | 沒有 PDF 時的原因；ODT/DOCX/XLS 候選網址 |

`status` 的意思：

| status | 意思 | app 行為 |
|---|---|---|
| `analyzed` | 已偵測欄位 | 可填寫 |
| `no_fillable_form` | 有 PDF 但不是申請表（計畫書、說明） | 不提供填寫 |
| `scanned_image_pdf` | 掃描檔，無文字層 | 不提供；需 OCR |
| `text_unreadable` | 字型無 Unicode 對應，文字是亂碼 | 不提供；需 OCR |
| `analysis_error` | 分析失敗 | 不提供 |
| `office_file_only` | 只有 ODT／DOCX／XLS | 不提供（本階段不處理） |
| `online_system` | 線上申請 | 顯示官方入口 |
| `no_form_exists` | 確認不需表單（自動核發、不用申請） | 顯示說明 |
| `download_failed` | 抓取失敗 | 顯示官方網址與 `reason` |

### 2.2 每個欄位

| 欄位 | 說明 |
|---|---|
| `type` | `text`／`date`／`checkbox`／`signature` |
| `label` | 表單上的印刷標籤 |
| `key` | 語意類別：`name` `national_id` `gender` `phone` `mobile` `address` `birth_date` `email` `signature` 等 |
| `box` | `{page, x, y, w, h}`，見第 3 節 |
| `prefill` | **只有 `true` 才可以自動填** |
| `prefill_key` | `prefill` 為 true 時，對應的個人資料類別 |
| `subject` / `subject_evidence` | `applicant`；依據，例如 `label`、`column_header:…`、`same_block_as_name:…` |
| `candidate_key` / `blocked_reason` | 有個資候選但被擋下；app 可詢問使用者 |
| `variant` | 例如 `home`（住家電話）、`registered`（戶籍地址） |
| `preprinted_prefix` | 表單已印好的前綴（例如「臺北市」），只需填剩餘部分 |
| `options` | `checkbox` 的選項文字 |
| `signature_mode` | 簽名欄：`handwritten_required` 或 `signature_or_seal` |

目前的統計（`prefill: true`）：姓名 163、身分證 140、電話 108、手機 61、地址 70、性別 6，合計 548。被擋下的候選有 746 個，其中 `other_person` 420、`subject_unclear` 248。

## 3. 座標

- 單位：PDF point（1/72 吋）。
- 原點：**顯示後頁面的左上角**，x 向右、y 向下。`box` 已經處理過頁面旋轉，所以應該直接用顯示尺寸（`pages[].width/height`）。
- `box.x, box.y` 是框的左上角，`w, h` 是寬高。
- 例：`WEL-0028` 第 1–3 頁是橫向（842×595），第 4–5 頁是直向（595×842）。
- 框超出頁面的已知案例：`WEL-0070` 第 1 頁 x=−2.9、`CT-0132` 第 1 頁 x=−19.0。app 要把 x 夾在 0 以上。

### 3.1 映射到 PDF 使用者空間（pdf-lib 使用左下原點）

設 `/MediaBox` 的未旋轉寬高為 W0、H0，`/Rotate` 為 R，顯示座標 (dx, dy)，使用者座標 (ux, uy)。依頁面旋轉方向推導的對應：

| R | dx | dy |
|---|---|---|
| 0 | ux | H0 − uy |
| 90 | uy | ux |
| 180 | W0 − ux | uy |
| 270 | H0 − uy | W0 − ux |

**注意：這張表是依旋轉方向推導的，尚未用真實檔案實測。** 寫入文字時，旋轉頁的文字也要以相同角度繪製。在完成實測前，R≠0 的頁面應該拒絕填寫，見下方範例。

## 4. 預填規則（app 必須遵守）

1. 只在 `prefill === true` 且 `type !== 'signature'` 時寫入。`candidate_key` 或 `blocked_reason` 存在的欄位保持空白。
2. `prefill_key` 對應個人資料：
   - `name` → 姓名；`national_id` → 身分證字號；`phone` → 電話（`variant: home` 為住家）；`mobile` → 手機；`address` → 地址；`gender` → 性別。
   - 若有 `preprinted_prefix`，寫入前先去掉前綴。
3. **值必須來自使用者自己輸入或確認的資料**，app 不得從其他人的資料或快照猜測。寫入前要顯示預覽，讓使用者逐項確認。資料中的 `subject` 是啟發式判斷，不能取代使用者確認。
4. `signature_policy.requires_handwritten === true` 的文件：即使印刷姓名欄看似可填，資料端也已擋下；app 應提示「此表需親筆簽名」，不要代填。
5. 附件（`attachments`）與主表單同樣適用本節規則，並讓使用者選擇要產生哪幾份。
6. 性別只有 6 筆、且以文字欄為主。若表單是「□男 □女」勾選，目前不會預填，應由使用者勾選。

## 5. 填寫與分享（subsidy-web 建議做法）

### 5.1 範例（草稿，尚未在 app 內執行）

```ts
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

type Box = { page: number; x: number; y: number; w: number; h: number };
type Field = { type: string; prefill: boolean; prefill_key?: string; box: Box; preprinted_prefix?: string };

// values 必須是使用者已確認的內容，例如 { name: '…', national_id: '…' }
export async function fillForm(
  pdfBytes: Uint8Array,
  fontBytes: Uint8Array,
  fields: Field[],
  values: Record<string, string>,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(fontBytes, { subset: true });
  const pages = doc.getPages();

  for (const f of fields) {
    if (!f.prefill || f.type === 'signature' || !f.prefill_key) continue;
    let value = values[f.prefill_key];
    if (!value) continue;
    if (f.preprinted_prefix && value.startsWith(f.preprinted_prefix)) {
      value = value.slice(f.preprinted_prefix.length);
    }

    const page = pages[f.box.page - 1];
    if (page.getRotation().angle !== 0) {
      // 旋轉頁尚未實測，先拒絕，見指南 3.1
      throw new Error(`第 ${f.box.page} 頁為旋轉頁，尚未支援`);
    }
    const { height } = page.getSize();
    const x = Math.max(0, f.box.x);
    const size = Math.min(11, f.box.h * 0.6);
    const baseline = height - (f.box.y + f.box.h) + f.box.h * 0.25;
    page.drawText(value, { x: x + 2, y: baseline, size, font, color: rgb(0, 0, 0) });
  }
  return doc.save();
}
```

注意事項：
- 文字寬度超過 `w` 時要縮小字級或換行，草稿沒有處理。
- 字型必須嵌入 CJK 字型（同 `checklist-pdf.ts` 的 NotoSansTC），pdf-lib 內建字型不支援中文。
- 必須在真實 PDF 上目視比對，包括旋轉頁與多人表單。

### 5.2 分享

使用既有的 `sharePdfFile()`（`src/domain/pdf-file.ts`），由使用者點擊後呼叫：

```ts
const outcome = await sharePdfFile(new File([bytes], '申請表.pdf', { type: 'application/pdf' }));
// 'presented' | 'cancelled' | 'unsupported' | 'failed'
```

橋接限制（Dart `share_pdf_message_handler.dart`）：
- 必須是主框架且 `userInitiated: true`，否則回傳 `invalid_request`。
- 最大 10 MB（`maxPdfBytes`）。
- 開頭必須是 `%PDF-1.x`，結尾必須有 `%%EOF`。
- 檔名不可以 `.` 開頭、不可有前後空白、長度 ≤ 120，且必須以 `.pdf` 結尾。
- 同時只能有一個分享請求，否則回傳 `busy`。
- 回覆 `presented` 只代表已交給系統分享面板，不代表對方已收到或已送件。

## 6. 尚未完成的缺口（上線前必須決定）

1. **PDF 送達路徑。** 目前沒有任何服務會把 `backend/data/forms/*.pdf` 送到前端：後端只服務 `WEB_ROOT` 內的建置檔，subsidy-web 也沒有 `public/`。可選方案：
   - A（建議）：後端新增 `GET /api/forms/{file}`，只允許 `^[0-9a-f]{12}\.pdf$` 這種檔名，避免路徑穿越。
   - B：隨 subsidy-web 建置放入 `public/forms/`。全部約 39 MB，WebView 負擔大。
   - C：打包進 Flutter assets。同樣很大，且每次更新都要發版。
2. **資料更新需重建。** 後端用 `include_str!` 內嵌 JSON，改資料後要重建後端，或設定 `SUBSIDY_DATA` 覆寫；subsidy-web 快照也要重新建置。
3. **檔案體積。** `subsidies.json` 約 4.3 MB（已排版），其中 `form_fields` 約 1 MB；`forms/` 約 39 MB。前端快照是獨立 chunk 按需載入，但仍需留意手機 WebView 的載入時間。
4. **`urls.form` 未被修改。** 規則檔的審核指紋包含 `urls.form`，所以找到的新網址只寫在 `form_fields.source_url`。`form_fields` 不參與指紋計算（後端與前端一致）。

## 7. 已知限制

- 欄位位置是程式啟發式偵測。目前只目視抽查了約 10 份表單，其餘未逐份人工核對。
- 所有來源 PDF 都是平面檔（沒有 AcroForm 可填欄位），所有位置都靠文字與格線推算。
- 以下情況不會產生可填欄位：ODT／DOCX／XLS（24 筆）、掃描檔（4 筆）、亂碼字型（2 筆）、非申請表（5 筆）、網頁入口（9 筆）。
- 學生、病人、被保險人、授權人、承租人的欄位會被擋下（`subject_unclear`），即使表單其實就是本人填寫。這是刻意保守的設計；若要放寬需另行確認規則。
- 旋轉頁座標映射尚未實測（見 3.1）。
- 出現在同頁的其他人物（代理人、家庭成員、受款人）以標題、列位與距離判斷，多人表單容易出錯，應以抽樣檢查為準。

## 8. 驗收清單

- [ ] 抽樣至少 10 份 `analyzed` 表單，在 app 內渲染後框位置正確，包括：
  - `WEL-0028`（旋轉頁）
  - `CT-0127`（受款人區塊應全部擋下）
  - `WEL-0067`（第 4 頁家庭成員欄應全部擋下）
  - `CT-0125`、`WEL-0112`（密集表格）
- [ ] 產生的 PDF 在系統預覽與 Acrobat 皆可開啟，中文字正確顯示。
- [ ] 預填值只來自使用者確認過的個人資料。
- [ ] `signature`、`candidate_key` 欄位永遠不寫入。
- [ ] `requires_handwritten` 的文件不寫入印刷姓名欄。
- [ ] 分享的取消、失敗、`busy`、`unsupported` 各有對應的 UI。
- [ ] 資料更新後後端與前端都已重建，`/api/catalog` 內的 `form_fields` 與檔案一致。

## 9. 重新產生資料

見 `backend/tools/form_fields/README.md`。流程為：
`download.py` → `extract_fields.py`／`analyze_all.py` → `refine.py` → `build.py` → **`audit_prefill.py`（必跑）** → `overlay.py` 目視檢查。

`audit_prefill.py` 每次在 `build.py` 之後都要重跑，因為 `build.py` 會重寫 `form_fields`。

## 10. 待決定事項（尚未實作）

以下三項需要先決定，才能進入實作。目前只記錄，不改程式。

### 10.1 PDF 送達路徑

狀態：未決定。
- A（建議）：後端新增 `GET /api/forms/{file}`，檔名只允許 `^[0-9a-f]{12}\.pdf$`，避免路徑穿越。優點：不增加 app 體積，可獨立更新。
- B：隨 subsidy-web 建置放入 `public/forms/`。缺點：約 39 MB，WebView 負擔大。
- C：打包進 Flutter assets。缺點：同樣很大，每次更新都要發版。

### 10.2 填寫放在哪一端

狀態：未決定。
- A（建議）：subsidy-web 用 `pdf-lib` 填寫，Dart 只負責 `share_pdf`。理由：前端已有 `pdf-lib`、CJK 字型與檢核表 PDF 流程，Dart 端沒有 PDF 繪製套件。
- B：Dart 端填寫。需要新增 PDF 套件，並自行處理 CJK 字型與座標轉換。

### 10.3 旋轉頁座標

狀態：未驗證。第 3.1 節的映射表是依旋轉方向推導的，尚未用真實檔案實測。
- 待辦：以 `WEL-0028`（第 1–3 頁為 90° 旋轉）實測，確認映射正確後，才能在草稿代碼中開放旋轉頁填寫。
- 目前草稿對旋轉頁直接拋出錯誤，屬於刻意保守。

## 11. 資料更新流程備註

- 後端以 `include_str!` 內嵌 `subsidies.json`，改資料後必須重建後端，或以 `SUBSIDY_DATA` 覆寫。
- subsidy-web 的快照同樣在建置時打包，改資料後需重新建置。
- 執行 `build.py` 後一定要再跑 `audit_prefill.py`，否則預填規則不會生效。
