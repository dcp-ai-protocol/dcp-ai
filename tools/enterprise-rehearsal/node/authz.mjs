// Application authorization of the MP-05 rehearsal (TEST ONLY; design v0.2 § 2.6 with the P2a corrections).
//
// Runs after the SDK admitted the evidence. Both the operator policy and, on the delegated route, the scope of every
// mandate of the chain must allow the action; the request arguments must match the signed intent. Nothing the agent
// sends widens the policy. Returns {ok: true, ...} or {ok: false, code, detail}; the caller maps a refusal to 403.
import { canonicalizeV2 } from '@dcp-ai/sdk';
import { isObject, sha256Hex } from './common.mjs';

const fail = (code, detail) => ({ ok: false, code, detail });
const sameMembers = (o, members) => {
  const k = Object.keys(o).sort();
  const m = [...members].sort();
  return k.length === m.length && k.every((x, i) => x === m[i]);
};
const own = (o, k) => isObject(o) && Object.hasOwn(o, k);

export const argsSha256 = (args) => `sha256:${sha256Hex(Buffer.from(canonicalizeV2(args), 'utf8'))}`;
export const routePath = (contract, route, action) => contract.routes[route].path.replace('{action}', action);

/** null, or the first member of args that breaks the contract (members, types, units). */
export function checkArgs(contract, args) {
  const spec = contract.args;
  if (!isObject(args) || !sameMembers(args, spec.members)) return 'members';
  if (typeof args.sku !== 'string' || !new RegExp(spec.sku_pattern).test(args.sku)) return 'sku';
  const a = args.amount;
  if (typeof a !== 'number' || !Number.isSafeInteger(a) || a < spec.amount.minimum || a > spec.amount.maximum) return 'amount';
  if (!spec.currencies.includes(args.currency)) return 'currency';
  return null;
}

/** null, or the first member of the signed intent that does not match the route, the action or the args. */
export function checkIntent(contract, policy, route, action, args, intent) {
  const a = contract.actions[action];
  if (!isObject(intent)) return 'intent';
  if (intent.action_type !== a.action_type) return 'action_type';
  const t = intent.target;
  if (!isObject(t) || !sameMembers(t, contract.intent_binding.target_members)) return 'target';
  if (t.channel !== a.channel) return 'target.channel';
  if (t.domain !== policy.domain) return 'target.domain';
  if (t.url !== routePath(contract, route, action)) return 'target.url';
  const x = t.x_rehearsal;
  if (!isObject(x) || !sameMembers(x, contract.intent_binding.x_rehearsal_members)) return 'target.x_rehearsal';
  if (x.action !== action) return 'target.x_rehearsal.action';
  if (x.args_sha256 !== argsSha256(args)) return 'target.x_rehearsal.args_sha256';
  const dc = intent.data_classes;
  if (!Array.isArray(dc) || new Set(dc).size !== dc.length || dc.length !== a.data_classes.length) return 'data_classes';
  if (!a.data_classes.every((c) => dc.includes(c))) return 'data_classes';
  return null;
}

/**
 * route: 'direct' | 'delegated'. intent: the verified intent payload (the leaf's on the delegated route). agentId and
 * principalId: from the verified bundle. chain: the mandates the SDK admitted, root first (delegated route only).
 */
export function authorize({ contract, policy, route, action, args, intent, agentId, principalId, chain }) {
  if (!own(contract.routes, route)) return fail('APP_ACTION_NOT_AUTHORIZED', 'route');
  if (typeof action !== 'string' || !own(contract.actions, action)) return fail('APP_ACTION_NOT_AUTHORIZED', 'unknown action');
  const badArgs = checkArgs(contract, args);
  if (badArgs) return fail('APP_ARGS_INVALID', badArgs);
  const badIntent = checkIntent(contract, policy, route, action, args, intent);
  if (badIntent) return fail('APP_INTENT_MISMATCH', badIntent);

  const table = route === 'direct' ? policy.direct_agents : policy.delegated_principals;
  const actor = route === 'direct' ? agentId : principalId;
  const allowed = typeof actor === 'string' && own(table, actor) ? table[actor] : null;
  if (!Array.isArray(allowed) || !allowed.includes(action)) return fail('APP_ACTION_NOT_AUTHORIZED', 'operator policy');
  const cap = own(policy.max_amount, action) ? policy.max_amount[action] : undefined;
  if (!Number.isSafeInteger(cap) || cap < 0) return fail('APP_ACTION_NOT_AUTHORIZED', 'no operator cap');
  if (args.amount > cap) return fail('APP_ARGS_OUT_OF_SCOPE', 'operator cap');
  let limit = cap;

  if (route === 'delegated') {
    if (!Array.isArray(chain) || chain.length === 0) return fail('APP_DELEGATION_NOT_ACTIVE', 'no chain');
    for (const [i, m] of chain.entries()) {
      const at = `mandate ${i}`;
      const entries = isObject(m) && Array.isArray(m.authority_scope) ? m.authority_scope.filter((e) => isObject(e) && e.domain === policy.domain) : [];
      if (entries.length !== 1) return fail('APP_DOMAIN_OUT_OF_SCOPE', at);
      const e = entries[0];
      if (!Array.isArray(e.actions_permitted) || !e.actions_permitted.includes(action)) return fail('APP_ACTION_OUT_OF_SCOPE', at);
      if (!Array.isArray(e.data_classes) || !intent.data_classes.every((c) => e.data_classes.includes(c))) {
        return fail('APP_DATA_CLASS_OUT_OF_SCOPE', at);
      }
      if (own(e, 'limits')) {
        if (!isObject(e.limits)) return fail('APP_ARGS_OUT_OF_SCOPE', `${at} limits`);
        if (Object.hasOwn(e.limits, 'max_amount')) {
          const max = e.limits.max_amount;
          if (!Number.isSafeInteger(max) || max < 0 || args.amount > max) return fail('APP_ARGS_OUT_OF_SCOPE', `${at} max_amount`);
          limit = Math.min(limit, max);
        }
      }
    }
  }
  return { ok: true, action, amount: args.amount, single_use: contract.actions[action].single_use, limit };
}
