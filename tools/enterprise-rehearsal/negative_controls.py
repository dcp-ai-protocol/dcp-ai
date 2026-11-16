#!/usr/bin/env python3
"""Exercise installed-consumer guards on a disposable copy, offline."""
import argparse
import json
import os
from pathlib import Path
import shutil
import tempfile

from verify import verify, check_manifest


def controls(manifest, consumer):
    results = []
    with tempfile.TemporaryDirectory(prefix='mp05-guard-controls-') as directory:
        root = Path(directory).resolve()
        work = root / 'consumer'
        shutil.copytree(consumer, work, symlinks=True)
        def valid(label):
            assert verify(manifest, work)['status'] == 'verified'
            results.append({'case': label, 'observed': 'accepted', 'pass': True})
        def refused(label, expected):
            try:
                verify(manifest, work)
            except Exception as exc:
                if expected not in str(exc):
                    raise AssertionError(f'{label}: wrong failure {exc}') from exc
                results.append({'case': label, 'observed': 'rejected', 'reason': str(exc), 'pass': True})
            else:
                raise AssertionError(f'{label}: corrupted installation accepted')
        def edit(path, mutate, label, expected):
            old = path.read_bytes()
            try:
                path.write_bytes(mutate(old))
                refused(label, expected)
            finally:
                path.write_bytes(old)

        valid('clean_copy')
        modules = work / 'node/node_modules'
        sdk = modules / '@dcp-ai/sdk'
        hold = root / 'held-sdk'
        sdk.rename(hold)
        try:
            sdk.symlink_to(hold, target_is_directory=True)
            refused('node_external_symlink', 'symlink')
        finally:
            sdk.unlink(); hold.rename(sdk)
        edit(sdk/'dist/index.js', lambda b:b+b'\n// changed\n', 'node_changed_content', 'differs')
        edit(sdk/'dist/index.js', lambda b:b'export {};\n', 'node_missing_api_synthetic', 'differs')
        nested = modules / '@dcp-ai/express/node_modules/@dcp-ai/sdk'
        nested.parent.mkdir(parents=True)
        shutil.copytree(sdk, nested)
        try:
            refused('node_nested_sdk', 'nested DCP')
        finally:
            shutil.rmtree(modules/'@dcp-ai/express/node_modules')
        def lock_change(raw, name, key, value):
            d=json.loads(raw);d['packages']['node_modules/'+name][key]=value
            return json.dumps(d).encode()
        lock = work/'node/package-lock.json'
        edit(lock, lambda b:lock_change(b,'@dcp-ai/sdk','resolved','https://registry.npmjs.org/invalid.tgz'), 'node_registry_origin', 'lock')
        edit(lock, lambda b:lock_change(b,'express','version','0.0.0'), 'node_third_party_lock_drift', 'lock')
        hidden = modules/'.package-lock.json'
        edit(hidden, lambda b:lock_change(b,'express','version','0.0.0'), 'node_hidden_lock_drift', 'hidden lock')
        site=next((work/'python/lib').glob('python*/site-packages'))
        pth=site/'__editable__synthetic.pth'; pth.write_text(str(root/'fake-source')+'\n')
        try:
            refused('python_editable_hook', 'path hook')
        finally:
            pth.unlink()
        edit(site/'dcp_ai/__init__.py', lambda b:b+b'\n# changed\n', 'python_changed_content', 'wheel content')
        extra=site/'dcp_ai/unexpected.py';extra.write_text('unexpected=True\n')
        try:
            refused('python_extra_module', 'extra or missing')
        finally:
            extra.unlink()
        fake=site/'unexpected_mp05-1.0.dist-info'; fake.mkdir();(fake/'METADATA').write_text('Metadata-Version: 2.1\nName: unexpected-mp05\nVersion: 1.0\n')
        try:
            refused('python_extra_distribution', 'distribution set')
        finally:
            shutil.rmtree(fake)
        direct=next(site.glob('dcp_ai-*.dist-info'))/'direct_url.json'
        edit(direct,lambda b:json.dumps({'url':'file:///wrong.whl','archive_info':{}}).encode(),'python_wrong_wheel_origin','origin drift')
        try:
            check_manifest({'dependencies':{'synthetic':'file:/private/test-only'}})
        except ValueError:
            results.append({'case':'artifact_private_dependency','observed':'rejected','pass':True})
        else:
            raise AssertionError('private artifact dependency accepted')
        fake_source=root/'fake-source';(fake_source/'dcp_ai').mkdir(parents=True)
        (fake_source/'dcp_ai/__init__.py').write_text('raise RuntimeError("polluted")\n')
        original=os.environ.get('PYTHONPATH')
        try:
            os.environ['PYTHONPATH']=str(fake_source)
            valid('pythonpath_pollution_ignored')
        finally:
            if original is None:os.environ.pop('PYTHONPATH',None)
            else:os.environ['PYTHONPATH']=original
        valid('restored_copy')
    return {'status':'pass','cases':len(results),'results':results}


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--manifest',type=Path,required=True)
    p.add_argument('--work',type=Path,required=True)
    a=p.parse_args()
    print(json.dumps(controls(a.manifest,a.work),indent=2))
