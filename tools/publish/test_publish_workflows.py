#!/usr/bin/env python3
"""Checks of the three npm publish workflows. They need no publish permission and publish nothing.

    python3 tools/publish/test_publish_workflows.py -v
        Offline: the wiring of publish.yml, publish-integrations.yml and publish-templates.yml, the
        version check against a mock registry, and the real `run:` scripts of the pack step and of the
        tarball check, taken from the workflow files, with negative controls.

    python3 tools/publish/test_publish_workflows.py --rehearse build-anthropic-mcp build-google-a2a ...
        Network (npm install from the registry): runs the guard, install, build and pack steps of the
        named build jobs as written in the workflow, checks the tarball against the package's entry
        points and runs the publish job's tarball check on it. It stops before `npm publish`.

Needs PyYAML, node, npm, bash, tar and sha256sum. A missing tool is an error, never a skip. The only npm
commands these checks run are `npm pack`, `npm pack <tarball> --dry-run` and, in the rehearsal, the
install and build commands of the build jobs. No workflow is triggered and no registry write is attempted.
"""
import hashlib
import http.server
import io
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import unittest

import yaml

ROOT = pathlib.Path(__file__).resolve().parents[2]
WORKFLOWS = ROOT / ".github" / "workflows"
FILES = ("publish.yml", "publish-integrations.yml", "publish-templates.yml")
HELPER = ROOT / "tools" / "publish" / "npm-version-check.mjs"
PRECHECK_RUN = 'node "$GITHUB_WORKSPACE/tools/publish/npm-version-check.mjs"'
CHECK_STEP = "Check the tarball before publishing"
GUARD_STEP = "Refuse a dependency on a local path"
LIFECYCLE = ("prepare", "prepublish", "prepublishOnly", "prepack", "postpack", "publish", "postpublish")

for tool in ("node", "npm", "bash", "tar", "sha256sum"):
    if shutil.which(tool) is None:
        raise RuntimeError(f"{tool} is required for these checks and was not found")


def load(name):
    doc = yaml.safe_load((WORKFLOWS / name).read_text(encoding="utf-8"))
    doc["on"] = doc.pop(True)  # YAML 1.1 reads the key `on` as a boolean
    return doc


DOCS = {name: load(name) for name in FILES}


def all_jobs():
    for name, doc in DOCS.items():
        for job_id, job in doc["jobs"].items():
            yield name, job_id, job


def permissions(name, job):
    return job.get("permissions", DOCS[name]["permissions"])


def holds_oidc(name, job):
    return permissions(name, job).get("id-token") == "write"


def needs(job):
    value = job.get("needs", [])
    return [value] if isinstance(value, str) else value


def step(job, **match):
    found = [s for s in job["steps"] if all(s.get(k) == v for k, v in match.items())]
    assert len(found) == 1, (match, len(found))
    return found[0]


def manifest(job):
    directory = ROOT / job["defaults"]["run"]["working-directory"]
    return directory, json.loads((directory / "package.json").read_text(encoding="utf-8"))


def is_npm(job):
    return any(s.get("id") == "check" and s.get("run") == PRECHECK_RUN for s in job["steps"])


def run(script, cwd, env=None, timeout=600):
    """Runs a step script the way Actions does by default on Linux: `bash -e`."""
    base = {k: v for k, v in os.environ.items() if not k.startswith(("GITHUB_", "RUNNER_", "EXPECTED_"))}
    base.update({"npm_config_update_notifier": "false", "npm_config_fund": "false", "npm_config_audit": "false"})
    base.update(env or {})
    return subprocess.run(
        ["bash", "-e", "-c", script], cwd=cwd, env=base, capture_output=True, text=True, timeout=timeout
    )


