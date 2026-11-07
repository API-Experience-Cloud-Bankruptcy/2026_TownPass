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

**已實測（2026-11-08）**：對全部 161 份已分析 PDF 的 5274 個欄位，用 pdf-lib 依此表放標記、PyMuPDF 渲染比對，5273 個不同中心點中 5222 個誤差 ≤1pt，其餘 51 個皆因相距 <6.5pt 的標記在點陣上合併（每個都有相鄰欄位），無無法解釋的偏差。涵蓋 0°、90°；180°、270° 以 WEL-0028 第 4 頁合成旋轉測試；CropBox 原點非 (0,0) 的 4 頁也在測試內。

- 使用者空間座標一律要加上 CropBox 原點：`x = cropBox.x + ux`，`y = cropBox.y + uy`，其中 `ux, uy` 以 CropBox 寬高（W0, H0）計算。
- 文字方向：旋轉頁的文字要以 `rotate: degrees(R)` 繪製（R 為頁面 `/Rotate`）。已用 NotoSansTC 在 0/90/180/270 空白頁各畫一次「申請人」，墨跡都落在顯示座標的同一框內。

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
import { PDFDocument, rgb, degrees } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

type Box = { page: number; x: number; y: number; w: number; h: number };
type Field = { type: string; prefill: boolean; prefill_key?: string; box: Box; preprinted_prefix?: string };

// 顯示座標（左上原點）→ CropBox 內的使用者座標，依 §3.1 已實測
function toUser(R: number, dx: number, dy: number, W0: number, H0: number): [number, number] {
  switch (R) {
    case 0: return [dx, H0 - dy];
    case 90: return [dy, dx];
    case 180: return [W0 - dx, dy];
    case 270: return [W0 - dy, H0 - dx];
    default: throw new Error(`unsupported rotation ${R}`);
  }
}

