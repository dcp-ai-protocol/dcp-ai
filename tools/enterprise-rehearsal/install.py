#!/usr/bin/env python3
"""Install and verify MP05 local artifacts in a fresh consumer directory."""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import time
import zipfile

from prepare import run, sha, write_json


def verify_tarball(archive, installed):
    installed = Path(installed)
    if installed.is_symlink():
        raise ValueError('package directory is a symlink')
    expected = set()
    with tarfile.open(archive) as t:
        for item in t.getmembers():
            if not item.isfile():
                if not item.isdir():
                    raise ValueError('unexpected link or special file in package')
                continue
            rel = Path(item.name).relative_to('package')
            if '..' in rel.parts:
                raise ValueError('unsafe package member')
            target = installed / rel
            if target.is_symlink() or not target.resolve().is_relative_to(installed.resolve()):
                raise ValueError('installed package escapes its root')
            if target.read_bytes() != t.extractfile(item).read():
                raise ValueError(f'installed file differs: {rel}')
            expected.add(str(rel))
    actual = {str(p.relative_to(installed)) for p in installed.rglob('*') if p.is_file() or p.is_symlink()}
    if actual != expected:
        raise ValueError('installed package has missing or additional files')
    return len(expected)


def install(manifest_path, work, python):
    manifest_path = Path(manifest_path).resolve(strict=True)
    manifest = json.loads(manifest_path.read_text())
    if manifest.get('format') != 'mp05-local-artifacts-v1' or manifest.get('status') != 'built':
        raise ValueError('a completed local artifact manifest is required')
    work = Path(work).resolve()
    tool = Path(__file__).resolve().parent
    if work.exists() or work.is_relative_to(tool.parents[1]) or work.is_relative_to(manifest_path.parent):
        raise ValueError('consumer must be a fresh directory outside source and build')
    files = {}
    for name, record in manifest['artifacts'].items():
        if Path(name).name != name:
            raise ValueError('unsafe artifact name')
        path = manifest_path.parent / 'artifacts' / name
        if path.is_symlink() or sha(path) != record['sha256'] or path.stat().st_size != record['bytes']:
            raise ValueError(f'artifact hash or size mismatch: {name}')
        files[name] = path
    def one(suffix, prefix):
        found = [p for n, p in files.items() if n.startswith(prefix) and n.endswith(suffix)]
        if len(found) != 1:
            raise ValueError(f'expected one {prefix}*{suffix}')
        return found[0]
    sdk = one('.tgz', 'dcp-ai-sdk-')
    adapter = one('.tgz', 'dcp-ai-express-')
    wheel = one('.whl', 'dcp_ai-')
    work.mkdir(mode=0o700, parents=True)
    logs = work / 'logs'; logs.mkdir()
    node = work / 'node'; node.mkdir()
    report = {'format': 'mp05-installed-consumers-v1', 'status': 'incomplete',
              'commit': manifest['commit'], 'artifact_manifest_sha256': sha(manifest_path), 'artifacts': manifest['artifacts']}
    result_path = work / 'installed.json'
    write_json(result_path, report)
    deadline = time.monotonic() + 1800
    env = dict(os.environ)
    for k in ('PYTHONPATH', 'PYTHONHOME', 'NODE_PATH', 'NODE_OPTIONS'):
        env.pop(k, None)
    env['PYTHONNOUSERSITE'] = '1'
    env['PIP_DISABLE_PIP_VERSION_CHECK'] = '1'
    def command(args, cwd, label):
        run(list(map(str, args)), cwd, logs / f'{label}.log', deadline, env)
    try:
        shutil.copyfile(sdk, node / 'sdk.tgz')
        shutil.copyfile(adapter, node / 'express.tgz')
        shutil.copyfile(tool / 'runtime-package.json', node / 'package.json')
        lock = json.loads((tool / 'runtime-package-lock.json').read_text())
        # Only local artifact integrity changes; all third-party entries remain pinned.
        for name, archive, filename in [('@dcp-ai/sdk', sdk, 'sdk.tgz'), ('@dcp-ai/express', adapter, 'express.tgz')]:
            entry = lock['packages']['node_modules/' + name]
            if entry['resolved'] != 'file:' + filename:
                raise ValueError('runtime lock does not refer to local artifacts')
            entry['integrity'] = 'sha512-' + base64.b64encode(hashlib.sha512(archive.read_bytes()).digest()).decode()
        write_json(node / 'package-lock.json', lock)
        lock_before = sha(node / 'package-lock.json')
        command(['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'], node, 'node-install')
        if sha(node / 'package-lock.json') != lock_before:
            raise ValueError('npm changed the frozen runtime lock')
        report['node_files'] = {
            'sdk': verify_tarball(sdk, node / 'node_modules/@dcp-ai/sdk'),
            'express': verify_tarball(adapter, node / 'node_modules/@dcp-ai/express'),
        }
        probe = '''import {createRequire} from 'node:module';
import {realpathSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import * as sdk from '@dcp-ai/sdk';
const sdkPath=realpathSync(fileURLToPath(import.meta.resolve('@dcp-ai/sdk')));
const expressPath=realpathSync(fileURLToPath(import.meta.resolve('@dcp-ai/express')));
const require=createRequire(expressPath);
const transit=realpathSync(require.resolve('@dcp-ai/sdk'));
for (const name of ['admitDelegatedBundleV2','evaluateDelegationActivationV2','createMandateAcknowledgment','admitSignedBundleV2FromBytes'])
  if(typeof sdk[name]!=='function') throw Error('Missing MP02 API: '+name);
console.log(JSON.stringify({sdkPath,expressPath,transit}));'''
        command(['node', '--input-type=module', '--eval', probe], node, 'node-resolution')
        paths = json.loads((logs / 'node-resolution.log').read_text())
        if Path(paths['sdkPath']).parent != Path(paths['transit']).parent:
            raise ValueError('Express resolves a different SDK')
        for key, package in [('sdkPath', '@dcp-ai/sdk'), ('transit', '@dcp-ai/sdk'), ('expressPath', '@dcp-ai/express')]:
            if not Path(paths[key]).is_relative_to(node / 'node_modules' / package):
                raise ValueError('package resolution escaped consumer')
        report['node_resolution'] = paths
        command(['npm', 'ls', '@dcp-ai/sdk', '--json'], node, 'node-tree')
        venv = work / 'python'
        command([python, '-m', 'venv', venv], work, 'python-venv')
        py = venv / 'bin/python'
        command([py, '-m', 'pip', 'install', '--only-binary=:all:', '--require-hashes', '-r', tool / 'runtime-requirements.lock'], work, 'python-dependencies')
        command([py, '-m', 'pip', 'install', '--no-deps', wheel], work, 'python-local-wheel')
        command([py, '-m', 'pip', 'check'], work, 'python-check')
        pyprobe = '''import dcp_ai,json,importlib.metadata as m
from dcp_ai import v2
for n in ['admit_delegated_bundle_v2','evaluate_delegation_activation_v2','create_mandate_acknowledgment','admit_signed_bundle_v2_from_bytes']:
 assert callable(getattr(v2,n,None)), n
d=m.distribution('dcp-ai')
print(json.dumps({'package':dcp_ai.__file__,'site':str(d.locate_file('')),'direct_url':json.loads(d.read_text('direct_url.json'))}))'''
        command([py, '-I', '-c', pyprobe], work, 'python-resolution')
        paths_py = json.loads((logs / 'python-resolution.log').read_text())
        site = Path(paths_py['site']).resolve()
        if not site.is_relative_to(venv) or not Path(paths_py['package']).resolve().is_relative_to(site):
            raise ValueError('Python resolution escaped isolated venv')
        direct = paths_py['direct_url']
        if direct.get('url') != wheel.as_uri() or direct.get('archive_info', {}).get('hashes', {}).get('sha256') != sha(wheel):
            raise ValueError('Python was not installed from the reviewed wheel')
        if list(site.glob('*.pth')) or list(site.glob('*.egg-link')):
            raise ValueError('unexpected Python path hook or editable install')
        checked = 0
        with zipfile.ZipFile(wheel) as z:
            for name in z.namelist():
                if name.endswith('/') or name.endswith('.dist-info/RECORD'):
                    continue
                target = site / name
                if target.is_symlink() or not target.resolve().is_relative_to(site) or target.read_bytes() != z.read(name):
                    raise ValueError('installed wheel content differs: ' + name)
                checked += 1
        report['python_files'] = checked
        report['python_resolution'] = paths_py
        report['locks'] = {n: sha(tool / n) for n in ('runtime-package.json', 'runtime-package-lock.json', 'runtime-requirements.lock')}
        report['node_installed_lock_sha256'] = lock_before
        report['status'] = 'installed-and-verified'
        write_json(result_path, report)
        return result_path
    except BaseException as exc:
        report['status'] = 'failed'
        report['error'] = f'{type(exc).__name__}: {exc}'
        write_json(result_path, report)
        raise


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--manifest', type=Path, required=True)
    p.add_argument('--work', type=Path, required=True)
    p.add_argument('--python', default=sys.executable)
    args = p.parse_args()
    print(install(args.manifest, args.work, args.python))
