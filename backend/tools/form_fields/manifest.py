"""Build manifest of every PDF to analyse: existing (recorded urls.form) + agent-discovered."""
import json, os, hashlib, shutil, glob, re, collections
REPO='/Users/phillychi3/Documents/code/2026_TownPass/backend'
W='/tmp/tp_work/pdfs'; os.makedirs(W,exist_ok=True)
d=json.load(open(f'{REPO}/data/subsidies.json'))
by={r['id']:r for r in d}
M=[]  # entries
def sha(p): return hashlib.sha256(open(p,'rb').read()).hexdigest()
# existing recorded forms
for r in d:
    ff=r['application'].get('form_fields')
    if ff and ff.get('content_type')=='pdf':
        p=f"{REPO}/data/{ff['local_file']}"
        M.append(dict(id=r['id'],origin='recorded',url=ff['source_url'],found_on=r['application']['urls'].get('program'),label='',isform=True,src=p))
C=json.load(open('/tmp/tp_scripts/cands.json'))
for rid,v in C.items():
    for c in v:
        if c['isform'] is False: continue
        M.append(dict(id=rid,origin='discovered',url=c['url'],found_on=c['found_on'],label=c['label'] or '',isform=c['isform'],src=c['path']))
for m in M:
    m['sha']=sha(m['src']); m['size']=os.path.getsize(m['src'])
    dst=f"{W}/{m['sha'][:12]}.pdf"
    if not os.path.exists(dst): shutil.copyfile(m['src'],dst)
    m['file']=m['sha'][:12]+'.pdf'; del m['src']
json.dump(M,open('/tmp/tp_work/manifest.json','w'),ensure_ascii=False,indent=1)
print(len(M),'entries',len({m['sha'] for m in M}),'unique pdfs',len({m['id'] for m in M}),'records')
print('total MB',sum(os.path.getsize(f) for f in glob.glob(W+'/*.pdf'))/1e6)
big=sorted(((os.path.getsize(f)/1e6,os.path.basename(f)) for f in glob.glob(W+'/*.pdf')),reverse=True)[:6]; print(big)
print(collections.Counter(m['origin'] for m in M))
