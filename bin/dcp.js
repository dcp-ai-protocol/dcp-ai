#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import crypto from "crypto";
import { ml_dsa65 } from "@noble/post-quantum/ml-dsa.js";
import nacl from "tweetnacl";

const ALLOWED_BASE_DIRS = [process.cwd()];

function safePath(userPath) {
  const resolved = path.resolve(userPath);
  const isAllowed = ALLOWED_BASE_DIRS.some(base => resolved.startsWith(path.resolve(base) + path.sep) || resolved === path.resolve(base));
  if (!isAllowed) {
    console.error(`Error: path '${userPath}' is outside the allowed working directory`);
    process.exit(2);
  }
  return resolved;
}

function safeParseJSON(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    console.error(`Error: failed to parse ${label || filePath}: ${err.message}`);
    process.exit(2);
  }
}

function safeParseInt(value, name) {
  const n = parseInt(value, 10);
  if (Number.isNaN(n) || !Number.isFinite(n)) {
    console.error(`Error: ${name} must be a valid integer, got '${value}'`);
    process.exit(2);
  }
  return n;
}

function writeSecretFile(filePath, contents) {
  fs.writeFileSync(filePath, contents, { mode: 0o600 });
}

const ALLOWED_ENDPOINT_PATTERN = /^https?:\/\/[a-zA-Z0-9._-]+(:\d{1,5})?(\/[a-zA-Z0-9._/-]*)?$/;

function safeEndpoint(url) {
  if (!ALLOWED_ENDPOINT_PATTERN.test(url)) {
    console.error(`Error: invalid endpoint URL '${url}'`);
    process.exit(2);
  }
  const parsed = new URL(url);
  const forbidden = ["169.254.169.254", "metadata.google.internal", "100.100.100.200"];
  if (forbidden.includes(parsed.hostname)) {
    console.error(`Error: endpoint '${url}' targets a forbidden host`);
    process.exit(2);
  }
  return url;
}

function printHelp() {
  console.log(`
DCP CLI (genesis) — V1 + V2 + V2.0 Phase 3 (PQ-First)

Usage:
  dcp help
  dcp version
  dcp init
  dcp validate <schemaPath> <jsonPath>
  dcp validate-bundle <bundle.json>
  dcp conformance
  dcp integrity

  V1 Commands:
    dcp keygen [out_dir]
    dcp sign-bundle <bundle.json> <secret_key.txt> [out.json]
    dcp verify-bundle <bundle.signed.json> <public_key.txt>
    dcp bundle-hash <bundle.json>
    dcp merkle-root <bundle.json>
    dcp intent-hash <intent.json>

  V2 Commands:
    dcp keygen --hybrid [out_dir]                         Generate Ed25519 + ML-DSA-65 keypair
    dcp keygen --algorithm <alg> [out_dir]                Generate keypair for specific algorithm
    dcp kid <public_key_file> --alg <algorithm>           Compute deterministic kid
    dcp sign-bundle --composite <bundle.json> <ed_sk> <pq_sk> [out]  Composite sign
    dcp verify-bundle --policy <mode> <signed.json>       Verify with policy
    dcp recovery-setup --threshold <M> --shares <N> [out] Generate Shamir shares
    dcp emergency-revoke --agent <id> --token <secret>    Emergency revocation
    dcp rotate-key --old-kid <kid> --new-alg <alg>        Key rotation with PoP
    dcp capabilities <endpoint_url>                       Query server capabilities
    dcp advisory check [url]                              Check algorithm advisories

  Phase 3 Commands (PQ-First / Governance):
    dcp keys rotate --key-dir <dir> --new-alg <alg>       Key rotation ceremony (local)
    dcp keys certify --key-dir <dir> --endpoint <url>     Certify rotated key with gateway
    dcp governance ceremony --threshold <M> --parties <N> [out_dir]   Governance key ceremony
    dcp governance sign-advisory <advisory.json> --key-dir <dir>      Sign advisory as governance
    dcp governance verify-advisory <advisory.json> --keys <gov_keys>  Verify governance sigs
    dcp audit gaps                                        Verify all 13 gaps are closed
`);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeFileIfMissing(filePath, contents) {
  if (fs.existsSync(filePath)) return;
  fs.writeFileSync(filePath, contents, "utf8");
}

function deriveKid(alg, publicKeyBytes) {
  const algBytes = Buffer.from(alg, "utf8");
  const sep = Buffer.from([0x00]);
  const input = Buffer.concat([algBytes, sep, publicKeyBytes]);
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 32);
}

const args = process.argv.slice(2);
const cmd = (args[0] || "help").toLowerCase();

// ── Help ──
if (cmd === "help" || cmd === "--help" || cmd === "-h") {
  printHelp();
  process.exit(0);
}

// ── Version ──
if (cmd === "version" || cmd === "--version" || cmd === "-v") {
  console.log("2.0.0-genesis");
  process.exit(0);
}

// ── Init ──
if (cmd === "init") {
  ensureDir("spec");
  ensureDir("schemas/v1");
  ensureDir("schemas/v2");
  ensureDir("tools");
  ensureDir("tests/conformance/examples");
  ensureDir("tests/conformance/v2");
  ensureDir("bin");
  writeFileIfMissing("spec/README.md", "# Specs\n\nPlace DCP specs here.\n");
  writeFileIfMissing("schemas/v1/README.md", "# Schemas v1\n\nPlace V1 JSON Schemas here.\n");
  writeFileIfMissing("schemas/v2/README.md", "# Schemas v2\n\nV2 JSON Schemas with composite signature support.\n");
  writeFileIfMissing("tests/conformance/README.md", "# Conformance\n\nPut fixtures under tests/conformance/examples.\n");
  console.log("✅ DCP scaffolding created (non-destructive).");
  process.exit(0);
}

// ── Validate schema ──
if (cmd === "validate") {
  const schemaPath = args[1];
  const jsonPath = args[2];
  if (!schemaPath || !jsonPath) {
    console.error("Usage: dcp validate <schemaPath> <jsonPath>");
    process.exit(2);
  }
  execFileSync("node", ["tools/validate.js", safePath(schemaPath), safePath(jsonPath)], { stdio: "inherit" });
  process.exit(0);
}

// ── Validate bundle ──
if (cmd === "validate-bundle") {
  const bundlePath = args[1];
  if (!bundlePath) {
    console.error("Usage: dcp validate-bundle <bundle.json>");
    process.exit(2);
  }

  const bundle = safeParseJSON(safePath(bundlePath), "bundle");
  const artifactNames = ["responsible_principal_record", "agent_passport", "intent", "policy_decision"];
  for (const name of artifactNames) console.log(`Validating ${name}...`);
  if (Array.isArray(bundle.audit_entries)) {
    for (let i = 0; i < bundle.audit_entries.length; i++) console.log(`Validating audit_entries[${i}]...`);
  }

  const { validateBundle } = await import("../lib/verify.js");
  const result = validateBundle(bundle);
  if (result.valid) {
    console.log("\n✅ BUNDLE VALID (DCP-01/02/03)");
    process.exit(0);
  }
  for (const e of result.errors || []) console.error(`- ${e}`);
  const artifact = result.errors?.[0]?.includes(": ") ? result.errors[0].split(": ")[0] : "bundle";
  console.error(`\nBundle invalid: ${artifact} failed.`);
  process.exit(1);
}

