// Draws 申請人 at display (200,300)-(230,310) on blank pages rotated 0/90/180/270 (NotoSansTC, full embed).
// usage: node rotated_text.cjs <out_dir>
const { createRequire } = require('module');
const fs = require('fs');
const path = require('path');
const repo = path.resolve(__dirname, '../../../..');
const req = createRequire(path.join(repo, 'subsidy-web/package.json'));
const { PDFDocument, rgb, degrees } = req('pdf-lib');
const fontkit = req('@pdf-lib/fontkit');
const OUT = process.argv[2];
if (!OUT) { console.error('usage: node rotated_text.cjs <out_dir>'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
function toUser(R, dx, dy, W0, H0) {
  switch (R) {
    case 0: return [dx, H0 - dy];
    case 90: return [dy, dx];
    case 180: return [W0 - dx, dy];
    case 270: return [W0 - dy, H0 - dx];
  }
}
(async () => {
  const fontBytes = fs.readFileSync(path.join(repo, 'subsidy-web/src/assets/fonts/NotoSansTC-Regular.ttf'));
  const exp = {};
  for (const R of [0, 90, 180, 270]) {
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    const font = await doc.embedFont(fontBytes, { subset: false });
    const page = doc.addPage([595, 842]);
    page.setRotation(degrees(R));
    const cb = page.getCropBox();
    const [ux, uy] = toUser(R, 200, 310, cb.width, cb.height);
    page.drawText('申請人', { x: cb.x + ux, y: cb.y + uy, size: 10, font, color: rgb(0, 0, 0), rotate: degrees(R) });
    fs.writeFileSync(path.join(OUT, `text_${R}.pdf`), await doc.save());
    exp[R] = { box: [200, 300, 230, 310] };
  }
  fs.writeFileSync(path.join(OUT, 'text.expected.json'), JSON.stringify(exp));
  console.log('ok');
})().catch(e => { console.error(e); process.exit(1); });
