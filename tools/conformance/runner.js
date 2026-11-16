// Conformance runner: selects suites from the versioned catalog, runs them against fixtures under `root`,
// checks every suite produced exactly the case ids the catalog pins, and builds a fresh report.
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { SUITES as DEFAULT_SUITES, ExpectationError } from "./suites.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "..", "..");
export const CATALOG_PATH = path.join(HERE, "catalog.json");

export class UsageError extends Error {}
export class FixtureError extends Error {}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

export function loadCatalog(file = CATALOG_PATH) {
  const raw = fs.readFileSync(file, "utf8");
  const cat = JSON.parse(raw);
  const bad = (m) => { throw new Error(`invalid catalog ${file}: ${m}`); };
  if (typeof cat.kit_version !== "string" || !Array.isArray(cat.suites) || !Array.isArray(cat.inventory)) bad("needs kit_version, suites and inventory");
  const ids = new Set();
  for (const s of cat.suites) {
    if (!isObj(s) || typeof s.id !== "string" || !Array.isArray(s.expected_cases) || s.expected_cases.length === 0) bad("every suite needs an id and a non-empty expected_cases");
    if (ids.has(s.id)) bad(`duplicate suite id ${s.id}`);
    ids.add(s.id);
    if (new Set(s.expected_cases).size !== s.expected_cases.length) bad(`duplicate case id in ${s.id}`);
  }
  return { ...cat, sha256: crypto.createHash("sha256").update(raw).digest("hex") };
}

export function selectSuites(catalog, requested) {
  if (requested === undefined || requested.length === 0) return catalog.suites.map((s) => s.id);
  const seen = new Set();
  for (const id of requested) {
    if (typeof id !== "string" || id.trim() === "") throw new UsageError("empty suite id");
    if (seen.has(id)) throw new UsageError(`suite ${id} selected twice`);
    if (!catalog.suites.some((s) => s.id === id)) throw new UsageError(`unknown suite ${id} (see --list)`);
    seen.add(id);
  }
  return requested;
}

function makeContext(root) {
  const cache = new Map();
  let ajv;
  const read = (rel) => {
    const file = path.join(root, rel);
    try {
      return fs.readFileSync(file, "utf8");
    } catch (e) {
      throw new FixtureError(`required fixture ${rel} is missing or unreadable (${e.code ?? e.message})`);
    }
  };
  const json = (rel) => {
    if (!cache.has(rel)) {
      try {
        cache.set(rel, JSON.parse(read(rel)));
      } catch (e) {
        if (e instanceof FixtureError) throw e;
        throw new FixtureError(`required fixture ${rel} is not valid JSON (${e.message})`);
      }
    }
    return structuredClone(cache.get(rel));
  };
  const validate = (schemaRel, data) => {
    if (!ajv) {
      ajv = new Ajv({ allErrors: true, strict: false });
      addFormats(ajv);
      for (const dir of ["schemas/v1", "schemas/v2"]) {
        let files;
        try { files = fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith(".json")).sort(); }
        catch (e) { throw new FixtureError(`schema directory ${dir} is missing (${e.code})`); }
        for (const f of files) {
          const schema = json(`${dir}/${f}`);
          if (schema.$id) ajv.addSchema(schema, schema.$id); else ajv.addSchema(schema);
        }
      }
    }
    const schema = json(schemaRel);
    const fn = (schema.$id && ajv.getSchema(schema.$id)) || ajv.compile(schema);
    return fn(data) || (fn.errors || []).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
  };
  return { root, json, text: read, validate };
}

function classify(e) {
  if (e instanceof FixtureError) return { status: "error", kind: "fixture", message: e.message };
  if (e instanceof ExpectationError) return { status: "error", kind: "expectation", message: e.message };
  return { status: "error", kind: "exception", message: e?.stack?.split("\n").slice(0, 2).join(" ") ?? String(e) };
}

/**
 * Runs the selected suites. `suites` maps suite id → implementation (tests may inject their own);
 * `catalog` defaults to tools/conformance/catalog.json.
 */
