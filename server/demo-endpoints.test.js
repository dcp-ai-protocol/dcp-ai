// The DCP-05–09 demo endpoints of the reference server (server/demo-gate.js): off by default, an explicit
// opt-in that needs a usable operator token, and on every request under their twelve families a gate that runs
// before the body is read or a store is touched. Real server processes on free ports, with deadlines.
//   node --test server/demo-endpoints.test.js
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { startService } from "../tests/helpers.js";
import { DEMO_FAMILIES } from "./demo-gate.js";

const SERVER = fileURLToPath(new URL("./index.js", import.meta.url));
const SOURCE = fs.readFileSync(SERVER, "utf8");
const example = (name) => JSON.parse(fs.readFileSync(new URL(`../tests/conformance/examples/${name}_v2.json`, import.meta.url), "utf8"));
// A token generated for this run only; it is never printed.
const TOKEN = crypto.randomBytes(32).toString("hex");
// The environment of a server whose demo setting comes only from `env` (nothing inherited from the shell).
const clean = (env) => ({ DCP_DEMO_ENDPOINTS: undefined, OPERATOR_TOKEN: undefined, ...env });
const OFF = clean({});
const ON = clean({ DCP_DEMO_ENDPOINTS: "dcp-05-09", OPERATOR_TOKEN: TOKEN });
// Every child this file starts; after() waits for each to exit, with SIGKILL as a bounded fallback.
const procs = [];
const exited = (p) => p.exitCode !== null || p.signalCode !== null;
after(async () => {
  // A child whose spawn failed has no pid and never emits exit: it is skipped.
  await Promise.all(procs.map((p) => (p.pid === undefined || exited(p) ? null : new Promise((resolve) => {
    const kill = setTimeout(() => p.kill("SIGKILL"), 2000);
    p.once("exit", () => { clearTimeout(kill); resolve(); });
    p.kill("SIGTERM");
  }))));
});
async function serve(env) {
  const s = await startService(SERVER, env);
  procs.push(s.proc);
  return s.base;
}

const AGENT = "agent:research-bot-v2-001";
const DISPUTE = example("dispute_record").dispute_id;
const MANDATE = example("delegation_mandate").mandate_id;
const ADVISORY = example("advisory_declaration").declaration_id;
// The 31 routes: method, a concrete target each handler accepts, and the body it reads (if any).
const ROUTES = [
  ["POST", "/v2/lifecycle/commission", { commissioning_certificate: example("commissioning_certificate") }],
  ["POST", "/v2/lifecycle/vitality", { vitality_report: example("vitality_report") }],
  ["POST", "/v2/lifecycle/decommission", { decommissioning_record: example("decommissioning_record") }],
  ["GET", `/v2/lifecycle/${AGENT}`],
  ["POST", "/v2/succession/testament", { digital_testament: example("digital_testament") }],
  ["GET", `/v2/succession/testament/${AGENT}`],
  ["POST", "/v2/succession/execute", { succession_record: example("succession_record") }],
  ["POST", "/v2/succession/memory-transfer", { memory_transfer_manifest: example("memory_transfer_manifest") }],
  ["GET", `/v2/succession/${AGENT}`],
  ["POST", "/v2/disputes/create", { dispute_record: example("dispute_record") }],
  ["POST", `/v2/disputes/${DISPUTE}/escalate`, {}],
  ["POST", `/v2/disputes/${DISPUTE}/resolve`, { arbitration_resolution: example("arbitration_resolution") }],
  ["GET", `/v2/disputes/${DISPUTE}`],
  ["POST", "/v2/objections/create", { objection_record: example("objection_record") }],
  ["GET", "/v2/jurisprudence"],
  ["POST", "/v2/jurisprudence", { jurisprudence_bundle: example("jurisprudence_bundle") }],
  ["POST", "/v2/rights/declare", { rights_declaration: example("rights_declaration") }],
  ["GET", `/v2/rights/${AGENT}`],
  ["POST", "/v2/obligations/record", { obligation_record: example("obligation_record") }],
  ["GET", `/v2/obligations/${AGENT}`],
  ["POST", "/v2/rights/violation", { violation_report: example("rights_violation_report") }],
  ["POST", "/v2/delegation/mandate", { delegation_mandate: example("delegation_mandate") }],
  ["GET", `/v2/delegation/mandate/${MANDATE}`],
  ["POST", `/v2/delegation/mandate/${MANDATE}/revoke`, {}],
  ["POST", "/v2/agent-advisory/declare", { advisory_declaration: example("advisory_declaration") }],
  ["GET", `/v2/agent-advisory/${ADVISORY}`],
  ["POST", "/v2/mirror/generate", { principal_mirror: example("principal_mirror") }],
  ["GET", `/v2/mirror/${AGENT}`],
  ["POST", "/v2/interactions/record", { interaction_record: example("interaction_record") }],
  ["POST", "/v2/awareness/threshold", { awareness_threshold: example("awareness_threshold") }],
  ["GET", `/v2/awareness/threshold/${AGENT}`],
].map(([method, target, body]) => ({ method, target, body }));

