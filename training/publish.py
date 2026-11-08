"""Archive an explicitly named pilot into an existing PRIVATE HF model repo."""
import argparse
import hashlib
import json
import os
from pathlib import Path


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--run', type=Path, required=True)
    p.add_argument('--repo', required=True)
    p.add_argument('--prefix', required=True)
    p.add_argument('--token-file', type=Path, required=True)
    a = p.parse_args()
    from huggingface_hub import HfApi
    api = HfApi(token=a.token_file.read_text().strip())
    if not api.model_info(a.repo).private:
        raise RuntimeError('Refusing to publish this unvalidated pilot to a public repository')
    if not (a.run / 'adapter/adapter_model.safetensors').exists():
        raise RuntimeError('Missing trained adapter; do not claim successful training')
    # Only model artifacts and reports; never credentials, caches, or raw applicant data.
    selected = [x for x in a.run.glob('*.json') if x.name not in {'manifest.json', 'upload-receipt.json'}] + [x for x in (a.run / 'adapter').iterdir()
                   if x.suffix in {'.json', '.safetensors', '.jinja'} or x.name == 'README.md']
    manifest = {str(x.relative_to(a.run)): hashlib.sha256(x.read_bytes()).hexdigest() for x in selected}
    (a.run / 'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
    commit = api.upload_folder(repo_id=a.repo, folder_path=a.run, path_in_repo=a.prefix,
        allow_patterns=list(manifest) + ['manifest.json'],
        commit_message='Archive unvalidated TownPass pilot, not a production release')
    info = api.model_info(a.repo, revision=commit.oid, files_metadata=True)
    weight = a.prefix.rstrip('/') + '/adapter/adapter_model.safetensors'
    match = next((x for x in info.siblings if x.rfilename == weight), None)
    lfs = getattr(match, 'lfs', None)
    remote_hash = lfs.get('sha256') if isinstance(lfs, dict) else getattr(lfs, 'sha256', None)
    if remote_hash != manifest['adapter/adapter_model.safetensors']:
        raise RuntimeError('Uploaded adapter SHA-256 not verified')
    result = {'repo': a.repo, 'revision': info.sha, 'private': info.private,
              'adapter_sha256_verified': True, 'prefix': a.prefix, 'production_accepted': False}
    (a.run / 'upload-receipt.json').write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(result))


if __name__ == '__main__': main()