export async function runConformance({ root = REPO_ROOT, select, catalog = loadCatalog(), suites = DEFAULT_SUITES, log = () => {} } = {}) {
  const selected = selectSuites(catalog, select);
  const started = new Date();
  const report = {
    kit: { name: "dcp-ai-conformance", version: catalog.kit_version, catalog_sha256: catalog.sha256 },
    run: { id: crypto.randomUUID(), started_at: started.toISOString(), finished_at: null, root: path.resolve(root), node: process.version },
    selection: selected,
    status: "incomplete",
    totals: { cases: 0, executed: 0, pass: 0, fail: 0, error: 0 },
    suites: [],
    inventory: catalog.inventory,
    limits: catalog.limits ?? [],
  };
  for (const id of selected) {
    const def = catalog.suites.find((s) => s.id === id);
    const results = [];
    const record = (caseId, outcome) => {
      if (results.some((r) => r.id === caseId)) {
        results.push({ id: caseId, status: "error", kind: "catalog", message: "duplicate case id produced by the suite" });
      } else {
        results.push({ id: caseId, ...outcome });
      }
    };
    const toOutcome = (v) => (v === true ? { status: "pass" } : { status: "fail", kind: "discrepancy", message: String(v) });
    const ctx = {
      ...makeContext(root),
      check(caseId, fn) {
        try { record(caseId, toOutcome(fn())); } catch (e) { record(caseId, classify(e)); }
      },
      async checkAsync(caseId, fn) {
        try { record(caseId, toOutcome(await fn())); } catch (e) { record(caseId, classify(e)); }
      },
    };
    log(`\n── ${id}: ${def.title} ──`);
    let suiteError;
    const impl = suites[id];
    if (typeof impl !== "function") suiteError = { status: "error", kind: "catalog", message: `no implementation for suite ${id}` };
    else {
      try { await impl(ctx); } catch (e) { suiteError = classify(e); }
    }
    const produced = new Set(results.map((r) => r.id));
    for (const exp of def.expected_cases) {
      if (!produced.has(exp)) {
        results.push({ id: exp, status: "error", kind: suiteError?.kind ?? "catalog",
          message: suiteError ? `not run: ${suiteError.message}` : "case pinned in the catalog was not produced" });
      }
    }
    // A suite that throws fails even when it had already produced every pinned case.
    if (suiteError) results.push({ id: `${id}#suite`, ...suiteError, message: `suite aborted: ${suiteError.message}` });
    for (const r of results) {
      if (!def.expected_cases.includes(r.id) && r.status !== "error") {
        Object.assign(r, { status: "error", kind: "catalog", message: `case not pinned in the catalog (was ${r.status})` });
      }
    }
    const totals = { cases: results.length, executed: 0, pass: 0, fail: 0, error: 0 };
    for (const r of results) {
      totals[r.status]++;
      if (r.status !== "error") totals.executed++;
      log(`${r.status === "pass" ? "✔" : r.status === "fail" ? "✖" : "!"} ${r.id}${r.message ? ` — ${r.message}` : ""}`);
    }
    const status = totals.error ? "error" : totals.fail ? "fail" : "pass";
    report.suites.push({ id, title: def.title, claim: def.claim, limits: def.limits ?? [], status, totals, cases: results });
    for (const k of Object.keys(totals)) report.totals[k] += totals[k];
  }
  report.run.finished_at = new Date().toISOString();
  if (report.totals.executed === 0) {
    report.status = "error";
    report.no_checks = "no check was executed";
  } else {
    report.status = report.totals.error ? "error" : report.totals.fail ? "fail" : "pass";
  }
  return report;
}

/** Writes an "incomplete" placeholder first, so a crash never leaves an older successful report in place. */
export function beginReport(file) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ status: "incomplete", started_at: new Date().toISOString() }) + "\n");
}

export function writeReport(file, report) {
  fs.writeFileSync(file, JSON.stringify(report, null, 2) + "\n");
}
