#!/usr/bin/env node
// Writes or checks tools/conformance/external-delegation-catalog.json (contract dcp-ai-conformance-external/4) from
// the committed mandate chain corpora. It decides nothing about verdicts: those stay in the corpora. It restates the
// runner's fixed informative classification, assigns each normative negative the DCP-09 §3.5.2 rule written below by
// hand, and picks its control by the bytes both cases send (the runner checks that relation again when it loads).
//
//   node tools/conformance/delegation-catalog.mjs --check    # exit 1 if the committed catalog differs
//   node tools/conformance/delegation-catalog.mjs --write
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { SUITES, INFORMATIVE, BASES, DELEGATION_CONTRACT, DELEGATION_CATALOG_PATH, loadFixture, fixtureCase, scopeHolds } from "./external-delegation.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");

// The rule of DCP-09 §3.5.2 each normative rejection exercises; fail_closed is its preamble (an unknown value, a field
// missing for the depth or an input that is not comparable). Every accepted chain is all_rules.
const ANCHOR = {
  "external.delegation.chain": {
    widened_actions_permitted: "rule5", added_data_classes: "rule5", dropped_data_classes: "rule5", data_classes_where_parent_has_none: "rule5",
    loosened_numeric_limit: "rule5", changed_non_numeric_limit: "rule5", dropped_limit_key: "rule5", limit_type_changed: "rule5",
    limit_of_2_53_is_not_comparable: "rule5", limit_of_2_53_plus_1_over_a_parent_at_the_bound: "rule5", added_limit_of_2_53_plus_1: "rule5",
    unknown_domain: "rule5", duplicate_domain_in_child: "rule5",
    validity_extended_beyond_parent: "rule4", validity_starts_before_parent: "rule4", validity_offset_compared_as_text_would_pass: "rule4",
    not_yet_valid_at_verification_time: "rule4", expired_at_verification_time: "rule4",
    depth_exceeded: "rule3", sub_delegation_not_permitted: "rule3",
    missing_parent_mandate_id: "rule2", wrong_parent_mandate_id: "rule2", delegation_depth_wrong: "rule2", delegation_depth_missing: "rule2",
    human_id_changed: "rule2", sub_mandate_signed_by_wrong_agent: "rule2", sub_mandate_signed_by_its_own_agent: "rule2",
    sub_mandate_signed_by_the_human: "rule2", sub_mandate_tampered_after_signing: "rule2", sub_mandate_with_human_signature_only: "rule2",
    sub_mandate_under_the_delegation_context: "rule2",
    root_tampered_after_signing: "rule1", root_signed_by_an_agent: "rule1", both_signatures_present: "rule1", root_with_delegator_signature: "rule1",
    root_with_delegation_depth_1: "rule1", root_with_parent_mandate_id: "rule1", chain_out_of_order: "rule1",
    lowered_minimum_security_tier: "rule6", dropped_minimum_security_tier: "rule6",
    revoked_root: "rule7", revoked_intermediate: "rule7",
    unknown_minimum_security_tier: "fail_closed", malformed_sub_delegation: "fail_closed",
  },
  "external.delegation.chain_time": {
    root_expired_by_one_millisecond: "rule4", sub_not_yet_valid_by_one_millisecond: "rule4", sub_starts_one_millisecond_before_the_parent: "rule4",
    sub_ends_one_millisecond_after_the_parent: "rule4", root_window_in_year_minus_1: "rule4", sub_window_starting_in_year_10000: "rule4",
  },
  "external.delegation.domains": {
    root_identical_duplicate: "rule5", root_conflicting_duplicate: "rule5", root_nonadjacent_duplicate: "rule5", root_each_duplicate_reported_once: "rule5",
    root_duplicate_with_a_sub: "rule5", root_duplicate_with_two_levels_below: "rule5", sub_duplicate: "rule5", third_level_duplicate: "rule5",
    root_duplicate_named_proto: "rule5", root_duplicate_named_constructor: "rule5", root_exact_unicode_duplicate_beside_its_nfd_form: "rule5",
    root_duplicate_and_an_invalid_tier: "rule5", sub_takes_a_case_variant_with_fewer_actions: "rule5", sub_domain_with_a_trailing_space: "rule5",
    root_duplicate_beside_an_invalid_entry: "fail_closed",
  },
};

