"""Negative controls for MP05 artifact preparation (no network or SDK campaign)."""
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest

from prepare import run
from install import install, verify_tarball


class ArtifactControls(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.archive = self.root / 'sample.tgz'
        self.package = self.root / 'installed'
        self.package.mkdir()
        (self.package / 'index.js').write_bytes(b'export const answer = 42;\n')
        with tarfile.open(self.archive, 'w:gz') as t:
            payload = (self.package / 'index.js').read_bytes()
            info = tarfile.TarInfo('package/index.js'); info.size = len(payload)
            t.addfile(info, io.BytesIO(payload))

    def tearDown(self):
        self.tmp.cleanup()

    def test_unchanged_archive_is_accepted(self):
        self.assertEqual(verify_tarball(self.archive, self.package), 1)

    def test_mutated_installed_content_is_rejected(self):
        (self.package / 'index.js').write_text('export const answer = 0;')
        with self.assertRaisesRegex(ValueError, 'differs'):
            verify_tarball(self.archive, self.package)

    def test_extra_installed_code_is_rejected(self):
        (self.package / 'extra.js').write_text('unexpected')
        with self.assertRaisesRegex(ValueError, 'additional'):
            verify_tarball(self.archive, self.package)

    def test_symlink_to_source_is_rejected(self):
        alias = self.root / 'alias'; alias.symlink_to(self.package, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'symlink'):
            verify_tarball(self.archive, alias)

    def test_incomplete_manifest_never_installs(self):
        manifest = self.root / 'artifacts.json'
        manifest.write_text(json.dumps({'format': 'mp05-local-artifacts-v1', 'status': 'incomplete'}))
        with self.assertRaisesRegex(ValueError, 'completed'):
            install(manifest, self.root / 'consumer', sys.executable)
        self.assertFalse((self.root / 'consumer').exists())

    def test_empty_artifact_set_never_installs(self):
        manifest = self.root / 'artifacts.json'
        manifest.write_text(json.dumps({'format': 'mp05-local-artifacts-v1', 'status': 'built', 'artifacts': {}}))
        with self.assertRaisesRegex(ValueError, 'expected one'):
            install(manifest, self.root.parent / (self.root.name + '-consumer'), sys.executable)

    def test_child_failure_propagates(self):
        with self.assertRaisesRegex(RuntimeError, 'exited 7'):
            run([sys.executable, '-c', 'raise SystemExit(7)'], self.root, self.root/'failure.log', time.monotonic()+5)

    def test_clean_child_is_accepted(self):
        run([sys.executable, '-c', 'print("ok")'], self.root, self.root/'clean.log', time.monotonic()+5)
        self.assertEqual((self.root/'clean.log').read_text().strip(), 'ok')

    def test_parent_success_does_not_hide_retained_child(self):
        code = 'import subprocess,sys; subprocess.Popen([sys.executable,"-c","import time;time.sleep(30)"])'
        with self.assertRaisesRegex(RuntimeError, 'left a descendant'):
            run([sys.executable, '-c', code], self.root, self.root/'retained.log', time.monotonic()+5)

    def test_failing_parent_also_stops_descendant(self):
        code = 'import subprocess,sys,pathlib; p=subprocess.Popen([sys.executable,"-c","import time;time.sleep(30)"]); pathlib.Path("child-pid").write_text(str(p.pid)); raise SystemExit(7)'
        with self.assertRaisesRegex(RuntimeError, 'exited 7'):
            run([sys.executable, '-c', code], self.root, self.root/'failed-retained.log', time.monotonic()+5)
        pid = int((self.root/'child-pid').read_text())
        for _ in range(100):
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                return
            time.sleep(0.01)
        self.fail('failed command left a live descendant')

    def test_child_timeout_kills_its_process_group(self):
        pid_file = self.root / 'pid'
        script = 'import os,time,pathlib; pathlib.Path("pid").write_text(str(os.getpid())); time.sleep(30)'
        with self.assertRaises(subprocess.TimeoutExpired):
            run([sys.executable, '-c', script], self.root, self.root/'timeout.log', time.monotonic()+1)
        pid = int(pid_file.read_text())
        with self.assertRaises(ProcessLookupError):
            os.killpg(pid, 0)


if __name__ == '__main__':
    unittest.main()
