// Places a magenta marker at the display centre of every analysed form field, using the mapping in
// docs/form-fields-integration.md §3.1 plus the CropBox origin. Writes one PDF per form + expected.json.
// usage: node rotation_markers.cjs <out_dir>      (pdf-lib is taken from subsidy-web/node_modules)
const { createRequire } = require('module');
const fs = require('fs');
const path = require('path');
const repo = path.resolve(__dirname, '../../../..');
const { PDFDocument, rgb } = createRequire(path.join(repo, 'subsidy-web/package.json'))('pdf-lib');
const OUT = process.argv[2];
if (!OUT) { console.error('usage: node rotation_markers.cjs <out_dir>'); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });
function toUser(R, dx, dy, W0, H0) {
  switch (R) {
    case 0: return [dx, H0 - dy];
    case 90: return [dy, dx];
    case 180: return [W0 - dx, dy];
    case 270: return [W0 - dy, H0 - dx];
  }
  throw new Error('rotation ' + R);
}
(async () => {
  const subs = JSON.parse(fs.readFileSync(path.join(repo, 'backend/data/subsidies.json'), 'utf8'));
  const seen = new Map();
  for (const r of subs) {
    const ff = r.application.form_fields;
    for (const e of [ff, ...(ff.attachments || [])]) {
      if (e.status === 'analyzed' && !seen.has(e.local_file)) seen.set(e.local_file, e);
    }
  }
  const expected = {};
  for (const [lf, e] of seen) {
    const doc = await PDFDocument.load(fs.readFileSync(path.join(repo, 'backend/data', lf)));
    expected[lf] = [];
    for (const f of e.fields) {
      const b = f.box;
      const p = doc.getPage(b.page - 1);
      const R = p.getRotation().angle, cb = p.getCropBox();
      const dx = b.x + b.w / 2, dy = b.y + b.h / 2;
      const [ux, uy] = toUser(R, dx, dy, cb.width, cb.height);
      p.drawRectangle({ x: cb.x + ux - 3, y: cb.y + uy - 3, width: 6, height: 6, color: rgb(1, 0, 1) });
      expected[lf].push({ page: b.page, dx, dy, R, key: f.key });
    }
    fs.writeFileSync(path.join(OUT, lf.replace(/\//g, '_')), await doc.save());
  }
  fs.writeFileSync(path.join(OUT, 'expected.json'), JSON.stringify(expected));
  console.log('forms', seen.size, 'markers', Object.values(expected).reduce((n, a) => n + a.length, 0));
})().catch(e => { console.error(e); process.exit(1); });
