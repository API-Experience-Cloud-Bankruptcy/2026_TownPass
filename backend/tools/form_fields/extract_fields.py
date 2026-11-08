"""Extract fillable-field layout from flat (non-AcroForm) application-form PDFs.
usage: extract_fields.py <pdf_dir> <out_dir>
"""
import fitz, glob, os, sys, json, re, hashlib, collections

fitz.TOOLS.mupdf_display_errors(False)

OTHER_PERSON = r'配偶|父|母|子女|兒童|兒少|幼兒|孩|代理|監護|家屬|親屬|同住|成員|法定|負責人|代表人|聯絡人|推薦|導師|證明人|介紹|保證|醫師|受託|經辦|承辦|審核|主管|填表人'
ORG = r'學校|公司|機構|單位|事業|商號|廠|店|服務處|工作|醫院|銀行|診所|院所|辦公|戶政|機關|團體|協會|園|所在地|課程|場所|營業|登記'
SIGN = r'簽章|簽名|蓋章|簽署|用印|印章|印信|關防'


def norm(t):
    t = re.sub(r'[（(][^）)]*[）)]', '', t)
    t = re.sub(r'[\s　:：＿_＊*※■□☐☑▢\.．、，,;；]+', '', t)
    return t


def classify(label, ftype):
    n = norm(label)
    if re.search(SIGN, n):
        return 'signature', None, None
    if re.search(r'出生|生日', n):
        return 'birth_date', None, None
    if re.search(r'e-?mail|電子郵件|電郵|信箱', n, re.I):
        return 'email', None, None
    if re.search(r'傳真|fax', n, re.I):
        return 'fax', None, None
    if re.search(r'郵遞區號|郵區', n):
        return 'postal_code', None, None
    other_person = bool(re.search(OTHER_PERSON, n))
    org = bool(re.search(ORG, n))
    if re.search(r'身[分份]證|統一證號|居留證|證件號|證號', n) and not re.search(r'證明|影本|護照', n):
        if not other_person and not org:
            return 'national_id', 'national_id', None
        return 'national_id', None, None
    if re.search(r'性別', n):
        return 'gender', (None if other_person else 'gender'), None
    if re.fullmatch(r'(住宅|住家|市話|家用|家裡)', n):
        return 'phone', 'phone', 'home'
    if re.search(r'手機|行動電話|行動', n):
        return 'mobile', (None if (other_person or org) else 'mobile'), None
    if re.search(r'電話|tel|聯絡方式|連絡方式', n, re.I):
        if other_person or org:
            return 'phone', None, None
        v = 'home' if re.search(r'住宅|住家|市話|家', n) else None
        return 'phone', 'phone', v
    if re.search(r'地址|住址|住所|居所|戶籍地|戶籍所在|通訊處|居住地|現住|通訊地|聯絡地|寄送地|承租地|門牌', n):
        if other_person or org:
            return 'address', None, None
        v = 'registered' if re.search(r'戶籍', n) else \
            'mailing' if re.search(r'通訊|郵寄|聯絡|連絡|收件|寄送', n) else \
            'residence' if re.search(r'現住|居住|居所|住所|承租|住宅|門牌', n) else None
        return 'address', 'address', v
    if n and re.fullmatch(r'(本人|申請人|申請者|立書人|聲明人|聲明者|承租人|請領人|申請補助人|領款人|立同意書人|立切結書人)?(之)?(姓名|名字)?', n):
        return 'name', 'name', None
    if re.search(r'姓名|名字|^申請人$|^本人$', n) and not other_person and not org and not re.search(r'名稱', n):
        return 'name', 'name', None
    if re.search(r'姓名|名字', n):
        return 'name', None, None
    for key, rx in [
        ('bank_account', r'帳號|帳戶|存摺|郵局|銀行|金融'),
        ('account_name', r'戶名'),
        ('relationship', r'關係|稱謂'),
        ('school', r'學校|校名|就讀'),
        ('grade', r'年級|班級|學號'),
        ('department', r'科系|系所|學院'),
        ('occupation', r'職業|職稱|工作'),
        ('income', r'所得|收入|薪資'),
        ('date', r'日期|年月日|填表|申請日|[年月日]$'),
        ('amount', r'費用|租金|金額'),
        ('reason', r'原因|事由|理由|說明|備註'),
    ]:
        if re.search(rx, n):
            return key, None, None
    if ftype == 'checkbox':
        return 'choice', None, None
    return 'other', None, None