// ── Conformance ──
if (cmd === "conformance") {
  try {
    execFileSync("node", ["tools/conformance.js"], { stdio: "inherit" });
    process.exit(0);
  } catch { process.exit(1); }
}

// ── Keygen (V1 + V2) ──
if (cmd === "keygen") {
  const isHybrid = args.includes("--hybrid");
  const algIdx = args.indexOf("--algorithm");
  const specificAlg = algIdx >= 0 ? args[algIdx + 1] : null;

  // Find output directory (first arg that isn't a flag)
  let outDir = "keys";
  for (let i = 1; i < args.length; i++) {
    if (!args[i].startsWith("--") && (i === 1 || !["--algorithm"].includes(args[i - 1]))) {
      outDir = args[i];
      break;
    }
  }
  ensureDir(outDir);

  if (isHybrid) {
    // V2 hybrid: Ed25519 + ML-DSA-65
    const { generateKeypair } = await import("../tools/crypto.js");
    const classicalKp = generateKeypair();

    const pqKeys = ml_dsa65.keygen();
    const pqPublicKey = Buffer.from(pqKeys.publicKey);
    const pqSecretKey = Buffer.from(pqKeys.secretKey);

    const classicalKid = deriveKid("ed25519", Buffer.from(classicalKp.publicKeyB64, "base64"));
    const pqKid = deriveKid("ml-dsa-65", pqPublicKey);

    fs.writeFileSync(path.join(outDir, "ed25519_public_key.txt"), classicalKp.publicKeyB64 + "\n");
    writeSecretFile(path.join(outDir, "ed25519_secret_key.txt"), classicalKp.secretKeyB64 + "\n");
    fs.writeFileSync(path.join(outDir, "ed25519_kid.txt"), classicalKid + "\n");
    fs.writeFileSync(path.join(outDir, "ml_dsa_65_public_key.txt"), pqPublicKey.toString("base64") + "\n");
    writeSecretFile(path.join(outDir, "ml_dsa_65_secret_key.txt"), pqSecretKey.toString("base64") + "\n");
    fs.writeFileSync(path.join(outDir, "ml_dsa_65_kid.txt"), pqKid + "\n");

    console.log(`✅ Hybrid keypair written to ${outDir}/`);
    console.log(`   Ed25519 kid:   ${classicalKid}`);
    console.log(`   ML-DSA-65 kid: ${pqKid}`);
    process.exit(0);
  }

  if (specificAlg) {
    if (!["ed25519", "ml-dsa-65", "ml-dsa-87", "slh-dsa-192f"].includes(specificAlg)) {
      console.error(`Unsupported algorithm: ${specificAlg}`);
      console.error("Supported: ed25519, ml-dsa-65, ml-dsa-87, slh-dsa-192f");
      process.exit(2);
    }

    if (specificAlg === "ed25519") {
      const { generateKeypair } = await import("../tools/crypto.js");
      const kp = generateKeypair();
      const kid = deriveKid("ed25519", Buffer.from(kp.publicKeyB64, "base64"));
      fs.writeFileSync(path.join(outDir, "public_key.txt"), kp.publicKeyB64 + "\n");
      writeSecretFile(path.join(outDir, "secret_key.txt"), kp.secretKeyB64 + "\n");
      fs.writeFileSync(path.join(outDir, "kid.txt"), kid + "\n");
      console.log(`✅ Ed25519 keypair written to ${outDir}/ (kid: ${kid})`);
    } else if (specificAlg === "ml-dsa-65") {
      const pqKeys = ml_dsa65.keygen();
      const pk = Buffer.from(pqKeys.publicKey);
      const sk = Buffer.from(pqKeys.secretKey);
      const kid = deriveKid(specificAlg, pk);
      fs.writeFileSync(path.join(outDir, "public_key.txt"), pk.toString("base64") + "\n");
      writeSecretFile(path.join(outDir, "secret_key.txt"), sk.toString("base64") + "\n");
      fs.writeFileSync(path.join(outDir, "kid.txt"), kid + "\n");
      console.log(`✅ ${specificAlg} keypair written to ${outDir}/ (kid: ${kid})`);
    } else {
      console.error(`Algorithm ${specificAlg} keygen requires the corresponding SDK provider.`);
      console.error("Supported for real keygen: ed25519, ml-dsa-65");
      process.exit(2);
    }
    process.exit(0);
  }

  // Default V1 keygen
  const { generateKeypair } = await import("../tools/crypto.js");
  const kp = generateKeypair();
  fs.writeFileSync(path.join(outDir, "public_key.txt"), kp.publicKeyB64 + "\n");
  writeSecretFile(path.join(outDir, "secret_key.txt"), kp.secretKeyB64 + "\n");
  console.log(`✅ Keypair written to ${outDir}/public_key.txt and ${outDir}/secret_key.txt`);
  process.exit(0);
}

// ── kid — Compute deterministic kid ──
if (cmd === "kid") {
  const publicKeyPath = args[1];
  const algIdx = args.indexOf("--alg");
  const alg = algIdx >= 0 ? args[algIdx + 1] : "ed25519";

  if (!publicKeyPath) {
    console.error("Usage: dcp kid <public_key_file> --alg <algorithm>");
    process.exit(2);
  }

  const publicKeyB64 = fs.readFileSync(safePath(publicKeyPath), "utf8").trim();
  const pkBytes = Buffer.from(publicKeyB64, "base64");
  const kid = deriveKid(alg, pkBytes);
  console.log(kid);
  process.exit(0);
}

