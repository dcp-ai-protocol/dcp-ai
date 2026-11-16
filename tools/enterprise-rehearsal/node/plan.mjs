// The G1-G10 plan of the MP-05 rehearsal and its evaluation (TEST ONLY). Pure data and functions: no SDK, no I/O.
//
// Every expectation is written here, before anything runs, from the contract, the shared vectors
// (tests/interop/v2), DCP-09, spec/profiles/admission and the code of the installed adapters; never from what a run
// answers. The runner writes the plan to the evidence before the first request. Groups run in EXECUTION_ORDER: G6
// (rotation) last, because retiring p-k1 invalidates the root mandate the other delegated groups use. Each group
// starts with an explicit operator refresh of both revocation lists (the service never refreshes them by itself).

export const PLAN_FORMAT = 'dcp-ai-mp05-plan-v2';
export const GROUPS = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8', 'G9', 'G10'];
export const EXECUTION_ORDER = ['G1', 'G2', 'G3', 'G4', 'G5', 'G7', 'G8', 'G9', 'G10', 'G6'];
export const LANES = ['node', 'python'];
const DELTAS = ['trust', 'deny', 'mandates', 'reservations', 'effects'];

const ARGS = (amount = 100) => ({ sku: 'SKU-1', amount, currency: 'EUR' });
const none = { trust: 0, deny: 0, mandates: 0, reservations: 0, effects: 0 };
// Source calls by construction: the adapters read the trust source once and fetch the deny list once a bundle has
// verified; the delegated route of this application reads the trust set and fetches both lists once per request.
const directVerified = { ...none, trust: 1, deny: 1 };
const directUnverified = { ...none, trust: 1 };
const delegatedSources = { ...none, trust: 1, deny: 1, mandates: 1 };
// The real DCP outcome each response must carry once DCP was evaluated (R2): never a constant of the application.
const DIRECT_DCP = { admitted: true, action_authorized: false };
const DELEGATED_DCP = { admitted: true, delegation_active: true, action_authorized: false };
const NOT_ACTIVE_DCP = { admitted: true, delegation_active: false, action_authorized: false };
const REFUSED_DCP = { admitted: false, delegation_active: false, action_authorized: false };

const okDirect = (deltas, single = false) => ({ status: 200, app: null, codes: [], dcp: DIRECT_DCP, deltas: { ...deltas, effects: 1, reservations: single ? 1 : 0 } });
const okDelegated = (deltas, single = false) => ({ status: 200, app: null, codes: [], dcp: DELEGATED_DCP, deltas: { ...deltas, effects: 1, reservations: single ? 1 : 0 } });
// A refusal by the adapter: its own body, admitted false.
const adapterRefusal = (codes, deltas) => ({ status: 403, app: null, codes, admitted: false, deltas });
// A refusal of the composition by the SDK, reported by the application with the real outcome.
const compositionRefusal = (codes) => ({ status: 403, app: null, codes, dcp: REFUSED_DCP, deltas: delegatedSources });
const appDirect = (code, deltas = directVerified) => ({ status: 403, app: code, codes: [], dcp: DIRECT_DCP, deltas });
const appDelegated = (code) => ({ status: 403, app: code, codes: [], dcp: DELEGATED_DCP, deltas: delegatedSources });
const notActive = (activation) => ({ status: 403, app: 'APP_DELEGATION_NOT_ACTIVE', codes: [], dcp: NOT_ACTIVE_DCP, deltas: delegatedSources, ...activation });
const early = (status, code, extra = {}) => ({ status, app: code, codes: [], deltas: none, ...extra });

const quote = (over = {}) => ({ kind: 'direct', tenant: 'T1', action: 'quote', args: ARGS(), ...over });
const order = (over = {}) => ({ kind: 'direct', tenant: 'T1', action: 'order', args: ARGS(), ...over });
const dQuote = (over = {}) => ({ kind: 'delegated', tenant: 'T1', chain: 'valid', action: 'quote', args: ARGS(), ...over });
const dOrder = (over = {}) => ({ kind: 'delegated', tenant: 'T1', chain: 'valid', action: 'order', args: ARGS(), ...over });