def segments(page):
    M = page.rotation_matrix
    H, V = [], []
    for d in page.get_drawings():
        for it in d['items']:
            if it[0] == 'l':
                p1, p2 = it[1] * M, it[2] * M
                if abs(p1.y - p2.y) < 1.2 and abs(p1.x - p2.x) > 4:
                    H.append((p1.y, min(p1.x, p2.x), max(p1.x, p2.x)))
                elif abs(p1.x - p2.x) < 1.2 and abs(p1.y - p2.y) > 4:
                    V.append((p1.x, min(p1.y, p2.y), max(p1.y, p2.y)))
            elif it[0] == 're':
                r = fitz.Rect(it[1]) * M
                r.normalize()
                if r.height < 3 and r.width > 6:
                    H.append(((r.y0 + r.y1) / 2, r.x0, r.x1))
                elif r.width < 3 and r.height > 6:
                    V.append(((r.x0 + r.x1) / 2, r.y0, r.y1))
                elif r.width > 6 and r.height > 6:
                    H += [(r.y0, r.x0, r.x1), (r.y1, r.x0, r.x1)]
                    V += [(r.x0, r.y0, r.y1), (r.x1, r.y0, r.y1)]
    return H, V


def cell_at(H, V, x, y, W, Hh):
    L = [p for p, a, b in V if p <= x + .5 and a - 2 <= y <= b + 2]
    R = [p for p, a, b in V if p >= x - .5 and a - 2 <= y <= b + 2]
    T = [p for p, a, b in H if p <= y + .5 and a - 2 <= x <= b + 2]
    B = [p for p, a, b in H if p >= y - .5 and a - 2 <= x <= b + 2]
    if not (L and R and T and B):
        return None
    c = (max(L), max(T), min(R), min(B))
    if c[2] - c[0] < 15 or c[3] - c[1] < 8 or ((c[2] - c[0]) > W * .98 and (c[3] - c[1]) > Hh * .9):
        return None
    return c


def merge_stacked(out):
    """Join short text fragments stacked in one column into a single label (e.g. 姓 / 名 -> 姓名)."""
    def ok(o, n):
        t = o['text']
        return (not o['runs'] and len(norm(t)) <= n and not re.search(r'[□☐▢：:]', t[-1:] if n == 4 else ''))
    changed = True
    while changed:
        changed = False
        for a in out:
            if a['runs'] or re.search(r'[□☐▢]', a['text']) or re.search(r'[：:]\s*$', a['text']) or len(norm(a['text'])) > 4:
                continue
            ba = a['bbox']
            for b in out:
                if b is a or b['runs'] or re.search(r'[□☐▢]', b['text']) or len(norm(b['text'])) > 6:
                    continue
                bb = b['bbox']
                gap = bb[1] - ba[3]
                if -1 <= gap <= 5 and abs((ba[0] + ba[2]) / 2 - (bb[0] + bb[2]) / 2) <= max(6, .35 * max(ba[2] - ba[0], bb[2] - bb[0])) \
                        and abs((ba[3] - ba[1]) - (bb[3] - bb[1])) < 4:
                    a['text'] = a['text'] + b['text']; a['raw'] = a['text']
                    a['bbox'] = (min(ba[0], bb[0]), ba[1], max(ba[2], bb[2]), bb[3])
                    out.remove(b); changed = True
                    break
            if changed:
                break
    return out


