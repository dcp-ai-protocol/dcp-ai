#!/usr/bin/env node
import fs from "fs";
import path from "path";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function addAllSchemas(ajv, schemasDir) {
  if (!fs.existsSync(schemasDir)) return;
  const files = fs.readdirSync(schemasDir).filter(f => f.endsWith(".json"));
  for (const f of files) {
    const full = path.join(schemasDir, f);
    const schema = loadJson(full);
    if (schema.$id) {
      ajv.addSchema(schema, schema.$id);
    } else {
      ajv.addSchema(schema);
    }
  }
}

function detectSchemaVersion(schemaPath) {
  if (schemaPath.includes("schemas/v2") || schemaPath.includes("schemas\\v2")) return "v2";
  return "v1";
}

const schemaPath = process.argv[2];
const jsonPath = process.argv[3];

if (!schemaPath || !jsonPath) {
  console.error("Usage: node tools/validate.js <schemaPath> <jsonPath>");
  console.error("  Schemas from schemas/v1/ and schemas/v2/ are loaded automatically.");
  process.exit(2);
}

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

const v1Dir = path.join(process.cwd(), "schemas", "v1");
const v2Dir = path.join(process.cwd(), "schemas", "v2");
addAllSchemas(ajv, v1Dir);
addAllSchemas(ajv, v2Dir);

const schema = loadJson(schemaPath);
const data = loadJson(jsonPath);

const version = detectSchemaVersion(schemaPath);

let validate;
try {
  validate = schema.$id ? ajv.getSchema(schema.$id) : null;
  if (!validate) validate = ajv.compile(schema);
} catch (e) {
  console.error("Schema compile error:", e.message || e);
  process.exit(2);
}

const ok = validate(data);
if (ok) {
  console.log(`✅ VALID (${version})`);
  process.exit(0);
} else {
  console.error(`❌ INVALID (${version})`);
  const schemaName = path.basename(schemaPath);
  console.error(`Schema: ${schemaName}. See spec/ for required fields.`);
  for (const err of validate.errors || []) {
    console.error(`- ${err.instancePath || "/"} ${err.message}`);
  }
  process.exit(1);
}
