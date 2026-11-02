// The historical rejects that V2-2 now decides first (tests/interop/v2/schema_validation/regression_map.json): for
// these rows a test asserts the exact schema diagnostics both oracles report, instead of the historical
// error_contains, which belonged to a deeper check the row no longer reaches. Where that check stays reachable, the map
// names its coverage (schema-valid rows, deep_negatives.json or a helper's direct test; see test/schema-v2.mjs).
import { readFileSync } from 'node:fs';

export const REGRESSION_MAP = JSON.parse(
  readFileSync(new URL('../../../tests/interop/v2/schema_validation/regression_map.json', import.meta.url), 'utf8'),
);

/** The verifier's wording of a member name: RFC 6901 escaped, then cut to 64 code points. */
export const boundedToken = (s) => {
  const t = s.replaceAll('~', '~0').replaceAll('/', '~1');
  const cps = [...t];
  return cps.length > 64 ? `${cps.slice(0, 64).join('')}…[cut]` : t;
};

/** The row of `fixture` (a file under tests/interop/v2/) named `name`, when V2-2 now decides it. */
export const schemaFirstRow = (fixture, name) =>
  REGRESSION_MAP.rows.find((r) => r.fixture === `tests/interop/v2/${fixture}` && r.name === name);

export const expectedDiagnostics = (row) =>
  row.schema_errors
    .map((e) => `schema: ${e.instance || '/'} ${e.keyword}${e.member !== undefined ? ` ${boundedToken(e.member)}` : ''}`)
    .sort();

/** True when `errors` are exactly `want` (sorted), or its first 16 and the truncation marker. */
export const sameSchemaDiagnostics = (errors, want) => {
  if (want.length <= 16) return JSON.stringify([...errors].sort()) === JSON.stringify(want);
  return errors.length === 17 && errors[16] === 'schema: further errors not listed' && errors.slice(0, 16).every((e) => want.includes(e));
};

/** A rejection by V2-2 with exactly the oracles' schema errors of `row`. */
export const isSchemaRejection = (result, row) =>
  result.verified === false && sameSchemaDiagnostics(result.errors, expectedDiagnostics(row));