// One request on its own socket, written as given (the target is sent raw); the client never closes it. Settles
// once: when the peer closes the socket (closedByPeer, with the time), or at the deadline (timedOut; the socket is
// then destroyed here). A reset is recorded (reset): a server that answers before reading a body and closes the
// connection can make the kernel reset it once the rest of the body arrives. Whether the response arrived whole is
// `complete`, from its own framing; a reset counts only after a complete response (see gated()).
function raw(base, { method, target, headers = {}, body, declaredLength, deadlineMs = 5000 }) {
  const port = Number(new URL(base).port);
  return new Promise((resolve) => {
    const sock = net.connect(port, "127.0.0.1");
    const t0 = performance.now();
    let buf = Buffer.alloc(0);
    let reset = null;
    let settled = false;
    const settle = (timedOut) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const closedMs = timedOut ? null : performance.now() - t0;
      sock.destroy();
      resolve({ timedOut, closedByPeer: !timedOut, closedMs, reset, ...parse(buf, method, !timedOut && reset === null) });
    };
    const timer = setTimeout(() => settle(true), deadlineMs);
    sock.on("connect", () => {
      const payload = body === undefined ? null : Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
      const h = { Host: `127.0.0.1:${port}`, ...headers };
      if (payload) { h["Content-Type"] ??= "application/json"; h["Content-Length"] = String(declaredLength ?? payload.length); }
      sock.write(`${method} ${target} HTTP/1.1\r\n${Object.entries(h).map(([k, v]) => `${k}: ${v}\r\n`).join("")}\r\n`);
      if (payload) sock.write(payload);
    });
    sock.on("data", (d) => { buf = Buffer.concat([buf, d]); });
    sock.on("error", (e) => { reset = e.code; });
    sock.on("close", () => settle(false));
  });
}
// The response in `buf` and whether it is complete by its own framing: HEAD, 204 and 304 end with the headers; a
// chunked body needs its last chunk (size 0) and the final CRLF; a Content-Length body needs exactly that many
// bytes; a body with neither ends at a clean close by the server (`cleanClose`). Anything else is incomplete.
function parse(buf, method, cleanClose) {
  const end = buf.indexOf("\r\n\r\n");
  if (end < 0) return { status: null, headers: {}, text: "", complete: false };
  const [line, ...rest] = buf.subarray(0, end).toString("latin1").split("\r\n");
  const headers = Object.fromEntries(rest.map((l) => [l.slice(0, l.indexOf(":")).toLowerCase(), l.slice(l.indexOf(":") + 1).trim()]));
  const status = Number(line.split(" ")[1]);
  let bytes = buf.subarray(end + 4);
  let complete;
  if (method === "HEAD" || status === 204 || status === 304) complete = true;
  else if (/chunked/i.test(headers["transfer-encoding"] ?? "")) {
    const out = [];
    complete = false;
    for (let i = 0; ;) {
      const eol = bytes.indexOf("\r\n", i);
      if (eol < 0) break;
      const size = parseInt(bytes.subarray(i, eol).toString("latin1"), 16);
      if (!Number.isInteger(size) || size < 0) break;
      if (size === 0) { complete = bytes.subarray(eol + 2, eol + 4).toString("latin1") === "\r\n"; break; }
      if (bytes.length < eol + 2 + size + 2) break;
      out.push(bytes.subarray(eol + 2, eol + 2 + size));
      i = eol + 2 + size + 2;
    }
    bytes = Buffer.concat(out);
  } else if (headers["content-length"] !== undefined) {
    const n = Number(headers["content-length"]);
    complete = Number.isInteger(n) && bytes.length === n;
  } else complete = cleanClose;
  return { status, headers, text: method === "HEAD" ? "" : bytes.toString("utf8"), complete };
}
// A gate answer: the expected status in a complete response, and the server itself closing the connection before
// the deadline. A reset is accepted only after the complete response (it comes from the body the gate never read).
function gated(r, status, what) {
  assert.equal(r.timedOut, false, `${what}: the server did not close the connection before the deadline`);
  assert.equal(r.complete, true, `${what}: incomplete response (status ${r.status}, reset ${r.reset})`);
  assert.equal(r.status, status, what);
  assert.equal(r.headers.connection, "close", what);
}
const bearer = { Authorization: `Bearer ${TOKEN}` };
const call = (base, route, headers = {}) => raw(base, { method: route.method, target: route.target, headers, body: route.body });
const authed = (base, method, path, body) => fetch(new URL(path, base), { method, headers: { ...bearer, ...(body === undefined ? {} : { "Content-Type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });

test("the harness: a response counts only when complete by its own framing", () => {
  const r = (s) => Buffer.from(s, "latin1");
  const head = "HTTP/1.1 404 Not Found\r\nConnection: close\r\n";
  assert.equal(parse(r(`${head}Content-Length: 21\r\n\r\n{"error":"Not found"}`), "GET", false).complete, true);
  assert.equal(parse(r(`${head}Content-Length: 21\r\n\r\n{"error":"Not fo`), "GET", true).complete, false, "short Content-Length body");
  assert.equal(parse(r(`${head}Transfer-Encoding: chunked\r\n\r\n15\r\n{"error":"Not found"}\r\n0\r\n\r\n`), "GET", false).complete, true);
  assert.equal(parse(r(`${head}Transfer-Encoding: chunked\r\n\r\n15\r\n{"error":"Not found"}\r\n`), "GET", true).complete, false, "no last chunk");
  assert.equal(parse(r(`${head}Transfer-Encoding: chunked\r\n\r\n15\r\n{"error":"Not`), "GET", true).complete, false, "cut inside a chunk");
  assert.equal(parse(r(`${head}Content-Length: 21\r\n\r\n`), "HEAD", false).complete, true, "HEAD has no body");
  assert.equal(parse(r(`${head}\r\n{"error":"x"}`), "GET", false).complete, false, "no length and no clean close");
  assert.equal(parse(r(`${head}\r\n{"error":"x"}`), "GET", true).complete, true, "no length, clean close");
  assert.equal(parse(r("HTTP/1.1 401 Unauthor"), "GET", true).complete, false, "headers cut");
});

// ── The gate against the router: whatever a handler accepts, the gate sees ──

const block = SOURCE.slice(SOURCE.indexOf("// DCP-05: Agent Lifecycle Endpoints"), SOURCE.indexOf("// Anchor stub"));
const conditions = [...block.matchAll(/^\s*if \((req\.method === "(?:GET|POST)" && .*)\) \{$/gm)].map((m) => m[1]);
// The handlers' own conditions, evaluated on {method, url} (the server's source, read from this checkout).
const handlers = conditions.map((c) => new Function("req", `return Boolean(${c});`));

test("the 31 handlers are the 31 routes of the table, one each", () => {
  assert.equal(conditions.length, 31);
  const served = ROUTES.map((r) => handlers.findIndex((h) => h({ method: r.method, url: r.target })));
  assert.ok(served.every((i) => i >= 0), "every route reaches a handler");
  assert.deepEqual([...served].sort((a, b) => a - b), [...Array(31).keys()], "each handler serves exactly one route of the table");
});

test("sampled raw targets: every variant a handler accepts, under any method, is under the gate (not an exhaustive proof)", () => {
  const variants = (t) => {
    const last = t.slice(t.lastIndexOf("/") + 1);
    return [t, `${t}?q=1`, `${t}/`, `${t}/x`, `${t}#f`, `${t}%2Fx`, `${t}%00`, `${t}%20`, t.slice(0, t.lastIndexOf("/") + 1), t.replace(last, "%E0"),
      t.replace(last, "a%2Fb"), t.replace(last, "..%2F..%2Fhealth"), `${t}/../../health`, `/${t}`, t.replace("/v2/", "/v2//"), t.toUpperCase(),
      t.replace("/v2/", "/V2/"), `http://h${t}`, `${t.slice(0, -1)}%${t.at(-1).charCodeAt(0).toString(16)}`];
  };
  let accepted = 0;
  for (const r of ROUTES) for (const url of variants(r.target)) for (const method of ["GET", "POST", "PUT", "DELETE", "HEAD", "OPTIONS", "PATCH"]) {
    if (handlers.some((h) => h({ method, url }))) { accepted++; assert.ok(DEMO_FAMILIES.test(url), `${method} ${url} reaches a handler outside the gate`); }
  }
  assert.ok(accepted > 31, `variants are accepted beyond the table (${accepted})`);
});

test("the demo handlers touch no core store (a source check; the store is not exposed to observe)", () => {
  for (const n of ["passportRegistry", "keyRegistry", "agentKids", "keyCounts", "retiredKids", "auditChains", "emergencyTokens", "revokedKids",
    "revokedAgents", "algorithmAdvisories", "governanceKeySet", "policyHistory", "VERIFIER_POLICY", "ADMISSION"]) {
    assert.doesNotMatch(block, new RegExp(`\\b${n}\\b`), n);
  }
});

// ── Startup configuration ───────────────────────────────────────

// A server start that records stdout and stderr (bounded) and how it ended: once it reports listening and has
// printed its banner it gets SIGTERM; one that exits by itself is recorded as it exited. Only an EADDRINUSE exit
// before listening is retried on a new port (at most three starts, one shared deadline), as tests/helpers.js does.
const KEPT = 64 * 1024;
const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); }); });
async function launch(env, deadlineMs = 20000) {
  const deadline = performance.now() + deadlineMs;
  for (let attempt = 1; ; attempt++) {
    const r = await launchOnce(env, await freePort(), deadline);
    if (!(r.listening === false && /\bEADDRINUSE\b/.test(r.stderr) && attempt < 3 && performance.now() < deadline)) return r;
  }
}
function launchOnce(env, port, deadline) {
  return new Promise((resolve) => {
    const proc = spawn(process.execPath, [SERVER], { env: { ...process.env, PORT: String(port), ...env }, stdio: ["ignore", "pipe", "pipe"] });
    procs.push(proc);
    let stdout = ""; let stderr = ""; let listening = false; let timedOut = false; let spawnError = null;
    proc.stdout.on("data", (d) => {
      if (stdout.length < KEPT) stdout += d;
      if (!listening && /listening/.test(stdout)) { listening = true; setTimeout(() => proc.kill("SIGTERM"), 500); }
    });
    proc.stderr.on("data", (d) => { if (stderr.length < KEPT) stderr += d; });
    const timer = setTimeout(() => { timedOut = true; proc.kill("SIGKILL"); }, Math.max(0, deadline - performance.now()));
    proc.on("error", (e) => { spawnError = e.code ?? e.message; });
    proc.on("close", (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr, listening, timedOut, spawnError }); });
  });
}
// A startup refused by the configuration: a real non-zero exit by the process itself, with the expected error.
function refused(r, message, what) {
  assert.equal(r.spawnError, null, what);
  assert.equal(r.timedOut, false, `${what}: still running at the deadline`);
  assert.equal(r.listening, false, `${what}: started listening`);
  assert.equal(r.signal, null, `${what}: ended by a signal`);
  assert.ok(Number.isInteger(r.code) && r.code !== 0, `${what}: exit code ${r.code}`);
  assert.match(r.stderr, message, what);
}