const TEXT = {
  "external.delegation.chain": {
    title: "DCP-09 §3.5.2 mandate chains: signatures and roles, links, depth, attenuation, windows, tier floor, revocation",
    claim: "The verdict of each committed chain at the corpus verification time, with the keys and revoked ids it gives; for accepted chains, the effective tier (rule 6).",
  },
  "external.delegation.chain_time": {
    title: "DCP-09 §3.5.2 rule 4 mandate chain times: windows, nesting and the verification time as RFC 3339 instants",
    claim: "The verdict of each normative chain at its verification time; ten cases that rest on millisecond precision or on signer key validity are informative.",
  },
  "external.delegation.domains": {
    title: "DCP-09 §3.5.2 rule 5: a domain that appears twice in one mandate, at every depth, compared as exact strings",
    claim: "The verdict of each committed chain; the exact error lists of the corpus are the SDKs' diagnostics and are reported, never judged.",
  },
};
const SUITE_LIMITS = [
  "Only valid, and effective_tier on accepted chains, are judged. Error texts, their order and depth are diagnostics of the SDK APIs, not of DCP-09.",
  "The keys and the revoked ids are given in the request, out of band: the kit does not establish whose keys they are, and valid is not trust in the principal, admission or the authorization of an action.",
];
const LIMITS = [
  "A pass shows that the argv that was run gives these verdicts on these committed chains, nothing more.",
  "Chains and keys are sent as the exact bytes of the fixtures; how an implementation reads JSON numbers past 2^53 is its own.",
  "The informative cases rest on conventions DCP-09 §3.5.2 does not state; their results are reported apart and never make a run pass or fail, but a missing, malformed or failed answer to them is an error.",
  "Controls relate a negative to a positive by the bytes both send (same chain, one different mandate, or the same length); none claims the two differ by a single defect.",
  "The validity helper, tier_floor (computeSecurityTier) and every other DCP-09 record are outside this catalog.",
];
const RANK = ["same_chain", "single_mandate", "same_shape"];

export function buildCatalog(root = ROOT) {
  const fixtures = {};
  const suites = SUITES.map(({ id, file }) => {
    const fx = loadFixture(root, file, undefined);
    fixtures[file] = fx.sha256;
    const all = [
      ...fx.doc.must_accept.map((_c, i) => fixtureCase(fx, "must_accept", i, `${file} must_accept ${i}`)),
      ...fx.doc.must_reject.map((_c, i) => fixtureCase(fx, "must_reject", i, `${file} must_reject ${i}`)),
    ].map((f) => ({ ...f, id: `${id}.${f.name}` }));
    const positives = all.filter((f) => f.list === "must_accept" && !Object.hasOwn(INFORMATIVE, f.id));
    const cases = all.map((f) => {
      const base = { id: f.id, name: f.name, list: f.list, index: f.index };
      if (Object.hasOwn(INFORMATIVE, f.id)) return { ...base, class: "informative", basis: INFORMATIVE[f.id] };
      if (f.list === "must_accept") return { ...base, class: "normative", anchor: "all_rules" };
      const anchor = ANCHOR[id][f.name];
      if (!anchor) throw new Error(`${f.id}: no anchor in the table`);
      // The closest normative positive: the same chain, then one different mandate, then the same length.
      let best = null;
      for (const p of positives) {
        const scope = RANK.find((s) => scopeHolds(s, f, p));
        if (scope && (!best || RANK.indexOf(scope) < RANK.indexOf(best.scope))) best = { scope, id: p.id };
      }
      return best ? { ...base, class: "normative", anchor, controls: [best.id], control_scope: best.scope }
        : { ...base, class: "normative", anchor, controls: positives.map((p) => p.id), control_scope: "suite" };
    });
    const used = new Set(cases.filter((c) => c.list === "must_reject" && c.class === "normative").map((c) => c.name));
    const extra = Object.keys(ANCHOR[id]).filter((n) => !used.has(n));
    if (extra.length) throw new Error(`${id}: anchors for cases that are not normative rejections: ${extra.join(", ")}`);
    return { id, title: TEXT[id].title, source: file, claim: TEXT[id].claim, limits: SUITE_LIMITS, cases };
  });
  return { contract: DELEGATION_CONTRACT, catalog_version: "1.0.0", fixtures, informative_bases: BASES, informative: INFORMATIVE, suites, limits: LIMITS };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const mode = process.argv[2];
  if (process.argv.length !== 3 || !["--check", "--write"].includes(mode)) {
    console.error("usage: delegation-catalog.mjs --check | --write");
    process.exit(2);
  }
  const text = `${JSON.stringify(buildCatalog(), null, 2)}\n`;
  if (mode === "--write") {
    fs.writeFileSync(DELEGATION_CATALOG_PATH, text);
    console.log(`wrote ${path.relative(ROOT, DELEGATION_CATALOG_PATH)}`);
  } else {
    const current = fs.existsSync(DELEGATION_CATALOG_PATH) ? fs.readFileSync(DELEGATION_CATALOG_PATH, "utf8") : "";
    if (current !== text) {
      console.error(`${path.relative(ROOT, DELEGATION_CATALOG_PATH)} differs from what the corpora and this generator give`);
      process.exit(1);
    }
    console.log(`${path.relative(ROOT, DELEGATION_CATALOG_PATH)} is up to date`);
  }
}