def page_lines(page):
    """text segments (line pieces separated by wide gaps) in display coordinates."""
    M = page.rotation_matrix
    out = []
    for b in page.get_text('rawdict')['blocks']:
        if b['type'] != 0:
            continue
        for ln in b['lines']:
            chars = []
            for s_ in ln['spans']:
                for c in s_['chars']:
                    r = fitz.Rect(c['bbox']) * M
                    r.normalize()
                    chars.append((c['c'], r))
            if not any(c[0].strip() for c in chars):
                continue
            # split on gaps
            segs, cur, prev = [], [], None
            for c in chars:
                if c[0].isspace():
                    cur.append(c); continue
                if prev is not None and (c[1].x0 - prev[1].x1 > 11 or abs(c[1].y0 - prev[1].y0) > 6):
                    segs.append(cur); cur = []
                cur.append(c); prev = c
            if cur:
                segs.append(cur)
            for sg in segs:
                while sg and sg[0][0].isspace(): sg = sg[1:]
                while sg and sg[-1][0].isspace(): sg = sg[:-1]
                text = ''.join(c[0] for c in sg)
                if not text.strip():
                    continue
                x0 = min(c[1].x0 for c in sg); y0 = min(c[1].y0 for c in sg)
                x1 = max(c[1].x1 for c in sg); y1 = max(c[1].y1 for c in sg)
                if (y1 - y0) > (x1 - x0) * 1.5 and len(text.strip()) > 1:
                    continue  # vertical text: not supported
                runs, cu = [], None
                for ch, r in sg:
                    if ch in '_＿':
                        if cu is None:
                            cu = [r.x0, r.y0, r.x1, r.y1, 1]
                        else:
                            cu[2] = r.x1; cu[4] += 1
                    elif cu is not None:
                        runs.append(cu); cu = None
                if cu is not None:
                    runs.append(cu)
                m = re.search(r'[_＿]{2,}', text)
                out.append(dict(bbox=(x0, y0, x1, y1), text=text.strip(), raw=text,
                                runs=[r for r in runs if r[4] >= 2], first_us=m.start() if m else None))
    out = merge_stacked(out)
    # digit-box segments (□□□□□□...) attach to the label on their left
    for o in out:
        o['digitbox'] = bool(re.fullmatch(r'[□☐]{6,}', o['text']))
    return out


def overlap_y(a, b):
    return min(a[3], b[3]) - max(a[1], b[1]) > 3


def rnd(v):
    return round(float(v), 1)


def box(pn, x0, y0, x1, y1):
    return dict(page=pn, x=rnd(x0), y=rnd(y0), w=rnd(max(x1 - x0, 0)), h=rnd(max(y1 - y0, 0)))


def has_text_in(lines, c, margin=1.5):
    for ln in lines:
        b = ln['bbox']
        cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
        if c[0] - margin <= cx <= c[2] + margin and c[1] - margin <= cy <= c[3] + margin \
                and re.search(r'[^\s_＿]', ln['text']) and not re.fullmatch(r'[\s年月日民國中華\d/_＿:：()（）]*', ln['text']):
            return True
    return False


LABEL_COLON = re.compile(r'[：:]\s*$')
CHECK = re.compile(r'[□☐▢]')