test("an invalid DCP_DEMO_ENDPOINTS, or the opt-in without a usable OPERATOR_TOKEN, stops the server and prints no token", async () => {
  const fails = [
    [{ DCP_DEMO_ENDPOINTS: "" }, /CONFIG_INVALID_VALUE: DCP_DEMO_ENDPOINTS must be unset/],
    [{ DCP_DEMO_ENDPOINTS: "true" }, /CONFIG_INVALID_VALUE: DCP_DEMO_ENDPOINTS must be unset/],
    [{ DCP_DEMO_ENDPOINTS: "1" }, /CONFIG_INVALID_VALUE: DCP_DEMO_ENDPOINTS must be unset/],
    [{ DCP_DEMO_ENDPOINTS: "on" }, /CONFIG_INVALID_VALUE: DCP_DEMO_ENDPOINTS must be unset/],
    [{ DCP_DEMO_ENDPOINTS: "DCP-05-09" }, /CONFIG_INVALID_VALUE: DCP_DEMO_ENDPOINTS must be unset/],
    [{ DCP_DEMO_ENDPOINTS: " dcp-05-09" }, /CONFIG_INVALID_VALUE: DCP_DEMO_ENDPOINTS must be unset/],
    [{ DCP_DEMO_ENDPOINTS: "dcp-05-09 " }, /CONFIG_INVALID_VALUE: DCP_DEMO_ENDPOINTS must be unset/],
    [{ DCP_DEMO_ENDPOINTS: "dcp-05-09" }, /needs OPERATOR_TOKEN/],
    [{ DCP_DEMO_ENDPOINTS: "dcp-05-09", OPERATOR_TOKEN: "" }, /needs OPERATOR_TOKEN/],
    [{ DCP_DEMO_ENDPOINTS: "dcp-05-09", OPERATOR_TOKEN: TOKEN.slice(0, 31) }, /b64token of at least 32 characters/],
    [{ DCP_DEMO_ENDPOINTS: "dcp-05-09", OPERATOR_TOKEN: `${TOKEN.slice(0, 20)} ${TOKEN.slice(20)}` }, /b64token of at least 32 characters/],
    [{ DCP_DEMO_ENDPOINTS: "dcp-05-09", OPERATOR_TOKEN: `${TOKEN}\t` }, /b64token of at least 32 characters/],
  ];
  for (const [env, message] of fails) {
    const what = `${JSON.stringify(env.DCP_DEMO_ENDPOINTS)} with ${env.OPERATOR_TOKEN === undefined ? "no token" : `a token of ${env.OPERATOR_TOKEN.length} characters`}`;
    const r = await launch(clean(env));
    refused(r, message, what);
    assert.equal(r.stderr.includes(TOKEN.slice(0, 20)) || r.stdout.includes(TOKEN.slice(0, 20)), false, `${what}: no token in the output`);
  }
  for (const env of [{}, { DCP_DEMO_ENDPOINTS: "off" }, { DCP_DEMO_ENDPOINTS: "dcp-05-09", OPERATOR_TOKEN: TOKEN.slice(0, 32) }, { OPERATOR_TOKEN: "short-admin-token" }]) {
    const r = await launch(clean(env));
    assert.equal(r.listening, true, `${JSON.stringify(Object.keys(env))}: ${r.stderr.slice(0, 300)}`);
    assert.equal(r.stdout.includes(TOKEN.slice(0, 20)), false);
  }
});

