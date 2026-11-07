# PDF 繁中字型

- Noto Sans TC Regular，SIL Open Font License 1.1；完整授權見同目錄 `LICENSE`（Reserved Font Name 為 Source）。
- 官方來源：https://github.com/google/fonts/blob/main/ofl/notosanstc/NotoSansTC%5Bwght%5D.ttf
- 隨附 `NotoSansTC-Regular.ttf` 約 6.8 MiB：以 FontTools 4.68.0 從官方可變 TTF 固定 `wght=400`，並將字型名稱表標為 Regular，不變更字形設計。繁體中文、拉丁字元均保留。
- 重製：`python -m fontTools.varLib.instancer 'NotoSansTC[wght].ttf' wght=400 --output NotoSansTC-Regular.ttf`；名稱表 1/16 設 Noto Sans TC、2/17 設 Regular、4 設 Noto Sans TC Regular、6 設 NotoSansTC-Regular。
- Vite 打包為本站靜態資產，執行時不使用外部 CDN。PDF 完整嵌入字型（壓縮後範例約 4.2 MB），避免 fontkit 對 CJK 子集的跨閱讀器缺字問題；已用 Poppler 渲染及文字抽取核對。
- 不支援的罕用字以 `[U+碼位]` 明示，避免靜默遺漏。
- PDF 產製：`pdf-lib` 與 `@pdf-lib/fontkit`，MIT 授權。官方用法：https://pdf-lib.js.org/#embed-font-and-measure-text
