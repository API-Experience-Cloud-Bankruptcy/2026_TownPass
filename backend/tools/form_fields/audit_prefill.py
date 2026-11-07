"""Tighten `prefill`: only the APPLICANT'S OWN data may be pre-filled, and never a signature.

usage: python -I audit_prefill.py <backend/data dir> [--dry]
Idempotent post-process over subsidies.json + data/forms/*.pdf (run after build.py).

For every field that was a prefill candidate (name / national_id / gender / phone / mobile / address):
  1. label gating      - label must really be that kind of data (not 保險證號, 牌證號碼, 設置地址 ...)
  2. subject detection - who is the field about?  label role -> row header (left) -> column header (above)
                         -> same block as the nearest name field -> section heading -> sole person on page
                         applicant | other | unknown ; only `applicant` with explicit evidence is pre-filled
  3. signature rules   - signature / seal lines are never pre-filled; documents demanding a hand-written
                         signature (親簽 ...) also block the printed-name field of that signature block
Blocked candidates keep `candidate_key` + `blocked_reason` so the app may ask the user instead.
"""
import fitz, json, os, re, sys, collections, importlib.util

fitz.TOOLS.mupdf_display_errors(False)
here = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('ef', os.path.join(here, 'extract_fields.py'))
ef = importlib.util.module_from_spec(spec); spec.loader.exec_module(ef)

KEYS = ('name', 'national_id', 'gender', 'phone', 'mobile', 'address')
SIGN_LABEL = re.compile(r'簽名|簽章|簽署|簽字|蓋章|用印|印章|印信|關防|具名|署名|親簽')
SIGN_RIGHT = re.compile(r'簽名|簽章|簽署|蓋章|簽字|親簽')
SIGN_ROLE = re.compile(r'^(立書人|立切結書人|立同意書人|立據人|立委託書人|立切結人|聲明人|聲明者|切結人|具結人|具切結人)$')
STRICT = re.compile(r'親簽|親自簽|親筆|親自署|親自蓋|不得代簽|不得代為簽|不得蓋章|不得以印章|限本人簽|本人親自簽|須本人簽|應由本人簽')

APPL = re.compile(r'申請人|申請者|申請學生|申領人|請領人|申請補助人|本人|立書人|立同意書人|立切結書人|立據人|聲明者|聲明人|切結人')
STUDENT = re.compile(r'學生')
BENEF = re.compile(r'授權|承租人|承租|被保險人|被保人|身心障礙者|病人|病患|受益人|受領人|當事人|被照顧|受照顧|受補助|領取人')
OTHER = re.compile(
    r'配偶|父|母|眷屬|家屬|親屬|同住|成員|法定代理|監護|代理|委任|委託|受託|受款|領款|收款|被扶養|死亡|亡者|'
    r'聯絡人|連絡人|緊急|推薦|導師|證明人|介紹|保證|醫師|社工|承辦|經辦|審核|主管|負責人|主任委員|主委|代表人|'
    r'填表人|雇主|用人單位|廠商|房東|出租人|共同|老師|教師|家長|兒童|兒少|幼兒|新生兒|子女|孩|代領|管理組織|管理委員|'
    r'公司|機構|單位|學校|事業|營業|醫院|銀行|店')

ID_LABEL = re.compile(r'身[分份]證|居留證|統一證號|統號')
ID_ORG = re.compile(r'營利|事業|機關|團體|負責人|公司|商號|統一編號.*統一編號')
ADDR_LABEL = re.compile(r'址|住所|居所|住居所|通訊處')
ADDR_NOT = re.compile(r'設置|用電|安裝|裝設|工作|公司|營業|事業|單位|學校|坐落|標的|房屋|土地|廠|停車|場所|施工|建物|建築|承租|出租|機構|車籍|營業所')
PHONE_NOT = re.compile(r'緊急|社工|公司|工作|辦公|單位|傳真|\(公\)|（公）')


def strip(t):
    t = (t or '').replace('︵', '（').replace('︶', '）')
    t = re.sub(r'[（(][^）)]*[）)]', '', t)
    return re.sub(r'[\s　:：＿_＊*※■□☐☑▢\.．、，,;；/／]+', '', t)


def role_of(t):
    s = strip(t)
    if not s or len(s) > 18:
        return None
    o, a, st, b = OTHER.search(s), APPL.search(s), STUDENT.search(s), BENEF.search(s)
    if (o and a) or (a and b): return 'mixed'
    if o: return 'other'
    if a: return 'appl'
    if b: return 'benef'
    if st: return 'student'
    return None


def ov(a0, a1, b0, b1):
    return min(a1, b1) - max(a0, b0)


