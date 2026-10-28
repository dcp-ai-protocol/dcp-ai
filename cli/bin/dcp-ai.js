#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import crypto from 'node:crypto';
import chalk from 'chalk';
import { loadConfig, findConfigDir } from '../lib/config.js';

const VERSION = '2.0';
const CLI_VERSION = '2.1.1';

const HELP = `
${chalk.bold('dcp-ai')} — DCP Digital Citizenship Protocol CLI

${chalk.yellow('Usage:')}
  dcp-ai <command> [options]

${chalk.yellow('Commands:')}
  ${chalk.cyan('init')}                   Initialize DCP in the current directory
  ${chalk.cyan('status')}                 Show current DCP configuration
  ${chalk.cyan('verify')} <bundle.json>   Verify a DCP bundle
  ${chalk.cyan('sign')}   <bundle.json>   Sign a DCP bundle
  ${chalk.cyan('info')}                   Show protocol version and capabilities

${chalk.yellow('Options:')}
  --help, -h             Show this help message
  --version, -v          Show version
`;

// RFC 8032 §5.1.7 requires S < L, which TweetNaCl does not check. Same check as
// verifyDetached in sdks/typescript/src/core/ed25519-scalar.ts: the range is
// checked only on input TweetNaCl accepts, so its errors stay the same. `nacl`
// is passed in so that tweetnacl is still loaded only by the commands using it.
const L = [
  0xed, 0xd3, 0xf5, 0x5c, 0x1a, 0x63, 0x12, 0x58, 0xd6, 0x9c, 0xf7, 0xa2, 0xde, 0xf9, 0xde, 0x14,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x10,
];

function scalarBelowL(sig) {
  for (let i = 31; i >= 0; i--) {
    if (sig[32 + i] !== L[i]) return sig[32 + i] < L[i];
  }
  return false; // S = L
}

function verifyDetached(nacl, msg, sig, pk) {
  if (
    msg instanceof Uint8Array && sig instanceof Uint8Array && pk instanceof Uint8Array &&
    sig.length === nacl.sign.signatureLength && pk.length === nacl.sign.publicKeyLength &&
    !scalarBelowL(sig)
  ) {
    return false;
  }
  return nacl.sign.detached.verify(msg, sig, pk);
}

async function cmdInit() {
  const initPath = new URL('./dcp-init.js', import.meta.url).pathname;
  const { execFileSync } = await import('node:child_process');
  execFileSync(process.execPath, [initPath], { stdio: 'inherit' });
}

async function cmdStatus() {
  const dcpDir = findConfigDir();
  if (!dcpDir) {
    console.log(chalk.red('\n  No .dcp/ directory found.'));
    console.log(chalk.gray('  Run ') + chalk.bold('dcp-ai init') + chalk.gray(' to set up DCP.\n'));
    process.exit(1);
  }

  const config = await loadConfig();
  if (!config) {
    console.log(chalk.red('\n  Could not load .dcp/config.json\n'));
    process.exit(1);
  }

  console.log();
  console.log(chalk.bold('  DCP Status'));
  console.log(chalk.gray('  ─────────────────────────────'));
  console.log(`  ${chalk.cyan('Directory:')}       ${dcpDir}`);
  console.log(`  ${chalk.cyan('Entity:')}          ${config.entity_name}`);
  console.log(`  ${chalk.cyan('Jurisdiction:')}    ${config.jurisdiction}`);
  console.log(`  ${chalk.cyan('Framework:')}       ${config.framework}`);
  console.log(`  ${chalk.cyan('Security Tier:')}   ${config.default_security_tier}`);
  console.log(`  ${chalk.cyan('DCP Version:')}     ${config.dcp_version}`);
  console.log(`  ${chalk.cyan('Created:')}         ${config.created_at}`);

  const keysDir = join(dcpDir, 'keys');
  const hasPublicKey = existsSync(join(keysDir, 'ed25519_public.key'));
  const hasSecretKey = existsSync(join(keysDir, 'ed25519_secret.key'));
  const hasIdentity = existsSync(join(dcpDir, 'identity.json'));
  const hasPassport = existsSync(join(dcpDir, 'passport.json'));

  console.log();
  console.log(chalk.bold('  Artifacts'));
  console.log(chalk.gray('  ─────────────────────────────'));
  console.log(`  ${hasPublicKey ? chalk.green('✓') : chalk.red('✗')} Ed25519 public key`);
  console.log(`  ${hasSecretKey ? chalk.green('✓') : chalk.red('✗')} Ed25519 secret key`);
  console.log(`  ${hasIdentity ? chalk.green('✓') : chalk.red('✗')} Responsible Principal Record`);
  console.log(`  ${hasPassport ? chalk.green('✓') : chalk.red('✗')} Agent Passport`);
  console.log();
}

