# 旋轉頁座標與文字方向驗證

對應 `docs/form-fields-integration.md` §3.1 與 §10.3。需要 Node（使用 `subsidy-web/node_modules` 的 pdf-lib）與 PyMuPDF。

```sh
OUT=/tmp/rotcheck; mkdir -p $OUT
cd /path/to/repo
node backend/tools/form_fields/verify/rotation_markers.cjs $OUT/all   # 所有已分析表單的欄位中心放標記
node backend/tools/form_fields/verify/rotated_text.cjs $OUT/text     # 0/90/180/270 空白頁畫「申請人」
python3 -m venv $OUT/venv && $OUT/venv/bin/pip install pymupdf
$OUT/venv/bin/python -I backend/tools/form_fields/verify/verify_rotation.py $OUT/all    # 標記
$OUT/venv/bin/python -I backend/tools/form_fields/verify/verify_rotation.py $OUT/text   # 文字
```

判定：標記中心與預期點誤差 ≤1pt；未達標者必須能由相鄰標記（<6.5pt，方塊會在點陣上合併）解釋，否則為 UNEXPLAINED。
文字的墨跡框應與預期框（x 200–230、y 300–310）重合，誤差在字形邊界內即可。
只用 PyMuPDF 渲染；Acrobat、Preview、Chrome 等閱讀器未測。
