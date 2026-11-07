"""Draw detected boxes on a form page.  usage: overlay.py <backend/data dir> <record id> <page> <out.png> [entry index]
green = will be pre-filled (applicant's own data) | orange = personal-data candidate that was BLOCKED
purple = signature (never pre-filled) | blue = other field"""
import fitz, json, sys, os
fitz.TOOLS.mupdf_display_errors(False)
data, rid, pno, out = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
idx = int(sys.argv[5]) if len(sys.argv) > 5 else 0
d = {r['id']: r for r in json.load(open(os.path.join(data, 'subsidies.json')))}
ff = d[rid]['application']['form_fields']
e = ([ff] + ff.get('attachments', []))[idx]
doc = fitz.open(os.path.join(data, e['local_file'])); pg = doc[pno - 1]
for f in e['fields']:
    b = f['box']
    if b['page'] != pno or f['type'] == 'checkbox': continue
    r = fitz.Rect(b['x'], b['y'], b['x'] + b['w'], b['y'] + b['h']) * pg.derotation_matrix; r.normalize()
    if f['prefill']: c, tag = (0, .6, 0), 'FILL:' + f['prefill_key']
    elif f['type'] == 'signature': c, tag = (.6, 0, .8), 'SIGN'
    elif f.get('candidate_key'): c, tag = (1, .5, 0), 'BLOCK:' + (f.get('blocked_reason') or '')[:14]
    else: c, tag = (0, .4, 1), f['key']
    pg.draw_rect(r, color=c, width=1.3); pg.insert_text(fitz.Point(r.x0 + 1, r.y0 + 7), tag, fontsize=6, color=c)
pg.get_pixmap(dpi=90).save(out)
print(e.get('label'), e.get('signature_policy'))