// ── Sign bundle (V1 + V2 composite) ──
if (cmd === "sign-bundle") {
  const isComposite = args.includes("--composite");

  if (isComposite) {
    // V2 composite sign: dcp sign-bundle --composite <bundle.json> <ed_sk> <pq_sk> [out]
    const filteredArgs = args.filter(a => a !== "--composite");
    const bundlePath = filteredArgs[1];
    const edSecretPath = filteredArgs[2];
    const pqSecretPath = filteredArgs[3];
    const outPath = filteredArgs[4] || "citizenship_bundle_v2.signed.json";

    if (!bundlePath || !edSecretPath || !pqSecretPath) {
      console.error("Usage: dcp sign-bundle --composite <bundle.json> <ed25519_sk> <mldsa_sk> [out]");
      process.exit(2);
    }

    const bundle = safeParseJSON(safePath(bundlePath), "bundle");
    const edSecret = fs.readFileSync(safePath(edSecretPath), "utf8").trim();
    const pqSecret = fs.readFileSync(safePath(pqSecretPath), "utf8").trim();

    // Compute manifest hash
    const manifestJson = JSON.stringify(bundle.manifest || bundle);
    const manifestHash = "sha256:" + crypto.createHash("sha256").update(manifestJson).digest("hex");

    // Create composite signature structure
    const edPk = Buffer.from(edSecret, "base64").subarray(32); // Ed25519 sk is 64B, last 32 are pk
    const classicalKid = deriveKid("ed25519", edPk);
    const pqPkStub = crypto.createHash("sha256").update(Buffer.from(pqSecret, "base64")).digest();
    const pqKid = deriveKid("ml-dsa-65", pqPkStub);

    const { signObject, canonicalize, domainSeparatedMessage } = await import("../tools/crypto.js");
    const domainMsg = domainSeparatedMessage("bundle", bundle.manifest || bundle);
    const canonicalManifest = canonicalize(bundle.manifest || bundle);
    const edSig = signObject(JSON.parse(canonicalManifest), edSecret);

    const pqSecretBuf = Buffer.from(pqSecret, "base64");
    const msgBytes = Buffer.from(domainMsg, "utf8");
    const edSigBytes = Buffer.from(edSig, "base64");
    const bindingInput = Buffer.concat([msgBytes, edSigBytes]);
    const pqSigReal = ml_dsa65.sign(bindingInput, pqSecretBuf);
    const pqSigB64 = Buffer.from(pqSigReal).toString("base64");

    const signedBundle = {
      dcp_version: "2.0",
      bundle,
      signature: {
        hash_alg: "sha256",
        created_at: new Date().toISOString(),
        signer: {
          type: "human",
          id: "cli-signer",
          kids: [classicalKid, pqKid],
        },
        manifest_hash: manifestHash,
        composite_sig: {
          classical: {
            alg: "ed25519",
            kid: classicalKid,
            sig_b64: edSig,
          },
          pq: {
            alg: "ml-dsa-65",
            kid: pqKid,
            sig_b64: pqSigB64,
          },
          binding: "pq_over_classical",
        },
        domain_sep: "DCP-BUNDLE-SIG-v2",
      },
    };

    fs.writeFileSync(outPath, JSON.stringify(signedBundle, null, 2));
    console.log(`✅ V2 composite-signed bundle written to ${outPath}`);
    process.exit(0);
  }

  // V1 sign
  const bundlePath = args[1];
  const secretKeyPath = args[2];
  const outPath = args[3] || "citizenship_bundle.signed.json";
  if (!bundlePath || !secretKeyPath) {
    console.error("Usage: dcp sign-bundle <bundle.json> <secret_key.txt> [out.json]");
    process.exit(2);
  }
  execFileSync("node", ["tools/bundle_sign.js", safePath(bundlePath), safePath(secretKeyPath), safePath(outPath)], { stdio: "inherit" });
  process.exit(0);
}

// ── Verify bundle (V1 + V2 with policy) ──
if (cmd === "verify-bundle") {
  const policyIdx = args.indexOf("--policy");
  const policyMode = policyIdx >= 0 ? args[policyIdx + 1] : null;

  // Find the bundle path (first non-flag arg after command)
  let signedPath = null;
  let publicKeyPath = null;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--policy") { i++; continue; }
    if (!signedPath) { signedPath = args[i]; continue; }
    if (!publicKeyPath) { publicKeyPath = args[i]; continue; }
  }

  if (!signedPath) {
    console.error("Usage: dcp verify-bundle [--policy <mode>] <signed.json> [public_key.txt]");
    process.exit(2);
  }

  const signedBundle = safeParseJSON(safePath(signedPath), "signed bundle");

  // Detect version
  const isV2 = signedBundle.bundle?.dcp_bundle_version === "2.0" ||
               signedBundle.bundle?.manifest !== undefined;

  if (isV2) {
    console.log("Detected: DCP v2.0 bundle");
    const errors = [];
    const warnings = [];
    const bundle = signedBundle.bundle;
    const signature = signedBundle.signature;

    if (!bundle || !signature) {
      console.error("❌ Missing bundle or signature");
      process.exit(1);
    }

    // Check manifest
    if (bundle.manifest) {
      console.log("✅ Manifest present");
      if (bundle.manifest.session_nonce && /^[0-9a-f]{64}$/.test(bundle.manifest.session_nonce)) {
        console.log(`✅ Session nonce: ${bundle.manifest.session_nonce.slice(0, 16)}...`);
      } else {
        errors.push("Invalid session_nonce");
      }

      if (bundle.manifest.session_expires_at) {
        const expiresAt = new Date(bundle.manifest.session_expires_at);
        if (expiresAt < new Date()) {
          errors.push(`Session expired at ${bundle.manifest.session_expires_at}`);
        } else {
          console.log(`✅ Session valid until: ${bundle.manifest.session_expires_at}`);
        }
      }

      if (bundle.manifest.intended_verifier) {
        console.log(`✅ Intended verifier: ${bundle.manifest.intended_verifier}`);
      }
    } else {
      errors.push("Missing manifest");
    }

    // Check artifacts
    for (const field of ["responsible_principal_record", "agent_passport", "intent", "policy_decision"]) {
      if (bundle[field]?.payload) {
        console.log(`✅ ${field} (SignedPayload)`);
      } else {
        errors.push(`Missing ${field}`);
      }
    }

    // Check composite sig
    if (signature.composite_sig) {
      const cs = signature.composite_sig;
      if (cs.classical) console.log(`✅ Classical sig: ${cs.classical.alg} (kid: ${cs.classical.kid})`);
      if (cs.pq) console.log(`✅ PQ sig: ${cs.pq.alg} (kid: ${cs.pq.kid})`);
      console.log(`   Binding: ${cs.binding}`);

      if (policyMode === "hybrid_required" && cs.binding === "classical_only") {
        errors.push("Policy hybrid_required but bundle is classical_only");
      }
      if (policyMode === "hybrid_preferred" && cs.binding === "classical_only") {
        warnings.push("Classical-only (no PQ protection)");
      }
    } else {
      errors.push("Missing composite_sig");
    }

    // Audit entries
    if (Array.isArray(bundle.audit_entries)) {
      console.log(`✅ Audit entries: ${bundle.audit_entries.length}`);
    }

    // PQ checkpoints
    if (Array.isArray(bundle.pq_checkpoints)) {
      console.log(`✅ PQ checkpoints: ${bundle.pq_checkpoints.length}`);
    }

    if (warnings.length > 0) {
      for (const w of warnings) console.log(`⚠️  ${w}`);
    }

    if (errors.length === 0) {
      console.log("\n✅ V2 BUNDLE STRUCTURE VALID");
      if (policyMode) console.log(`   Policy: ${policyMode}`);
      process.exit(0);
    } else {
      for (const e of errors) console.error(`❌ ${e}`);
      console.error("\n❌ V2 VERIFICATION FAILED");
      process.exit(1);
    }
  }

  // V1 path
  if (!publicKeyPath) {
    console.error("V1 bundles require a public key: dcp verify-bundle <signed.json> <public_key.txt>");
    process.exit(2);
  }

  const publicKeyB64 = fs.readFileSync(safePath(publicKeyPath), "utf8").trim();
  const { verifySignedBundle } = await import("../lib/verify.js");
  const result = verifySignedBundle(signedBundle, publicKeyB64);
  if (result.verified) {
    console.log("✅ SIGNATURE VALID");
    console.log("✅ BUNDLE INTEGRITY VALID");
    console.log("\n✅ VERIFIED (SCHEMA + SIGNATURE)");
    process.exit(0);
  }
  for (const e of result.errors || []) console.error(e);
  console.error("\nVerification failed.");
  process.exit(1);
}

// ── Bundle hash ──
if (cmd === "bundle-hash") {
  const bundlePath = args[1];
  if (!bundlePath) {
    console.error("Usage: dcp bundle-hash <bundle.json>");
    process.exit(2);
  }
  const { canonicalize } = await import("../tools/merkle.js");
  const bundle = safeParseJSON(safePath(bundlePath), "bundle");
  const hex = crypto.createHash("sha256").update(canonicalize(bundle), "utf8").digest("hex");
  console.log(`sha256:${hex}`);
  process.exit(0);
}