/** One lane's steps: [group, name, valid, before (operator and service actions), request, expect]. */
function laneSteps() {
  const s = [];
  const add = (group, name, valid, before, request, expect) => s.push({ group, name, valid, before, request, expect });

  // G1 onboarding: P is not enrolled in T1 yet (T2 has Q).
  add('G1', 'principal_not_enrolled', false, [], quote(), { ...adapterRefusal(['TRUST_PRINCIPAL_UNKNOWN'], directVerified), tenant: 'T1' });
  add('G1', 'wrong_fingerprint_refused', false, [{ op: 'enroll', tenant: 'T1', document: 'p-k1', fingerprint: 'p-k2', refused: 'OP_FINGERPRINT_MISMATCH' }], null, { operator: 'OP_FINGERPRINT_MISMATCH', trust_unchanged: true, deltas: none });
  add('G1', 'tampered_document_refused', false, [{ op: 'enroll', tenant: 'T1', document: 'p-k1', tamper: 'human_id', fingerprint: 'p-k1', refused: 'OP_FINGERPRINT_MISMATCH' }], null, { operator: 'OP_FINGERPRINT_MISMATCH', trust_unchanged: true, deltas: none });
  add('G1', 'enrolled_out_of_band', true, [{ op: 'enroll', tenant: 'T1', document: 'p-k1', fingerprint: 'p-k1' }], quote(), { ...okDirect(directVerified), tenant: 'T1' });

  // G2 direct admission (quote).
  add('G2', 'valid', true, [], quote(), { ...okDirect(directVerified), tenant: 'T1' });
  add('G2', 'session_expired', false, [], quote({ manifest: 'expired' }), { ...adapterRefusal(['PROFILE_SESSION_EXPIRED', 'VERIFICATION_FAILED'], directUnverified), tenant: 'T1' });
  add('G2', 'other_audience', false, [], quote({ manifest: 'audience' }), { ...adapterRefusal(['PROFILE_AUDIENCE_MISMATCH', 'VERIFICATION_FAILED'], directUnverified), tenant: 'T1' });
  add('G2', 'action_not_in_policy', false, [], quote({ action: 'refund' }), { ...appDirect('APP_ACTION_NOT_AUTHORIZED'), tenant: 'T1' });
  add('G2', 'args_not_the_signed_ones', false, [], quote({ requestArgs: ARGS(200) }), { ...appDirect('APP_INTENT_MISMATCH'), tenant: 'T1' });

  // G3 tenants: the tenant comes only from the bearer token. The envelope is strict: a member it does not define,
  // tenant or operator fields alike, is refused before any source (400), which is not a trust refusal of the SDK.
  add('G3', 'valid_T1', true, [], quote(), { ...okDirect(directVerified), tenant: 'T1' });
  add('G3', 'T2_does_not_trust_P', false, [], quote({ tenant: 'T2' }), { ...adapterRefusal(['TRUST_PRINCIPAL_UNKNOWN'], directVerified), tenant: 'T2' });
  add('G3', 'x_tenant_header_ignored', false, [], quote({ tenant: 'T2', headers: { 'x-tenant': 'T1' } }), { ...adapterRefusal(['TRUST_PRINCIPAL_UNKNOWN'], directVerified), tenant: 'T2' });
  add('G3', 'tenant_in_body_refused', false, [], quote({ tenant: 'T2', envelope: { tenant: 'T1' } }), { ...early(400, 'APP_ENVELOPE_INVALID'), tenant: 'T2' });
  add('G3', 'operator_fields_in_body_refused', false, [], quote({ envelope: { trust: { trust_set_version: 'x', principals: [] }, profile: { profile: 'strict-v1', verifier_id: 'x' }, admitted: true, action_authorized: true } }), { ...early(400, 'APP_ENVELOPE_INVALID'), tenant: 'T1' });
  add('G3', 'no_token', false, [], quote({ tenant: null }), { ...early(401, 'APP_UNAUTHENTICATED'), tenant: null });
  add('G3', 'unknown_token', false, [], quote({ tenant: 'unknown' }), { ...early(401, 'APP_UNAUTHENTICATED'), tenant: null });
  add('G3', 'T3_without_trust_set', false, [], quote({ tenant: 'T3' }), { status: 503, app: null, codes: [], admitted: false, deltas: { ...none, trust: 1 }, tenant: 'T3' });

  // G4 withdrawal and restoration, without restarting.
  add('G4', 'withdrawn', false, [{ op: 'withdraw', tenant: 'T1', principal: 'P' }], quote(), { ...adapterRefusal(['TRUST_PRINCIPAL_UNKNOWN'], directVerified), tenant: 'T1' });
  add('G4', 'restored', true, [{ op: 'restore', tenant: 'T1', principal: 'P' }], quote(), { ...okDirect(directVerified), tenant: 'T1' });

  // G5 revocation on the direct route: fails closed (spec/profiles/admission § 4.3, R1-R4). The service serves the
  // operator's file as it is: a really old list is stale and a malformed date invalid, in normal mode.
  add('G5', 'agent_revoked', false, [{ op: 'revoke-agent', agent: 'A0' }], quote(), { ...adapterRefusal(['REVOCATION_REVOKED'], directVerified), tenant: 'T1' });
  add('G5', 'key_revoked', false, [{ op: 'unrevoke-agent', agent: 'A0' }, { op: 'revoke-kid', keyset: 'a0-k1' }], quote(), { ...adapterRefusal(['REVOCATION_REVOKED'], directVerified), tenant: 'T1' });
  add('G5', 'service_down', false, [{ op: 'unrevoke-kid', keyset: 'a0-k1' }, { op: 'mode', mode: 'down' }], quote(), { ...adapterRefusal(['REVOCATION_UNAVAILABLE'], directVerified), tenant: 'T1' });
  add('G5', 'list_stale_fault_injected', false, [{ op: 'mode', mode: 'stale' }], quote(), { ...adapterRefusal(['REVOCATION_STALE'], directVerified), tenant: 'T1' });
  add('G5', 'deny_list_really_old', false, [{ op: 'mode', mode: 'normal' }, { op: 'list-file', list: 'deny', state: 'aged' }], quote(), { ...adapterRefusal(['REVOCATION_STALE'], directVerified), tenant: 'T1' });
  add('G5', 'deny_list_malformed_date', false, [{ op: 'list-file', list: 'deny', state: 'malformed_date' }], quote(), { ...adapterRefusal(['REVOCATION_INVALID'], directVerified), tenant: 'T1' });
  add('G5', 'restored', true, [{ op: 'list-file', list: 'deny', state: 'fresh' }], quote(), { ...okDirect(directVerified), tenant: 'T1' });

  // G7 delegation and activation (quote by A2 through A1, chain "valid" unless stated).
  add('G7', 'valid', true, [], dQuote(), { ...okDelegated(delegatedSources), tenant: 'T1' });
  add('G7', 'leaf_mandate_revoked', false, [{ op: 'revoke-mandate', mandate: 'mandate:mp05-m2' }], dQuote(), { ...compositionRefusal(['DELEGATION_CHAIN_INVALID', 'REVOCATION_REVOKED']), tenant: 'T1' });
  add('G7', 'leaf_mandate_expired', false, [{ op: 'unrevoke-mandate', mandate: 'mandate:mp05-m2' }], dQuote({ chain: 'expired' }), { ...compositionRefusal(['DELEGATION_CHAIN_INVALID']), tenant: 'T1' });
  add('G7', 'leaf_mandate_not_yet_valid', false, [], dQuote({ chain: 'future' }), { ...compositionRefusal(['DELEGATION_CHAIN_INVALID']), tenant: 'T1' });
  add('G7', 'acknowledgment_missing', false, [], dQuote({ over: { acknowledgments: ['m1'], awareness_thresholds: ['m1'] } }), { ...notActive({ activation: ['ACK_MISSING'] }), tenant: 'T1' });
  add('G7', 'acknowledgment_signed_by_a1', false, [], dQuote({ over: { acknowledgments: ['m1', 'm2_by_a1'] } }), { ...notActive({ activation: ['ACK_KEY_UNKNOWN', 'ACK_KEY_UNKNOWN'] }), tenant: 'T1' });
  add('G7', 'acknowledgment_of_another_mandate', false, [], dQuote({ over: { acknowledgments: ['m1', 'm2_k2'], awareness_thresholds: ['m1', 'm2_k2'] } }), { ...notActive({ activationIncludes: ['ACK_MANDATE_MISMATCH'] }), tenant: 'T1' });
  add('G7', 'delegator_missing', false, [], dQuote({ over: { delegators: [] } }), { ...compositionRefusal(['DELEGATION_CHAIN_INVALID', 'DELEGATION_DELEGATOR_MISSING']), tenant: 'T1' });
  // Both lists at once: the delegator bundle is admitted with the same snapshot, so it is not admitted either
  // (spec/profiles/admission § 10, procedure step 3: DELEGATION_DELEGATOR_NOT_ADMITTED).
  add('G7', 'both_lists_down', false, [{ op: 'mode', mode: 'down' }], dQuote(), { ...compositionRefusal(['DELEGATION_DELEGATOR_NOT_ADMITTED', 'REVOCATION_UNAVAILABLE']), tenant: 'T1' });
  add('G7', 'both_lists_stale_fault_injected', false, [{ op: 'mode', mode: 'stale' }], dQuote(), { ...compositionRefusal(['DELEGATION_DELEGATOR_NOT_ADMITTED', 'REVOCATION_STALE']), tenant: 'T1' });
  // The list of mandates alone, with a valid deny list (delegated_admission_vectors mandate_revocation_unavailable and
  // mandate_revocation_stale): no delegator code.
  add('G7', 'mandate_list_only_unavailable', false, [{ op: 'mode', mode: 'normal' }, { op: 'list-file', list: 'mandates', state: 'unreadable' }], dQuote(), { ...compositionRefusal(['REVOCATION_UNAVAILABLE']), tenant: 'T1' });
  add('G7', 'mandate_list_only_really_old', false, [{ op: 'list-file', list: 'mandates', state: 'aged' }], dQuote(), { ...compositionRefusal(['REVOCATION_STALE']), tenant: 'T1' });
  add('G7', 'lists_restored', true, [{ op: 'list-file', list: 'mandates', state: 'fresh' }], dQuote(), { ...okDelegated(delegatedSources), tenant: 'T1' });
  add('G7', 'leaf_session_expired', false, [], dQuote({ manifest: 'expired' }), { ...compositionRefusal(['DELEGATION_CHAIN_INVALID', 'PROFILE_SESSION_EXPIRED', 'VERIFICATION_FAILED']), tenant: 'T1' });
  add('G7', 'leaf_other_audience', false, [], dQuote({ manifest: 'audience' }), { ...compositionRefusal(['DELEGATION_CHAIN_INVALID', 'PROFILE_AUDIENCE_MISMATCH', 'VERIFICATION_FAILED']), tenant: 'T1' });

  // G8 authorization with delegation: operator policy and every mandate; arguments bound to the signed intent.
  add('G8', 'order_at_leaf_limit', true, [], dOrder({ args: ARGS(5000) }), { ...okDelegated(delegatedSources, true), tenant: 'T1' });
  add('G8', 'order_over_leaf_limit', false, [], dOrder({ args: ARGS(5001) }), { ...appDelegated('APP_ARGS_OUT_OF_SCOPE'), tenant: 'T1' });
  add('G8', 'refund_in_mandates_not_in_policy', false, [], dOrder({ chain: 'r', action: 'refund' }), { ...appDelegated('APP_ACTION_NOT_AUTHORIZED'), tenant: 'T1' });
  add('G8', 'order_not_in_leaf', false, [], dOrder({ chain: 'q' }), { ...appDelegated('APP_ACTION_OUT_OF_SCOPE'), tenant: 'T1' });
  add('G8', 'leaf_other_domain', false, [], dOrder({ chain: 'dom' }), { ...appDelegated('APP_DOMAIN_OUT_OF_SCOPE'), tenant: 'T1' });
  add('G8', 'leaf_without_financial_data', false, [], dOrder({ chain: 'dc' }), { ...appDelegated('APP_DATA_CLASS_OUT_OF_SCOPE'), tenant: 'T1' });
  add('G8', 'low_chain_at_limit', true, [], dOrder({ chain: 'low', args: ARGS(3000) }), { ...okDelegated(delegatedSources, true), tenant: 'T1' });
  add('G8', 'low_chain_over_limit', false, [], dOrder({ chain: 'low', args: ARGS(3001) }), { ...appDelegated('APP_ARGS_OUT_OF_SCOPE'), tenant: 'T1' });
  // DCP-09 § 3.5.2 rule 5 (chain vectors loosened_numeric_limit, dropped_limit_key); composition code as rules 4 and 6.
  add('G8', 'looser_sub_mandate', false, [], dOrder({ chain: 'looser' }), { ...compositionRefusal(['DELEGATION_CHAIN_INVALID']), tenant: 'T1' });
  add('G8', 'args_not_the_signed_ones', false, [], dOrder({ requestArgs: ARGS(200) }), { ...appDelegated('APP_INTENT_MISMATCH'), tenant: 'T1' });
  add('G8', 'extra_data_class_signed', false, [], dOrder({ intent: { data_classes: ['financial_data', 'pii'] } }), { ...appDelegated('APP_INTENT_MISMATCH'), tenant: 'T1' });
  add('G8', 'other_route_signed', false, [], dOrder({ signRoute: 'direct' }), { ...appDelegated('APP_INTENT_MISMATCH'), tenant: 'T1' });
  add('G8', 'boolean_amount_signed', false, [], dOrder({ args: { sku: 'SKU-1', amount: true, currency: 'EUR' } }), { ...appDelegated('APP_ARGS_INVALID'), tenant: 'T1' });

  // G9 single use: the reservation follows the signed intent, never the request.
  add('G9', 'new_intent', true, [], dOrder(), { ...okDelegated(delegatedSources, true), tenant: 'T1' });
  add('G9', 'eight_concurrent', false, [], { kind: 'concurrent', count: 8, request: dOrder() }, {
    responses: { 200: 1, 409: 7 },
    app409: 'APP_ALREADY_CONSUMED',
    dcp: DELEGATED_DCP,
    deltas: { trust: 8, deny: 8, mandates: 8, reservations: 1, effects: 1 },
    tenant: 'T1',
  });
  add('G9', 'replay_other_request_id_reserialized', false, [], { kind: 'replay', of: 'eight_concurrent', reserialize: true }, { ...early(409, 'APP_ALREADY_CONSUMED'), dcp: DELEGATED_DCP, deltas: delegatedSources, tenant: 'T1' });
  add('G9', 'direct_first', true, [], order(), { ...okDirect(directVerified, true), tenant: 'T1' });
  add('G9', 'direct_repeat', false, [], { kind: 'replay', of: 'direct_first' }, { ...early(409, 'APP_ALREADY_CONSUMED'), dcp: DIRECT_DCP, deltas: directVerified, tenant: 'T1' });

  // G10 ingress, on both routes, refused before any source; each with its valid twin.
  for (const [route, twin] of [
    ['direct', quote()],
    ['delegated', dQuote()],
  ]) {
    const raw = (mutation) => ({ kind: 'raw', route, mutation, base: twin });
    const rejected = (reason) => ({ ...early(400, 'APP_INGRESS_REJECTED', { reason }), tenant: 'T1' });
    add('G10', `${route}_valid_twin`, true, [], twin, { ...(route === 'direct' ? okDirect(directVerified) : okDelegated(delegatedSources)), tenant: 'T1' });
    add('G10', `${route}_duplicate_key_in_envelope`, false, [], raw('duplicate_key_in_envelope'), rejected('DUPLICATE_KEY'));
    add('G10', `${route}_duplicate_key_in_args`, false, [], raw('duplicate_key_in_args'), rejected('DUPLICATE_KEY'));
    add('G10', `${route}_duplicate_key_in_bundle`, false, [], raw('duplicate_key_in_bundle'), rejected('DUPLICATE_KEY'));
    add('G10', `${route}_fraction`, false, [], raw('fraction'), rejected('NUMBER_FORM'));
    add('G10', `${route}_rounded_fraction`, false, [], raw('rounded_fraction'), rejected('NUMBER_FORM'));
    add('G10', `${route}_exponent`, false, [], raw('exponent'), rejected('NUMBER_FORM'));
    add('G10', `${route}_negative_zero`, false, [], raw('negative_zero'), rejected('NUMBER_FORM'));
    add('G10', `${route}_lone_surrogate`, false, [], raw('lone_surrogate'), rejected('UNICODE'));
    add('G10', `${route}_invalid_utf8`, false, [], raw('invalid_utf8'), rejected('UTF8'));
    add('G10', `${route}_over_budget_declared`, false, [], raw('over_budget'), { ...early(413, 'APP_INGRESS_TOO_LARGE'), tenant: 'T1' });
    add('G10', `${route}_over_budget_chunked`, false, [], raw('over_budget_chunked'), { ...early(413, 'APP_INGRESS_TOO_LARGE'), tenant: 'T1' });
    add('G10', `${route}_bundle_header`, false, [], raw('bundle_header'), { ...early(400, 'APP_BUNDLE_HEADER_REJECTED'), tenant: null });
    add('G10', `${route}_content_type`, false, [], raw('content_type'), { ...early(415, 'APP_CONTENT_TYPE_REJECTED'), tenant: null });
    add('G10', `${route}_envelope_member`, false, [], raw('envelope_member'), { ...early(400, 'APP_ENVELOPE_INVALID'), tenant: 'T1' });
  }

  // G6 rotation, last: the operator anchors keys; nothing is trusted from a bundle; old evidence stops passing.
  add('G6', 'new_key_not_anchored', false, [], quote({ principalKeyset: 'p-k2' }), { ...adapterRefusal(['TRUST_KEY_NOT_ANCHORED'], directVerified), tenant: 'T1' });
  add('G6', 'overlap_old_key', true, [{ op: 'add-key', tenant: 'T1', document: 'p-k2', fingerprint: 'p-k2' }], quote(), { ...okDirect(directVerified), tenant: 'T1' });
  add('G6', 'overlap_new_key', true, [], quote({ principalKeyset: 'p-k2' }), { ...okDirect(directVerified), tenant: 'T1' });
  add('G6', 'agent_rotated_chain', true, [], dQuote({ chain: 'rot_agent' }), { ...okDelegated(delegatedSources), tenant: 'T1' });
  add('G6', 'old_m2_after_agent_rotation', false, [], dQuote({ over: { delegators: [{ agent: 'A1', keyset: 'a1-k2' }] } }), { ...compositionRefusal(['DELEGATION_CHAIN_INVALID']), tenant: 'T1' });
  add('G6', 'old_a1_acknowledgment_after_agent_rotation', false, [], dQuote({ chain: 'rot_agent', over: { acknowledgments: ['m1', 'm2_a1k2'], awareness_thresholds: ['m1', 'm2_a1k2'] } }), { ...notActive({ activationOnly: ['ACK_KEY_UNKNOWN'] }), tenant: 'T1' });
  add('G6', 'old_key_retired', false, [{ op: 'retire-key', tenant: 'T1', principal: 'P', keyset: 'p-k1' }], quote(), { ...adapterRefusal(['TRUST_KEY_EXPIRED'], directVerified), tenant: 'T1' });
  add('G6', 'new_key_after_retirement', true, [], quote({ principalKeyset: 'p-k2' }), { ...okDirect(directVerified), tenant: 'T1' });
  add('G6', 'old_root_after_retirement', false, [], dQuote({ over: { principal: { name: 'P', keyset: 'p-k2' } } }), { ...compositionRefusal(['TRUST_KEY_EXPIRED']), tenant: 'T1' });
  add('G6', 'reissued_root_chain', true, [], dQuote({ chain: 'rot_principal' }), { ...okDelegated(delegatedSources), tenant: 'T1' });
  add('G6', 'old_acknowledgments_after_root_reissue', false, [], dQuote({ chain: 'rot_principal', over: { acknowledgments: ['m1', 'm2'], awareness_thresholds: ['m1', 'm2'] } }), { ...notActive({ activationIncludes: ['ACK_MANDATE_MISMATCH'] }), tenant: 'T1' });
  return s;
}