class Wiring(unittest.TestCase):
    """What must stay true of the three files for a merge to publish nothing and a run to publish safely."""

    def test_only_a_release_or_a_manual_dispatch_starts_them(self):
        for name, doc in DOCS.items():
            with self.subTest(name):
                self.assertEqual(set(doc["on"]), {"release", "workflow_dispatch"})
                self.assertEqual(doc["on"]["release"], {"types": ["published"]})

    def test_the_default_permission_is_read_only(self):
        for name, doc in DOCS.items():
            self.assertEqual(doc["permissions"], {"contents": "read"}, name)

    def test_the_jobs_are_the_known_ones(self):
        self.assertEqual(
            {name: sorted(doc["jobs"]) for name, doc in DOCS.items()},
            {
                "publish.yml": sorted(
                    ["build-typescript-sdk", "publish-typescript-sdk", "build-wasm-sdk", "publish-wasm-sdk"]
                    + ["build-cli", "publish-cli", "publish-rust-sdk"]
                ),
                "publish-integrations.yml": sorted(
                    [f"{kind}-{p}" for p in ("anthropic-mcp", "google-a2a", "express", "openclaw") for kind in ("build", "publish")]
                    + ["publish-autogen", "publish-w3c-did"]
                ),
                "publish-templates.yml": sorted(f"publish-create-{t}" for t in ("langchain", "crewai", "openai", "express")),
            },
        )

    def test_a_job_with_the_oidc_permission_runs_only_these_commands(self):
        """An allowlist, not a search for known bad commands: no install, no build, no package script."""
        guard = step(DOCS["publish-integrations.yml"]["jobs"]["publish-autogen"], name=GUARD_STEP)["run"]
        check = step(DOCS["publish.yml"]["jobs"]["publish-cli"], name=CHECK_STEP)["run"]
        allowed_runs = {
            PRECHECK_RUN,
            guard,
            check,
            "npm publish --access public --ignore-scripts",
            "npm publish ./pkg/*.tgz --access public --ignore-scripts",
        }
        allowed_actions = {"actions/checkout@v4", "actions/setup-node@v4", "actions/download-artifact@v4"}
        seen = 0
        for name, job_id, job in all_jobs():
            if not holds_oidc(name, job):
                continue
            seen += 1
            with self.subTest(job_id):
                self.assertLessEqual(set(permissions(name, job).items()), {("id-token", "write"), ("contents", "read")})
                for s in job["steps"]:
                    if "uses" in s:
                        self.assertIn(s["uses"], allowed_actions)
                    else:
                        self.assertIn(s["run"], allowed_runs)
                    self.assertNotIn("shell", s)
        self.assertEqual(seen, 13)  # one per npm package

    def test_a_job_that_installs_or_builds_cannot_publish(self):
        for name, job_id, job in all_jobs():
            if not job_id.startswith("build-"):
                continue
            with self.subTest(job_id):
                self.assertEqual(permissions(name, job), {"contents": "read"})
                self.assertNotIn("secrets.", json.dumps(job))
                self.assertEqual(
                    job["outputs"],
                    {
                        "skip": "${{ steps.check.outputs.skip }}",
                        "version": "${{ steps.check.outputs.version }}",
                        "sha256": "${{ steps.pack.outputs.sha256 }}",
                    },
                )

    def test_tokens_reach_only_the_publish_command(self):
        for name, job_id, job in all_jobs():
            for s in job["steps"]:
                text = json.dumps(s)
                if "secrets." not in text:
                    continue
                with self.subTest(job_id):
                    command = s["run"].split()[:2]
                    self.assertIn(command, (["npm", "publish"], ["cargo", "publish"]))
                    expected = (
                        {"NODE_AUTH_TOKEN": "${{ secrets.NPM_TOKEN }}"}
                        if command[0] == "npm"
                        else {"CARGO_REGISTRY_TOKEN": "${{ secrets.CRATES_IO_TOKEN }}"}
                    )
                    self.assertEqual(s["env"], expected)
                    self.assertEqual(text.count("secrets."), 1)

    def test_every_npm_job_asks_the_registry_through_the_checked_script(self):
        for name in FILES:
            text = (WORKFLOWS / name).read_text(encoding="utf-8")
            self.assertNotIn("npm view", text, name)
            self.assertNotIn("|| true", text, name)
        asking = [job_id for _, job_id, job in all_jobs() if is_npm(job)]
        self.assertEqual(len(asking), 13)
        for name, job_id, job in all_jobs():
            if job_id == "publish-rust-sdk" or needs(job)[:1] and needs(job)[0].startswith("build-") and job_id.startswith("publish-"):
                continue
            with self.subTest(job_id):
                self.assertTrue(is_npm(job))
                # Every later step depends on the answer, so a failed check stops the job.
                after = job["steps"][job["steps"].index(step(job, id="check")) + 1 :]
                self.assertTrue(after)
                for s in after:
                    self.assertEqual(s.get("if"), "steps.check.outputs.skip != 'true'")

    def test_a_publish_job_accepts_only_the_tarball_of_its_build_job(self):
        checks = set()
        pairs = 0
        for name, job_id, job in all_jobs():
            build_id = needs(job)[0] if needs(job) else ""
            if not (job_id.startswith("publish-") and build_id.startswith("build-")):
                continue
            pairs += 1
            with self.subTest(job_id):
                build = DOCS[name]["jobs"][build_id]
                _, pkg = manifest(build)
                self.assertEqual(permissions(name, job), {"id-token": "write"})
                self.assertIn(f"needs.{build_id}.result == 'success'", job["if"])
                self.assertIn(f"needs.{build_id}.outputs.skip != 'true'", job["if"])
                kinds = [s.get("uses") or s.get("name") or s["run"] for s in job["steps"]]
                self.assertEqual(
                    kinds,
                    [
                        "actions/download-artifact@v4",
                        "actions/setup-node@v4",
                        CHECK_STEP,
                        "npm publish ./pkg/*.tgz --access public --ignore-scripts",
                    ],
                )
                upload = step(build, uses="actions/upload-artifact@v4")
                self.assertEqual(job["steps"][0]["with"], {"name": upload["with"]["name"], "path": "pkg"})
                self.assertEqual(upload["with"]["path"], "${{ runner.temp }}/pkg/*.tgz")
                self.assertEqual(upload["with"]["if-no-files-found"], "error")
                check = step(job, name=CHECK_STEP)
                self.assertEqual(
                    check["env"],
                    {
                        "EXPECTED_NAME": pkg["name"],
                        "EXPECTED_VERSION": "${{ needs.%s.outputs.version }}" % build_id,
                        "EXPECTED_SHA256": "${{ needs.%s.outputs.sha256 }}" % build_id,
                    },
                )
                self.assertNotIn("${{", check["run"])
                self.assertIn(pkg["name"], job["name"])
                checks.add(check["run"])
        self.assertEqual(pairs, 7)
        self.assertEqual(len(checks), 1)  # one script, tested below

    def test_the_cli_is_published_when_the_sdk_job_is_skipped(self):
        """Without a status function, a skipped ancestor (publish-typescript-sdk) would skip publish-cli."""
        jobs = DOCS["publish.yml"]["jobs"]
        self.assertEqual(jobs["build-cli"]["needs"], ["build-typescript-sdk", "publish-typescript-sdk"])
        self.assertTrue(jobs["build-cli"]["if"].startswith("${{ !cancelled() && !contains(needs.*.result, 'failure') && "))
        self.assertTrue(jobs["publish-cli"]["if"].startswith("${{ !cancelled() && "))
        for name, job_id, job in all_jobs():
            if job_id.startswith("publish-") and job_id != "publish-cli" and needs(job):
                build = DOCS[name]["jobs"][needs(job)[0]]
                self.assertEqual(needs(build), [], f"{job_id} would need a status function too")

    def test_a_package_published_from_the_checkout_needs_no_build(self):
        """anthropic-mcp and google-a2a became built packages while their jobs still published the checkout."""
        from_checkout = 0
        for name, job_id, job in all_jobs():
            if not (is_npm(job) and holds_oidc(name, job)):
                continue
            from_checkout += 1
            with self.subTest(job_id):
                directory, pkg = manifest(job)
                scripts = pkg.get("scripts", {})
                self.assertNotIn("build", scripts)
                self.assertFalse(set(scripts) & set(LIFECYCLE))
                self.assertFalse(pkg.get("dependencies"))
                shipped = list(pkg["files"]) + [pkg[k] for k in ("main", "module", "types") if k in pkg]
                shipped += list(pkg["bin"].values()) if isinstance(pkg.get("bin"), dict) else [pkg["bin"]] if "bin" in pkg else []
                for path in shipped:
                    tracked = subprocess.run(
                        ["git", "ls-files", "--", str((directory / path).relative_to(ROOT))],
                        cwd=ROOT, capture_output=True, text=True, check=True,
                    ).stdout.strip()
                    self.assertTrue(tracked, f"{pkg['name']}: {path} is not in the repository")
        self.assertEqual(from_checkout, 6)

    def test_a_built_package_is_installed_and_built_before_it_is_packed(self):
        packs = set()
        for name, job_id, job in all_jobs():
            if not job_id.startswith("build-"):
                continue
            with self.subTest(job_id):
                _, pkg = manifest(job)
                runs = [s["run"] for s in job["steps"] if "run" in s]
                pack = step(job, id="pack")
                packs.add(pack["run"])
                self.assertEqual(runs[-1], pack["run"])
                self.assertTrue(any(r.startswith(("npm ci", "npm install")) for r in runs[:-1]))
                if "build" in pkg.get("scripts", {}):
                    self.assertIn("npm run build", runs[:-1])
                if "integrations/" in job["defaults"]["run"]["working-directory"]:
                    self.assertEqual(step(job, name=GUARD_STEP)["if"], "steps.check.outputs.skip != 'true'")
        self.assertEqual(len(packs), 1)  # one script, tested below

    def test_every_manual_choice_selects_a_job(self):
        for name, doc in DOCS.items():
            options = doc["on"]["workflow_dispatch"]["inputs"]["package"]["options"]
            conditions = " ".join(job.get("if", "") for job in doc["jobs"].values())
            used = set(re.findall(r"github\.event\.inputs\.package == '([^']+)'", conditions))
            self.assertEqual(used, set(options), name)


