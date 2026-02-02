#!/usr/bin/env node
import fs from "fs";
import path from "path";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function addAllSchemas(ajv, schemasDir) {
  const files = fs.readdirSync(schemasDir).filter(f => f.endsWith(".json"));
  for (const f of files) {
    const full = path.join(schemasDir, f);
    const schema = loadJson(full);

    // Add by $id (preferred)
    if (schema.$id) ajv.addSchema(schema, schema.$id);

    // Also add by filename so $ref: "x.schema.json" resolves.
    const id = schema.$id;
    if (id && ajv.getSchema(id)) {
      ajv.removeSchema(id);
    }
    ajv.addSchema(schema);
  }
}

const schemaPath = process.argv[2];
const jsonPath = process.argv[3];

if (!schemaPath || !jsonPath) {
  console.error("Usage: node tools/validate.js <schemaPath> <jsonPath>");
  process.exit(2);
}

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);

addAllSchemas(ajv, path.join(process.cwd(), "schemas", "v1"));

const schema = loadJson(schemaPath);
const data = loadJson(jsonPath);

let validate;
try {
  validate = ajv.compile(schema);
} catch (e) {
  console.error("Schema compile error:", e.message || e);
  process.exit(2);
}

const ok = validate(data);
if (ok) {
  console.log("✅ VALID");
  process.exit(0);
} else {
  console.error("❌ INVALID");
  for (const err of validate.errors || []) {
    console.error(`- ${err.instancePath || "/"} ${err.message}`);
  }
  process.exit(1);
}