def analyse_page(page, pno):
    W, Hh = page.rect.width, page.rect.height
    lines = page_lines(page)
    H, V = segments(page)
    fields = []

    def right_limit(ln, sx):
        xs = [o['bbox'][0] for o in lines if o is not ln and overlap_y(o['bbox'], ln['bbox']) and o['bbox'][0] > sx + 3]
        return min(xs) if xs else min(W - 30, sx + 220)

    def input_box(ln, lx1, force=False):
        b = ln['bbox']
        lh = b[3] - b[1]
        cx, cy = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2

        def rowlimit(c):
            if (c[3] - c[1]) > 2.2 * lh + 6:
                return (c[0], b[1] - 2, c[2], b[3] + 2)
            return c
        c = cell_at(H, V, min(cx, b[0] + 3), cy, W, Hh)
        if c:
            row_others = [o for o in lines if o is not ln and overlap_y(o['bbox'], b) and o['bbox'][0] > lx1 + 2
                          and o['bbox'][0] < c[2] and re.search(r'[^\s_＿]', o['text'])
                          and not re.fullmatch(r'[\s年月日\d/_＿:：]*', o['text'])]
            rest = c[2] - lx1
            # header-style cell: label centred in its cell -> the input cell is underneath
            if abs((b[0] + b[2]) / 2 - (c[0] + c[2]) / 2) < 0.12 * (c[2] - c[0]) and (c[3] - c[1]) < 3.2 * lh + 10:
                c3 = cell_at(H, V, (c[0] + c[2]) / 2, c[3] + 3, W, Hh)
                if c3 and not has_text_in(lines, c3):
                    return c3, 'cell-below'
            if rest >= 45 and not row_others and not has_text_in([o for o in lines if o is not ln and o['bbox'][0] > lx1 - 1 and not overlap_y(o['bbox'], b)], c):
                r = rowlimit((lx1 + 2, c[1], c[2], c[3]))
                return r, 'cell-right'
            if row_others and force and rest >= 45:
                return rowlimit((lx1 + 2, c[1], c[2], c[3])), 'cell-right-template'
            if row_others:
                lim = min(o['bbox'][0] for o in row_others)
                if lim - lx1 >= 30:
                    return (lx1 + 2, b[1] - 2, lim - 2, b[3] + 2), 'inline-in-cell'
            if LABEL_COLON.search(ln['text']) and has_text_in([o for o in lines if o is not ln], c):
                if c[2] - lx1 >= 30:
                    return (lx1 + 2, b[1] - 2, c[2] - 2, b[3] + 2), 'inline-in-cell'
                return None, 'no-space'
            c2 = cell_at(H, V, c[2] + 3, cy, W, Hh)
            if c2 and not has_text_in(lines, c2):
                return c2, 'cell-neighbour-right'
            c3 = cell_at(H, V, (c[0] + c[2]) / 2, c[3] + 3, W, Hh)
            if c3 and not has_text_in(lines, c3):
                return c3, 'cell-below'
            if rest >= 45 and not row_others:
                return rowlimit((lx1 + 2, c[1], c[2], c[3])), 'cell-right'
            return None, 'no-space'
        lim = right_limit(ln, lx1)
        if lim - lx1 < 30:
            return None, 'no-space'
        return (lx1 + 2, b[1] - 2, lim - 2, b[3] + 2), 'inline'

    for ln in lines:
        t, b = ln['text'], ln['bbox']
        nt = norm(t)
        if not nt or ln.get('digitbox'):
            continue
        db = [o for o in lines if o.get('digitbox') and overlap_y(o['bbox'], b) and 0 <= o['bbox'][0] - b[2] < 40]
        if db and not CHECK.search(t):
            o = db[0]
            fields.append(dict(_ln=ln, _y=b[1], type='text', label=re.sub(r'[：:\s]+$', '', t).strip(),
                               box=box(pno, *o['bbox']), _src='digit-boxes'))
            continue
        if CHECK.search(t):
            parts = [p.strip() for p in re.split(r'[□☐▢]', t)]
            prefix, opts = parts[0], [p for p in parts[1:] if p]
            opts = [re.sub(r'[_＿\s]+$', '', o).strip() or '其他' for o in opts]
            fields.append(dict(_ln=ln, type='checkbox', label=LABEL_COLON.sub('', prefix).strip(), options=opts,
                               box=box(pno, *b)))
            continue
        if re.search(r'影本|黏貼|浮貼|附件', t) and not ln['runs']:
            continue
        if ln['runs']:
            runs = ln['runs']
            i0 = ln['first_us'] or 0
            prefix = re.sub(r'[：:\s]+$', '', ln['raw'][:i0]).strip()
            label = prefix
            if len(norm(prefix)) < 1:
                label = ''
            if len(label) > 14:
                label = re.split(r'[，,。；;]', label)[-1].strip() or label
                label = label[-14:]
            x0 = min(r[0] for r in runs); x1 = max(r[2] for r in runs)
            after = ln['raw'][ln['raw'].rfind('_')+1:].strip()
            if re.match(r'(不同意|同意|已|曾|未|是否|所有|之)', after):
                label = '勾選／填寫說明'
            fields.append(dict(_ln=ln, type='text', label=label, box=box(pno, x0, b[1] - 1, x1, b[3] + 1), _src='underscore'))
            continue
        short = len(nt) <= 14
        colon = bool(LABEL_COLON.search(t)) and len(nt) <= 24
        if re.search(r'[，。；]', t) or re.match(r'^([一二三四五六七八九十]+|\d+)\s*[、.]|^[（(][一二三四五六七八九十\d]+[）)]', t):
            continue
        if not (short or colon):
            continue
        key, pk, var = classify(t, 'text')
        if not (colon or key != 'other'):
            continue
        if nt in ('年', '月', '日'):
            left = [o['bbox'][2] for o in lines if o is not ln and overlap_y(o['bbox'], b) and o['bbox'][2] <= b[0] + 1]
            x0 = max(left) if left else b[0] - 40
            if b[0] - x0 >= 10:
                fields.append(dict(_ln=ln, _y=b[1], type='date', label=nt, box=box(pno, x0 + 1, b[1] - 1, b[2], b[3] + 1), _src='date-part'))
            continue
        ib, how = input_box(ln, b[2], force=(pk is not None))
        if ib is None:
            continue
        fields.append(dict(_ln=ln, _y=b[1], type='text', label=re.sub(r'[：:\s]+$', '', t).strip(), box=box(pno, *ib), _src=how))

    out = []
    for f in fields:
        lab = f['label']
        if f['type'] == 'checkbox' and not lab:
            ln = f['_ln']
            cands = [o for o in lines if o is not ln and not CHECK.search(o['text']) and
                     ((overlap_y(o['bbox'], ln['bbox']) and o['bbox'][2] <= ln['bbox'][0] + 2) or
                      (0 < ln['bbox'][1] - o['bbox'][3] < 22 and abs(o['bbox'][0] - ln['bbox'][0]) < 40))]
            if cands:
                o = min(cands, key=lambda o: abs(o['bbox'][1] - ln['bbox'][1]) + abs(o['bbox'][0] - ln['bbox'][0]) * .2)
                lab = LABEL_COLON.sub('', o['text'])[:24]
        if f['type'] == 'checkbox' and len(f.get('options', [])) == 1:
            lab = f['options'][0]; f['options'] = []
            if not f['options']: f.pop('options')
        key, pk, var = classify(lab, f['type'])
        if f['type'] == 'checkbox' and not f.get('options'):
            key, pk, var = 'choice', None, None
        if f['type'] != 'checkbox':
            if key == 'signature':
                f['type'] = 'signature'
            elif key in ('date', 'birth_date') or re.search(r'年.*月.*日|日期', lab):
                f['type'] = 'date'
        f['label'] = lab
        f['key'] = key
        f['prefill'] = pk is not None
        if pk:
            f['prefill_key'] = pk
        if var:
            f['variant'] = var
        out.append(f)
    uniq, seen = [], set()
    for f in out:
        sig = (f['label'], round(f['box']['x'] / 4), round(f['box']['y'] / 4))
        if sig not in seen:
            seen.add(sig); uniq.append(f)
    # a phone header cell with 手機/住家 sub-labels beneath it has no input of its own
    subs = [g for g in uniq if g['key'] in ('phone', 'mobile') and g['label'] not in ('電話', '聯絡電話', '電 話')]
    def is_header(f):
        if f['key'] != 'phone' or f['label'].replace(' ', '') not in ('電話', '聯絡電話'):
            return False
        hb = f['box']
        return any(g is not f and g['box']['page'] == hb['page'] and 0 <= g['box']['y'] - hb['y'] < 50
                   and g['box']['x'] < hb['x'] + hb['w'] + 5 and g['box']['x'] + g['box']['w'] > hb['x'] - 80 and g['box']['y'] > hb['y'] - 1
                   and g['key'] in ('phone', 'mobile') for g in subs)
    uniq = [f for f in uniq if not is_header(f)]
    # merge 年/月/日 pieces on the same row into one date field
    parts = [f for f in uniq if f['label'] in ('年', '月', '日') and f.get('_src') == 'date-part']
    rows = collections.defaultdict(list)
    for f in parts:
        rows[(f['box']['page'], round(f['box']['y'] / 8))].append(f)
    drop = set()
    for k, g in rows.items():
        if len(g) >= 2:
            g.sort(key=lambda f: f['box']['x'])
            x0 = g[0]['box']['x']; x1 = max(f['box']['x'] + f['box']['w'] for f in g)
            g[0]['box'] = dict(g[0]['box'], x=x0, w=rnd(x1 - x0)); g[0]['label'] = '日期（' + ''.join(f['label'] for f in g) + '）'
            g[0]['key'] = 'date'
            for f in g[1:]: drop.add(id(f))
    uniq = [f for f in uniq if id(f) not in drop]
    # fields that landed in one shared box: stack them in label order
    grp = collections.defaultdict(list)
    for f in uniq:
        if f['type'] != 'checkbox':
            b = f['box']; grp[(b['page'], b['x'], b['y'], b['w'], b['h'])].append(f)
    for k, g in grp.items():
        if len(g) > 1:
            g.sort(key=lambda f: f.get('_y', 0))
            b0 = g[0]['box']; hh = b0['h'] / len(g)
            for i, f in enumerate(g):
                f['box'] = dict(b0, y=rnd(b0['y'] + i * hh), h=rnd(hh))
    return uniq