class Registry(http.server.BaseHTTPRequestHandler):
    """A registry that answers what the test tells it to, and records what it was asked."""

    answer = (200, "application/json", b"{}", 0.0, None)
    seen = []

    def do_GET(self):  # noqa: N802 (name fixed by http.server)
        status, content_type, body, delay, location = type(self).answer
        type(self).seen.append((self.path, {k.lower(): v for k, v in self.headers.items()}))
        time.sleep(delay)
        try:
            self.send_response(status)
            self.send_header("content-type", content_type)
            self.send_header("content-length", str(len(body)))
            if location:
                self.send_header("location", location)
            self.end_headers()
            self.wfile.write(body)
        except OSError:
            pass  # the client gave up (timeout case)

    def log_message(self, *args):
        pass


class VersionCheck(unittest.TestCase):
    """tools/publish/npm-version-check.mjs: only an unequivocal registry answer lets a job go on."""

    NAME, VERSION = "@dcp-ai/probe", "1.2.3"

    @classmethod
    def setUpClass(cls):
        cls.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Registry)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.url = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def ask(self, answer=None, package=None, registry=None, output=True, timeout_ms="3000", args=None):
        Registry.answer = answer or Registry.answer
        Registry.seen = []
        with tempfile.TemporaryDirectory() as tmp:
            pkg = {"name": self.NAME, "version": self.VERSION} if package is None else package
            pathlib.Path(tmp, "package.json").write_text(pkg if isinstance(pkg, str) else json.dumps(pkg))
            out = pathlib.Path(tmp, "github_output")
            out.write_text("")
            env = {k: v for k, v in os.environ.items() if k != "GITHUB_OUTPUT"}
            # Canaries: the check must not send a credential to the registry.
            env.update({"NODE_AUTH_TOKEN": "canary-node-auth-token", "NPM_TOKEN": "canary-npm-token"})
            if output:
                env["GITHUB_OUTPUT"] = str(out)
            argv = ["node", str(HELPER)] + (args if args is not None else ["--registry", registry or self.url, "--timeout-ms", timeout_ms])
            proc = subprocess.run(argv, cwd=tmp, env=env, capture_output=True, text=True, timeout=60)
            return proc, out.read_text(), list(Registry.seen)

    def json_answer(self, status, value, delay=0.0):
        return (status, "application/json", json.dumps(value).encode(), delay, None)

    def test_a_published_version_is_skipped(self):
        proc, out, seen = self.ask(self.json_answer(200, {"name": self.NAME, "version": self.VERSION, "dist": {}}))
        self.assertEqual((proc.returncode, out), (0, "version=1.2.3\nskip=true\n"), proc.stderr)
        self.assertEqual([path for path, _ in seen], ["/@dcp-ai%2Fprobe/1.2.3"])
        self.assertNotIn("authorization", seen[0][1])
        self.assertNotIn("canary", json.dumps(seen))

    def test_an_absent_version_or_package_goes_on(self):
        for body in ("version not found: 1.2.3", "Not Found"):  # what registry.npmjs.org answers
            with self.subTest(body):
                proc, out, _ = self.ask(self.json_answer(404, body))
                self.assertEqual((proc.returncode, out), (0, "version=1.2.3\nskip=false\n"), proc.stderr)

    def test_anything_else_fails_closed(self):
        html = (404, "text/html", b"<html><body>Not Found</body></html>", 0.0, None)
        cases = {
            "401": self.json_answer(401, {"error": "unauthorized"}),
            "403": self.json_answer(403, {"error": "forbidden"}),
            "429": self.json_answer(429, {"error": "rate limited"}),
            "500": self.json_answer(500, {"error": "internal"}),
            "502": (502, "text/html", b"<html>Bad Gateway</html>", 0.0, None),
            "503": self.json_answer(503, {"error": "unavailable"}),
            "404 that is not JSON": html,
            "200 that is not JSON": (200, "application/json", b"{not json", 0.0, None),
            "200 empty": (200, "application/json", b"", 0.0, None),
            "200 JSON string": self.json_answer(200, "ok"),
            "200 JSON array": self.json_answer(200, [{"name": self.NAME, "version": self.VERSION}]),
            "200 null": self.json_answer(200, None),
            "200 other version": self.json_answer(200, {"name": self.NAME, "version": "1.2.4"}),
            "200 other name": self.json_answer(200, {"name": "@dcp-ai/other", "version": self.VERSION}),
            "200 no version": self.json_answer(200, {"name": self.NAME}),
            "redirect": (302, "application/json", b"{}", 0.0, "/elsewhere"),
            "204": (204, "application/json", b"", 0.0, None),
        }
        for label, answer in cases.items():
            with self.subTest(label):
                proc, out, seen = self.ask(answer)
                self.assertEqual((proc.returncode, out), (1, ""), proc.stdout + proc.stderr)
                self.assertIn("::error::", proc.stderr)
                self.assertEqual(len(seen), 1)

    def test_no_answer_fails_closed(self):
        # Nothing listens on this port: bind one, read its number, close it.
        free = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Registry)
        port = free.server_address[1]
        free.server_close()
        proc, out, _ = self.ask(registry=f"http://127.0.0.1:{port}")
        self.assertEqual((proc.returncode, out), (1, ""), proc.stdout + proc.stderr)
        self.assertIn("no answer from the registry", proc.stderr)

    def test_a_timeout_fails_closed(self):
        slow = self.json_answer(200, {"name": self.NAME, "version": self.VERSION}, delay=2.0)
        proc, out, _ = self.ask(slow, timeout_ms="300")
        self.assertEqual((proc.returncode, out), (1, ""), proc.stdout + proc.stderr)
        self.assertIn("no answer from the registry", proc.stderr)

    def test_an_unusable_manifest_fails_before_asking(self):
        bad = {
            "not JSON": "{",
            "no version": {"name": self.NAME},
            "no name": {"version": self.VERSION},
            "version with a path": {"name": self.NAME, "version": "1.2.3/../../x"},
            "version range": {"name": self.NAME, "version": "^1.2.3"},
            "name with a path": {"name": "@dcp-ai/probe/../x", "version": self.VERSION},
            "name with a query": {"name": "probe?x=1", "version": self.VERSION},
        }
        for label, package in bad.items():
            with self.subTest(label):
                proc, out, seen = self.ask(package=package)
                self.assertEqual((proc.returncode, out, seen), (1, "", []), proc.stdout + proc.stderr)

    def test_without_an_output_file_it_fails(self):
        proc, out, seen = self.ask(output=False)
        self.assertEqual((proc.returncode, out, seen), (1, "", []), proc.stderr)

    def test_unknown_arguments_fail(self):
        for args in (["--registry"], ["--registry", "ftp://x"], ["--timeout-ms", "0"], ["--force"], ["x", "y"]):
            with self.subTest(args):
                proc, out, seen = self.ask(args=args)
                self.assertEqual((proc.returncode, out, seen), (1, "", []), proc.stderr)

    def test_the_workflows_use_the_real_registry(self):
        self.assertIn("const DEFAULT_REGISTRY = 'https://registry.npmjs.org';", HELPER.read_text())
        self.assertNotIn("process.env.npm", HELPER.read_text().replace("process.env.GITHUB_OUTPUT", ""))
        for name in FILES:
            self.assertNotIn("--registry", (WORKFLOWS / name).read_text(), name)


