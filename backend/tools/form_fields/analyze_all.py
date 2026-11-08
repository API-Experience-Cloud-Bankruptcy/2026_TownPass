import sys, json, os, importlib.util, fitz, collections, traceback
fitz.TOOLS.mupdf_display_errors(False)
spec=importlib.util.spec_from_file_location('ef','/Users/phillychi3/Documents/code/2026_TownPass/backend/tools/form_fields/extract_fields.py')
ef=importlib.util.module_from_spec(spec); spec.loader.exec_module(ef)
M=json.load(open('/tmp/tp_work/manifest.json'))
out={}; os.makedirs('/tmp/tp_work/fields',exist_ok=True)
IDENT={'name','national_id','phone','mobile','address','signature','birth_date','gender'}
for sha_file in sorted({m['file'] for m in M}):
    p='/tmp/tp_work/pdfs/'+sha_file
    try:
        doc=fitz.open(p)
        txt=''.join(pg.get_text() for pg in doc); chars=len(txt); imgs=sum(len(pg.get_images()) for pg in doc)
        na=[c for c in txt if ord(c)>127 and not c.isspace()]
        cj=sum(1 for c in na if 0x4E00<=ord(c)<=0x9FFF or 0x3000<=ord(c)<=0x303F or 0xFF00<=ord(c)<=0xFFEF or 0x2000<=ord(c)<=0x206F or 0x25A0<=ord(c)<=0x25FF)
        garbled=len(na)>60 and cj/len(na)<0.8
        if doc.is_encrypted or doc.page_count>40:
            raise RuntimeError(f'encrypted={doc.is_encrypted} pages={doc.page_count}')
        pages,fields=ef.analyse_pdf(p)
        for f in fields:
            for k in ('_ln','_y','_src'): f.pop(k,None)
        isform=sum(1 for f in fields if f['key'] in IDENT)>=2
        if garbled: kind='garbled'
        elif chars<80*doc.page_count and imgs>0: kind='scanned'
        elif isform: kind='form'
        else: kind='document'
        out[sha_file]=dict(kind=kind,pages=pages,chars=chars,imgs=imgs,fields=fields if kind in ('form','document') else [])
    except Exception as e:
        out[sha_file]=dict(kind='error',err=str(e)[:100],pages=[],fields=[])
json.dump(out,open('/tmp/tp_work/analysis.json','w'),ensure_ascii=False)
print(collections.Counter(v['kind'] for v in out.values()))
print([ (k,v['err']) for k,v in out.items() if v['kind']=='error'][:5])
print('fields',sum(len(v['fields']) for v in out.values()),'prefill',sum(f['prefill'] for v in out.values() for f in v['fields']))
