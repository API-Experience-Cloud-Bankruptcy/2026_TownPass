import json, os, re, shutil, glob, collections
REPO='/Users/phillychi3/Documents/code/2026_TownPass/backend'
d=json.load(open(f'{REPO}/data/subsidies.json'))
M=json.load(open('/tmp/tp_work/manifest.json')); A=json.load(open('/tmp/tp_work/analysis2.json'))
# ---- audit verdicts from agents
AUD={}
def magic(p):
    try: b=open(p,'rb').read(8)
    except Exception: return 'missing'
    return 'pdf' if b[:5]==b'%PDF-' else 'zip' if b[:2]==b'PK' else 'ole' if b[:4]==b'\xd0\xcf\x11\xe0' else 'other'
for n in ['result_1','result_2','result_3','result_4','result_html','result_fail']:
    for x in json.load(open(f'/tmp/tp_audit/{n}.json')):
        v=x.get('verdict') or {'wrong_url_fixed':'form_found','works_with_headers':'form_found'}.get(x.get('diagnosis'),x.get('diagnosis'))
        office=[f.get('url') for f in (x.get('forms') or []) if f.get('kind') not in ('pdf',None,'html','other') and f.get('is_application_form') is not False and f.get('url')]
        AUD[x['id']]=dict(verdict=v,reason=(lambda t: t if isinstance(t,str) else json.dumps(t,ensure_ascii=False))(x.get('reason') or x.get('evidence') or '')[:300],office=office,page=x.get('page_url'),new_url=x.get('new_url'))
# ---- group manifest entries per record, unique by sha
per=collections.defaultdict(list)
for m in M:
    if any(e['file']==m['file'] for e in per[m['id']]): continue
    per[m['id']].append(m)
BAD=r'委託|切結|領據|同意|核銷|請款|撤回|變更|異動|申復|附表|授權|聲明|匯款|收據|代查'
def score(m):
    a=A[m['file']]; lab=m['label'] or ''
    s=(100 if m['isform'] is True else 0)+(50 if re.search(r'申請(書|表|單)',lab) and not re.search(BAD,lab) else 0)
    s+=sum(f['prefill'] for f in a['fields'])+0.1*len(a['fields'])+(30 if m['origin']=='recorded' else 0)
    return s
COORD='PDF points, origin top-left of the displayed page; box = {page,x,y,w,h}'
forms_out=f'{REPO}/data/forms'
for f in glob.glob(forms_out+'/*.pdf'): os.remove(f)
os.makedirs(forms_out,exist_ok=True)
def entry(m):
    a=A[m['file']]
    st={'form':'analyzed','scanned':'scanned_image_pdf','document':'no_fillable_form','error':'analysis_error','garbled':'text_unreadable'}[a['kind']]
    e=dict(label=m['label'],source_url=m['url'],found_on=m['found_on'],origin=m['origin'],content_type='pdf',status=st)
    if m['isform']!='True' and m['isform'] is not True: e['is_application_form']=m['isform']
    if a['kind'] in ('form','scanned','garbled'):
        shutil.copyfile('/tmp/tp_work/pdfs/'+m['file'],f"{forms_out}/{m['file']}")
        e['local_file']=f"forms/{m['file']}"; e['pages']=a['pages']
    if a['kind']=='form': e['form_pages']=a['form_pages']
    e['fields']=a['fields'] if a['kind']=='form' else []
    return e
stats=collections.Counter(); missing=[]
for r in d:
    app=r['application']; app.pop('form_fields',None)
    rid=r['id']; url=app['urls'].get('form'); ents=per.get(rid,[])
    ff=None
    if ents:
        ents=sorted(ents,key=score,reverse=True)
        es=[entry(m) for m in ents]
        good=[e for e in es if e['status']=='analyzed']
        pick=good[0] if good else es[0]
        rest=[e for e in es if e is not pick and e['status'] in ('analyzed','scanned_image_pdf','text_unreadable')]
        ff=dict(pick); ff['coordinate_system']=COORD
        if rest: ff['attachments']=[{k:v for k,v in e.items() if k!='content_type'} for e in rest]
    elif rid in AUD or url:
        a=AUD.get(rid,{})
        v=a.get('verdict'); 
        st={'form_found':'office_file_only','online_system':'online_system','no_form_exists':'no_form_exists','no_form_on_page':'no_form_exists','fetch_failed':'download_failed'}.get(v,'download_failed')
        su=(a.get('office') or [None])[0] or a.get('new_url') or url
        ff=dict(source_url=su,status=st,fields=[])
        if a.get('reason'): ff['reason']=a['reason']
        if st=='office_file_only': ff['office_files']=a['office'][:6]
    if ff is None:
        if url: missing.append(rid)
        continue
    if 'source_url' not in ff or ff['source_url'] is None: ff.pop('source_url',None)
    app['form_fields']=ff
    stats[ff['status']]+=1
json.dump(d,open(f'{REPO}/data/subsidies.json','w'),ensure_ascii=False,indent=2)
print(dict(stats)); print('urls.form but no form_fields:',missing)
print('records with form_fields',sum('form_fields' in r['application'] for r in d),'pdf files',len(os.listdir(forms_out)))