export function buildPlan(lanes = LANES) {
  const steps = [];
  for (const lane of lanes) {
    const own = laneSteps();
    for (const group of EXECUTION_ORDER) {
      own
        .filter((x) => x.group === group)
        .forEach((step, i) => {
          const before = i === 0 ? [{ op: 'refresh-lists' }, ...step.before] : step.before;
          steps.push({ id: `${lane}.${group}.${step.name}`, lane, ...step, before });
        });
    }
  }
  return { plan_format: PLAN_FORMAT, lanes, groups: GROUPS, execution_order: EXECUTION_ORDER, steps };
}

/** Refuses a plan without steps, with a lane missing a group, a group without a valid and a negative step, a repeated
 * id or a step without expectations. */
export function checkPlan(plan) {
  if (plan?.plan_format !== PLAN_FORMAT || !Array.isArray(plan.steps) || plan.steps.length === 0) throw new Error('empty plan');
  if (!Array.isArray(plan.lanes) || plan.lanes.length === 0) throw new Error('plan without lanes');
  const ids = new Set();
  for (const step of plan.steps) {
    if (ids.has(step.id)) throw new Error(`repeated step id ${step.id}`);
    ids.add(step.id);
    if (!step.expect || !step.expect.deltas || !DELTAS.every((d) => Number.isInteger(step.expect.deltas[d]))) {
      throw new Error(`step ${step.id} has no complete expectations`);
    }
  }
  for (const lane of plan.lanes) {
    for (const group of GROUPS) {
      const own = plan.steps.filter((x) => x.lane === lane && x.group === group);
      if (own.length === 0) throw new Error(`lane ${lane} has no ${group}`);
      if (!own.some((x) => x.valid) || !own.some((x) => !x.valid)) throw new Error(`lane ${lane} ${group} needs a valid and a negative step`);
    }
  }
  return plan.steps.length;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The failures of one step: an empty list is a PASS. observed: {error?, status?, body?, responses?, deltas, tenant,
 * operator?}. An exception, a 500 or any unexpected status, code, outcome or count is a failure; a refusal is never
 * inferred from an exception, and an absent observation ("missing") never matches a tenant.
 */
export function evaluateStep(step, observed) {
  const e = step.expect;
  const f = [];
  if (observed.error) return [`infrastructure: ${observed.error}`];
  for (const d of DELTAS) {
    if (observed.deltas?.[d] !== e.deltas[d]) f.push(`delta ${d}: expected ${e.deltas[d]}, observed ${observed.deltas?.[d]}`);
  }
  if (e.operator !== undefined) {
    if (observed.operator !== e.operator) f.push(`operator: expected ${e.operator}, observed ${observed.operator}`);
    if (e.trust_unchanged && observed.trust_unchanged !== true) f.push('the trust set changed');
    return f;
  }
  if (e.responses) {
    const counts = {};
    for (const r of observed.responses ?? []) counts[r.status] = (counts[r.status] ?? 0) + 1;
    if (!same(counts, e.responses)) f.push(`responses: expected ${JSON.stringify(e.responses)}, observed ${JSON.stringify(counts)}`);
    for (const r of observed.responses ?? []) {
      if (r.status === 409 && r.body?.code !== e.app409) f.push(`409 code ${r.body?.code}`);
      if (r.status === 200 && !(r.body?.ok === true && r.body.application_authorized === true)) f.push('200 body');
      if (!same(r.body?.dcp, e.dcp)) f.push(`dcp of a ${r.status}: ${JSON.stringify(r.body?.dcp)}`);
    }
    if (!same(observed.tenants ?? [], Array(observed.responses?.length ?? 0).fill(e.tenant))) f.push(`tenants ${JSON.stringify(observed.tenants)}`);
    return f;
  }
  const body = observed.body ?? {};
  if (observed.status !== e.status) f.push(`status: expected ${e.status}, observed ${observed.status}`);
  if ((body.code ?? null) !== e.app) f.push(`application code: expected ${e.app}, observed ${body.code ?? null}`);
  const codes = Array.isArray(body.codes) ? [...body.codes].sort() : [];
  if (!same(codes, [...e.codes].sort())) f.push(`DCP codes: expected ${JSON.stringify(e.codes)}, observed ${JSON.stringify(codes)}`);
  if (e.dcp !== undefined && !same(body.dcp, e.dcp)) f.push(`DCP outcome: expected ${JSON.stringify(e.dcp)}, observed ${JSON.stringify(body.dcp)}`);
  if (e.dcp === undefined && body.dcp !== undefined) f.push(`unexpected DCP outcome ${JSON.stringify(body.dcp)}`);
  if (e.admitted !== undefined && body.admitted !== e.admitted) f.push(`admitted: expected ${e.admitted}, observed ${body.admitted}`);
  const activation = body.activation_codes ?? [];
  if (e.activation && !same(activation, e.activation)) f.push(`activation: expected ${JSON.stringify(e.activation)}, observed ${JSON.stringify(activation)}`);
  if (e.activationIncludes && !e.activationIncludes.every((c) => activation.includes(c))) f.push(`activation lacks ${e.activationIncludes}: ${JSON.stringify(activation)}`);
  if (e.activationOnly && !(activation.length > 0 && activation.every((c) => e.activationOnly.includes(c)))) f.push(`activation not only ${e.activationOnly}: ${JSON.stringify(activation)}`);
  if (e.reason !== undefined && body.reason !== e.reason) f.push(`ingress reason: expected ${e.reason}, observed ${body.reason}`);
  if (observed.tenant !== e.tenant) f.push(`tenant: expected ${e.tenant}, observed ${observed.tenant}`);
  if (e.status === 200 && !(body.ok === true && body.application_authorized === true)) f.push('200 body');
  if (body.action_authorized === true || body.dcp?.action_authorized === true) f.push('action_authorized true');
  return f;
}
