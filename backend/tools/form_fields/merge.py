"""merge extracted form fields into subsidies.json
usage: merge.py <subsidies.json> <downloads_dir> <fields_dir> <forms_out_dir>"""
import json, sys, os, shutil, glob
data_p, dl, fl, forms_out = sys.argv[1:5]
d = json.load(open(data_p))
rep = {x['id']: x for x in json.load(open(os.path.join(dl, '_download_report.json')))}
fields_by_id, lead = {}, {}
for p in glob.glob(os.path.join(fl, 'WEL-*.fields.json')):
    j = json.load(open(p))
    for rid in j['record_ids']:
        fields_by_id[rid] = j; lead[rid] = j['record_ids'][0]
os.makedirs(forms_out, exist_ok=True)
copied = set()
stats = {}
for r in d:
    url = r['application']['urls'].get('form')
    if not url:
        r['application'].pop('form_fields', None); continue
    rp = rep.get(r['id'], {})
    ff = {'source_url': url, 'content_type': rp.get('kind'), 'http_status': rp.get('status')}
    k = rp.get('kind')
    if k == 'pdf':
        j = fields_by_id[r['id']]
        lid = lead[r['id']]
        ff['local_file'] = f'forms/{lid}.pdf'
        if lid not in copied:
            shutil.copyfile(os.path.join(dl, f'{lid}.pdf'), os.path.join(forms_out, f'{lid}.pdf')); copied.add(lid)
        ff['pages'] = j['pages']
        ff['coordinate_system'] = 'PDF points, origin top-left of the displayed page; box = {page,x,y,w,h}'
        if j['kind'] == 'form' and j['fields']:
            ff['status'] = 'analyzed'
        else:
            ff['status'] = j.get('status_override') or ('scanned_image_pdf' if j['kind'] != 'form' and r['id'] in ('WEL-0074', 'WEL-0080') else 'no_fillable_form')
        ff['fields'] = j['fields']
    elif k in ('zip',):
        ff['status'] = 'odf_not_analyzed'; ff['fields'] = []
    elif k == 'html':
        ff['status'] = 'web_page_not_pdf' if rp.get('status') == 200 else 'download_failed'; ff['fields'] = []
    else:
        ff['status'] = 'download_failed'; ff['fields'] = []
    stats[ff['status']] = stats.get(ff['status'], 0) + 1
    r['application']['form_fields'] = ff
json.dump(d, open(data_p, 'w'), ensure_ascii=False, indent=2)
print(stats)
