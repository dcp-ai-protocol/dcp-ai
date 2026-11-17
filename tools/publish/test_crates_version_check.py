#!/usr/bin/env python3
"""Rust release-precheck regressions. Loopback only; never calls cargo publish."""
import http.server
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import tomllib
import unittest

import yaml

ROOT = Path(__file__).resolve().parents[2]
HELPER = ROOT / "tools/publish/crates-version-check.py"
MANIFEST = '[package]\nname = "dcp-ai"\nversion = "2.14.0"\n'
ENTRY = {"name": "dcp-ai", "vers": "2.14.0", "yanked": False, "deps": [], "features": {}, "cksum": "a" * 64}
PRESENT = [ENTRY]
ABSENT = [dict(ENTRY, vers="2.13.0")]


class Registry(http.server.BaseHTTPRequestHandler):
    response = (200, PRESENT, 0, False, False, True)
    seen = []

    def do_GET(self):
        status, value, delay, trickle, truncated, with_length = type(self).response
        type(self).seen.append((self.path, dict(self.headers)))
        body = value if isinstance(value, bytes) else b"\n".join(json.dumps(row).encode() for row in value) + b"\n"
        try:
            time.sleep(delay)
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            if with_length:
                self.send_header("Content-Length", str(len(body) + (10 if truncated else 0)))
            if status == 302:
                self.send_header("Location", "/redirect-target")
            self.end_headers()
            if trickle:
                for byte in body:
                    self.wfile.write(bytes([byte]))
                    self.wfile.flush()
                    time.sleep(0.04)
            else:
                self.wfile.write(body)
        except OSError:
            pass  # expected when the deadline/size control closes the connection

    def log_message(self, *args):
        pass


