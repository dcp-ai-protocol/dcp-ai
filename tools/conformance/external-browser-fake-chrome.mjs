// A stand-in for Chrome in the cleanup self-tests of external-browser.test.mjs, never a conformance result: it answers
// as a correct page would, then leaves the temporary profile in the state its mode names, so that the wrapper's cleanup
// is tested deterministically. The test starts it through a small executable shim given to the wrapper as --chrome.
//
//   node external-browser-fake-chrome.mjs <mode> <pids-file> [the wrapper's Chrome arguments...]
//
//   lingering  a child in this process group keeps writing into the profile after the main process exits, and a
//              process that left the group (detached) sleeps; their pids go to <pids-file>
//   locked     the profile holds a directory without write permission, so that removing it fails (EACCES)
import fs from "fs";
import path from "path";
import http from "http";
import crypto from "crypto";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

const SELF = fileURLToPath(import.meta.url);
const [mode, target, ...args] = process.argv.slice(2);

if (mode === "--writer") {
  // Bounded, so that a run that does not stop it cannot leave it running for long.
  let i = 0;
  setInterval(() => { try { fs.writeFileSync(path.join(target, `late-${i++}`), "x"); } catch { /* the profile is gone */ } }, 2);
  setTimeout(() => process.exit(0), 20000);
} else if (mode === "--sleeper") {
  setTimeout(() => {}, 20000);
} else if (args.includes("--version")) {
  process.stdout.write("FakeChrome 0 (cleanup self-test)\n");
} else {
  const profile = args.find((a) => a.startsWith("--user-data-dir=")).slice("--user-data-dir=".length);
  const url = new URL(args.at(-1));
  const call = (rel, body) => new Promise((resolve, reject) => {
    const headers = body ? { origin: url.origin, "content-type": "application/json" } : {};
    const req = http.request(new URL(rel, url), { method: body ? "POST" : "GET", headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", reject);
    req.end(body);
  });
  const request = JSON.parse(await call("request"));
  const received = {};
  for (const rel of request.assets) received[rel] = crypto.createHash("sha256").update(await call(rel)).digest("hex");
  const api = JSON.parse(fs.readFileSync(path.join(path.dirname(SELF), "wrappers", "browser", "expected-api.json"), "utf8"));

  if (mode === "lingering") {
    const writer = spawn(process.execPath, [SELF, "--writer", profile], { stdio: "ignore" });
    const sleeper = spawn(process.execPath, [SELF, "--sleeper"], { stdio: "ignore", detached: true });
    writer.unref();
    sleeper.unref();
    fs.writeFileSync(target, JSON.stringify({ writer: writer.pid, sleeper: sleeper.pid }));
  } else if (mode === "locked") {
    const locked = path.join(profile, "locked");
    fs.mkdirSync(locked);
    fs.writeFileSync(path.join(locked, "file"), "x");
    fs.chmodSync(locked, 0o555);
  } else throw new Error(`unknown mode ${mode}`);

  // No verify_signed_bundle_v2 case reaches this stand-in, so the clock shim reports no call.
  await call("result", JSON.stringify({
    run_id: request.run_id, nonce: request.nonce, terminal: "done", error: null,
    environment: { user_agent: "FakeChrome (cleanup self-test)", node_absent: true, secure_context: true },
    api, received_sha256: received,
    clock: { calls: 0, not_called: [], restored_every_time: true, now_after: Date.now() },
    results: request.cases.map((c) => ({ id: c.id, status: "unsupported" })),
  }));
  setInterval(() => {}, 1000); // like Chrome, it stays until it is signalled
}
