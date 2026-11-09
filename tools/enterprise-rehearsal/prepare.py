#!/usr/bin/env python3
"""Build local MP05 artifacts from a clean revision. Never publishes packages.

Python 3.12, Node 22 and npm 11 are the initial tested toolchain. All writes go to
a new work directory outside the source checkout. Installation is a separate step.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tarfile
import time

PACKAGE_PATHS = ('sdks/typescript', 'integrations/express', 'sdks/python')


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_json(path, value):
    Path(path).write_text(json.dumps(value, indent=2) + '\n')


def run(argv, cwd, log, deadline, env=None):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise TimeoutError('overall build deadline exceeded')
    with Path(log).open('wb') as out:
        child = subprocess.Popen(argv, cwd=cwd, stdout=out, stderr=subprocess.STDOUT,
                                 env=env, start_new_session=True)
        try:
            code = child.wait(timeout=remaining)
        except BaseException:
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            child.wait()
            raise
    retained = False
    try:
        os.killpg(child.pid, 0)
    except ProcessLookupError:
        pass
    else:
        retained = True
        # A parent exit (successful or failed) does not imply descendants stopped.
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    if code:
        raise RuntimeError(f'{argv[0]} exited {code}; see {log}')
    if retained:
        raise RuntimeError(f'{argv[0]} left a descendant process; see {log}')


def prepare(source: Path, work: Path, revision: str, python: str):
    source = source.resolve(strict=True)
    work = work.resolve()
    if work.is_relative_to(source) or source.is_relative_to(work):
        raise ValueError('work must be a new directory outside the checkout')
    if work.exists():
        raise ValueError('work directory already exists; choose a fresh path')
    commit = subprocess.check_output(['git', 'rev-parse', '--verify', revision + '^{commit}'], cwd=source, text=True).strip()
    dirty = subprocess.check_output(['git', 'status', '--porcelain', '--untracked-files=no', '--', *PACKAGE_PATHS], cwd=source)
    if dirty:
        raise ValueError('package source has uncommitted changes')
    work.mkdir(mode=0o700, parents=True)
    logs = work / 'logs'; logs.mkdir()
    artifacts = work / 'artifacts'; artifacts.mkdir()
    export = work / 'source'; export.mkdir()
    report = {'format': 'mp05-local-artifacts-v1', 'status': 'incomplete', 'commit': commit,
              'source_paths': list(PACKAGE_PATHS), 'published': False, 'commands': [], 'artifacts': {},
              'prepare_script_sha256': sha(__file__)}
    manifest = work / 'artifacts.json'
    write_json(manifest, report)
    deadline = time.monotonic() + 1800
    env = dict(os.environ)
    for name in ('PYTHONPATH', 'PYTHONHOME', 'NODE_PATH', 'NODE_OPTIONS'):
        env.pop(name, None)
    env['PYTHONNOUSERSITE'] = '1'
    env['PIP_DISABLE_PIP_VERSION_CHECK'] = '1'
    env['SOURCE_DATE_EPOCH'] = subprocess.check_output(['git', 'show', '-s', '--format=%ct', commit], cwd=source, text=True).strip()

    def command(args, cwd, label):
        report['commands'].append({'argv': list(map(str, args)), 'cwd': str(Path(cwd).relative_to(work)), 'log': f'logs/{label}.log'})
        write_json(manifest, report)
        run(list(map(str, args)), cwd, logs / f'{label}.log', deadline, env)

    try:
        archive = subprocess.check_output(['git', 'archive', commit, *PACKAGE_PATHS], cwd=source, timeout=60)
        report['source_archive_sha256'] = hashlib.sha256(archive).hexdigest()
        with tarfile.open(fileobj=io.BytesIO(archive)) as t:
            if any(not (m.isfile() or m.isdir()) for m in t.getmembers()):
                raise ValueError('unexpected link or special file in source export')
            t.extractall(export, filter='data')
        report['source_files'] = {str(p.relative_to(export)): sha(p) for p in sorted(export.rglob('*')) if p.is_file()}
        for program in ('node', 'npm', python):
            report.setdefault('toolchain', {})[program] = subprocess.check_output([program, '--version'], text=True).strip()
        sdk = export / 'sdks/typescript'
        command(['npm', 'ci', '--no-audit', '--no-fund'], sdk, 'sdk-install')
        command(['npm', 'run', 'build'], sdk, 'sdk-build')
        command(['npm', 'pack', '--json', '--pack-destination', artifacts], sdk, 'sdk-pack')
        sdk_tar = artifacts / json.loads((logs / 'sdk-pack.log').read_text())[0]['filename']
        adapter = export / 'integrations/express'
        # The existing lock bootstraps build dependencies (including the published
        # SDK). Replace that SDK before compiling. Neither build nor runtime uses it.
        command(['npm', 'ci', '--no-audit', '--no-fund'], adapter, 'express-bootstrap')
        before = {f: (adapter / f).read_bytes() for f in ('package.json', 'package-lock.json')}
        command(['npm', 'install', '--no-save', '--package-lock=false', '--ignore-scripts', '--no-audit', '--no-fund', sdk_tar], adapter, 'express-local-sdk')
        installed = adapter / 'node_modules/@dcp-ai/sdk'
        if installed.is_symlink() or not installed.is_dir():
            raise RuntimeError('Express build did not install a physical local SDK')
        with tarfile.open(sdk_tar) as t:
            for m in t.getmembers():
                if m.isfile():
                    rel = Path(m.name).relative_to('package')
                    if (installed / rel).read_bytes() != t.extractfile(m).read():
                        raise RuntimeError(f'Express SDK differs from local tarball: {rel}')
        command(['npm', 'run', 'build'], adapter, 'express-build')
        for f, content in before.items():
            if (adapter / f).read_bytes() != content:
                raise RuntimeError(f'build changed source manifest: {f}')
        command(['npm', 'pack', '--json', '--pack-destination', artifacts], adapter, 'express-pack')
        builder = work / 'build-env'
        command([python, '-m', 'venv', builder], work, 'python-venv')
        py = builder / 'bin/python'
        lock = Path(__file__).with_name('build-requirements.lock')
        command([py, '-m', 'pip', 'install', '--only-binary=:all:', '--require-hashes', '-r', lock], work, 'python-build-dependencies')
        command([py, '-m', 'build', '--no-isolation', '--outdir', artifacts], export / 'sdks/python', 'python-build')
        report['build_requirements_sha256'] = sha(lock)
        report['artifacts'] = {p.name: {'sha256': sha(p), 'bytes': p.stat().st_size} for p in sorted(artifacts.iterdir()) if p.is_file()}
        if len(report['artifacts']) != 4:
            raise RuntimeError('expected SDK tarball, Express tarball, wheel and sdist')
        report['status'] = 'built'
        write_json(manifest, report)
        return manifest
    except BaseException as exc:
        report['status'] = 'failed'
        report['error'] = f'{type(exc).__name__}: {exc}'
        write_json(manifest, report)
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--work', type=Path, required=True)
    parser.add_argument('--revision', default='HEAD')
    parser.add_argument('--python', default=sys.executable)
    a = parser.parse_args()
    print(prepare(a.source, a.work, a.revision, a.python))