class CratesVersionCheck(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if shutil.which("curl") is None:
            raise RuntimeError("curl is required; missing infrastructure is not a skip")
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Registry)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.registry = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def invoke(self, status=200, body=PRESENT, manifest=MANIFEST, delay=0,
               trickle=False, truncated=False, with_length=True, timeout="2", args=None, registry=None, output=True, fake_curl=None, crate_dir=None):
        Registry.response = (status, body, delay, trickle, truncated, with_length)
        Registry.seen = []
        with tempfile.TemporaryDirectory(prefix="dcp-crates-test-") as tmp:
            directory = Path(tmp)
            if crate_dir is None:
                (directory / "Cargo.toml").write_text(manifest)
            (directory / ".curlrc").write_text('header = "Authorization: Bearer curlrc-canary"\n')
            out = directory / "output"
            out.write_text("")
            env = dict(os.environ, HOME=tmp, CURL_HOME=tmp,
                       CARGO_REGISTRY_TOKEN="registry-token-canary", NODE_AUTH_TOKEN="node-token-canary")
            env.pop("GITHUB_OUTPUT", None)
            if output:
                env["GITHUB_OUTPUT"] = str(out)
            if fake_curl:
                binary = directory / "bin"
                binary.mkdir()
                (binary / "curl").write_text(fake_curl)
                (binary / "curl").chmod(0o755)
                env["PATH"] = str(binary) + os.pathsep + env["PATH"]
            argv = [sys.executable, str(HELPER)] + (args if args is not None else
                    ["--registry", registry or self.registry, "--timeout-seconds", timeout])
            start = time.monotonic()
            done = subprocess.run(argv, cwd=crate_dir or directory, env=env, capture_output=True, text=True, timeout=8)
            return done, out.read_text(), list(Registry.seen), time.monotonic() - start

    def refused(self, **kwargs):
        done, output, seen, elapsed = self.invoke(**kwargs)
        self.assertNotEqual(done.returncode, 0, done.stdout)
        self.assertEqual(output, "", done.stdout + done.stderr)
        return done, seen, elapsed

    def test_existing_and_yanked_versions_are_skipped(self):
        for yanked in (False, True):
            with self.subTest(yanked=yanked):
                done, out, seen, _ = self.invoke(body=[dict(ENTRY, yanked=yanked)])
                self.assertEqual((done.returncode, out), (0, "version=2.14.0\nskip=true\n"), done.stderr)
                self.assertEqual(seen[0][0], "/dc/p-/dcp-ai")
                self.assertNotIn("canary", json.dumps(seen))
                self.assertTrue(any(k.lower() == "user-agent" for k in seen[0][1]))

    def test_absence_is_confirmed_by_a_valid_existing_crate_index(self):
        done, out, _, _ = self.invoke(body=ABSENT)
        self.assertEqual((done.returncode, out), (0, "version=2.14.0\nskip=false\n"), done.stderr)

    def test_http_errors_and_redirects_stop_the_check(self):
        for status in (204, 301, 302, 401, 403, 404, 408, 429, 500, 502, 503):
            with self.subTest(status=status):
                _, seen, _ = self.refused(status=status, body=PRESENT)
                self.assertEqual(len(seen), 1)

    def test_index_identity_schema_and_types_are_validated(self):
        changes = [{"name": "other"}, {"vers": 2}, {"vers": "2.14.0-01"},
                   {"yanked": None}, {"yanked": 0}, {"deps": {}}, {"features": []},
                   {"cksum": "bad"}, {"v": 3}, {"v": True}]
        for change in changes:
            with self.subTest(change=change):
                self.refused(body=[dict(ENTRY, **change)])
        for field in ENTRY:
            with self.subTest(missing=field):
                self.refused(body=[{k: v for k, v in ENTRY.items() if k != field}])

    def test_all_rows_are_checked_and_ambiguous_duplicates_are_rejected(self):
        for body in ([ENTRY, ENTRY], [ENTRY, dict(ENTRY, vers="2.14.0+other")],
                     [ENTRY, dict(ENTRY, name="other")], [ENTRY, None], [ENTRY, []]):
            with self.subTest(body=body):
                self.refused(body=body)

    def test_malformed_duplicate_and_non_json_values_are_rejected(self):
        for body in (b"", b"\n", b"{", b"\xff", b"[]", b"null", b"<html>Not Found</html>",
                     b'{"name":"other",' + json.dumps(ENTRY).encode()[1:],
                     json.dumps(ENTRY).encode()[:-1] + b',"extra":NaN}'):
            with self.subTest(body=body):
                self.refused(body=body)

    def test_headers_and_trickling_body_have_a_total_deadline(self):
        for options in ({"delay": 0.8}, {"trickle": True}):
            with self.subTest(options=options):
                _, _, elapsed = self.refused(timeout="0.2", **options)
                self.assertLess(elapsed, 3)

    def test_oversized_body_is_rejected(self):
        # Otherwise valid JSON must be refused for size alone. Invalid padding
        # would also fail without either size control and would not test the cap.
        seed = json.dumps(dict(ENTRY, pad="")).encode() + b"\n"
        for with_length in (True, False):
            for size in (256 * 1024 - 1, 256 * 1024, 256 * 1024 + 1):
                with self.subTest(with_length=with_length, size=size):
                    body = json.dumps(dict(ENTRY, pad="x" * (size - len(seed)))).encode() + b"\n"
                    self.assertEqual(len(body), size)
                    if size > 256 * 1024:
                        self.refused(body=body, with_length=with_length)
                    else:
                        done, out, _, _ = self.invoke(body=body, with_length=with_length)
                        self.assertEqual((done.returncode, out), (0, "version=2.14.0\nskip=true\n"), done.stderr)

    def test_index_schemas_v1_and_v2_remain_supported(self):
        for schema in (1, 2):
            for rows, skip in ((PRESENT, "true"), (ABSENT, "false")):
                with self.subTest(schema=schema, skip=skip):
                    body = [dict(row, v=schema, features2={"default": ["dep:optional"]}) for row in rows]
                    done, out, _, _ = self.invoke(body=body)
                    self.assertEqual((done.returncode, out), (0, f"version=2.14.0\nskip={skip}\n"), done.stderr)

    def test_checkout_manifest_against_a_current_index_shape(self):
        crate = ROOT / "sdks/rust"
        package = tomllib.loads((crate / "Cargo.toml").read_text())["package"]
        row = dict(ENTRY, name=package["name"], vers=package["version"], v=2,
                   features2={"default": ["dep:optional"]}, pubtime="2026-11-01T00:00:00Z",
                   deps=[{"name": "optional", "req": "^1", "features": [], "optional": True,
                          "default_features": True, "target": None, "kind": "normal"}])
        done, out, seen, _ = self.invoke(crate_dir=crate, body=[row])
        self.assertEqual((done.returncode, out), (0, f'version={package["version"]}\nskip=true\n'), done.stderr)
        self.assertEqual(seen[0][0], "/dc/p-/dcp-ai")

    def test_truncation_after_a_valid_row_does_not_confirm_absence(self):
        self.refused(body=ABSENT, truncated=True)

    def test_sparse_index_paths_and_valid_unicode_inside_a_record(self):
        for name, path in (("a", "/1/a"), ("Ab", "/2/ab"), ("abc", "/3/a/abc"), ("Abcd", "/ab/cd/abcd")):
            with self.subTest(name=name):
                row = dict(ENTRY, name=name, comment="a\u2028b")
                body = json.dumps(row, ensure_ascii=False).encode() + b"\n"
                done, out, seen, _ = self.invoke(body=body, manifest=MANIFEST.replace('"dcp-ai"', json.dumps(name)))
                self.assertEqual((done.returncode, out), (0, "version=2.14.0\nskip=true\n"), done.stderr)
                self.assertEqual(seen[0][0], path)

    def test_connection_failure_is_not_absence(self):
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Registry)
        port = server.server_port
        server.server_close()
        _, seen, _ = self.refused(registry=f"http://127.0.0.1:{port}")
        self.assertEqual(seen, [])

    def test_outer_deadline_bounds_an_unresponsive_curl(self):
        fake = f'#!{sys.executable}\nimport time\ntime.sleep(20)\n'
        _, seen, elapsed = self.refused(timeout="0.1", fake_curl=fake)
        self.assertEqual(seen, [])
        self.assertLess(elapsed, 3)

    def test_toml_parser_reads_package_identity_not_a_dependency(self):
        manifest = "[dependencies.other]\nversion = '1.0.0'\n[package]\nname = 'dcp-ai' # comment\nversion = '2.14.0'\n"
        done, out, _, _ = self.invoke(manifest=manifest)
        self.assertEqual((done.returncode, out), (0, "version=2.14.0\nskip=true\n"), done.stderr)

    def test_invalid_or_inherited_manifest_values_fail_before_network(self):
        for manifest in ("{", "", '[[package]]\nname="dcp-ai"\nversion="2.14.0"',
                         MANIFEST + 'version="2.15.0"\n', MANIFEST.replace('"dcp-ai"', '"dcp/ai"'),
                         MANIFEST.replace('"2.14.0"', '42'), MANIFEST.replace('version = "2.14.0"', 'version.workspace = true'),
                         MANIFEST.replace('"2.14.0"', '"2.14.0-01"'), MANIFEST.replace('"2.14.0"', '"02.14.0"')):
            with self.subTest(manifest=manifest):
                _, seen, _ = self.refused(manifest=manifest)
                self.assertEqual(seen, [])

    def test_prerelease_and_build_metadata_follow_cargo_version_uniqueness(self):
        for requested, existing in (("2.15.0-rc.1+local", "2.15.0-rc.1+published"),
                                    ("2.15.0", "2.15.0+build.5"), ("2.15.0+build.5", "2.15.0")):
            with self.subTest(requested=requested, existing=existing):
                done, out, seen, _ = self.invoke(manifest=MANIFEST.replace("2.14.0", requested),
                                                 body=[dict(ENTRY, vers=existing)])
                self.assertEqual((done.returncode, out), (0, f"version={requested}\nskip=true\n"), done.stderr)
                self.assertEqual(seen[0][0], "/dc/p-/dcp-ai")

    def test_prereleases_and_releases_are_distinct_versions(self):
        for requested, existing in (("2.15.0", "2.15.0-rc.1"), ("2.15.0-rc.1", "2.15.0"),
                                    ("2.15.0-rc.1", "2.15.0-rc.2")):
            with self.subTest(requested=requested, existing=existing):
                done, out, _, _ = self.invoke(manifest=MANIFEST.replace("2.14.0", requested),
                                              body=[dict(ENTRY, vers=existing)])
                self.assertEqual((done.returncode, out), (0, f"version={requested}\nskip=false\n"), done.stderr)

    def test_default_registry_and_curl_configuration_are_credential_free(self):
        # Observe the subprocess boundary without sending a real registry request.
        # The other tests exercise real curl against a loopback HTTP server.
        fake = f'''#!{sys.executable}
import os, sys
from pathlib import Path
assert sys.argv[-1] == "https://index.crates.io/dc/p-/dcp-ai", sys.argv[-1]
assert sys.argv[1] == "--disable", "curl must ignore default configuration"
assert not ({{"CARGO_REGISTRY_TOKEN", "NODE_AUTH_TOKEN", "CURL_HOME", "HOME"}} & os.environ.keys()), "caller environment leaked"
Path(sys.argv[sys.argv.index("--output") + 1]).write_bytes({(json.dumps(ENTRY).encode() + bytes([10]))!r})
print("200", end="")
'''
        done, out, seen, _ = self.invoke(args=[], fake_curl=fake)
        self.assertEqual((done.returncode, out), (0, "version=2.14.0\nskip=true\n"), done.stderr)
        self.assertEqual(seen, [])

    def test_invalid_options_or_missing_output_fail_before_network(self):
        cases = [{"output": False}] + [{"args": args} for args in
                (["--force"], ["--registry", "https://user:pass@example.com"],
                 ["--registry", "https://example.com?x=1"], ["--registry", "ftp://example.com"],
                 ["--timeout-seconds", "nan"], ["--timeout-seconds", "inf"],
                 ["--timeout-seconds", "0"], ["--timeout-seconds", "301"])]
        for options in cases:
            with self.subTest(options=options):
                _, seen, _ = self.refused(**options)
                self.assertEqual(seen, [])

    def test_workflow_requires_an_affirmative_absence_result(self):
        workflow = yaml.safe_load((ROOT / ".github/workflows/publish.yml").read_text())
        job = workflow["jobs"]["publish-rust-sdk"]
        self.assertEqual(job["defaults"]["run"]["working-directory"], "sdks/rust")
        steps = job["steps"]
        check = next(step for step in steps if step.get("id") == "check")
        self.assertNotIn("working-directory", check)
        self.assertEqual(check["run"], 'python3 "$GITHUB_WORKSPACE/tools/publish/crates-version-check.py"')
        before, after = steps[:steps.index(check)], steps[steps.index(check) + 1:]
        self.assertTrue(any(s.get("uses") == "actions/setup-python@v5" and s["with"]["python-version"] == "3.12" for s in before))
        self.assertNotIn("secrets.", json.dumps(before + [check]))
        self.assertNotIn("--registry", check["run"])
        self.assertEqual(job.get("permissions", workflow["permissions"]), {"contents": "read"})
        self.assertEqual(len(after), 2)
        for step in after:
            self.assertEqual(step["if"], "steps.check.outputs.skip == 'false'")
        self.assertEqual(after[-1]["run"], "cargo publish")
        self.assertEqual(after[-1]["env"], {"CARGO_REGISTRY_TOKEN": "${{ secrets.CRATES_IO_TOKEN }}"})
        ci = yaml.safe_load((ROOT / ".github/workflows/ci.yml").read_text())
        changes = ci["jobs"]["changes"]["steps"]
        filters = yaml.safe_load(next(step["with"]["filters"] for step in changes if "filters" in step.get("with", {})))
        self.assertIn("sdks/rust/Cargo.toml", filters["publish"])


if __name__ == "__main__":
    unittest.main()
