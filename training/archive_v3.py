"""Archive V3 reports, synthetic input and code to the existing private repo."""
import argparse, hashlib, json, shutil
from pathlib import Path

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--root',type=Path,default=Path('.'))
    p.add_argument('--token-file',type=Path,required=True)
    p.add_argument('--prefix',default='experiments/2026-11-07/v3-records')
    a=p.parse_args()
    from huggingface_hub import HfApi, hf_hub_download
    token=a.token_file.read_text().strip()
    api=HfApi(token=token)
    repo='Felix-0901/townpass-gemma4-e2b'
    if not api.model_info(repo).private: raise RuntimeError('Private repo required')
    stage=a.root/'archive-records'
    stage.mkdir(exist_ok=False)
    files=list(a.root.glob('*.py'))+list(a.root.glob('*.txt'))
    for folder in ('runs','data-final','data-refined','provenance','final-diagnostic'):
        for ext in ('*.json','*.jsonl','*.md'):
            files+=list((a.root/folder).rglob(ext))
    files+=list(a.root.glob('*.log'))
    manifest={}
    for source in files:
        if 'adapter' in source.relative_to(a.root).parts: continue
        rel=source.relative_to(a.root)
        if source.is_symlink(): raise RuntimeError('Symlink rejected')
        dest=stage/rel; dest.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(source,dest)
        manifest[str(rel)]=hashlib.sha256(dest.read_bytes()).hexdigest()
    (stage/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    commit=api.upload_folder(repo_id=repo,folder_path=stage,path_in_repo=a.prefix,
        allow_patterns=list(manifest)+['manifest.json'],commit_message='Archive rejected or unvalidated V3 research records')
    # Verify every small file from the immutable remote commit, not merely upload status.
    for name,digest in manifest.items():
        remote=hf_hub_download(repo,a.prefix+'/'+name,revision=commit.oid,token=token)
        if hashlib.sha256(Path(remote).read_bytes()).hexdigest()!=digest:
            raise RuntimeError('Remote hash mismatch: '+name)
    receipt={'repo':repo,'revision':commit.oid,'prefix':a.prefix,'private':True,
             'verified_files':len(manifest),'all_sha256_verified':True,'production_accepted':False}
    (a.root/'archive-receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(receipt))
if __name__=='__main__': main()
