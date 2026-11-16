/**
 * DCP-09 §3.5.2 Mandate Domain Vector Generator
 *
 * Writes tests/interop/v2/mandate_domain_vectors.json: signed chains (a root signed by the human, a sub-mandate signed
 * by the root's agent, a third mandate signed by the sub-mandate's agent) that every chain verifier MUST accept or
 * reject. Every chain is valid but for its authority_scope domains, except two rejection controls that add a second
 * defect to a repeated domain (an invalid minimum_security_tier; an entry without actions_permitted) to show where the
 * duplicate check sits among a mandate's own field checks.
 *
 * The verdicts are normative: a domain that appears twice in one mandate is not comparable (DCP-09 §3.5.2 rule 5), at
 * every depth, the root included, and domains are the exact strings they are, with no case folding, no trimming and
 * no Unicode normalization, so a domain that differs in case, in a space or in its code points is another domain. The
 * error lists are not: they are the diagnostics the four SDK verifiers chose (each repeated domain reported once, at
 * its second entry, before the signature is looked at), kept as a regression of those APIs; the protocol fixes no
 * error text and no order.
 *
 * The expectations, verdicts and error lists alike, are written by hand. Before writing, the generator checks every
 * signature with compositeVerify (no vector rests on a forged signature) and every expectation against a reference
 * evaluator below (the domain rules, plus the two shape checks of the controls); it never asks verifyMandateChain what
 * to expect. Keys are fresh and ML-DSA-65 signatures are hedged, so a new run writes other keys and signatures: the
 * committed file is the artifact.
 *
 * Run: cd sdks/typescript && npx --no -- vite-node src/__tests__/generate-mandate-domain-vectors.ts
 * (`--no` never installs: it takes a local or an already cached vite-node; this checkout has no local one).
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

import { Ed25519Provider } from '../providers/ed25519.js';
import { MlDsa65Provider } from '../providers/ml-dsa-65.js';
import { AlgorithmRegistry } from '../core/crypto-registry.js';
import { canonicalizeV2 } from '../core/canonicalize.js';
import { DCP_CONTEXTS } from '../core/domain-separation.js';
import type { DcpContext } from '../core/domain-separation.js';
import { compositeSign, compositeVerify } from '../core/composite-ops.js';
import type { CompositeKeyPair } from '../core/composite-ops.js';
import type { CompositeSignature } from '../core/composite-sig.js';
import { generateSessionNonce } from '../core/session-nonce.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(__dirname, '../../../../tests/interop/v2/mandate_domain_vectors.json');

const registry = new AlgorithmRegistry();
const ed25519 = new Ed25519Provider();
const mlDsa65 = new MlDsa65Provider();
registry.registerSigner(ed25519);
registry.registerSigner(mlDsa65);

const HUMAN = 'human:domain-principal';
const ORCHESTRATOR = 'agent:domain-orchestrator';
const SUBAGENT = 'agent:domain-subagent';
const LEAF = 'agent:domain-leaf';
const VERIFICATION_TIME = '2026-11-05T12:00:00Z';

// Near-but-distinct strings, written with escapes so the source shows which code points they are.
const CAFE_NFC = 'caf\u00e9';
const CAFE_NFD = 'cafe\u0301';
const KELVIN = '\u212a'; // KELVIN SIGN, not LATIN CAPITAL LETTER K
const FULLWIDTH_EMAIL = '\uff45mail'; // FULLWIDTH LATIN SMALL LETTER E

type Mandate = Record<string, unknown>;
type Entry = Record<string, unknown>;
type KeyEntry = { kid: string; alg: string; public_key_b64: string; created_at: string; expires_at: null; status: 'active' };

async function generateKeys(): Promise<CompositeKeyPair> {
  const c = await ed25519.generateKeypair();
  const p = await mlDsa65.generateKeypair();
  return {
    classical: { kid: c.kid, alg: 'ed25519', secretKeyB64: c.secretKeyB64, publicKeyB64: c.publicKeyB64 },
    pq: { kid: p.kid, alg: 'ml-dsa-65', secretKeyB64: p.secretKeyB64, publicKeyB64: p.publicKeyB64 },
  };
}

const entries = (k: CompositeKeyPair): KeyEntry[] => [
  { kid: k.classical.kid, alg: k.classical.alg, public_key_b64: k.classical.publicKeyB64, created_at: '2026-01-01T00:00:00Z', expires_at: null, status: 'active' },
  { kid: k.pq.kid, alg: k.pq.alg, public_key_b64: k.pq.publicKeyB64, created_at: '2026-01-01T00:00:00Z', expires_at: null, status: 'active' },
];

const SIG_FIELDS = ['human_composite_sig', 'delegator_composite_sig'];
const unsigned = (m: Mandate): Mandate => Object.fromEntries(Object.entries(m).filter(([k]) => !SIG_FIELDS.includes(k)));
const bytesOf = (m: Mandate) => new TextEncoder().encode(canonicalizeV2(unsigned(m)));

async function signed(payload: Mandate, context: DcpContext, keys: CompositeKeyPair, field: string): Promise<Mandate> {
  return { ...payload, [field]: await compositeSign(registry, context, bytesOf(payload), keys) };
}

/** authority_scope entries from [domain, actions_permitted] pairs. */
const scope = (...pairs: [string, string[]][]): Entry[] => pairs.map(([domain, actions_permitted]) => ({ domain, actions_permitted }));
const dup = (i: number, domain: string) => `mandate[${i}]: authority_scope domain "${domain}" is duplicated`;