class Page:
    def __init__(self, page):
        self.lines = ef.page_lines(page)
        self.text = page.get_text()
        M = page.rotation_matrix
        # vertical (tategaki) headings such as 受/款/人/資/料 are dropped by page_lines -> add them back
        singles = []
        for b in page.get_text('dict')['blocks']:
            if b['type'] != 0: continue
            for ln in b['lines']:
                t = ''.join(sp['text'] for sp in ln['spans']).strip()
                r = fitz.Rect(ln['bbox']) * M; r.normalize()
                if len(t) >= 2 and r.height > r.width * 1.5:
                    self.lines.append(dict(bbox=tuple(r), text=t, raw=t, runs=[], vertical=True))
                elif len(t) == 1 and r.height < 30:
                    singles.append((round((r.x0 + r.x1) / 8), r, t))
        H, V = ef.segments(page); W, Hh = page.rect.width, page.rect.height
        self._cell = lambda x, y: ef.cell_at(H, V, x, y, W, Hh)
        cols = collections.defaultdict(list)
        for k, r, t in singles: cols[k].append((r, t))
        for k, items in cols.items():
            items.sort(key=lambda it: it[0].y0)
            chain = [items[0]]
            for it in items[1:] + [None]:
                if it is not None and it[0].y0 - chain[-1][0].y1 <= 45:
                    chain.append(it); continue
                if len(chain) >= 2:
                    x0 = min(c[0].x0 for c in chain); x1 = max(c[0].x1 for c in chain)
                    y0 = chain[0][0].y0; y1 = chain[-1][0].y1
                    txt = ''.join(c[1] for c in chain)
                    self.lines.append(dict(bbox=(x0, y0, x1, y1), text=txt, raw=txt, runs=[], vertical=True))
                chain = [it] if it is not None else []
        for l in self.lines:
            if l.get('vertical'):
                bb = l['bbox']; c = self._cell((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2)
                if c and (c[2] - c[0]) < 90:           # a narrow heading column: use the whole cell height
                    l['bbox'] = (bb[0], min(bb[1], c[1]), bb[2], max(bb[3], c[3]))


def own_line(l, label):
    a, b = strip(l['text']), strip(label)
    return len(a) >= 2 and len(b) >= 2 and (a in b or b in a)


def context_role(pg, f, label):
    b = f['box']; x0, y0, x1, y1 = b['x'], b['y'], b['x'] + b['w'], b['y'] + b['h']
    # row header: nearest role-bearing text to the left on the same row band
    best = None
    for l in pg.lines:
        bb = l['bbox']
        if own_line(l, label) or bb[2] > x0 + 2: continue
        if ov(bb[1], bb[3], y0, y1) < 3 or x0 - bb[2] > 330: continue
        r = role_of(l['text'])
        if r and (best is None or x0 - bb[2] < best[0]): best = (x0 - bb[2], r, l['text'])
    if best: return best[1], 'row_header:' + best[2][:12]
    # column header: nearest role-bearing text directly above
    best = None
    for l in pg.lines:
        bb = l['bbox']
        if own_line(l, label) or bb[3] > y0 + 2 or y0 - bb[3] > 45: continue
        if ov(bb[0], bb[2], x0, x1) < min(30, 0.3 * (x1 - x0)): continue
        r = role_of(l['text'])
        if r and (best is None or y0 - bb[3] < best[0]): best = (y0 - bb[3], r, l['text'])
    if best:
        # a much closer role-bearing line above (outside the column) with a different role -> ambiguous
        for l in pg.lines:
            bb = l['bbox']
            if own_line(l, label) or bb[3] > y0 + 2 or bb[0] > x1 or y0 - bb[3] >= best[0] - 10: continue
            if ov(bb[0], bb[2], x0, x1) >= min(30, 0.3 * (x1 - x0)): continue
            r2 = role_of(l['text'])
            if r2 and r2 != best[1]: return 'mixed', 'conflict:' + l['text'][:10]
        return best[1], 'column_header:' + best[2][:12]
    return None, None


def heading_role(pg, f, label):
    b = f['box']; y0 = b['y']; x1 = b['x'] + b['w']
    best = None
    for l in pg.lines:
        bb = l['bbox']
        if own_line(l, label) or bb[3] > y0 + 3 or y0 - bb[3] > 260 or bb[0] > x1: continue
        if len(strip(l['text'])) > 12: continue
        r = role_of(l['text'])
        if r and (best is None or bb[3] > best[0]): best = (bb[3], r, l['text'])
    return (best[1], 'section_heading:' + best[2][:12]) if best else (None, None)


def judge(f, pg, names, strict_doc, sig_boxes):
    """-> (prefill:bool, subject, evidence, blocked_reason)"""
    key = f['key']; raw = f['label'] or ''
    s = strip(raw)
    # ---- label gating ----
    if len(s) > 22 or re.search(r'行銷|得以|同意|是否|願意|如有|應檢|須檢|請填|請勿', s):
        return False, 'unknown', None, 'label_unclear'
    if re.search(r'地址.*電話|電話.*地址|地址.*姓名|姓名.*地址', s):                    # composite label
        return False, 'unknown', None, 'label_unclear'
    flat = raw.replace(' ', '')
    if flat.count('）') + flat.count(')') > flat.count('（') + flat.count('('):   # truncated label, e.g. "責人）地址"
        return False, 'unknown', None, 'label_unclear'
    paren = ''.join(re.findall(r'[（(]([^）)]*)[）)]', raw))
    if paren and not APPL.search(s) and OTHER.search(paren):
        return False, 'other', 'label_note', 'other_person'
    if key == 'name' and not (re.search(r'姓名|名字', s) or (len(s) <= 10 and role_of(raw) in ('appl', 'student'))):
        return False, 'unknown', None, 'label_unclear'
    if key == 'national_id':
        if not ID_LABEL.search(s): return False, 'unknown', None, 'not_personal_id'
        if ID_ORG.search(s): return False, 'other', None, 'organization'
    if key == 'address':
        if ADDR_NOT.search(s): return False, 'other', None, 'not_personal_address'
        if not ADDR_LABEL.search(s): return False, 'unknown', None, 'label_unclear'
    if key in ('phone', 'mobile') and PHONE_NOT.search(raw.replace(' ', '')):
        return False, 'other', None, 'not_personal_phone'
    if key == 'gender' and '性別' not in s: return False, 'unknown', None, 'label_unclear'
    # ---- subject ----
    role = role_of(raw)
    ev = None
    if role == 'appl': subject, ev = 'applicant', 'label'
    elif role == 'other': return False, 'other', 'label', 'other_person'
    elif role == 'mixed': return False, 'unknown', 'label', 'subject_unclear'
    elif role in ('benef', 'student'): return False, 'unknown', 'label', 'subject_unclear'   # a student/patient is not necessarily the applicant
    else:
        r, e = context_role(pg, f, raw)
        if r is None and key != 'name':
            near = None                       # same block as the nearest name field
            cx, cy = b_center(f)
            for n in names:
                nx, ny = b_center(n)
                if ny > cy + 12 or n['_subject'] is None: continue
                d = abs(cy - ny) + 0.5 * abs(cx - nx)
                if d < 220 and not barrier(pg, n, f) and (near is None or d < near[0]): near = (d, n)
            if near:
                r, e = ('appl' if near[1]['_subject'] == 'applicant' else 'other' if near[1]['_subject'] == 'other' else 'benef'), \
                       'same_block_as_name:' + (near[1]['label'] or '')[:10]
        if r is None:
            r, e = heading_role(pg, f, raw)
        if r is None:                          # sole person on the page, and nobody else is mentioned
            n_names = sum(1 for n in names if n['box']['page'] == f['box']['page'])
            if n_names <= 1 and not OTHER.search(pg.text.replace('\n', '')[:100000].replace('法定代理人', '')) and key in KEYS:
                r, e = 'appl', 'sole_person_on_page'
        if r == 'appl': subject, ev = 'applicant', e
        elif r == 'other': return False, 'other', e, 'other_person'
        elif r in ('mixed', 'benef', 'student'): return False, 'unknown', e, 'subject_unclear'
        else: return False, 'unknown', None, 'subject_unclear'
    # ---- signature block ----
    if strict_doc and key == 'name':
        for sb in sig_boxes:
            if sb['page'] == f['box']['page'] and abs(sb['y'] - f['box']['y']) < 90:
                return False, subject, ev, 'handwritten_signature_required'
    return True, subject, ev, None


def barrier(pg, n, f):
    """another person's heading/label lies between the name field and this field"""
    nx, ny = b_center(n); cx, cy = b_center(f)
    lo, hi = min(ny, cy), max(ny, cy)
    xl = min(n['box']['x'], f['box']['x']) - 60
    xr = max(n['box']['x'] + n['box']['w'], f['box']['x'] + f['box']['w']) + 60
    for l in pg.lines:
        bb = l['bbox']
        if lo + 2 < (bb[1] + bb[3]) / 2 < hi - 2 and bb[0] < xr and bb[2] > xl and role_of(l['text']) in ('other', 'benef', 'mixed'):
            return True
    return False


def b_center(f):
    b = f['box']; return b['x'] + b['w'] / 2, b['y'] + b['h'] / 2


def process_entry(e, data_dir, stats):
    if e.get('status') != 'analyzed' or not e.get('local_file'): return
    doc = fitz.open(os.path.join(data_dir, e['local_file']))
    # document-level: does it demand a hand-written signature?
    evid = []
    for i, p in enumerate(doc, 1):
        t = p.get_text().replace('\n', '')
        for m in STRICT.finditer(t):
            if re.search(r'蓋章|或蓋|用印', t[m.end():m.end() + 6]): continue      # "親自簽名或蓋章" allows a seal
            evid.append(dict(page=i, text=t[max(0, m.start() - 14):m.end() + 14]))
    strict_doc = bool(evid)
    e['signature_policy'] = dict(requires_handwritten=strict_doc, evidence=evid[:4])
    pages = {i: Page(doc[i - 1]) for i in {f['box']['page'] for f in e['fields']}}
    # pass 1: signatures
    for f in e['fields']:
        if f['type'] == 'checkbox': continue
        raw = f['label'] or ''
        pg = pages[f['box']['page']]; b = f['box']
        right = ''.join(l['text'] for l in pg.lines
                        if ov(l['bbox'][1], l['bbox'][3], b['y'], b['y'] + b['h']) > 3 and b['x'] + b['w'] - 8 <= l['bbox'][0] <= b['x'] + b['w'] + 120)
        is_sig = bool(SIGN_LABEL.search(raw)) or bool(SIGN_ROLE.match(strip(raw))) or bool(SIGN_RIGHT.search(right))
        if is_sig and f['type'] != 'signature':
            f['type'] = 'signature'
            if f.get('prefill_key'): f['candidate_key'] = f['prefill_key']
            f['key'] = 'signature'
        if f['type'] == 'signature':
            f['prefill'] = False; f.pop('prefill_key', None)
            f['blocked_reason'] = 'handwritten_signature' if strict_doc else 'signature_or_seal'
            f['signature_mode'] = 'handwritten_required' if (strict_doc or STRICT.search(raw + right)) else 'signature_or_seal'
    sig_boxes = [f['box'] for f in e['fields'] if f['type'] == 'signature']
    # pass 2: personal data
    cands = [f for f in e['fields'] if f['type'] != 'signature' and (f.get('prefill') or f.get('candidate_key')) and (f['key'] in KEYS or f.get('candidate_key') in KEYS)]
    for f in cands:
        ck = f.get('prefill_key') or f.get('candidate_key') or f['key']
        f['key'] = ck if f['key'] not in KEYS else f['key']
        f['_ck'] = ck; f['_subject'] = None
    names = [f for f in cands if f['key'] == 'name']
    for f in sorted(names, key=lambda f: (f['box']['page'], f['box']['y'], f['box']['x'])):
        pg = pages[f['box']['page']]
        ok, subj, ev, why = judge(f, pg, names, strict_doc, sig_boxes)
        f['_subject'] = subj; f['_res'] = (ok, subj, ev, why)
    for f in cands:
        pg = pages[f['box']['page']]
        res = f.get('_res') or judge(f, pg, names, strict_doc, sig_boxes)
        ok, subj, ev, why = res
        stats[('before', f['_ck'])] += 1
        if ok:
            f['prefill'] = True; f['prefill_key'] = f['_ck']; f.pop('candidate_key', None); f.pop('blocked_reason', None)
            stats[('after', f['_ck'])] += 1
        else:
            f['prefill'] = False; f.pop('prefill_key', None); f['candidate_key'] = f['_ck']; f['blocked_reason'] = why
            stats[('blocked', why)] += 1
        f['subject'] = subj
        if ev: f['subject_evidence'] = ev
        else: f.pop('subject_evidence', None)
        m = re.search(r'[：:]\s*(臺北市|台北市|[^\s]{1,3}[縣市])\s*$', f['label'] or '')
        if m and ok and f['_ck'] == 'address': f['preprinted_prefix'] = m.group(1)
    for f in e['fields']:
        for k in ('_ck', '_subject', '_res'): f.pop(k, None)


def main():
    data_dir = sys.argv[1]; dry = '--dry' in sys.argv
    p = os.path.join(data_dir, 'subsidies.json')
    d = json.load(open(p)); stats = collections.Counter()
    for r in d:
        ff = r['application'].get('form_fields') or {}
        for e in [ff] + ff.get('attachments', []):
            process_entry(e, data_dir, stats)
    b = {k[1]: v for k, v in stats.items() if k[0] == 'before'}
    a = {k[1]: v for k, v in stats.items() if k[0] == 'after'}
    print('candidates', sum(b.values()), '-> prefilled', sum(a.values()))
    for k in KEYS: print(f'  {k:12} {b.get(k, 0):4} -> {a.get(k, 0):4}')
    print('blocked reasons', {k[1]: v for k, v in stats.items() if k[0] == 'blocked'})
    if not dry:
        json.dump(d, open(p, 'w'), ensure_ascii=False, indent=2)
        print('written', p)


if __name__ == '__main__':
    main()