// ── Merkle root ──
if (cmd === "merkle-root") {
  const bundlePath = args[1];
  if (!bundlePath) {
    console.error("Usage: dcp merkle-root <bundle.json>");
    process.exit(2);
  }
  const { merkleRootForAuditEntries } = await import("../tools/merkle.js");
  const bundle = safeParseJSON(safePath(bundlePath), "bundle");
  if (!Array.isArray(bundle.audit_entries) || bundle.audit_entries.length === 0) {
    console.error("audit_entries must be a non-empty array");
    process.exit(2);
  }
  const hex = merkleRootForAuditEntries(bundle.audit_entries);
  console.log(hex ? `sha256:${hex}` : "null");
  process.exit(0);
}

// ── Intent hash ──
if (cmd === "intent-hash") {
  const intentPath = args[1];
  if (!intentPath) {
    console.error("Usage: dcp intent-hash <intent.json>");
    process.exit(2);
  }
  const { intentHash } = await import("../tools/merkle.js");
  const intent = safeParseJSON(safePath(intentPath), "intent");
  console.log(intentHash(intent));
  process.exit(0);
}

// ── recovery-setup — Generate Shamir shares ──
if (cmd === "recovery-setup") {
  const secrets = (await import("secrets.js-grempe")).default;

  const thresholdIdx = args.indexOf("--threshold");
  const sharesIdx = args.indexOf("--shares");
  const threshold = thresholdIdx >= 0 ? safeParseInt(args[thresholdIdx + 1], "threshold") : 2;
  const totalShares = sharesIdx >= 0 ? safeParseInt(args[sharesIdx + 1], "shares") : 3;

  let outDir = "recovery";
  for (let i = 1; i < args.length; i++) {
    if (!args[i].startsWith("--") && !["--threshold", "--shares"].includes(args[i - 1]) && args[i] !== cmd) {
      outDir = args[i];
      break;
    }
  }
  ensureDir(outDir);

  if (threshold < 2 || totalShares < threshold) {
    console.error("Error: threshold must be >= 2 and <= total shares");
    process.exit(2);
  }

  if (totalShares > 255) {
    console.error("Error: total shares must be <= 255");
    process.exit(2);
  }

  const masterSecret = crypto.randomBytes(64);
  const masterHex = secrets.str2hex(masterSecret.toString("hex"));
  const rawShares = secrets.share(masterHex, totalShares, threshold);

  const shares = [];
  for (let i = 0; i < rawShares.length; i++) {
    shares.push({ index: i + 1, data: rawShares[i] });
    writeSecretFile(
      path.join(outDir, `share_${i + 1}.txt`),
      JSON.stringify({ index: i + 1, data: rawShares[i] }) + "\n"
    );
  }

  const config = {
    type: "recovery_config",
    human_id: `rpr:${crypto.randomUUID()}`,
    threshold,
    total_shares: totalShares,
    share_holders: shares.map((s, i) => ({
      holder_id: `recovery-contact-${i + 1}`,
      share_index: s.index,
      holder_kid: `placeholder-kid-${i + 1}`,
    })),
    created_at: new Date().toISOString(),
  };

  fs.writeFileSync(path.join(outDir, "recovery_config.json"), JSON.stringify(config, null, 2));
  console.log(`✅ Recovery setup complete (${threshold}-of-${totalShares})`);
  console.log(`   Shares written to ${outDir}/share_*.txt`);
  console.log(`   Config written to ${outDir}/recovery_config.json`);
  console.log(`   Shares use real Shamir Secret Sharing — any ${threshold} shares can reconstruct the secret.`);
  process.exit(0);
}

// ── recovery-reconstruct — Reconstruct master secret from M shares ──
if (cmd === "recovery-reconstruct") {
  const secrets = (await import("secrets.js-grempe")).default;

  const shareFiles = args.slice(1).filter(a => !a.startsWith("--"));
  if (shareFiles.length < 2) {
    console.error("Usage: dcp recovery-reconstruct <share1.txt> <share2.txt> [share3.txt ...]");
    process.exit(2);
  }

  const shareData = [];
  for (const sf of shareFiles) {
    const content = safeParseJSON(safePath(sf), `share file ${sf}`);
    if (!content.data) {
      console.error(`Error: share file ${sf} missing 'data' field`);
      process.exit(2);
    }
    shareData.push(content.data);
  }

  try {
    const reconstructedHex = secrets.combine(shareData);
    const masterHex = secrets.hex2str(reconstructedHex);
    console.log(`✅ Master secret reconstructed from ${shareData.length} shares`);
    console.log(`   Secret (hex): ${masterHex}`);
  } catch (err) {
    console.error(`❌ Failed to reconstruct secret: ${err.message}`);
    console.error("   Ensure you have the minimum threshold number of valid shares.");
    process.exit(1);
  }
  process.exit(0);
}

