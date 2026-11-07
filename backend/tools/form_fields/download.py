import json, sys, os, requests, hashlib
from concurrent.futures import ThreadPoolExecutor
data, out = sys.argv[1], sys.argv[2]
d = json.load(open(data))
items = [(r['id'], r['application']['urls']['form']) for r in d if r['application']['urls'].get('form')]
H = {'User-Agent': 'Mozilla/5.0 (TownPass form analysis)'}
def kind(b):
    if b[:5] == b'%PDF-': return 'pdf'
    if b[:2] == b'PK': return 'zip'   # odt/ods/docx
    if b[:4] == b'\xd0\xcf\x11\xe0': return 'ole'
    if b[:200].lstrip().lower().startswith((b'<!doc', b'<html')) or b'<html' in b[:1000].lower(): return 'html'
    return 'unknown'
def get(it):
    i, u = it
    try:
        r = requests.get(u, headers=H, timeout=40, allow_redirects=True)
        k = kind(r.content)
        p = os.path.join(out, f'{i}.{k}')
        open(p, 'wb').write(r.content)
        return dict(id=i, url=u, status=r.status_code, kind=k, size=len(r.content), ctype=r.headers.get('content-type'), final=r.url if r.url != u else None)
    except Exception as e:
        return dict(id=i, url=u, status=None, kind='error', err=str(e)[:150])
with ThreadPoolExecutor(8) as ex: res = list(ex.map(get, items))
json.dump(res, open(os.path.join(out, '_download_report.json'), 'w'), ensure_ascii=False, indent=1)
import collections
print(collections.Counter(x['kind'] for x in res))
print(collections.Counter(x['status'] for x in res))
for x in res:
    if x['kind'] != 'pdf': print(x['id'], x['kind'], x['status'], x.get('err',''))
