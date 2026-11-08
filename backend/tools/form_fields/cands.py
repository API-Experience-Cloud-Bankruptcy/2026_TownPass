import json, os, collections, sys
def magic(p):
    try: b=open(p,'rb').read(8)
    except Exception: return 'missing'
    return 'pdf' if b[:5]==b'%PDF-' else 'zip' if b[:2]==b'PK' else 'ole' if b[:4]==b'\xd0\xcf\x11\xe0' else 'other'
C=collections.defaultdict(list)
for n in ['result_1','result_2','result_3','result_4','result_html','result_fail']:
    for x in json.load(open(f'/tmp/tp_audit/{n}.json')):
        fl=x.get('forms') or ([{'local_path':x.get('local_path'),'url':x.get('new_url'),'is_application_form':x.get('is_application_form'),'label':'','note':x.get('evidence')}] if x.get('local_path') else [])
        for f in fl:
            lp=f.get('local_path')
            if lp and magic(lp)=='pdf':
                C[x['id']].append(dict(url=f.get('url'),found_on=f.get('found_on') or x.get('page_url'),label=f.get('label'),isform=f.get('is_application_form'),path=lp,note=(f.get('note') or '')[:120]))
json.dump(C,open('/tmp/tp_scripts/cands.json','w'),ensure_ascii=False,indent=1)
print(len(C),'records;',sum(len(v) for v in C.values()),'pdf entries; unique paths',len({c['path'] for v in C.values() for c in v}))
print(collections.Counter(str(c['isform']) for v in C.values() for c in v))