def pack(directory, name, version, destination):
    """A real tarball of a two-file package, made by npm without the network."""
    source = pathlib.Path(directory)
    source.mkdir(parents=True)
    (source / "package.json").write_text(json.dumps({"name": name, "version": version, "main": "index.js"}))
    (source / "index.js").write_text("module.exports = 1;\n")
    pathlib.Path(destination).mkdir(parents=True, exist_ok=True)
    done = run(f'npm pack --pack-destination "{destination}"', source, OFFLINE)
    assert done.returncode == 0, done.stderr
    (found,) = pathlib.Path(destination).glob("*.tgz")
    return found


def sha256(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()


OFFLINE = {"npm_config_offline": "true"}


class TarballCheck(unittest.TestCase):
    """The `run:` script of "Check the tarball before publishing", as written in the workflow."""

    SCRIPT = step(DOCS["publish.yml"]["jobs"]["publish-cli"], name=CHECK_STEP)["run"]
    NAME, VERSION = "@dcp-ai/anthropic-mcp", "9.9.9"

    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        root = pathlib.Path(cls.tmp.name)
        cls.root = root
        cls.good = pack(root / "src-good", cls.NAME, cls.VERSION, root / "good")
        cls.sibling = pack(root / "src-sibling", "@dcp-ai/google-a2a", cls.VERSION, root / "sibling")
        cls.older = pack(root / "src-older", cls.NAME, "9.9.8", root / "older")
        # package/package.json carries the expected name and a second top-level folder overrides it.
        cls.crafted = root / "crafted.tgz"
        with tarfile.open(cls.crafted, "w:gz") as tar:
            for member, text in (
                ("package/package.json", json.dumps({"name": cls.NAME, "version": cls.VERSION})),
                ("package/index.js", "module.exports = 1;\n"),
                ("zzz/package.json", json.dumps({"name": "@dcp-ai/google-a2a", "version": cls.VERSION})),
            ):
                data = text.encode()
                info = tarfile.TarInfo(member)
                info.size = len(data)
                tar.addfile(info, io.BytesIO(data))

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def check(self, label, files, name=None, version=None, digest=None):
        case = self.root / f"case-{label}"
        (case / "pkg").mkdir(parents=True)
        for source, target in files:
            shutil.copy(source, case / "pkg" / target)
        env = dict(OFFLINE)
        env.update({
            "EXPECTED_NAME": self.NAME if name is None else name,
            "EXPECTED_VERSION": self.VERSION if version is None else version,
            "EXPECTED_SHA256": sha256(self.good) if digest is None else digest,
        })
        done = run(self.SCRIPT, case, env)
        errors = re.findall(r"::error::(.*)", done.stdout)
        return done.returncode, (errors[0] if errors else ""), case

    def test_the_tarball_of_the_build_job_passes(self):
        code, error, _ = self.check("good", [(self.good, self.good.name)])
        self.assertEqual((code, error), (0, ""))

    def test_a_sibling_package_is_refused_even_with_its_own_hash(self):
        code, error, _ = self.check("sibling", [(self.sibling, self.sibling.name)], digest=sha256(self.sibling))
        self.assertEqual((code, error), (1, f"the tarball is @dcp-ai/google-a2a@9.9.9, not {self.NAME}@9.9.9"))

    def test_another_version_is_refused_even_with_its_own_hash(self):
        code, error, _ = self.check("older", [(self.older, self.older.name)], digest=sha256(self.older))
        self.assertEqual((code, error), (1, f"the tarball is {self.NAME}@9.9.8, not {self.NAME}@9.9.9"))

    def test_a_replaced_artifact_is_refused(self):
        code, error, _ = self.check("replaced", [(self.sibling, self.good.name)])
        self.assertEqual((code, error), (1, "the tarball is not the one the build job packed"))

    def test_a_second_manifest_does_not_hide_the_name(self):
        with tarfile.open(self.crafted) as tar:
            inner = json.load(tar.extractfile("package/package.json"))
        self.assertEqual(inner["name"], self.NAME)  # what reading package/package.json alone would accept
        code, error, _ = self.check("crafted", [(self.crafted, "crafted.tgz")], digest=sha256(self.crafted))
        self.assertEqual((code, error), (1, f"the tarball is @dcp-ai/google-a2a@9.9.9, not {self.NAME}@9.9.9"))

    def test_two_tarballs_are_refused(self):
        code, error, _ = self.check("two", [(self.good, self.good.name), (self.sibling, self.sibling.name)])
        self.assertEqual((code, error), (1, "expected one tarball, found 2"))

    def test_no_tarball_is_refused(self):
        code, error, _ = self.check("none", [])
        self.assertNotEqual(code, 0)

    def test_a_truncated_tarball_is_refused(self):
        cut = self.root / "cut.tgz"
        cut.write_bytes(self.good.read_bytes()[:120])
        code, error, _ = self.check("cut", [(cut, "cut.tgz")], digest=sha256(cut))
        self.assertNotEqual(code, 0)

    def test_a_missing_or_malformed_hash_is_refused(self):
        for label, digest in (("empty", ""), ("upper", sha256(self.good).upper()), ("short", sha256(self.good)[:63])):
            with self.subTest(label):
                code, error, _ = self.check(f"hash-{label}", [(self.good, self.good.name)], digest=digest)
                self.assertEqual((code, error), (1, "the build job reported no SHA-256"))

    def test_a_missing_or_malformed_version_is_refused(self):
        for label, version in (("empty", ""), ("range", "^9.9.9"), ("latest", "latest")):
            with self.subTest(label):
                code, error, _ = self.check(f"version-{label}", [(self.good, self.good.name)], version=version)
                self.assertEqual((code, error), (1, "the build job reported no version"))

    def test_the_expected_values_are_compared_and_never_evaluated(self):
        for label, field in (("hash", "digest"), ("version", "version"), ("name", "name")):
            with self.subTest(label):
                code, _, case = self.check(f"inject-{label}", [(self.good, self.good.name)], **{field: "$(touch pwned)`touch pwned`"})
                self.assertEqual(code, 1)
                self.assertFalse((case / "pwned").exists())


class PackStep(unittest.TestCase):
    """The `run:` script of "Pack the tarball", as written in the workflow."""

    SCRIPT = step(DOCS["publish.yml"]["jobs"]["build-cli"], id="pack")["run"]

    def pack_with(self, script):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        root = pathlib.Path(tmp.name)
        source = root / "src"
        source.mkdir()
        (source / "package.json").write_text(json.dumps({"name": "@dcp-ai/probe", "version": "1.2.3"}))
        output = root / "github_output"
        output.write_text("")
        env = dict(OFFLINE, RUNNER_TEMP=str(root / "runner-temp"), GITHUB_OUTPUT=str(output))
        (root / "runner-temp").mkdir()  # the runner provides RUNNER_TEMP, not RUNNER_TEMP/pkg
        return run(script, source, env), root / "runner-temp" / "pkg", output.read_text()

    def test_it_creates_the_destination_and_reports_the_hash(self):
        done, destination, output = self.pack_with(self.SCRIPT)
        self.assertEqual(done.returncode, 0, done.stderr)
        (tarball,) = destination.glob("*.tgz")
        self.assertEqual(output, f"sha256={sha256(tarball)}\n")

    def test_without_the_mkdir_npm_fails(self):
        """The control for the line above. If it fails, npm now creates the destination: the mkdir line of
        the step is then harmless, and this control has to be rewritten, not deleted."""
        self.assertIn('mkdir -p "$RUNNER_TEMP/pkg"\n', self.SCRIPT)
        done, destination, output = self.pack_with(self.SCRIPT.replace('mkdir -p "$RUNNER_TEMP/pkg"\n', ""))
        self.assertNotEqual(done.returncode, 0)
        self.assertIn("ENOENT", done.stderr)
        self.assertEqual(output, "")


def entry_points(pkg):
    """Every file the manifest promises to a consumer: main, module, types, bin and the exports map."""
    found = [pkg[k] for k in ("main", "module", "types", "typings") if isinstance(pkg.get(k), str)]
    found += list(pkg["bin"].values()) if isinstance(pkg.get("bin"), dict) else [pkg["bin"]] if "bin" in pkg else []
    pending = [pkg.get("exports")]
    while pending:
        node = pending.pop()
        if isinstance(node, str):
            found.append(node)
        elif isinstance(node, dict):
            pending.extend(node.values())
    return sorted({os.path.normpath(p) for p in found})


def rehearse(job_ids):
    """Runs the named build jobs as written, up to the tarball the publish job would accept. Returns the failures."""
    failures = []
    for job_id in job_ids:
        name = next((n for n, doc in DOCS.items() if job_id in doc["jobs"]), None)
        if name is None or not job_id.startswith("build-"):
            failures.append(f"{job_id}: not a build job of the publish workflows")
            continue
        jobs = DOCS[name]["jobs"]
        job = jobs[job_id]
        (publish,) = [j for i, j in jobs.items() if i.startswith("publish-") and needs(j) == [job_id]]
        check = step(publish, name=CHECK_STEP)
        directory, pkg = manifest(job)
        print(f"== {job_id}: {pkg['name']}@{pkg['version']} in {directory.relative_to(ROOT)}", flush=True)
        with tempfile.TemporaryDirectory() as tmp:
            output = pathlib.Path(tmp, "github_output")
            output.write_text("")
            runner_temp = pathlib.Path(tmp, "runner-temp")
            runner_temp.mkdir()
            env = {"RUNNER_TEMP": str(runner_temp), "GITHUB_OUTPUT": str(output), "GITHUB_WORKSPACE": str(ROOT)}
            problems = []
            for s in job["steps"]:
                if "run" not in s or s.get("id") == "check":
                    continue  # actions, and the registry answer (the mock registry tests cover it)
                done = run(s["run"], ROOT / s.get("working-directory", job["defaults"]["run"]["working-directory"]), env, 1800)
                print(f"   {s.get('name') or s['run'].splitlines()[0]}: exit {done.returncode}", flush=True)
                if done.returncode != 0:
                    problems.append(f"step failed: {s.get('name') or s['run']}\n{done.stdout[-1500:]}\n{done.stderr[-1500:]}")
                    break
            tarballs = sorted((runner_temp / "pkg").glob("*.tgz")) if not problems else []
            if not problems and len(tarballs) != 1:
                problems.append(f"expected one tarball, found {len(tarballs)}")
            if not problems:
                tarball = tarballs[0]
                digest = sha256(tarball)
                if output.read_text() != f"sha256={digest}\n":
                    problems.append(f"the pack step reported {output.read_text()!r}, the file is {digest}")
                with tarfile.open(tarball) as tar:
                    members = sorted(m.name for m in tar.getmembers() if m.isfile())
                    inner = json.load(tar.extractfile("package/package.json"))
                if (inner["name"], inner["version"]) != (pkg["name"], pkg["version"]):
                    problems.append(f"the tarball is {inner['name']}@{inner['version']}")
                for path in entry_points(pkg):
                    if f"package/{path}" not in members:
                        problems.append(f"entry point missing from the tarball: {path}")
                allowed = tuple(f"package/{f.rstrip('/')}" for f in pkg.get("files", []))
                for member in members:
                    base = member.split("/", 1)[1]
                    if not (member.startswith(allowed) or re.match(r"(package\.json|README|LICEN[SC]E|CHANGELOG)", base, re.I)):
                        problems.append(f"file outside the manifest's `files`: {member}")
                print(f"   tarball {tarball.name}: {len(members)} files, sha256 {digest}", flush=True)
                print(f"   entry points: {', '.join(entry_points(pkg))}", flush=True)
                case = pathlib.Path(tmp, "publish-job")
                (case / "pkg").mkdir(parents=True)
                shutil.copy(tarball, case / "pkg" / tarball.name)
                expected = {"EXPECTED_NAME": check["env"]["EXPECTED_NAME"], "EXPECTED_VERSION": pkg["version"], "EXPECTED_SHA256": digest}
                accepted = run(check["run"], case, dict(OFFLINE, **expected))
                print(f"   {CHECK_STEP}: exit {accepted.returncode}", flush=True)
                if accepted.returncode != 0:
                    problems.append(f"the publish job would refuse this tarball: {accepted.stdout[-500:]}{accepted.stderr[-500:]}")
                refused = run(check["run"], case, dict(OFFLINE, **dict(expected, EXPECTED_NAME="@dcp-ai/another-package")))
                print(f"   the same check for another package name (control): exit {refused.returncode}", flush=True)
                if refused.returncode == 0:
                    problems.append("the tarball check accepted the tarball under another package name")
            print(f"   {'PASS' if not problems else 'FAIL'}", flush=True)
            failures += [f"{job_id}: {p}" for p in problems]
    for failure in failures:
        print(f"FAIL {failure}")
    print(f"rehearsed {len(job_ids)} build job(s), {len(failures)} problem(s); nothing was published")
    return failures


if __name__ == "__main__":
    if sys.argv[1:2] == ["--rehearse"]:
        if len(sys.argv) < 3:
            sys.exit("usage: test_publish_workflows.py --rehearse <build job>...")
        sys.exit(1 if rehearse(sys.argv[2:]) else 0)
    unittest.main()
