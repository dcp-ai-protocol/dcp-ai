/**
 * JSON Schema validation for DCP artifacts.
 * Loads schemas from the bundled schema definitions.
 */
import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import type { ValidationResult } from '../types/index.js';

// Inline schema definitions (v1) so the SDK is self-contained.
import { SCHEMAS } from '../schemas/v1.js';

let _ajv: InstanceType<typeof Ajv> | null = null;

function getAjv(): InstanceType<typeof Ajv> {
  if (_ajv) return _ajv;
  _ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(_ajv);
  for (const schema of Object.values(SCHEMAS)) {
    if (schema.$id) _ajv.addSchema(schema, schema.$id);
    else _ajv.addSchema(schema);
  }
  return _ajv;
}

function formatErrors(errors: any[] | null | undefined): string[] {
  return (errors || []).map(
    (e: any) => `${e.instancePath || '/'} ${e.message}`,
  );
}

/** Validate a JSON object against a named DCP schema. */
export function validateSchema(
  schemaName: string,
  data: unknown,
): ValidationResult {
  const ajv = getAjv();
  const schemaId = `https://dcp-ai.org/schemas/v1/${schemaName}.schema.json`;
  const validate = ajv.getSchema(schemaId);
  if (!validate) {
    return { valid: false, errors: [`Schema not found: ${schemaName}`] };
  }
  const ok = validate(data);
  if (ok) return { valid: true };
  return { valid: false, errors: formatErrors(validate.errors) };
}

/** Validate a Citizenship Bundle (all artifacts + audit entries). */
export function validateBundle(bundle: any): ValidationResult {
  const errors: string[] = [];
  const artifacts: [string, (b: any) => any, string][] = [
    ['human_binding_record', (b) => b.human_binding_record, 'human_binding_record'],
    ['agent_passport', (b) => b.agent_passport, 'agent_passport'],
    ['intent', (b) => b.intent, 'intent'],
    ['policy_decision', (b) => b.policy_decision, 'policy_decision'],
  ];

  for (const [schemaName, getter, name] of artifacts) {
    const obj = getter(bundle);
    if (obj == null) {
      errors.push(`${name}: missing`);
      continue;
    }
    const result = validateSchema(schemaName, obj);
    if (!result.valid) {
      result.errors?.forEach((e) => errors.push(`${name}: ${e}`));
    }
  }

  if (!Array.isArray(bundle.audit_entries) || bundle.audit_entries.length === 0) {
    errors.push('audit_entries must be a non-empty array');
  } else {
    for (let i = 0; i < bundle.audit_entries.length; i++) {
      const result = validateSchema('audit_entry', bundle.audit_entries[i]);
      if (!result.valid) {
        result.errors?.forEach((e) => errors.push(`audit_entries[${i}]: ${e}`));
      }
    }
  }

  if (errors.length > 0) return { valid: false, errors };
  return { valid: true };
}
