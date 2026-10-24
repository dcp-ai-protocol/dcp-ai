// The startService harness itself: only a port lost before readiness is retried, within its limits,
// and every rejection comes after the service process is gone.
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { after, before, test } from "node:test";
import { startServiceWithin } from "./helpers.js";

// Records each launch's pid, listens on HELD_PORT (taken) for its first TAKEN launches, then on PORT.
const FIXTURE = `
import fs from "node:fs";
import http from "node:http";
const launch = fs.readFileSync(process.env.LAUNCHES, "utf8").split("\\n").filter(Boolean).length;
fs.appendFileSync(process.env.LAUNCHES, process.pid + "\\n");
if (process.env.IGNORE_TERM) process.on("SIGTERM", () => {});
if (process.env.FAIL) throw new Error(process.env.FAIL);
if (process.env.SILENT) setInterval(() => {}, 1000);
else {
  const port = launch < Number(process.env.TAKEN ?? 0) ? process.env.HELD_PORT : process.env.PORT;
  http.createServer((_req, res) => res.end("ok")).listen(port, () => {
    if (!process.env.SPLIT) return console.log("fixture listening on port " + port);
    process.stdout.write("fixture listen");
    setTimeout(() => console.log("ing on port " + port), 300);
  });
}
`;

let dir;
let script;
let held;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "dcp-helpers-"));
  script = path.join(dir, "fixture.mjs");
  fs.writeFileSync(script, FIXTURE);
  held = net.createServer();
  await new Promise((resolve) => held.listen(0, resolve)); // all interfaces, like the services
});
after(async () => {
  await new Promise((resolve) => held.close(resolve));
  fs.rmSync(dir, { recursive: true, force: true });
});

const run = (name, env, limits = { attempts: 3, deadlineMs: 10_000 }) => {
  const launches = path.join(dir, `${name}.launches`);
  fs.writeFileSync(launches, "");
  const result = startServiceWithin(script, { LAUNCHES: launches, HELD_PORT: String(held.address().port), ...env }, limits);
  const pids = () => fs.readFileSync(launches, "utf8").split("\n").filter(Boolean).map(Number);
  return { result, pids };
};
const gone = (pid) => assert.throws(() => process.kill(pid, 0), { code: "ESRCH" }, `pid ${pid} still running`);
const answers = async ({ base, proc }) => {
  try {
    assert.equal(await (await fetch(base)).text(), "ok");
    assert.equal(proc.listenerCount("close") + proc.listenerCount("error") + proc.stdout.listenerCount("data"), 0);
  } finally {
    const closed = once(proc, "close");
    proc.kill();
    await closed;
  }
};

test("a port taken before readiness is retried on a new port, and the service then answers", async () => {
  const { result, pids } = await run("taken-once", { TAKEN: "1" });
  const service = await result;
  assert.equal(pids().length, 2);
  gone(pids()[0]);
  await answers(service);
});

test("readiness split across stdout chunks is still seen", async () => {
  const { result, pids } = await run("split", { SPLIT: "1" });
  await answers(await result);
  assert.equal(pids().length, 1);
});

test("a port that stays taken fails after the attempts, with the EADDRINUSE in the error", async () => {
  const { result, pids } = await run("taken-always", { TAKEN: "99" });
  await assert.rejects(result, /EADDRINUSE.*port taken on attempt 3 of 3/);
  assert.equal(pids().length, 3);
  pids().forEach(gone);
});

test("any other exit (an invalid configuration) fails at once, never retried", async () => {
  const { result, pids } = await run("invalid", { FAIL: "invalid configuration" });
  await assert.rejects(result, /exited \(1\): Error: invalid configuration/);
  assert.equal(pids().length, 1);
});

test("a service that never reports listening is stopped at the deadline and gone, never retried", async () => {
  const started = performance.now();
  const { result, pids } = await run("silent", { SILENT: "1" }, { attempts: 3, deadlineMs: 600 });
  await assert.rejects(result, /did not report listening before the startup deadline/);
  gone(pids()[0]); // checked as soon as it rejects: no waiting here
  assert.ok(performance.now() - started < 2_000); // SIGTERM was enough
  assert.equal(pids().length, 1);
});

test("one that ignores SIGTERM is killed after the grace, and gone before the rejection", async () => {
  const started = performance.now();
  const { result, pids } = await run("stubborn", { SILENT: "1", IGNORE_TERM: "1" }, { attempts: 3, deadlineMs: 600 });
  await assert.rejects(result, /did not report listening before the startup deadline/);
  gone(pids()[0]);
  const elapsed = performance.now() - started;
  assert.ok(elapsed >= 2_500 && elapsed < 6_000, `${elapsed} ms`); // the 2 s grace, then SIGKILL
  assert.equal(pids().length, 1);
});

test("no process is launched once the deadline is spent", async () => {
  const { result, pids } = await run("spent", {}, { attempts: 3, deadlineMs: 0 });
  await assert.rejects(result, /was not launched: the startup deadline was already spent/);
  assert.equal(pids().length, 0);
});

test("the total deadline also bounds the retries of a port that stays taken", async () => {
  const started = performance.now();
  const { result, pids } = await run("taken-deadline", { TAKEN: "1000" }, { attempts: 1000, deadlineMs: 1_500 });
  await assert.rejects(result, /EADDRINUSE|startup deadline/);
  assert.ok(performance.now() - started < 5_000);
  assert.ok(pids().length > 1 && pids().length < 1000, `${pids().length} launches`);
  pids().forEach(gone);
});
