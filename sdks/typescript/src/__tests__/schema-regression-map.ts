/**
 * The historical rejects that V2-2 now decides first (tests/interop/v2/schema_validation/regression_map.json): for
 * these rows a test asserts the exact schema diagnostics both oracles report, instead of the historical
 * error_contains, which belonged to a deeper check the row no longer reaches. Where that check stays reachable, the
 * map names its coverage (schema-valid rows, deep_negatives.json or a helper's direct test; see schema-v2.test.ts).
 */
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { expect } from 'vitest';

import { SCHEMA_ERRORS_CAP, boundedToken } from '../core/schema-v2.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
type SchemaError = { instance: string; keyword: string; member?: string };
type Row = { fixture: string; group: string; name: string; historical_error_contains: string; schema_errors: SchemaError[]; deep_coverage: { kind: string } };
export const REGRESSION_MAP = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../tests/interop/v2/schema_validation/regression_map.json'), 'utf8'),
) as { rows: Row[] };

/** The verifier's wording of one schema error. */
export const diagnostic = (e: SchemaError) => `schema: ${e.instance || '/'} ${e.keyword}${e.member !== undefined ? ` ${boundedToken(e.member)}` : ''}`;

/** The row of `fixture` (path under tests/interop/v2/) named `name`, when V2-2 now decides it. */
export function schemaFirstRow(fixture: string, name: string): Row | undefined {
  return REGRESSION_MAP.rows.find((r) => r.fixture === `tests/interop/v2/${fixture}` && r.name === name);
}

/** A rejection by V2-2 with exactly the oracles' schema errors (the first 16 and the marker when there are more). */
export function expectSchemaRejection(result: { verified: boolean; errors: string[] }, row: Row): void {
  expect(result.verified).toBe(false);
  const want = row.schema_errors.map(diagnostic);
  if (want.length <= SCHEMA_ERRORS_CAP) {
    expect([...result.errors].sort(), row.name).toEqual([...want].sort());
  } else {
    expect(result.errors.length, row.name).toBe(SCHEMA_ERRORS_CAP + 1);
    expect(result.errors.at(-1)).toBe('schema: further errors not listed');
    for (const e of result.errors.slice(0, -1)) expect(want, row.name).toContain(e);
  }
}