test("the banner lists the 31 routes only when the demo is on, and says so", async () => {
  const routeLines = (out) => out.split("\n").filter((l) => /^\s+(GET|POST)\s+\/v2\/(lifecycle|succession|disputes|objections|jurisprudence|rights|obligations|delegation|agent-advisory|mirror|interactions|awareness)\b/.test(l));
  const off = await launch(OFF);
  assert.match(off.stdout, /DCP-05–09 demo endpoints: disabled/);
  assert.equal(routeLines(off.stdout).length, 0);
  const on = await launch(ON);
  assert.match(on.stdout, /DCP-05–09 demo endpoints \(operator token; schema checks only, no signature verification\):/);
  assert.equal(routeLines(on.stdout).length, 31);
  assert.equal(on.stdout.includes(TOKEN), false);
});

// ── Off (the default, and "off") ─────────────────────────────────

test("off, by default and explicitly: every route, with or without the token, is the plain not-found, Connection: close", async () => {
  for (const env of [clean({ OPERATOR_TOKEN: TOKEN }), clean({ DCP_DEMO_ENDPOINTS: "off", OPERATOR_TOKEN: TOKEN })]) {
    const base = await serve(env);
    const unknown = await (await fetch(new URL("/v2/no-such-route", base))).text();
    for (const route of ROUTES) for (const headers of [{}, bearer]) {
      const r = await call(base, route, headers);
      gated(r, 404, `${route.method} ${route.target}`);
      assert.equal(r.text, unknown);
    }
    for (const [method, target] of [["GET", "/v2/lifecycle"], ["PUT", "/v2/rights/declare"], ["HEAD", `/v2/mirror/${AGENT}`], ["GET", "/v2/jurisprudence?all=1"], ["DELETE", `/v2/delegation/mandate/${MANDATE}`]]) {
      gated(await raw(base, { method, target, headers: bearer }), 404, `${method} ${target}`);
    }
  }
});

