#!/usr/bin/env python3
"""Install a built TownPass web/API release as a per-user macOS LaunchAgent."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import socket
import subprocess
import sys
import time
import urllib.request
import uuid


def file_digest(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def select_runtime(binary, base, old_config):
    """Web-only releases must not change the firewall-approved executable path."""
    digest = file_digest(binary)
    candidates = []
    firewall = subprocess.run(
        ['/usr/libexec/ApplicationFirewall/socketfilterfw', '--listapps'],
        capture_output=True, text=True,
    )
    lines = firewall.stdout.splitlines()
    for index, line in enumerate(lines[:-1]):
        if ' : ' not in line or 'Allow incoming connections' not in lines[index + 1]:
            continue
        candidate = Path(line.split(' : ', 1)[1].strip())
        # Only reuse this service's own immutable executable, never unrelated apps.
        if candidate.name == 'townpass-backend' and candidate.is_relative_to(base):
            candidates.append(candidate)
    arguments = old_config.get('ProgramArguments', [])
    if arguments:
        candidate = Path(arguments[0])
        if candidate.name == 'townpass-backend' and candidate.is_relative_to(base):
            candidates.append(candidate)
    for candidate in candidates:
        if candidate.is_file() and os.access(candidate, os.X_OK) and file_digest(candidate) == digest:
            return candidate
    # A genuinely new backend gets a content-addressed path, shared by web releases.
    runtime = base / 'runtimes' / digest / 'townpass-backend'
    runtime.parent.mkdir(parents=True, exist_ok=True)
    if runtime.exists():
        if file_digest(runtime) != digest or not os.access(runtime, os.X_OK):
            raise RuntimeError('Existing runtime is invalid; no executable was overwritten')
    else:
        shutil.copy2(binary, runtime)
    return runtime


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', type=Path, required=True, help='Built release townpass-backend binary')
    parser.add_argument('--web-root', type=Path, default=Path('subsidy-web/dist'))
    parser.add_argument('--port', type=int, default=5173)
    args = parser.parse_args()
    if sys.platform != 'darwin':
        parser.error('macOS only')
    binary, web = args.binary.resolve(), args.web_root.resolve()
    if not binary.is_file() or not os.access(binary, os.X_OK) or not (web / 'index.html').is_file():
        parser.error('Build the executable and web dist before installing')
    if not 1024 <= args.port <= 65535:
        parser.error('Use an unprivileged port between 1024 and 65535')

    label = 'org.townpass.local'
    domain = f'gui/{os.getuid()}'
    target = f'{domain}/{label}'
    plist = Path.home() / 'Library/LaunchAgents' / f'{label}.plist'
    old = plist.read_bytes() if plist.exists() else None
    old_config = plistlib.loads(old) if old else {}
    active = subprocess.run(['launchctl', 'print', target], capture_output=True).returncode == 0
    old_port = plistlib.loads(old).get('EnvironmentVariables', {}).get('PORT') if old else None
    if not active or old_port != str(args.port):
        with socket.socket() as check:
            try:
                check.bind(('0.0.0.0', args.port))
            except OSError:
                parser.error(f'Port {args.port} is occupied; no existing process was stopped')

    base = Path.home() / 'Library/Application Support/TownPassLocal'
    runtime = select_runtime(binary, base, old_config)
    release = base / 'releases' / uuid.uuid4().hex
    release.mkdir(parents=True)
    shutil.copytree(web, release / 'web')
    logs = Path.home() / 'Library/Logs/TownPassLocal'
    logs.mkdir(parents=True, exist_ok=True)
    config = {
        'Label': label,
        'ProgramArguments': [str(runtime)],
        'WorkingDirectory': str(release),
        'EnvironmentVariables': {'HOST': '0.0.0.0', 'PORT': str(args.port), 'WEB_ROOT': str(release / 'web')},
        'RunAtLoad': True, 'KeepAlive': True, 'ThrottleInterval': 10,
        'ProcessType': 'Background',
        'StandardOutPath': str(logs / 'service.log'),
        'StandardErrorPath': str(logs / 'error.log'),
    }
    plist.parent.mkdir(parents=True, exist_ok=True)
    if active:
        subprocess.run(['launchctl', 'bootout', target], check=True)
    try:
        plist.write_bytes(plistlib.dumps(config))
        subprocess.run(['launchctl', 'bootstrap', domain, str(plist)], check=True)
        for attempt in range(15):
            try:
                with urllib.request.urlopen(f'http://127.0.0.1:{args.port}/health', timeout=1) as response:
                    health = json.load(response)
                if health.get('status') == 'ok':
                    break
            except (OSError, ValueError):
                pass
            time.sleep(1)
        else:
            raise RuntimeError('Installed service did not become healthy; inspect its logs')
    except Exception:
        subprocess.run(['launchctl', 'bootout', target], capture_output=True)
        if old is not None:
            plist.write_bytes(old)
            if active:
                subprocess.run(['launchctl', 'bootstrap', domain, str(plist)], check=True)
        raise
    print(f'Installed {target} on LAN port {args.port}')
    print(f'Release: {release}')
    print(f'Runtime: {runtime}')
    print(f'Logs: {logs}')
    print('This service requires the Mac to be awake and this user logged in.')


if __name__ == '__main__':
    main()