async function cmdVerify(bundlePath) {
  if (!bundlePath) {
    console.log(chalk.red('\n  Usage: dcp-ai verify <bundle.json>\n'));
    process.exit(1);
  }

  if (!existsSync(bundlePath)) {
    console.log(chalk.red(`\n  File not found: ${bundlePath}\n`));
    process.exit(1);
  }

  try {
    const raw = await readFile(bundlePath, 'utf-8');
    const signed = JSON.parse(raw);

    console.log();
    console.log(chalk.bold('  Bundle Verification'));
    console.log(chalk.gray('  ─────────────────────────────'));

    // The pre-normative V2 envelope that earlier versions produced is rejected
    // first, also when its markers sit on a V1 or a normative V2 bundle.
    if (
      signed.dcp_version === '2.0' ||
      signed.bundle_manifest !== undefined ||
      signed.signature?.binding === 'composite'
    ) {
      console.log(
        `  ${chalk.red('✗')} Unsupported pre-normative V2 envelope (top-level dcp_version/bundle_manifest or signature.binding).`,
      );
      console.log(chalk.gray('    Re-sign with @dcp-ai/sdk signBundleV2 or `dcp sign-bundle --composite`.'));
      process.exitCode = 1;
    } else if (signed.bundle?.dcp_bundle_version === '2.0' || signed.bundle?.manifest !== undefined) {
      await verifyV2(signed);
    } else {
      await verifyV1(signed);
    }

    console.log();
  } catch (err) {
    console.log(chalk.red(`\n  Error verifying bundle: ${err.message}\n`));
    process.exit(1);
  }
}

// The local key, when .dcp/keys/ed25519_public.key exists, pins the principal's
// signing key. Without it the keys are the bundle's own: the signature is checked,
// not whether the principal is trusted or the bundle admitted.
async function verifyV2(signed) {
  console.log(`  ${chalk.green('✓')} Format: V2`);
  const dcpDir = findConfigDir();
  const keyPath = dcpDir && join(dcpDir, 'keys', 'ed25519_public.key');
  const pinnedKeyB64 = keyPath && existsSync(keyPath) ? (await readFile(keyPath, 'utf-8')).trim() : undefined;

  const { verifyBundleV2 } = await import('../lib/verify-v2.js');
  const result = await verifyBundleV2(signed, pinnedKeyB64);
  if (result.verified) {
    console.log(`  ${chalk.green('✓')} V2 normative verification VALID`);
  } else {
    console.log(`  ${chalk.red('✗')} V2 normative verification INVALID`);
    for (const error of result.errors) console.log(`    - ${error}`);
    process.exitCode = 1;
  }
  for (const warning of result.warnings || []) console.log(`  ${chalk.yellow('⚠')} ${warning}`);
  const keys = pinnedKeyB64 === undefined ? 'signer keys from the bundle' : 'signer pinned to .dcp/keys/ed25519_public.key';
  console.log(chalk.gray(`  @dcp-ai/sdk verifySignedBundleV2, default verifier policy, ${keys}.`));
  console.log(chalk.gray('  Signature verification only: not an admission or trust decision.'));
}

