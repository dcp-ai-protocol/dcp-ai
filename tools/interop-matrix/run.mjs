// Interop matrix orchestrator (design and agent protocol in README.md).
//
// Starts one agent process per SDK, has each one produce citizenship bundles,
// has every agent verify every bundle, untouched and tampered with in transit,
// and fails on any unexpected verdict, crash or timeout.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Agent, HERE, launchers } from './agents.mjs';
const ALL = ['ts', 'py', 'go', 'rust', 'ref'];
// Agents that only verify: the reference verifier (lib/verify.js) has no producer side.
const VERIFY_ONLY = new Set(['ref']);

const opts = { agents: ALL, python: process.env.INTEROP_PYTHON || 'python3', timeout: 60000, out: join(HERE, 'out') };
for (let i = 2; i < process.argv.length; i++) {
  const [flag, value] = [process.argv[i], process.argv[i + 1]];
  if (flag === '--agents') opts.agents = value.split(',');
  else if (flag === '--python') opts.python = value;
  else if (flag === '--timeout') opts.timeout = Number(value);
  else if (flag === '--out') opts.out = resolve(value);
  else throw new Error(`unknown option ${flag}`);
  i++;
}
for (const a of opts.agents) if (!ALL.includes(a)) throw new Error(`unknown agent ${a} (known: ${ALL.join(', ')})`);

// ── Scenario 1: DCP-01 to DCP-03 ──

const POLICY_HASH = `sha256:${createHash('sha256').update('dcp-interop-matrix policy v1').digest('hex')}`;
const MODES = ['', 'hybrid_required'];
const modeName = (m) => m || 'default';
const clone = (v) => JSON.parse(JSON.stringify(v));

async function produce(agent, ownerName) {
  const id = await agent.call('identity', { owner_name: ownerName, jurisdiction: 'CL' });
  const routine = await agent.call('intent', {
    action_type: 'api_call', channel: 'api', data_classes: ['none'], estimated_impact: 'low', risk_score: 100, applied_policy_hash: POLICY_HASH,
  });
  for (let i = 1; i <= 3; i++) {
    await agent.call('act', { intent_id: routine.intent_id, outcome: `call ${i} completed`, tool: 'weather.lookup', result_ref: `result-${i}` });
  }
  const payment = await agent.call('intent', {
    action_type: 'initiate_payment', channel: 'payments', data_classes: ['financial_data'], estimated_impact: 'high', risk_score: 900,
    applied_policy_hash: POLICY_HASH,
  });
  if (payment.decision !== 'block') throw new Error(`${agent.name}: risk 900 must be blocked, got ${payment.decision}`);
  await agent.call('act', { intent_id: payment.intent_id, outcome: 'blocked by policy', tool: 'payments.transfer', result_ref: 'not-executed' });
  return {
    identity: id,
    routine: (await agent.call('bundle', { intent_id: routine.intent_id })).signed_bundle,
    payment: (await agent.call('bundle', { intent_id: payment.intent_id })).signed_bundle,
  };
}

// Each attack takes the producer's bundles (and another producer's) and returns a tampered copy.
const ATTACKS = {
  intent_changed: (b) => ((b.bundle.intent.payload.estimated_impact = 'high'), b),
  audit_reordered: (b) => (([b.bundle.audit_entries[0], b.bundle.audit_entries[1]] = [b.bundle.audit_entries[1], b.bundle.audit_entries[0]]), b),
  audit_entry_dropped: (b) => (b.bundle.audit_entries.pop(), b),
  session_spliced: (b) => ((b.bundle.manifest.session_nonce = 'ab'.repeat(32)), b),
  bundle_signature_swapped: (b, own) => ((b.signature = clone(own.payment.signature)), b),
  passport_swapped: (b, _own, other) => ((b.bundle.agent_passport = clone(other.routine.bundle.agent_passport)), b),
  pq_stripped: (b) => ((b.signature.composite_sig = { ...b.signature.composite_sig, pq: null, binding: 'classical_only' }), b),
  // Same session and signer: the manifest's own hashes must catch artifacts from another bundle.
  intent_from_other_bundle: (b, own) => ((b.bundle.intent = clone(own.payment.bundle.intent)), (b.bundle.policy_decision = clone(own.payment.bundle.policy_decision)), b),
  trail_from_other_bundle: (b, own) => ((b.bundle.audit_entries = clone(own.payment.bundle.audit_entries)), b),
};
const ATTACK_MODES = { pq_stripped: ['hybrid_required'] };

