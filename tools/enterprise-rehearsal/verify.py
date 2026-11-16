#!/usr/bin/env python3
"""Read-only, offline guard for MP05 consumers, also run before a rehearsal."""
from __future__ import annotations
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tarfile
import zipfile

from install import verify_tarball
from prepare import sha


def read(path):
    return json.loads(Path(path).read_text())


def check_manifest(package):
    for group in ('dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'):
        for dependency in package.get(group, {}).values():
            if dependency.startswith(('file:', '/', '../', './')):
                raise ValueError('artifact manifest contains a private/local dependency')


def verify(manifest_path, work):
    manifest_path = Path(manifest_path).resolve(strict=True)
    work = Path(work).resolve(strict=True)
    tool = Path(__file__).resolve().parent
    manifest = read(manifest_path)
    installed = read(work / 'installed.json')
    if manifest.get('status') != 'built' or installed.get('status') != 'installed-and-verified':
        raise ValueError('incomplete artifact or installation report')
    if installed['artifact_manifest_sha256'] != sha(manifest_path):
        raise ValueError('artifact manifest changed since installation')
    archives = {}
    for name, record in manifest['artifacts'].items():
        if Path(name).name != name:
            raise ValueError('unsafe artifact path')
        path = manifest_path.parent / 'artifacts' / name
        if path.is_symlink() or sha(path) != record['sha256']:
            raise ValueError('artifact content changed')
        if name.endswith('.tgz'):
            with tarfile.open(path) as t:
                package = json.load(t.extractfile('package/package.json'))
                check_manifest(package)
                archives[package['name']] = path
        elif name.endswith('.whl'):
            archives['dcp-ai'] = path
    if set(archives) != {'@dcp-ai/sdk', '@dcp-ai/express', 'dcp-ai'}:
        raise ValueError('wrong artifact set')
    node = work / 'node'
    modules = node / 'node_modules'
    expected = read(tool / 'runtime-package-lock.json')
    for name in ('@dcp-ai/sdk', '@dcp-ai/express'):
        expected['packages']['node_modules/' + name]['integrity'] = 'sha512-' + base64.b64encode(hashlib.sha512(archives[name].read_bytes()).digest()).decode()
    if read(node / 'package-lock.json') != expected or read(node / 'package.json') != read(tool / 'runtime-package.json'):
        raise ValueError('runtime lock or manifest drift')
    hidden = read(modules / '.package-lock.json')
    if hidden['packages'] != {k: v for k, v in expected['packages'].items() if k}:
        raise ValueError('installed hidden lock drift')
    found = []
    for p in modules.rglob('*'):
        if p.is_symlink() and not p.resolve().is_relative_to(modules):
            raise ValueError('node_modules symlink escapes the consumer')
        if p.name == 'package.json' and p.is_file():
            name = read(p).get('name', '')
            if name.startswith('@dcp-ai/'):
                found.append((name, p.parent))
    if sorted(found) != sorted((name, modules / name) for name in ('@dcp-ai/sdk', '@dcp-ai/express')):
        raise ValueError('extra or nested DCP package')
    checked = {name: verify_tarball(archives[name], modules / name) for name in ('@dcp-ai/sdk', '@dcp-ai/express')}
    env = dict(os.environ)
    for key in ('NODE_PATH', 'NODE_OPTIONS', 'PYTHONPATH', 'PYTHONHOME'):
        env.pop(key, None)
    env['PYTHONNOUSERSITE'] = '1'
    subprocess.run(['npm', 'ls', '--all', '--json'], cwd=node, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, check=True)
    probe = """import * as sdk from '@dcp-ai/sdk';
import {createRequire} from 'node:module'; import {realpathSync} from 'node:fs'; import {fileURLToPath} from 'node:url';
for (const n of ['admitDelegatedBundleV2','evaluateDelegationActivationV2','createMandateAcknowledgment','admitSignedBundleV2FromBytes'])
 if(typeof sdk[n]!=='function')throw Error('Missing API '+n);
const sdkPath=realpathSync(fileURLToPath(import.meta.resolve('@dcp-ai/sdk')));
const adapter=realpathSync(fileURLToPath(import.meta.resolve('@dcp-ai/express')));
console.log(JSON.stringify({sdkPath,adapter,transitive:realpathSync(createRequire(adapter).resolve('@dcp-ai/sdk'))}));"""
    resolution = json.loads(subprocess.check_output(['node', '--input-type=module', '-e', probe], cwd=node, env=env, timeout=30))
    if Path(resolution['sdkPath']).parent != Path(resolution['transitive']).parent:
        raise ValueError('transitive SDK differs')
    for key, package in [('sdkPath', '@dcp-ai/sdk'), ('transitive', '@dcp-ai/sdk'), ('adapter', '@dcp-ai/express')]:
        if not Path(resolution[key]).is_relative_to(modules / package):
            raise ValueError('Node resolved outside consumer')
    venv = work / 'python'
    sites = list((venv / 'lib').glob('python*/site-packages'))
    if len(sites) != 1:
        raise ValueError('ambiguous Python site-packages')
    site = sites[0]
    if site.is_symlink() or not site.resolve().is_relative_to(venv):
        raise ValueError('Python site escapes consumer')
    # Inspect hooks and package bytes BEFORE starting Python in this environment.
    if list(site.glob('*.pth')) or list(site.glob('*.egg-link')):
        raise ValueError('unexpected Python path hook')
    wheel = archives['dcp-ai']
    expected_py = set()
    wheel_version = None
    with zipfile.ZipFile(wheel) as z:
        for name in z.namelist():
            if name.endswith('/') or name.endswith('.dist-info/RECORD'):
                continue
            target = site / name
            if target.is_symlink() or not target.resolve().is_relative_to(site) or target.read_bytes() != z.read(name):
                raise ValueError('wheel content changed: ' + name)
            if name.startswith('dcp_ai/'):
                expected_py.add(name)
            if name.endswith('.dist-info/METADATA'):
                wheel_version = re.search(r'^Version: (.+)$', z.read(name).decode(), re.M)[1]
    actual_py = {str(p.relative_to(site)) for p in (site / 'dcp_ai').rglob('*') if p.is_file() and '__pycache__' not in p.parts}
    if actual_py != expected_py:
        raise ValueError('extra or missing Python package file')
    normal = lambda s: re.sub(r'[-_.]+', '-', s).lower()
    expected_dists = {normal(n): v for n, v in re.findall(r'^([^#\s]+)==([^\s]+)', (tool / 'runtime-requirements.lock').read_text(), re.M)}
    expected_dists['dcp-ai'] = wheel_version
    pyprobe = """import sys,json,ensurepip,importlib.metadata as m
from pathlib import Path
assert sys.flags.isolated == 1, 'Python is not isolated'
from dcp_ai import v2
import dcp_ai
for n in ['admit_delegated_bundle_v2','evaluate_delegation_activation_v2','create_mandate_acknowledgment','admit_signed_bundle_v2_from_bytes']:
 assert callable(getattr(v2,n,None)), 'Missing API '+n
d=m.distribution('dcp-ai')
print(json.dumps({'path':str(Path(dcp_ai.__file__).resolve()),'sys_path':sys.path,'seed_pip':ensurepip.version(),'distributions':[(d.metadata['Name'],d.version) for d in m.distributions()],'direct_url':json.loads(d.read_text('direct_url.json'))}))"""
    info = json.loads(subprocess.check_output([str(venv / 'bin/python'), '-I', '-c', pyprobe], cwd=work, env=env, timeout=30))
    if not Path(info['path']).is_relative_to(site):
        raise ValueError('Python resolved outside consumer')
    if any(p and Path(p).resolve().is_relative_to(tool.parents[1]) for p in info['sys_path']):
        raise ValueError('Python sys.path includes checkout')
    expected_dists['pip'] = info['seed_pip']
    actual_dists = {normal(n): v for n, v in info['distributions']}
    if actual_dists != expected_dists or len(info['distributions']) != len(actual_dists):
        raise ValueError('Python distribution set drift')
    direct = info['direct_url']
    if direct.get('url') != wheel.as_uri() or direct.get('archive_info', {}).get('hashes', {}).get('sha256') != sha(wheel):
        raise ValueError('Python artifact origin drift')
    subprocess.run([str(venv / 'bin/python'), '-I', '-m', 'pip', 'check'], cwd=work, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True, timeout=30)
    return {'status': 'verified', 'commit': manifest['commit'], 'node_files': checked,
            'python_package_files': len(expected_py), 'python_distributions': len(actual_dists),
            'artifact_manifest_sha256': sha(manifest_path), 'node_resolution': resolution,
            'python_resolution': info['path']}


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--manifest', type=Path, required=True)
    p.add_argument('--work', type=Path, required=True)
    args = p.parse_args()
    print(json.dumps(verify(args.manifest, args.work), indent=2))