async function verifyV1(signed) {
  console.log(`  ${chalk.green('✓')} Format: V1 classical`);

  if (signed.bundle) {
    const nacl = (await import('tweetnacl')).default;
    const naclUtil = (await import('tweetnacl-util')).default;

    let publicKeyB64 = null;
    const dcpDir = findConfigDir();
    if (dcpDir) {
      const pubKeyPath = join(dcpDir, 'keys', 'ed25519_public.key');
      if (existsSync(pubKeyPath)) {
        publicKeyB64 = (await readFile(pubKeyPath, 'utf-8')).trim();
      }
    }

    if (!publicKeyB64) {
      publicKeyB64 = signed.signature?.signer?.public_key_b64;
    }

    if (publicKeyB64 && signed.signature?.sig_b64) {
      const jsonStableStringify = (await import('json-stable-stringify')).default;
      const canon = jsonStableStringify(signed.bundle);
      const msg = naclUtil.decodeUTF8(canon);
      const sig = naclUtil.decodeBase64(signed.signature.sig_b64);
      const pk = naclUtil.decodeBase64(publicKeyB64);
      const ok = verifyDetached(nacl, msg, sig, pk);
      if (ok) {
        console.log(`  ${chalk.green('✓')} Ed25519 signature VALID`);
      } else {
        console.log(`  ${chalk.red('✗')} Ed25519 signature INVALID`);
        process.exitCode = 1;
      }
    } else {
      console.log(chalk.yellow('  ⚠ No public key available for cryptographic verification'));
      process.exitCode = 1;
    }

    if (signed.session_nonce) {
      console.log(`  ${chalk.green('✓')} Session nonce: ${signed.session_nonce.slice(0, 16)}...`);
    }
  } else {
    console.log(chalk.yellow('  ⚠ Not a signed bundle format — structural check only'));
    process.exitCode = 1;
  }
}

async function cmdSign(bundlePath) {
  if (!bundlePath) {
    console.log(chalk.red('\n  Usage: dcp-ai sign <bundle.json>\n'));
    process.exit(1);
  }

  const dcpDir = findConfigDir();
  if (!dcpDir) {
    console.log(chalk.red('\n  No .dcp/ directory found. Run dcp-ai init first.\n'));
    process.exit(1);
  }

  const secretKeyPath = join(dcpDir, 'keys', 'ed25519_secret.key');
  if (!existsSync(secretKeyPath)) {
    console.log(chalk.red('\n  Secret key not found at .dcp/keys/ed25519_secret.key\n'));
    process.exit(1);
  }

  if (!existsSync(bundlePath)) {
    console.log(chalk.red(`\n  File not found: ${bundlePath}\n`));
    process.exit(1);
  }

  try {
    const raw = await readFile(bundlePath, 'utf-8');
    const bundle = JSON.parse(raw);
    const secretKeyB64 = (await readFile(secretKeyPath, 'utf-8')).trim();

    const nacl = (await import('tweetnacl')).default;
    const naclUtil = (await import('tweetnacl-util')).default;

    const secretKey = naclUtil.decodeBase64(secretKeyB64);
    const publicKey = secretKey.slice(32);
    const publicKeyB64 = naclUtil.encodeBase64(publicKey);

    const payload = JSON.stringify(bundle.payload || bundle);
    const message = naclUtil.decodeUTF8(payload);
    const signature = nacl.sign.detached(message, secretKey);

    const kid = crypto
      .createHash('sha256')
      .update(publicKeyB64)
      .digest('hex')
      .slice(0, 16);

    const signedBundle = {
      ...bundle,
      signatures: [
        ...(bundle.signatures || []),
        {
          kid,
          alg: 'ed25519',
          sig_b64: naclUtil.encodeBase64(signature),
          signed_at: new Date().toISOString(),
        },
      ],
    };

    const { writeFile: writeFileAsync } = await import('node:fs/promises');
    await writeFileAsync(bundlePath, JSON.stringify(signedBundle, null, 2) + '\n', 'utf-8');

    console.log();
    console.log(chalk.green.bold('  ✓ Bundle signed successfully'));
    console.log(chalk.gray(`    File: ${bundlePath}`));
    console.log(chalk.gray(`    Key:  ${kid}`));
    console.log(chalk.gray(`    Alg:  ed25519`));
    console.log();
  } catch (err) {
    console.log(chalk.red(`\n  Error signing bundle: ${err.message}\n`));
    process.exit(1);
  }
}