async function main() {
  const cmds = launchers(opts.agents, opts.python);
  const agents = Object.fromEntries(Object.entries(cmds).map(([n, [c, a]]) => [n, new Agent(n, c, a, opts.timeout)]));
  const names = opts.agents;
  if (!names.some((n) => !VERIFY_ONLY.has(n))) throw new Error('at least one producing agent is needed (ts, py, go or rust)');
  mkdirSync(opts.out, { recursive: true });
  const failures = [];
  const cells = {}; // `${producer}>${verifier}` -> { pass, total }
  const started = Date.now();
  try {
    const produced = {};
    for (const p of names.filter((n) => !VERIFY_ONLY.has(n))) {
      try {
        produced[p] = await produce(agents[p], `Interop Owner (${p})`);
      } catch (e) {
        failures.push({ producer: p, case: 'produce', error: e.message });
      }
    }
    const producers = names.filter((p) => produced[p]);
    if (producers.length < 2) console.log('note: passport_swapped needs two producers and is skipped');
    for (const [i, p] of producers.entries()) {
      const other = produced[producers[(i + 1) % producers.length]];
      const cases = [
        ['routine', produced[p].routine, true, MODES],
        ['payment', produced[p].payment, true, MODES],
        ...Object.entries(ATTACKS).map(([name, attack]) => [name, attack(clone(produced[p].routine), produced[p], other), false, ATTACK_MODES[name] ?? MODES]),
      ];
      for (const v of names) {
        const cell = (cells[`${p}>${v}`] = { pass: 0, total: 0 });
        for (const [name, doc, expected, modes] of cases) {
          if (name === 'passport_swapped' && producers.length < 2) continue;
          for (const mode of modes) {
            cell.total++;
            let verdict;
            try {
              verdict = await agents[v].call('verify', { signed_bundle: doc, mode });
            } catch (e) {
              verdict = { error: e.message };
            }
            if (verdict.valid === expected) {
              cell.pass++;
              continue;
            }
            const file = join(opts.out, `${p}-${v}-${name}-${modeName(mode)}.json`);
            writeFileSync(file, JSON.stringify({ producer: p, verifier: v, case: name, mode: modeName(mode), expected, verdict, signed_bundle: doc }, null, 2));
            failures.push({ producer: p, verifier: v, case: name, mode: modeName(mode), expected, verdict, file });
          }
        }
      }
    }
  } finally {
    await Promise.all(Object.values(agents).map((a) => a.stop()));
  }

  // Report: producer rows, verifier columns.
  const pad = (s, n) => String(s).padEnd(n);
  const lines = [`producer \\ verifier  ${names.map((v) => pad(v, 10)).join('')}`];
  for (const p of names.filter((n) => !VERIFY_ONLY.has(n))) {
    lines.push(`${pad(p, 21)}${names.map((v) => {
      const c = cells[`${p}>${v}`];
      return pad(c ? `${c.pass === c.total ? 'ok' : 'FAIL'} ${c.pass}/${c.total}` : 'no bundle', 10);
    }).join('')}`);
  }
  const report = { agents: names, cells, failures, seconds: (Date.now() - started) / 1000 };
  writeFileSync(join(opts.out, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`\nScenario 1 (DCP-01 to 03): 2 bundles + ${Object.keys(ATTACKS).length} attacks per producer, modes ${MODES.map(modeName).join(', ')}\n`);
  console.log(lines.join('\n'));
  for (const f of failures) {
    console.log(`\nFAIL ${f.producer}${f.verifier ? ` > ${f.verifier}` : ''} ${f.case}${f.mode ? ` [${f.mode}]` : ''}: ${f.error ?? `expected ${f.expected ? 'valid' : 'invalid'}, got ${JSON.stringify(f.verdict).slice(0, 400)}`}`);
  }
  console.log(`\n${failures.length === 0 ? 'INTEROP MATRIX PASS' : `INTEROP MATRIX FAIL: ${failures.length} unexpected results`} (${report.seconds.toFixed(1)} s, report in ${join(opts.out, 'report.json')})`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
