import fitz, json, sys, os
fitz.TOOLS.mupdf_display_errors(False)
rid, pno, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
j = json.load(open(f'/tmp/tp_fields/{rid}.fields.json'))
doc = fitz.open(f'/tmp/tp_forms/{rid}.pdf'); pg = doc[pno-1]
col = {True:(1,0,0), False:(0,0.4,1)}
for f in j['fields']:
    b = f['box']
    if b['page'] != pno: continue
    r = fitz.Rect(b['x'], b['y'], b['x']+b['w'], b['y']+b['h']) * pg.derotation_matrix
    r.normalize()
    pg.draw_rect(r, color=col[f['prefill']], width=1.2)
    p = fitz.Point(r.x0+1, r.y0+7) 
    pg.insert_text(p, f"{f['key']}", fontsize=6, color=col[f['prefill']])
pg.get_pixmap(dpi=100).save(out)