function cmdInfo() {
  console.log();
  console.log(chalk.bold('  DCP-AI Protocol Info'));
  console.log(chalk.gray('  ─────────────────────────────'));
  console.log(`  ${chalk.cyan('Protocol Version:')}  ${VERSION}`);
  console.log(`  ${chalk.cyan('CLI Version:')}       ${CLI_VERSION}`);
  console.log(`  ${chalk.cyan('SDK Package:')}       @dcp-ai/sdk`);
  console.log();
  console.log(chalk.bold('  Supported Algorithms'));
  console.log(chalk.gray('  ─────────────────────────────'));
  console.log(`  ${chalk.green('✓')} Ed25519           ${chalk.gray('— Classical digital signatures')}`);
  console.log(`  ${chalk.green('✓')} ML-DSA-65         ${chalk.gray('— Post-quantum signatures (FIPS 204)')}`);
  console.log(`  ${chalk.green('✓')} SLH-DSA-SHA2-192f ${chalk.gray('— Hash-based PQ signatures (FIPS 205)')}`);
  console.log(`  ${chalk.green('✓')} ML-KEM-768        ${chalk.gray('— Post-quantum key encapsulation (FIPS 203)')}`);
  console.log(`  ${chalk.green('✓')} X25519            ${chalk.gray('— Classical key exchange')}`);
  console.log();
  console.log(chalk.bold('  Security Tiers'));
  console.log(chalk.gray('  ─────────────────────────────'));
  console.log(`  ${chalk.white('routine')}   — Ed25519 only, low-risk ops`);
  console.log(`  ${chalk.white('standard')}  — Ed25519, normal business operations`);
  console.log(`  ${chalk.white('elevated')}  — Ed25519 + ML-DSA-65 composite`);
  console.log(`  ${chalk.white('maximum')}   — Full composite with SLH-DSA fallback`);
  console.log();
  console.log(chalk.bold('  Capabilities'));
  console.log(chalk.gray('  ─────────────────────────────'));
  console.log(`  ${chalk.green('✓')} Responsible Principal Records (RPR)`);
  console.log(`  ${chalk.green('✓')} Agent Passports`);
  console.log(`  ${chalk.green('✓')} Security-tiered bundle signing`);
  console.log(`  ${chalk.green('✓')} Bundle verification & audit trails`);
  console.log(`  ${chalk.green('✓')} Shamir Secret Sharing key recovery`);
  console.log(`  ${chalk.green('✓')} Emergency revocation`);
  console.log(`  ${chalk.green('✓')} Blinded RPR (privacy-preserving)`);
  console.log();
}

const args = process.argv.slice(2);
const command = args[0];

async function main() {
  switch (command) {
    case 'init':
      await cmdInit();
      break;
    case 'status':
      await cmdStatus();
      break;
    case 'verify':
      await cmdVerify(args[1]);
      break;
    case 'sign':
      await cmdSign(args[1]);
      break;
    case 'info':
      cmdInfo();
      break;
    case '--version':
    case '-v':
      console.log(`dcp-ai ${CLI_VERSION} (protocol ${VERSION})`);
      break;
    case '--help':
    case '-h':
    case undefined:
      console.log(HELP);
      break;
    default:
      console.log(chalk.red(`\n  Unknown command: ${command}`));
      console.log(HELP);
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(chalk.red(`\n  Error: ${err.message}\n`));
  process.exit(1);
});