// ── On: the operator token, exactly ─────────────────────────────

const WRONG = [
  ["no Authorization", {}],
  ["another token", { Authorization: `Bearer ${crypto.randomBytes(32).toString("hex")}` }],
  ["the bare token", { Authorization: TOKEN }],
  ["another scheme", { Authorization: `Basic ${TOKEN}` }],
  ["two spaces", { Authorization: `Bearer  ${TOKEN}` }],
  ["something after it", { Authorization: `Bearer ${TOKEN} x` }],
  ["a comma list", { Authorization: `Bearer ${TOKEN}, Bearer ${TOKEN}` }],
];
// At most 100 POSTs a minute per client and process: the wrong headers are split over servers.
for (const group of [WRONG.slice(0, 4), WRONG.slice(4)]) {
  test(`on: ${group.map(([n]) => n).join(", ")}: every route, GET included, is 401 with WWW-Authenticate: Bearer`, async () => {
    const base = await serve(ON);
    for (const [name, headers] of group) for (const route of ROUTES) {
      const r = await call(base, route, headers);
      gated(r, 401, `${name}: ${route.method} ${route.target}`);
      assert.equal(r.headers["www-authenticate"], "Bearer");
    }
  });
}

test("on: the namespace is gated, other targets stay not found, and the core routes are unchanged", async () => {
  const base = await serve(ON);
  for (const [method, target] of [["GET", "/v2/lifecycle"], ["GET", "/v2/jurisprudence?all=1"], ["PUT", "/v2/rights/declare"], ["GET", "/v2/mirror/a%2Fb"]]) {
    gated(await raw(base, { method, target }), 401, `${method} ${target} without the token`);
    // Authorized, the request goes on to the old router; the client asks to close, since only the gate closes by itself.
    const r = await raw(base, { method, target, headers: { ...bearer, Connection: "close" } });
    assert.equal(r.timedOut, false, `${method} ${target} with the token`);
    assert.equal(r.complete, true, `${method} ${target} with the token`);
    assert.equal(r.status, method === "GET" && target === "/v2/mirror/a%2Fb" ? 200 : 404, `${method} ${target} with the token`);
  }
  // Outside the gate (no handler accepts these): the plain not-found. The client asks to close, since only the gate
  // closes by itself.
  for (const target of ["//v2/lifecycle/x", "/V2/lifecycle/x", "/v2/lifecycle%2Fcommission", "/v2/lifecycles"]) {
    const r = await raw(base, { method: "GET", target, headers: { Connection: "close" } });
    assert.equal(r.timedOut, false, target);
    assert.equal(r.complete, true, target);
    assert.equal(r.status, 404, target);
  }
  assert.equal((await fetch(new URL("/health", base))).status, 200);
  assert.equal((await fetch(new URL("/v2/no-such-route", base))).status, 404);
  const mode = await fetch(new URL("/v2/policy/mode", base), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "hybrid_required" }) });
  assert.equal(mode.status, 401, "admin routes keep their own guard");
});

