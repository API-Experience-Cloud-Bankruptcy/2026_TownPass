# 表單欄位分析工具

把 `subsidies.json` 的 `application.urls.form` 抓下來，分析 PDF 欄位，寫回 `application.form_fields`。
需要 PyMuPDF 與 requests（建議用獨立 venv：`python3 -m venv /tmp/v && /tmp/v/bin/pip install pymupdf requests`）。

```sh
D=/tmp/forms; F=/tmp/fields
python download.py backend/data/subsidies.json $D        # 下載並依檔頭判斷格式，產生 _download_report.json
python extract_fields.py $D $F                           # 逐份唯一 PDF 偵測欄位
python merge.py backend/data/subsidies.json $D $F backend/data/forms   # 寫回 JSON、複製 PDF
python overlay.py WEL-0010 1 /tmp/out.png                # 目視檢查：把偵測框畫在 PDF 上（紅=可預填、藍=不預填）
```

座標單位為 PDF point，原點在「顯示後頁面」左上角（已處理頁面旋轉）。偵測為啟發式，輸出需抽查。
overlay.py 預設從 `/tmp/tp_fields`、`/tmp/tp_forms` 讀取，需要時自行改路徑。
