import json, collections
A=json.load(open('/tmp/tp_work/analysis.json'))
ID={'name','national_id','phone','mobile','address','birth_date','gender','email'}
M=json.load(open('/tmp/tp_work/manifest.json'))
true_files={m['file'] for m in M if m['isform'] is True}
R={}
for k,v in A.items():
    if v['kind'] not in ('form','document'): R[k]=v; continue
    byp=collections.defaultdict(list)
    for f in v['fields']: byp[f['box']['page']].append(f)
    # fields from the original run were dropped for 'document'; re-derive: only 'form' kept fields
    need=1 if (k in true_files and len(v['pages'])<=4) else 2
    good=[p for p,fs in byp.items() if len({f['key'] for f in fs if f['key'] in ID|{'signature'}})>=need and (need==2 or any(f['prefill'] for f in fs))] if need==1 else [p for p,fs in byp.items() if len({f['key'] for f in fs if f['key'] in ID})>=2]
    fs=[f for f in v['fields'] if f['box']['page'] in good]
    kind='form' if good else 'document'
    R[k]=dict(v,kind=kind,fields=fs,form_pages=sorted(good))
json.dump(R,open('/tmp/tp_work/analysis2.json','w'),ensure_ascii=False)
print(collections.Counter(v['kind'] for v in R.values()))
d=collections.Counter()
for v in R.values():
    if v['kind']=='form': d[(len(v['pages'])>1, len(v['form_pages'])==len(v['pages']))]+=1
print('multi-page,all-pages-form:',dict(d))
print('fields',sum(len(v['fields']) for v in R.values()),'prefill',sum(f['prefill'] for v in R.values() for f in v['fields']))
