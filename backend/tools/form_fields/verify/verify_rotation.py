"""Render the PDFs written by rotation_markers.cjs / rotated_text.cjs and check positions.
usage: python -I verify_rotation.py <out_dir>      (needs PyMuPDF: pip install pymupdf)"""
import json, sys, collections, pymupdf
pymupdf.TOOLS.mupdf_display_errors(False)
OUT = sys.argv[1]

def magenta_centroids(pix):
    w, h, n, s = pix.width, pix.height, pix.n, pix.samples
    def is_m(x, y):
        i = (y * w + x) * n
        return s[i] > 230 and s[i + 1] < 40 and s[i + 2] > 230
    seen = bytearray(w * h); out = []
    for y in range(h):
        for x in range(w):
            if seen[y * w + x] or not is_m(x, y): continue
            stack = [(x, y)]; seen[y * w + x] = 1; pts = []
            while stack:
                cx, cy = stack.pop(); pts.append((cx, cy))
                for nx, ny in ((cx+1,cy),(cx-1,cy),(cx,cy+1),(cx,cy-1)):
                    if 0 <= nx < w and 0 <= ny < h and not seen[ny*w+nx] and is_m(nx, ny):
                        seen[ny*w+nx] = 1; stack.append((nx, ny))
            if len(pts) >= 12:
                out.append((sum(p[0] for p in pts)/len(pts)+0.5, sum(p[1] for p in pts)/len(pts)+0.5))
    return out

import os
stat = collections.Counter(); misses = []
exp = json.load(open(f'{OUT}/expected.json')) if os.path.exists(f'{OUT}/expected.json') else {}
for lf, items in exp.items():
    doc = pymupdf.open(f"{OUT}/{lf.replace('/', '_')}")
    for pno in sorted({i['page'] for i in items}):
        pts = {(round(i['dx'], 1), round(i['dy'], 1)) for i in items if i['page'] == pno}
        found = magenta_centroids(doc[pno - 1].get_pixmap(alpha=False, dpi=72))
        for ex, ey in pts:
            d = min((((fx-ex)**2 + (fy-ey)**2) ** .5 for fx, fy in found), default=9e9)
            if d <= 1.0: stat['ok'] += 1; continue
            near = [p for p in pts if p != (ex, ey) and ((p[0]-ex)**2 + (p[1]-ey)**2) ** .5 < 6.5]
            if near: stat['merged_with_neighbour'] += 1
            else: stat['UNEXPLAINED'] += 1; misses.append((lf, pno, ex, ey, round(d, 2)))
if exp: print('markers', dict(stat))
for m in misses[:20]: print('unexplained', m)

if not os.path.exists(f'{OUT}/text.expected.json'): sys.exit(0)
t = json.load(open(f'{OUT}/text.expected.json'))
for R in t:
    page = pymupdf.open(f'{OUT}/text_{R}.pdf')[0]
    pix = page.get_pixmap(alpha=False, dpi=72)
    w, n, s = pix.width, pix.n, pix.samples
    xs, ys = [], []
    for y in range(pix.height):
        for x in range(w):
            i = (y * w + x) * n
            if s[i] < 128 and s[i+1] < 128 and s[i+2] < 128: xs.append(x); ys.append(y)
    b = t[R]['box']
    print(f"text rot {R}: ink x[{min(xs)},{max(xs)+1}) y[{min(ys)},{max(ys)+1}) expected box x[{b[0]},{b[2]}) y[{b[1]},{b[3]})")
