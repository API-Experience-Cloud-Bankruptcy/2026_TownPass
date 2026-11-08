"""Back up one experimental mobile artifact to the existing private model repo."""
import argparse
import hashlib
import json
from pathlib import Path


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--model', type=Path, required=True)
    p.add_argument('--repo', required=True)
    p.add_argument('--prefix', required=True)
    p.add_argument('--token-file', type=Path, required=True)
    p.add_argument('--receipt', type=Path, required=True)
    a = p.parse_args()
    if a.model.suffix != '.litertlm' or not a.model.is_file():
        raise RuntimeError('Expected one existing LiteRT-LM artifact')
    from huggingface_hub import HfApi
    api = HfApi(token=a.token_file.read_text().strip())
    if not api.model_info(a.repo).private:
        raise RuntimeError('Experimental artifact must remain private')
    digest = hashlib.sha256()
    with a.model.open('rb') as f:
        for chunk in iter(lambda: f.read(8 * 1024 * 1024), b''):
            digest.update(chunk)
    path = a.prefix.rstrip('/') + '/' + a.model.name
    commit = api.upload_file(path_or_fileobj=a.model, path_in_repo=path, repo_id=a.repo,
                             commit_message='Archive experimental mobile export; pending device acceptance')
    info = api.model_info(a.repo, revision=commit.oid, files_metadata=True)
    match = next(x for x in info.siblings if x.rfilename == path)
    lfs = match.lfs
    remote = lfs.get('sha256') if isinstance(lfs, dict) else getattr(lfs, 'sha256', None)
    if remote != digest.hexdigest():
        raise RuntimeError('Remote artifact hash mismatch')
    receipt = {'repo': a.repo, 'revision': info.sha, 'path': path, 'private': info.private,
               'sha256': digest.hexdigest(), 'remote_sha256_verified': True,
               'bytes': a.model.stat().st_size, 'physical_device_accepted': False}
    a.receipt.write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt))


if __name__ == '__main__':
    main()