// ── Reference evaluator: the domain rules and the two shape checks of the controls (not from any verifier) ──
// Whether it finds an error at all is the verdict, which follows from rule 5 and exact string comparison. Which
// errors it lists, their text and their order, is the diagnostic choice of the SDK verifiers, written down here so
// the hand-written error lists are checked twice; it is not a protocol requirement.

const TIERS = ['routine', 'standard', 'elevated', 'maximum'];
const isEntry = (e: unknown): e is { domain: string; actions_permitted: string[] } =>
  typeof e === 'object' && e !== null && !Array.isArray(e) &&
  typeof (e as Entry).domain === 'string' && (e as Entry).domain !== '' &&
  Array.isArray((e as Entry).actions_permitted) && ((e as Entry).actions_permitted as unknown[]).every((a) => typeof a === 'string');

/** The errors of the first mandate the domain rules reject, as the chain verifier reports them, or [] for none. */
function domainErrors(chain: Mandate[]): string[] {
  for (const [i, m] of chain.entries()) {
    const at = (e: string) => `mandate[${i}]: ${e}`;
    const list = m.authority_scope as unknown[];
    const own: string[] = [];
    if (!Array.isArray(list) || list.length === 0 || !list.every(isEntry)) {
      own.push('missing or invalid authority_scope');
    } else {
      const domains = list.map((e) => e.domain);
      // A domain is reported at its second entry: the one whose index is the second time === finds that string.
      domains.forEach((d, j) => {
        const first = domains.indexOf(d);
        if (first < j && domains.indexOf(d, first + 1) === j) own.push(`authority_scope domain "${d}" is duplicated`);
      });
    }
    if ('minimum_security_tier' in m && !TIERS.includes(m.minimum_security_tier as string)) own.push('invalid minimum_security_tier');
    if (own.length > 0) return own.map(at);
    if (i > 0) {
      const parent = chain[i - 1].authority_scope as { domain: string; actions_permitted: string[] }[];
      for (const c of m.authority_scope as { domain: string; actions_permitted: string[] }[]) {
        const p = parent.find((e) => e.domain === c.domain);
        if (!p) return [at(`authority_scope domain "${c.domain}" is not in the parent`)];
        if (!c.actions_permitted.every((a) => p.actions_permitted.includes(a))) {
          return [at(`actions_permitted for domain "${c.domain}" is not a subset of the parent`)];
        }
      }
    }
  }
  return [];
}