def analyse_pdf(path):
    doc = fitz.open(path)
    res, pages = [], []
    for pno, page in enumerate(doc, 1):
        pages.append(dict(page=pno, width=rnd(page.rect.width), height=rnd(page.rect.height)))
        res += analyse_page(page, pno)
    return pages, res


if __name__ == '__main__':
    src, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    groups = collections.OrderedDict()
    for p in sorted(glob.glob(os.path.join(src, '*.pdf'))):
        h = hashlib.sha256(open(p, 'rb').read()).hexdigest()
        groups.setdefault(h, []).append(os.path.basename(p)[:8])
    summary = {}
    for h, ids in groups.items():
        pages, fields = analyse_pdf(os.path.join(src, ids[0] + '.pdf'))
        ident = {'name','national_id','phone','mobile','address','signature','birth_date','gender'}
        isform = sum(1 for f in fields if f['key'] in ident) >= 2
        for f in fields:
            f.pop('_ln', None); f.pop('_y', None); f.pop('_src', None)
        if not isform: fields = []
        json.dump(dict(sha256=h, record_ids=ids, pages=pages, kind='form' if isform else 'document_or_scan', fields=fields),
                  open(os.path.join(out, ids[0] + '.fields.json'), 'w'), ensure_ascii=False, indent=1)
        summary[ids[0]] = dict(ids=ids, n=len(fields), prefill=sum(1 for f in fields if f['prefill']))
    json.dump(summary, open(os.path.join(out, '_groups.json'), 'w'), ensure_ascii=False, indent=1)
    for k, v in summary.items():
        print(k, len(v['ids']), 'fields', v['n'], 'prefill', v['prefill'])