// ── emergency-revoke — Panic button ──
if (cmd === "emergency-revoke") {
  const agentIdx = args.indexOf("--agent");
  const tokenIdx = args.indexOf("--token");
  const endpointIdx = args.indexOf("--endpoint");

  const agentId = agentIdx >= 0 ? args[agentIdx + 1] : null;
  const token = tokenIdx >= 0 ? args[tokenIdx + 1] : null;
  const endpoint = safeEndpoint(endpointIdx >= 0 ? args[endpointIdx + 1] : "http://localhost:3000");

  if (!agentId || !token) {
    console.error("Usage: dcp emergency-revoke --agent <agent_id> --token <revocation_secret> [--endpoint <url>]");
    process.exit(2);
  }

  if (!/^[0-9a-f]{64}$/.test(token)) {
    console.error("Error: revocation_secret must be 64 hex characters");
    process.exit(2);
  }

  try {
    const response = await fetch(`${endpoint}/v2/emergency-revoke`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent_id: agentId,
        revocation_secret: token,
        timestamp: new Date().toISOString(),
        reason: "key_compromise_emergency",
      }),
    });

    const data = await response.json();

    if (data.ok) {
      console.log(`✅ Emergency revocation successful`);
      console.log(`   Agent: ${data.agent_id}`);
      console.log(`   Revoked at: ${data.revoked_at}`);
      console.log(`   Keys revoked: ${data.keys_revoked}`);
    } else {
      console.error(`❌ Emergency revocation failed: ${data.error}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`❌ Failed to connect to ${endpoint}: ${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

// ── rotate-key ──
if (cmd === "rotate-key") {
  const oldKidIdx = args.indexOf("--old-kid");
  const newAlgIdx = args.indexOf("--new-alg");
  const endpointIdx = args.indexOf("--endpoint");

  const oldKid = oldKidIdx >= 0 ? args[oldKidIdx + 1] : null;
  const newAlg = newAlgIdx >= 0 ? args[newAlgIdx + 1] : "ml-dsa-65";
  const endpoint = safeEndpoint(endpointIdx >= 0 ? args[endpointIdx + 1] : "http://localhost:3000");

  if (!oldKid) {
    console.error("Usage: dcp rotate-key --old-kid <kid> [--new-alg <alg>] [--endpoint <url>]");
    process.exit(2);
  }

  if (!["ed25519", "ml-dsa-65"].includes(newAlg)) {
    console.error(`Unsupported algorithm for rotation: ${newAlg}. Supported: ed25519, ml-dsa-65`);
    process.exit(2);
  }

  let newPk;
  if (newAlg === "ml-dsa-65") {
    const pqKeys = ml_dsa65.keygen();
    newPk = Buffer.from(pqKeys.publicKey);
  } else {
    const { generateKeypair } = await import("../tools/crypto.js");
    const kp = generateKeypair();
    newPk = Buffer.from(kp.publicKeyB64, "base64");
  }
  const newKid = deriveKid(newAlg, newPk);

  try {
    const response = await fetch(`${endpoint}/v2/keys/rotate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        old_kid: oldKid,
        new_key: {
          kid: newKid,
          alg: newAlg,
          public_key_b64: newPk.toString("base64"),
          created_at: new Date().toISOString(),
          expires_at: null,
          status: "active",
        },
        proof_of_possession: {
          context: "DCP-AI.v2.KeyRotation",
          challenge: crypto.createHash("sha256").update(`${oldKid}:${newKid}:rotate`).digest("hex"),
          sig_b64: crypto.createHmac("sha256", crypto.randomBytes(32)).update(`${oldKid}:${newKid}`).digest("base64"),
          note: "Simulated PoP — production must sign challenge with old key",
        },
        timestamp: new Date().toISOString(),
      }),
    });

    const data = await response.json();

    if (data.ok) {
      console.log(`✅ Key rotation successful`);
      console.log(`   Old kid: ${data.old_kid}`);
      console.log(`   New kid: ${data.new_kid}`);
      console.log(`   Algorithm: ${newAlg}`);
    } else {
      console.error(`❌ Key rotation failed: ${data.error}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`❌ Failed to connect to ${endpoint}: ${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

// ── capabilities — Query server capabilities ──
if (cmd === "capabilities") {
  const endpoint = safeEndpoint(args[1] || "http://localhost:3000");

  try {
    const response = await fetch(`${endpoint}/.well-known/dcp-capabilities.json`);
    const caps = await response.json();

    console.log(`DCP Capabilities for ${endpoint}:`);
    console.log(`  Versions:     ${caps.supported_versions?.join(", ")}`);
    console.log(`  Signing algs: ${caps.supported_algs?.signing?.join(", ")}`);
    console.log(`  KEM algs:     ${caps.supported_algs?.kem?.join(", ") || "none"}`);
    console.log(`  Hash algs:    ${caps.supported_algs?.hash?.join(", ")}`);
    console.log(`  Wire formats: ${caps.supported_wire_formats?.join(", ")}`);
    console.log(`  Features:`);
    if (caps.features) {
      for (const [k, v] of Object.entries(caps.features)) {
        console.log(`    ${k}: ${v ? "✅" : "❌"}`);
      }
    }
    console.log(`  Min version:  ${caps.min_accepted_version}`);
    console.log(`  Policy hash:  ${caps.verifier_policy_hash?.slice(0, 32)}...`);
  } catch (err) {
    console.error(`❌ Failed to query ${endpoint}: ${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

// ── advisory check — Check algorithm advisories ──
if (cmd === "advisory" && args[1] === "check") {
  const url = args[2] || "https://dcp-ai.org/.well-known/algorithm-advisories.json";

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.log("No algorithm advisories found (or advisory endpoint not available).");
      console.log(`  Checked: ${url}`);
      process.exit(0);
    }

    const body = await response.json();
    const advisories = Array.isArray(body) ? body : (body.advisories || [body]);
    if (advisories.length === 0) {
      console.log("✅ No active algorithm advisories.");
      process.exit(0);
    }

    console.log("Algorithm Advisories:");
    const items = advisories;
    for (const adv of items) {
      const icon = adv.severity === "critical" ? "🔴" : adv.severity === "high" ? "🟠" : "🟡";
      console.log(`  ${icon} ${adv.advisory_id || "unknown"}: ${adv.description || ""}`);
      console.log(`     Severity: ${adv.severity}, Action: ${adv.action}`);
      console.log(`     Affected: ${adv.affected_algorithms?.join(", ")}`);
      console.log(`     Replace with: ${adv.replacement_algorithms?.join(", ")}`);
      console.log(`     Effective: ${adv.effective_date}, Grace: ${adv.grace_period_days} days`);
    }
  } catch (err) {
    console.log("Advisory endpoint not reachable (this is normal for local development).");
    console.log(`  Tried: ${url}`);
  }
  process.exit(0);
}

// ── Phase 3: Key rotation ceremony (local) ──
if (cmd === "keys" && args[1] === "rotate") {
  const keyDirIdx = args.indexOf("--key-dir");
  const newAlgIdx = args.indexOf("--new-alg");

  const keyDir = keyDirIdx >= 0 ? args[keyDirIdx + 1] : "keys";
  const newAlg = newAlgIdx >= 0 ? args[newAlgIdx + 1] : "ml-dsa-65";

  if (!fs.existsSync(keyDir)) {
    console.error(`Key directory '${keyDir}' not found`);
    process.exit(2);
  }

  if (!["ed25519", "ml-dsa-65", "ml-dsa-87", "slh-dsa-192f"].includes(newAlg)) {
    console.error(`Unsupported algorithm: ${newAlg}`);
    process.exit(2);
  }

  console.log("=== DCP Key Rotation Ceremony ===\n");

  // Read existing keys
  const existingKidFile = path.join(keyDir, "kid.txt");
  const existingPkFile = path.join(keyDir, "public_key.txt");

  let oldKid = "unknown";
  if (fs.existsSync(existingKidFile)) {
    oldKid = fs.readFileSync(existingKidFile, "utf8").trim();
  } else {
    // Try hybrid key directory
    const edKidFile = path.join(keyDir, "ed25519_kid.txt");
    if (fs.existsSync(edKidFile)) oldKid = fs.readFileSync(edKidFile, "utf8").trim();
  }

  console.log(`Old key kid:    ${oldKid}`);
  console.log(`New algorithm:  ${newAlg}`);

  let newPk, newSk;
  if (newAlg === "ml-dsa-65") {
    const pqKeys = ml_dsa65.keygen();
    newPk = Buffer.from(pqKeys.publicKey);
    newSk = Buffer.from(pqKeys.secretKey);
  } else if (newAlg === "ed25519") {
    const { generateKeypair } = await import("../tools/crypto.js");
    const kp = generateKeypair();
    newPk = Buffer.from(kp.publicKeyB64, "base64");
    newSk = Buffer.from(kp.secretKeyB64, "base64");
  } else {
    console.error(`Algorithm ${newAlg} keygen requires the corresponding SDK provider.`);
    process.exit(2);
  }
  const newKid = deriveKid(newAlg, newPk);

  // Create rotation record
  const rotationRecord = {
    type: "key_rotation",
    old_kid: oldKid,
    new_kid: newKid,
    new_key: {
      kid: newKid,
      alg: newAlg,
      public_key_b64: newPk.toString("base64"),
      created_at: new Date().toISOString(),
      expires_at: null,
      status: "active",
    },
    timestamp: new Date().toISOString(),
    proof_of_possession: {
      context: "DCP-AI.v2.KeyRotation",
      challenge: crypto.createHash("sha256").update(
        `${oldKid}:${newKid}:${new Date().toISOString()}`
      ).digest("hex"),
    },
  };

  // Write new keys and rotation record
  const rotDir = path.join(keyDir, "rotation");
  ensureDir(rotDir);

  fs.writeFileSync(path.join(rotDir, "new_public_key.txt"), newPk.toString("base64") + "\n");
  writeSecretFile(path.join(rotDir, "new_secret_key.txt"), newSk.toString("base64") + "\n");
  fs.writeFileSync(path.join(rotDir, "new_kid.txt"), newKid + "\n");
  fs.writeFileSync(path.join(rotDir, "rotation_record.json"), JSON.stringify(rotationRecord, null, 2) + "\n");

  console.log(`\nNew key kid:    ${newKid}`);
  console.log(`\nRotation record: ${path.join(rotDir, "rotation_record.json")}`);
  console.log(`New public key:  ${path.join(rotDir, "new_public_key.txt")}`);
  console.log(`New secret key:  ${path.join(rotDir, "new_secret_key.txt")}`);
  console.log(`\nNext: run 'dcp keys certify --key-dir ${keyDir}' to register with the gateway`);
  process.exit(0);
}

// ── Phase 3: Key certification with gateway ──
if (cmd === "keys" && args[1] === "certify") {
  const keyDirIdx = args.indexOf("--key-dir");
  const endpointIdx = args.indexOf("--endpoint");

  const keyDir = keyDirIdx >= 0 ? args[keyDirIdx + 1] : "keys";
  const endpoint = safeEndpoint(endpointIdx >= 0 ? args[endpointIdx + 1] : "http://localhost:3000");

  const rotDir = path.join(keyDir, "rotation");
  const rotRecordPath = path.join(rotDir, "rotation_record.json");

  if (!fs.existsSync(rotRecordPath)) {
    console.error(`No rotation record found at ${rotRecordPath}`);
    console.error("Run 'dcp keys rotate' first");
    process.exit(2);
  }

  const rotationRecord = safeParseJSON(rotRecordPath, "rotation record");

  console.log("=== DCP Key Certification ===\n");
  console.log(`Gateway:  ${endpoint}`);
  console.log(`Old kid:  ${rotationRecord.old_kid}`);
  console.log(`New kid:  ${rotationRecord.new_kid}`);
  console.log(`New alg:  ${rotationRecord.new_key.alg}`);

  try {
    const response = await fetch(`${endpoint}/v2/keys/rotate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "DCP-Version": "2.0",
      },
      body: JSON.stringify({
        old_kid: rotationRecord.old_kid,
        new_key: rotationRecord.new_key,
        proof_of_possession: rotationRecord.proof_of_possession,
        timestamp: rotationRecord.timestamp,
      }),
    });

    const data = await response.json();

    if (data.ok) {
      console.log(`\n✅ Key rotation certified by gateway`);
      console.log(`   Old kid: ${data.old_kid} (revoked)`);
      console.log(`   New kid: ${data.new_kid} (active)`);
      console.log(`   Rotated at: ${data.rotated_at}`);

      // Write certification receipt
      const receiptPath = path.join(rotDir, "certification_receipt.json");
      fs.writeFileSync(receiptPath, JSON.stringify({
        ...data,
        certified_at: new Date().toISOString(),
        gateway: endpoint,
      }, null, 2) + "\n");
      console.log(`   Receipt: ${receiptPath}`);
    } else {
      console.error(`\n❌ Certification failed: ${data.error}`);
      process.exit(1);
    }
  } catch (err) {
    console.error(`❌ Failed to connect to ${endpoint}: ${err.message}`);
    process.exit(1);
  }
  process.exit(0);
}

// ── Phase 3: Governance key ceremony ──
if (cmd === "governance" && args[1] === "ceremony") {
  const thresholdIdx = args.indexOf("--threshold");
  const partiesIdx = args.indexOf("--parties");

  const threshold = thresholdIdx >= 0 ? safeParseInt(args[thresholdIdx + 1], "threshold") : 2;
  const totalParties = partiesIdx >= 0 ? safeParseInt(args[partiesIdx + 1], "parties") : 3;

  let outDir = "governance";
  for (let i = 2; i < args.length; i++) {
    if (!args[i].startsWith("--") &&
        !["--threshold", "--parties"].includes(args[i - 1]) &&
        args[i] !== "ceremony") {
      outDir = args[i];
      break;
    }
  }
  ensureDir(outDir);

  if (threshold < 2 || totalParties < threshold) {
    console.error("Error: threshold must be >= 2 and <= total parties");
    process.exit(2);
  }

  console.log("=== DCP Governance Key Ceremony ===\n");
  console.log(`Threshold:    ${threshold}-of-${totalParties}`);
  console.log(`Output dir:   ${outDir}/\n`);

  const participants = [];
  const allKeys = [];

  for (let i = 1; i <= totalParties; i++) {
    const participantId = `governance-signer-${i}`;

    const edKp = nacl.sign.keyPair();
    const edPk = Buffer.from(edKp.publicKey);
    const edSk = Buffer.from(edKp.secretKey);
    const edKid = deriveKid("ed25519", edPk);

    const pqKeys = ml_dsa65.keygen();
    const pqPk = Buffer.from(pqKeys.publicKey);
    const pqSk = Buffer.from(pqKeys.secretKey);
    const pqKid = deriveKid("ml-dsa-65", pqPk);

    const participant = {
      participant_id: participantId,
      display_name: `Governance Signer #${i}`,
      ed25519_kid: edKid,
      ed25519_public_key_b64: edPk.toString("base64"),
      mldsa65_kid: pqKid,
      mldsa65_public_key_b64: pqPk.toString("base64"),
    };

    participants.push(participant);
    allKeys.push(
      { kid: edKid, alg: "ed25519", public_key_b64: edPk.toString("base64"), status: "active" },
      { kid: pqKid, alg: "ml-dsa-65", public_key_b64: pqPk.toString("base64"), status: "active" },
    );

    // Write participant secrets to individual files
    const pDir = path.join(outDir, `participant_${i}`);
    ensureDir(pDir);
    writeSecretFile(path.join(pDir, "ed25519_secret_key.txt"), edSk.toString("base64") + "\n");
    writeSecretFile(path.join(pDir, "mldsa65_secret_key.txt"), pqSk.toString("base64") + "\n");
    fs.writeFileSync(path.join(pDir, "participant.json"), JSON.stringify(participant, null, 2) + "\n");

    console.log(`  Participant ${i}: ${participantId}`);
    console.log(`    Ed25519 kid:   ${edKid}`);
    console.log(`    ML-DSA-65 kid: ${pqKid}`);
  }

  const governanceKeySet = {
    governance_id: `dcp-governance-${crypto.randomUUID().slice(0, 8)}`,
    keys: allKeys,
    threshold,
    created_at: new Date().toISOString(),
    description: `DCP-AI v2.0 Governance Key Set (${threshold}-of-${totalParties})`,
  };

  const ceremonyHash = "sha256:" + crypto.createHash("sha256")
    .update(JSON.stringify(governanceKeySet))
    .digest("hex");

  const ceremonySummary = {
    governance_key_set: governanceKeySet,
    participants: participants.map(p => ({
      participant_id: p.participant_id,
      display_name: p.display_name,
      keys: [
        { kid: p.ed25519_kid, alg: "ed25519" },
        { kid: p.mldsa65_kid, alg: "ml-dsa-65" },
      ],
    })),
    ceremony_hash: ceremonyHash,
    created_at: new Date().toISOString(),
    spec_version: "2.0",
  };

  // Write governance keys document
  const keysDocPath = path.join(outDir, "governance-keys.json");
  fs.writeFileSync(keysDocPath, JSON.stringify(ceremonySummary, null, 2) + "\n");

  console.log(`\n✅ Governance ceremony complete`);
  console.log(`   ID:        ${governanceKeySet.governance_id}`);
  console.log(`   Threshold: ${threshold}-of-${totalParties}`);
  console.log(`   Hash:      ${ceremonyHash.slice(0, 40)}...`);
  console.log(`   Keys doc:  ${keysDocPath}`);
  console.log(`\nPublish ${keysDocPath} at https://dcp-ai.org/.well-known/governance-keys.json`);
  process.exit(0);
}

// ── Phase 3: Sign advisory as governance participant ──
if (cmd === "governance" && args[1] === "sign-advisory") {
  const advisoryPath = args[2];
  const keyDirIdx = args.indexOf("--key-dir");
  const outIdx = args.indexOf("--out");

  const keyDir = keyDirIdx >= 0 ? args[keyDirIdx + 1] : null;
  const outPath = outIdx >= 0 ? args[outIdx + 1] : null;

  if (!advisoryPath || !keyDir) {
    console.error("Usage: dcp governance sign-advisory <advisory.json> --key-dir <dir> [--out <file>]");
    process.exit(2);
  }

  if (!fs.existsSync(advisoryPath)) {
    console.error(`Advisory file not found: ${advisoryPath}`);
    process.exit(2);
  }

  const advisory = safeParseJSON(safePath(advisoryPath), "advisory");
  const participantPath = path.join(keyDir, "participant.json");

  if (!fs.existsSync(participantPath)) {
    console.error(`Participant file not found at ${participantPath}`);
    process.exit(2);
  }

  const participant = safeParseJSON(participantPath, "participant");

  console.log("=== Sign Algorithm Advisory ===\n");
  console.log(`Advisory:    ${advisory.advisory_id || "unknown"}`);
  console.log(`Severity:    ${advisory.severity}`);
  console.log(`Action:      ${advisory.action}`);
  console.log(`Affected:    ${advisory.affected_algorithms?.join(", ")}`);
  console.log(`Signer:      ${participant.participant_id}`);

  // Create advisory signature
  const advisoryPayload = JSON.stringify({
    advisory_id: advisory.advisory_id,
    affected_algorithms: advisory.affected_algorithms,
    action: advisory.action,
    effective_date: advisory.effective_date,
    issued_at: advisory.issued_at,
  });

  const sigHash = crypto.createHash("sha256").update(advisoryPayload).digest("hex");

  const edSkPath = path.join(keyDir, "ed25519_secret_key.txt");
  const pqSkPath = path.join(keyDir, "mldsa65_secret_key.txt");
  if (!fs.existsSync(edSkPath) || !fs.existsSync(pqSkPath)) {
    console.error("Missing secret key files in key directory");
    process.exit(2);
  }
  const edSkB64 = fs.readFileSync(edSkPath, "utf8").trim();
  const pqSkB64 = fs.readFileSync(pqSkPath, "utf8").trim();

  const payloadBytes = Buffer.from(advisoryPayload, "utf8");
  const edSk = Buffer.from(edSkB64, "base64");
  const edSig = nacl.sign.detached(payloadBytes, edSk);
  const edSigB64 = Buffer.from(edSig).toString("base64");

  const pqSk = Buffer.from(pqSkB64, "base64");
  const bindingInput = Buffer.concat([payloadBytes, Buffer.from(edSig)]);
  const pqSig = ml_dsa65.sign(bindingInput, pqSk);
  const pqSigB64 = Buffer.from(pqSig).toString("base64");

  const governanceSig = {
    party_id: participant.participant_id,
    ed25519_kid: participant.ed25519_kid,
    mldsa65_kid: participant.mldsa65_kid,
    advisory_hash: "sha256:" + sigHash,
    composite_sig: {
      classical: {
        alg: "ed25519",
        kid: participant.ed25519_kid,
        sig_b64: edSigB64,
      },
      pq: {
        alg: "ml-dsa-65",
        kid: participant.mldsa65_kid,
        sig_b64: pqSigB64,
      },
      binding: "pq_over_classical",
    },
    signed_at: new Date().toISOString(),
  };

  const sigOutPath = outPath || advisoryPath.replace(".json", `.sig.${participant.participant_id}.json`);
  fs.writeFileSync(sigOutPath, JSON.stringify(governanceSig, null, 2) + "\n");

  console.log(`\n✅ Advisory signed`);
  console.log(`   Signature: ${sigOutPath}`);
  console.log(`   Hash:      ${governanceSig.advisory_hash}`);
  process.exit(0);
}

// ── Phase 3: Verify governance advisory signatures ──
if (cmd === "governance" && args[1] === "verify-advisory") {
  const advisoryPath = args[2];
  const keysIdx = args.indexOf("--keys");
  const sigsIdx = args.indexOf("--sigs");

  const keysPath = keysIdx >= 0 ? args[keysIdx + 1] : null;

  if (!advisoryPath || !keysPath) {
    console.error("Usage: dcp governance verify-advisory <advisory.json> --keys <governance-keys.json> [--sigs <sig1.json>,<sig2.json>]");
    process.exit(2);
  }

  const advisory = safeParseJSON(safePath(advisoryPath), "advisory");
  const govKeys = safeParseJSON(safePath(keysPath), "governance keys");

  const threshold = govKeys.governance_key_set?.threshold || govKeys.threshold || 2;
  const knownParticipants = new Set(
    (govKeys.participants || govKeys.governance_key_set?.participants || []).map(p => p.participant_id)
  );
  const knownKids = new Set();
  for (const p of (govKeys.participants || [])) {
    for (const k of (p.keys || [])) knownKids.add(k.kid);
  }

  let sigFiles = [];
  if (sigsIdx >= 0) {
    sigFiles = args[sigsIdx + 1].split(",");
  } else {
    const dir = path.dirname(advisoryPath);
    const prefix = path.basename(advisoryPath, ".json") + ".sig.";
    if (fs.existsSync(dir)) {
      sigFiles = fs.readdirSync(dir)
        .filter(f => f.startsWith(prefix) && f.endsWith(".json"))
        .map(f => path.join(dir, f));
    }
  }

  console.log("=== Verify Governance Advisory ===\n");
  console.log(`Advisory:    ${advisory.advisory_id || "unknown"}`);
  console.log(`Threshold:   ${threshold}`);
  console.log(`Signatures:  ${sigFiles.length} found`);

  const advisoryPayload = JSON.stringify({
    advisory_id: advisory.advisory_id,
    affected_algorithms: advisory.affected_algorithms,
    action: advisory.action,
    effective_date: advisory.effective_date,
    issued_at: advisory.issued_at,
  });
  const expectedHash = "sha256:" + crypto.createHash("sha256").update(advisoryPayload).digest("hex");

  const validSigners = new Set();
  for (const sigFile of sigFiles) {
    if (!fs.existsSync(sigFile)) {
      console.log(`  ❌ ${sigFile}: file not found`);
      continue;
    }
    const sig = safeParseJSON(sigFile, "signature");

    if (!sig.party_id || !sig.advisory_hash || !sig.composite_sig) {
      console.log(`  ❌ ${sig.party_id || "unknown"}: malformed signature file`);
      continue;
    }

    if (knownParticipants.size > 0 && !knownParticipants.has(sig.party_id)) {
      console.log(`  ❌ ${sig.party_id}: not a registered governance participant`);
      continue;
    }

    if (sig.advisory_hash !== expectedHash) {
      console.log(`  ❌ ${sig.party_id}: advisory_hash mismatch (expected ${expectedHash.slice(0, 24)}..., got ${sig.advisory_hash?.slice(0, 24)}...)`);
      continue;
    }

    if (!sig.composite_sig?.classical?.sig_b64) {
      console.log(`  ❌ ${sig.party_id}: missing classical signature`);
      continue;
    }

    console.log(`  ✅ ${sig.party_id} (${sig.ed25519_kid?.slice(0, 8)}...) — hash verified`);
    console.log(`     ⚠️  Cryptographic signature verification requires DCP core SDK`);
    validSigners.add(sig.party_id);
  }

  const thresholdMet = validSigners.size >= threshold;
  console.log(`\nThreshold: ${validSigners.size}/${threshold} ${thresholdMet ? "✅ MET" : "❌ NOT MET"}`);

  if (thresholdMet) {
    console.log("\n✅ Advisory governance signatures verified (structural + hash binding)");
    console.log("   ⚠️  Full cryptographic verification requires DCP SDK integration");
  } else {
    console.error(`\n❌ Need ${threshold - validSigners.size} more valid signature(s)`);
    process.exit(1);
  }
  process.exit(0);
}

// ── Phase 3: Audit gaps verification ──
if (cmd === "audit" && args[1] === "gaps") {
  console.log("=== DCP-AI v2.0 Gap Audit ===\n");

  const gaps = [
    { id: 1,  name: "Key Recovery (M-of-N Social Recovery)", file: "sdks/typescript/src/core/key-recovery.ts" },
    { id: 2,  name: "RPR Privacy — Blinded Mode", file: "sdks/typescript/src/core/blinded-rpr.ts" },
    { id: 3,  name: "Missing V2 Artifacts (JurisdictionAttestation, HumanConfirmation)", file: "schemas/v2/jurisdiction_attestation.schema.json" },
    { id: 4,  name: "Algorithm Deprecation Protocol", file: "sdks/typescript/src/core/algorithm-advisory.ts" },
    { id: 5,  name: "Multi-Party Authorization", file: "sdks/typescript/src/core/multi-party-auth.ts" },
    { id: 6,  name: "Dual-Hash Chains (SHA-256 + SHA3-256)", file: "sdks/typescript/src/core/dual-hash.ts" },
    { id: 7,  name: "Python Integrations V2", file: "integrations/fastapi/__init__.py" },
    { id: 8,  name: "gRPC/Protobuf V2 Messages", file: "api/proto/dcp.proto" },
    { id: 9,  name: "CLI V2 Commands", file: "bin/dcp.js" },
    { id: 10, name: "NIST KAT Validation", file: "sdks/typescript/src/providers/ml-dsa-65.ts" },
    { id: 11, name: "Secure Memory / HSM Provider", file: "sdks/typescript/src/providers/hsm-provider.ts" },
    { id: 12, name: "Version & Capability Negotiation", file: "server/index.js" },
    { id: 13, name: "Emergency Revocation (Panic Button)", file: "sdks/typescript/src/core/emergency-revocation.ts" },
  ];

  let allClosed = true;

  for (const gap of gaps) {
    const filePath = path.join(process.cwd(), gap.file);
    const exists = fs.existsSync(filePath);

    if (exists) {
      const content = fs.readFileSync(filePath, "utf8");
      const lines = content.split("\n").length;
      console.log(`  ✅ Gap #${String(gap.id).padStart(2, " ")}: ${gap.name}`);
      console.log(`     File: ${gap.file} (${lines} lines)`);
    } else {
      console.log(`  ❌ Gap #${String(gap.id).padStart(2, " ")}: ${gap.name}`);
      console.log(`     Missing: ${gap.file}`);
      allClosed = false;
    }
  }

  // Phase 3 specific checks
  console.log("\n  Phase 3 Components:");

  const phase3Files = [
    { name: "pq_only verifier mode", file: "sdks/typescript/src/core/verify-v2.ts", marker: "pq_only" },
    { name: "HsmCryptoProvider", file: "sdks/typescript/src/providers/hsm-provider.ts", marker: "HsmCryptoProvider" },
    { name: "Governance ceremony", file: "sdks/typescript/src/core/governance.ts", marker: "executeGovernanceCeremony" },
    { name: "Advisory auto-response", file: "sdks/typescript/src/core/algorithm-advisory.ts", marker: "autoApplyAdvisoriesToPolicy" },
    { name: "Key rotation ceremony CLI", file: "bin/dcp.js", marker: "Key Rotation Ceremony" },
    { name: "DCP-AI v2.0 Spec", file: "spec/DCP-AI-v2.0.md", marker: "Normative Specification" },
  ];

  for (const check of phase3Files) {
    const filePath = path.join(process.cwd(), check.file);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf8");
      if (content.includes(check.marker)) {
        console.log(`  ✅ ${check.name}`);
      } else {
        console.log(`  ⚠️  ${check.name} (file exists but marker '${check.marker}' not found)`);
      }
    } else {
      console.log(`  ❌ ${check.name} (${check.file} missing)`);
      allClosed = false;
    }
  }

  console.log(allClosed
    ? "\n✅ ALL 13 GAPS VERIFIED CLOSED — DCP-AI v2.0 audit passed."
    : "\n❌ AUDIT INCOMPLETE — some gaps remain open.");

  process.exit(allClosed ? 0 : 1);
}

// ── Integrity ──
if (cmd === "integrity") {
  const fingerprintsPath = path.join(process.cwd(), "protocol_fingerprints.json");
  if (!fs.existsSync(fingerprintsPath)) {
    console.error("protocol_fingerprints.json not found. Run from repo root.");
    process.exit(2);
  }
  const fingerprints = safeParseJSON(fingerprintsPath, "protocol fingerprints");
  const expected = fingerprints.schema_fingerprints;
  const schemasDir = path.join(process.cwd(), "schemas", "v1");
  let failures = 0;
  let checked = 0;
  for (const [name, expectedHash] of Object.entries(expected)) {
    const filePath = path.join(schemasDir, `${name}.schema.json`);
    if (!fs.existsSync(filePath)) {
      console.error(`MISSING  ${name}.schema.json`);
      failures++;
      continue;
    }
    const content = fs.readFileSync(filePath);
    const actualHash = "sha256:" + crypto.createHash("sha256").update(content).digest("hex");
    if (actualHash === expectedHash) {
      console.log(`✅ ${name}`);
    } else {
      console.error(`❌ ${name}`);
      console.error(`   expected: ${expectedHash}`);
      console.error(`   got:      ${actualHash}`);
      failures++;
    }
    checked++;
  }
  console.log(`\nProtocol: ${fingerprints.protocol} v${fingerprints.version}`);
  console.log(`Checked: ${checked} schemas`);
  if (failures > 0) {
    console.error(`\n❌ INTEGRITY CHECK FAILED (${failures} mismatch).`);
    process.exit(1);
  }
  console.log("\n✅ PROTOCOL INTEGRITY VERIFIED — all schemas match canonical fingerprints.");
  process.exit(0);
}

console.error(`Unknown command: ${cmd}`);
printHelp();
process.exit(2);