async function main() {
  const human = await generateKeys();
  const orchestrator = await generateKeys();
  const subagent = await generateKeys();
  const KEYS = { human_keys: entries(human), agent_keys: { [ORCHESTRATOR]: entries(orchestrator), [SUBAGENT]: entries(subagent) } };

  const base = (id: string, agent: string, authority_scope: Entry[]): Mandate => ({
    dcp_version: '2.0',
    mandate_id: id,
    session_nonce: generateSessionNonce(),
    human_id: HUMAN,
    agent_id: agent,
    authority_scope,
    valid_from: '2026-01-01T00:00:00Z',
    valid_until: '2099-01-01T00:00:00Z',
    revocable: true,
    timestamp: '2026-01-01T00:00:00Z',
  });
  /** A chain whose mandates carry the given scopes, root first; `extra` adds fields to the root. */
  const chain = async (scopes: Entry[][], extra: Mandate = {}): Promise<Mandate[]> => {
    const ids = ['mandate:domain-root', 'mandate:domain-sub', 'mandate:domain-leaf'];
    const agents = [ORCHESTRATOR, SUBAGENT, LEAF];
    const signers = [human, orchestrator, subagent];
    const out: Mandate[] = [];
    for (const [i, s] of scopes.entries()) {
      const payload: Mandate = { ...base(ids[i], agents[i], s), sub_delegation: { permitted: true, max_depth: 2 } };
      if (i === 0) Object.assign(payload, extra);
      else Object.assign(payload, { parent_mandate_id: ids[i - 1], delegation_depth: i });
      out.push(
        i === 0
          ? await signed(payload, DCP_CONTEXTS.Delegation, signers[0], 'human_composite_sig')
          : await signed(payload, DCP_CONTEXTS.SubMandate, signers[i], 'delegator_composite_sig'),
      );
    }
    return out;
  };

  const RS = ['read', 'send'];
  const R = ['read'];
  type Case = { name: string; chain: Mandate[]; expected?: { depth: number; effective_tier: null }; errors?: string[] };
  const accept: Case[] = [
    { name: 'root_unique_domains', chain: await chain([scope(['email', RS], ['calendar', R])]), expected: { depth: 0, effective_tier: null } },
    {
      name: 'three_levels_unique_domains',
      chain: await chain([scope(['email', RS], ['calendar', R]), scope(['email', RS], ['calendar', R]), scope(['email', R])]),
      expected: { depth: 2, effective_tier: null },
    },
    { name: 'root_domains_differing_in_case', chain: await chain([scope(['email', R], ['Email', R], ['EMAIL', R])]), expected: { depth: 0, effective_tier: null } },
    {
      name: 'root_domains_differing_in_spaces',
      chain: await chain([scope(['email', R], ['email ', R], [' email', R], ['e mail', R])]),
      expected: { depth: 0, effective_tier: null },
    },
    {
      name: 'root_domains_differing_in_code_points',
      chain: await chain([scope([CAFE_NFC, R], [CAFE_NFD, R], ['K', R], [KELVIN, R], ['email', R], [FULLWIDTH_EMAIL, R])]),
      expected: { depth: 0, effective_tier: null },
    },
    {
      name: 'root_domains_named_like_prototype_members',
      chain: await chain([scope(['__proto__', R], ['constructor', R], ['prototype', R], ['toString', R], ['hasOwnProperty', R], ['valueOf', R])]),
      expected: { depth: 0, effective_tier: null },
    },
    {
      name: 'sub_takes_the_exact_entry_among_case_variants',
      chain: await chain([scope(['Email', R], ['email', RS]), scope(['email', ['send']])]),
      expected: { depth: 1, effective_tier: null },
    },
    {
      name: 'sub_narrows_domains_named_like_prototype_members',
      chain: await chain([scope(['__proto__', R], ['constructor', RS]), scope(['constructor', ['send']], ['__proto__', R])]),
      expected: { depth: 1, effective_tier: null },
    },
  ];
  const reject: Case[] = [
    { name: 'root_identical_duplicate', chain: await chain([scope(['email', R], ['email', R])]), errors: [dup(0, 'email')] },
    { name: 'root_conflicting_duplicate', chain: await chain([scope(['email', R], ['email', ['read', 'send', 'delete']])]), errors: [dup(0, 'email')] },
    { name: 'root_nonadjacent_duplicate', chain: await chain([scope(['email', R], ['calendar', R], ['email', R])]), errors: [dup(0, 'email')] },
    {
      name: 'root_each_duplicate_reported_once',
      chain: await chain([scope(['email', R], ['calendar', R], ['email', R], ['calendar', R], ['email', R])]),
      errors: [dup(0, 'email'), dup(0, 'calendar')],
    },
    { name: 'root_duplicate_with_a_sub', chain: await chain([scope(['email', R], ['email', R]), scope(['email', R])]), errors: [dup(0, 'email')] },
    {
      name: 'root_duplicate_with_two_levels_below',
      chain: await chain([scope(['email', RS], ['email', RS]), scope(['email', RS]), scope(['email', R])]),
      errors: [dup(0, 'email')],
    },
    { name: 'sub_duplicate', chain: await chain([scope(['email', RS]), scope(['email', R], ['email', ['send']])]), errors: [dup(1, 'email')] },
    {
      name: 'third_level_duplicate',
      chain: await chain([scope(['email', RS], ['calendar', R]), scope(['email', RS]), scope(['email', R], ['email', ['send']])]),
      errors: [dup(2, 'email')],
    },
    { name: 'root_duplicate_named_proto', chain: await chain([scope(['__proto__', R], ['__proto__', R])]), errors: [dup(0, '__proto__')] },
    {
      name: 'root_duplicate_named_constructor',
      chain: await chain([scope(['constructor', R], ['toString', R], ['constructor', R])]),
      errors: [dup(0, 'constructor')],
    },
    {
      name: 'root_exact_unicode_duplicate_beside_its_nfd_form',
      chain: await chain([scope([CAFE_NFC, R], [CAFE_NFD, R], [CAFE_NFC, R])]),
      errors: [dup(0, CAFE_NFC)],
    },
    {
      name: 'root_duplicate_and_an_invalid_tier',
      chain: await chain([scope(['email', R], ['email', R])], { minimum_security_tier: 'ultra' }),
      errors: [dup(0, 'email'), 'mandate[0]: invalid minimum_security_tier'],
    },
    {
      name: 'root_duplicate_beside_an_invalid_entry',
      chain: await chain([[...scope(['email', R], ['email', R]), { domain: 'calendar' }]]),
      errors: ['mandate[0]: missing or invalid authority_scope'],
    },
    {
      name: 'sub_takes_a_case_variant_with_fewer_actions',
      chain: await chain([scope(['Email', R], ['email', RS]), scope(['Email', ['send']])]),
      errors: ['mandate[1]: actions_permitted for domain "Email" is not a subset of the parent'],
    },
    {
      name: 'sub_domain_with_a_trailing_space',
      chain: await chain([scope(['email', R]), scope(['email ', R])]),
      errors: ['mandate[1]: authority_scope domain "email " is not in the parent'],
    },
  ];

  const names = [...accept, ...reject].map((c) => c.name);
  if (new Set(names).size !== names.length) throw new Error('duplicate case names');
  const signers = [human, orchestrator, subagent];
  for (const c of [...accept, ...reject]) {
    // Every signature is real and verifies: a rejection here is never a signature failure.
    for (const [i, m] of c.chain.entries()) {
      const [field, context] = i === 0 ? ['human_composite_sig', DCP_CONTEXTS.Delegation] as const : ['delegator_composite_sig', DCP_CONTEXTS.SubMandate] as const;
      const r = await compositeVerify(registry, context, bytesOf(m), m[field] as CompositeSignature, signers[i].classical.publicKeyB64, signers[i].pq.publicKeyB64);
      if (!r.valid || !r.classical_valid || r.pq_valid !== true) throw new Error(`${c.name}: mandate[${i}] ${field} does not verify`);
    }
    // The hand-written expectation against the domain-only reference.
    const found = domainErrors(c.chain);
    const want = c.expected ? [] : c.errors!;
    if (JSON.stringify(found) !== JSON.stringify(want)) throw new Error(`${c.name}: expected ${JSON.stringify(want)}, the reference finds ${JSON.stringify(found)}`);
    if (c.expected && c.expected.depth !== c.chain.length - 1) throw new Error(`${c.name}: depth ${c.expected.depth} for ${c.chain.length} mandates`);
  }

  const strip = ({ name, chain: ch, expected, errors }: Case) => ({ name, chain: ch, revoked_mandate_ids: [], ...(expected ? { expected } : { errors }) });
  const out = {
    _description:
      'Cross-SDK DCP-09 §3.5.2 mandate domain vectors. Verdicts (normative): every chain verifier MUST accept each must_accept chain (root first), whose leaf depth and effective tier are expected.depth and expected.effective_tier, and MUST reject each must_reject chain, verified at verification_time against keys with revoked_mandate_ids revoked. ' +
      'A domain that appears twice in one mandate is not comparable (rule 5), at every depth, the root included. Domains are the exact strings the JSON decodes to: no case folding, no trimming, no Unicode normalization, so the case, space and code point variants of must_accept are distinct domains and a sub-mandate entry matches only the parent entry with the very same string. ' +
      'Diagnostics (not normative): errors lists, in order, what the reference chain verifiers of the TypeScript, Python, Go and Rust SDKs report for each must_reject chain, kept as a regression of those APIs. DCP-09 fixes no error text and no order, and an implementation that rejects these chains with other errors conforms. These verifiers report each repeated domain of a mandate whose authority_scope entries are all well formed once, at its second entry, among the errors of that mandate own fields and before its signature is looked at. ' +
      'Every signature is real (Ed25519 + ML-DSA-65, pq_over_classical): the root by the human, each sub-mandate by its parent agent. Key material is synthetic, generated for these vectors only.',
    _generator: 'sdks/typescript/src/__tests__/generate-mandate-domain-vectors.ts',
    verification_time: VERIFICATION_TIME,
    keys: KEYS,
    must_accept: accept.map(strip),
    must_reject: reject.map(strip),
  };
  writeFileSync(OUTPUT_PATH, `${JSON.stringify(out, null, 2)}\n`);

  // The file keeps every domain as written: the code point variants read back distinct, the exact repeat equal.
  const back = JSON.parse(readFileSync(OUTPUT_PATH, 'utf8'));
  const domains = (name: string) =>
    [...back.must_accept, ...back.must_reject].find((c: { name: string }) => c.name === name).chain[0].authority_scope.map((e: Entry) => e.domain);
  const variants = domains('root_domains_differing_in_code_points');
  if (JSON.stringify(variants) !== JSON.stringify([CAFE_NFC, CAFE_NFD, 'K', KELVIN, 'email', FULLWIDTH_EMAIL]) || new Set(variants).size !== 6) {
    throw new Error('the code point variants did not survive the file');
  }
  const repeat = domains('root_exact_unicode_duplicate_beside_its_nfd_form');
  if (repeat[0] !== repeat[2] || repeat[0] === repeat[1]) throw new Error('the Unicode duplicate did not survive the file');
  console.log(`wrote ${OUTPUT_PATH}: ${accept.length} must_accept, ${reject.length} must_reject`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