// values 必須是使用者已確認的內容，例如 { name: '…', national_id: '…' }
export async function fillForm(
  pdfBytes: Uint8Array,
  fontBytes: Uint8Array,
  fields: Field[],
  values: Record<string, string>,
): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdfBytes);
  doc.registerFontkit(fontkit);
  // 完整嵌入，與 checklist-pdf.ts 一致：subset 在 PyMuPDF 渲染為空白
  const font = await doc.embedFont(fontBytes, { subset: false });
  const pages = doc.getPages();

  for (const f of fields) {
    if (!f.prefill || f.type === 'signature' || !f.prefill_key) continue;
    let value = values[f.prefill_key];
    if (!value) continue;
    if (f.preprinted_prefix && value.startsWith(f.preprinted_prefix)) {
      value = value.slice(f.preprinted_prefix.length);
    }
    const page = pages[f.box.page - 1];
    const R = page.getRotation().angle;
    const cb = page.getCropBox();
    // 錨點：框左側 +2pt，基線約在框高 80%；超出框寬的文字尚未處理（需縮字級或換行）
    const size = Math.min(11, f.box.h * 0.8);
    const [ux, uy] = toUser(R, f.box.x + 2, f.box.y + f.box.h * 0.8, cb.width, cb.height);
    page.drawText(value, {
      x: cb.x + ux,
      y: cb.y + uy,
      size,
      font,
      color: rgb(0, 0, 0),
      rotate: degrees(R),
    });
  }
  return doc.save();
}
```

注意事項：
- 文字寬度超過 `w` 時要縮小字級或換行，草稿沒有處理。
- 字型必須嵌入 CJK 字型（同 `checklist-pdf.ts` 的 NotoSansTC），pdf-lib 內建字型不支援中文。
- 錨點位置與字級只驗證了文字方向與大致落點，未檢查中文字在欄位內的垂直置中；必須在真實表單上目視比對。

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

1. **PDF 送達路徑（已實作，分支 `feat/form-fields-serving`）。** 後端提供 `GET /api/forms/{file}`，只接受 `^[0-9a-f]{12}\.pdf$`，其他檔名一律 404。檔案目錄預設為 `backend/data/forms`，部署時以 `FORMS_DIR` 覆寫。app 取用時用 `local_file` 的檔名組出 `/api/forms/<檔名>`。回應為 `application/pdf`，`Cache-Control: public, max-age=86400`，`X-Content-Type-Options: nosniff`。另外 B、C 兩個方案不採用：B 約 39MB 會放進 web 建置，C 會把同樣的體積打進 Flutter 殼且每次更新都要發版。
2. **資料更新需重建。** 後端用 `include_str!` 內嵌 JSON，改資料後要重建後端，或設定 `SUBSIDY_DATA` 覆寫；subsidy-web 快照也要重新建置。
3. **檔案體積。** `subsidies.json` 約 4.3 MB（已排版），其中 `form_fields` 約 1 MB；`forms/` 約 39 MB。前端快照是獨立 chunk 按需載入，但仍需留意手機 WebView 的載入時間。
4. **`urls.form` 未被修改。** 規則檔的審核指紋包含 `urls.form`，所以找到的新網址只寫在 `form_fields.source_url`。`form_fields` 不參與指紋計算（後端與前端一致）。

## 7. 已知限制

- 欄位位置是程式啟發式偵測。目前只目視抽查了約 10 份表單，其餘未逐份人工核對。
- 所有來源 PDF 都是平面檔（沒有 AcroForm 可填欄位），所有位置都靠文字與格線推算。
- 以下情況不會產生可填欄位：ODT／DOCX／XLS（24 筆）、掃描檔（4 筆）、亂碼字型（2 筆）、非申請表（5 筆）、網頁入口（9 筆）。
- 學生、病人、被保險人、授權人、承租人的欄位會被擋下（`subject_unclear`），即使表單其實就是本人填寫。這是刻意保守的設計；若要放寬需另行確認規則。
- 旋轉頁座標與文字方向已實測（見 3.1），但中文字在欄位內的垂直置中與超寬文字尚未處理。
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

## 10. 決定與狀態（2026-11-08）

| 項目 | 決定 | 狀態 |
|---|---|---|
| 10.1 PDF 送達 | 方案 A：後端 `GET /api/forms/{file}` | 已實作，含測試 |
| 10.2 填寫位置 | web 以 pdf-lib 填寫，Dart 只負責 `share_pdf` | 已決定，app 內填寫流程尚未實作 |
| 10.3 旋轉頁座標 | 以真實渲染實測 | 已實測，見下 |

### 10.1 實作細節
- 路由：`GET /api/forms/{file}`。只接受 16 字元、小寫十六進位加 `.pdf` 的檔名；路徑穿越、大寫、非 ASCII、錯誤長度皆 404（測試 `form_pdfs_are_served_only_by_exact_hash_names` 涵蓋 12 種非法名稱）。
- 目錄：預設為編譯時的 `backend/data/forms`（`CARGO_MANIFEST_DIR`）。已確認 167 個檔名全部符合規則。部署到其他路徑時設定 `FORMS_DIR`。
- 注意：預設值是編譯時寫入的路徑，二進位搬離原始碼目錄時必須設定 `FORMS_DIR`。

### 10.3 旋轉頁座標（已實測）
- 方法：`backend/tools/form_fields/verify/` 內的腳本。pdf-lib 依 §3.1 的映射放洋紅色標記，PyMuPDF 渲染後比對質心。
- 結果：見 §3.1。沒有無法解釋的偏差。
- 文字方向：`drawText` 的 `rotate: degrees(R)` 已驗證。
- 未驗證：Acrobat、Preview、Chrome 等閱讀器的實際顯示；只用 PyMuPDF 渲染。

## 11. 資料更新流程備註

- 後端以 `include_str!` 內嵌 `subsidies.json`，改資料後必須重建後端，或以 `SUBSIDY_DATA` 覆寫。
- subsidy-web 的快照同樣在建置時打包，改資料後需重新建置。
- 執行 `build.py` 後一定要再跑 `audit_prefill.py`，否則預填規則不會生效。