test("the gate answers before the body: an unfinished or malformed body is refused at once and the socket closed", async () => {
  const off = await serve(OFF);
  const on = await serve(ON);
  for (const [base, status] of [[off, 404], [on, 401]]) {
    for (const route of ROUTES.filter((r) => r.method === "POST").slice(0, 5)) {
      const r = await raw(base, { method: "POST", target: route.target, body: '{"partial":', declaredLength: 100_000, deadlineMs: 3000 });
      gated(r, status, `${route.target} with an unfinished body (answer and close within 3000 ms)`);
    }
    gated(await raw(base, { method: "POST", target: "/v2/lifecycle/commission", body: "{not json" }), status, "a malformed body is not parsed first (no 400)");
  }
});

// ── On, with the token: the demo behaves as before ──────────────

test("on, authorized: one stateful flow per spec, denied writes change nothing, and capabilities stay honest", async () => {
  const base = await serve(ON);
  const ok = async (method, path, body, expected) => { const r = await authed(base, method, path, body); assert.equal(r.status, expected, `${method} ${path}: ${r.status}`); return r.json(); };
  const lifecycle = async () => (await ok("GET", `/v2/lifecycle/${AGENT}`, undefined, 200)).current_state;
  // DCP-05
  await ok("POST", "/v2/lifecycle/commission", ROUTES[0].body, 201);
  assert.equal(await lifecycle(), "commissioned");
  await ok("POST", "/v2/lifecycle/vitality", ROUTES[1].body, 200);
  const before = await lifecycle();
  const denied = await call(base, ROUTES[2], { Authorization: TOKEN });
  assert.equal(denied.status, 401);
  assert.equal(await lifecycle(), before, "a denied decommission changes nothing");
  const lower = await fetch(new URL("/v2/lifecycle/decommission", base), { method: "POST", headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify(ROUTES[2].body) });
  assert.equal(lower.status, 200, "the scheme is case-insensitive");
  assert.equal(await lifecycle(), "decommissioned");
  // DCP-06
  await ok("POST", "/v2/succession/testament", ROUTES[4].body, 201);
  assert.equal((await ok("GET", `/v2/succession/testament/${AGENT}`, undefined, 200)).agent_id, AGENT);
  // DCP-07
  await ok("POST", "/v2/disputes/create", ROUTES[9].body, 201);
  assert.equal((await ok("GET", `/v2/disputes/${DISPUTE}`, undefined, 200)).dispute_id, DISPUTE);
  await ok("POST", `/v2/disputes/${DISPUTE}/escalate`, {}, 200);
  // DCP-08
  await ok("POST", "/v2/rights/declare", ROUTES[16].body, 201);
  assert.equal((await ok("GET", `/v2/rights/${AGENT}`, undefined, 200)).agent_id, AGENT);
  // DCP-09
  await ok("POST", "/v2/delegation/mandate", ROUTES[21].body, 201);
  assert.equal((await ok("GET", `/v2/delegation/mandate/${MANDATE}`, undefined, 200)).revoked, false);
  assert.equal((await call(base, ROUTES[23], {})).status, 401);
  assert.equal((await ok("GET", `/v2/delegation/mandate/${MANDATE}`, undefined, 200)).revoked, false, "a denied revocation changes nothing");
  await ok("POST", `/v2/delegation/mandate/${MANDATE}/revoke`, {}, 200);
  assert.equal((await ok("GET", `/v2/delegation/mandate/${MANDATE}`, undefined, 200)).revoked, true);
  // Capabilities: on, the demo is announced as a non-normative demo; DCP-05 to DCP-09 support is not claimed.
  const caps = await (await fetch(new URL("/.well-known/dcp-capabilities.json", base))).json();
  for (const f of ["agent_lifecycle", "succession", "dispute_resolution", "rights_obligations", "delegation"]) assert.equal(caps.features[f], false, f);
  assert.equal(caps.features.dcp05_09_demo_endpoints, true);
  assert.deepEqual(caps.demo_endpoints, { "dcp-05-09": { enabled: true, normative: false, verifies_signatures: false, access: "operator_token" } });
});

test("off: capabilities claim neither DCP-05 to DCP-09 support nor the demo", async () => {
  const base = await serve(OFF);
  const caps = await (await fetch(new URL("/.well-known/dcp-capabilities.json", base))).json();
  for (const f of ["agent_lifecycle", "succession", "dispute_resolution", "rights_obligations", "delegation", "dcp05_09_demo_endpoints"]) assert.equal(caps.features[f], false, f);
  assert.deepEqual(caps.demo_endpoints, { "dcp-05-09": { enabled: false, normative: false, verifies_signatures: false, access: "operator_token" } });
  assert.equal(caps.features.hsm_provider, false);
});
