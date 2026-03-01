#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import crypto from 'node:crypto';
import chalk from 'chalk';
import { loadConfig, findConfigDir } from '../lib/config.js';

const VERSION = '2.0';
const CLI_VERSION = '1.0.0';

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

    const isV2 = signed.dcp_version === '2.0' || signed.signature?.binding === 'composite';
    console.log(`  ${chalk.green('✓')} Format: ${isV2 ? 'V2 composite' : 'V1 classical'}`);

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
      if (!publicKeyB64 && isV2) {
        const edKey = signed.signature?.signer?.keys?.find(k => k.algorithm === 'Ed25519');
        if (edKey) publicKeyB64 = edKey.public_key_b64;
      }

      if (publicKeyB64 && signed.signature?.sig_b64) {
        const jsonStableStringify = (await import('json-stable-stringify')).default;
        const canon = jsonStableStringify(signed.bundle);
        const msg = naclUtil.decodeUTF8(canon);
        const sig = naclUtil.decodeBase64(signed.signature.sig_b64);
        const pk = naclUtil.decodeBase64(publicKeyB64);
        const ok = nacl.sign.detached.verify(msg, sig, pk);
        if (ok) {
          console.log(`  ${chalk.green('✓')} Ed25519 signature VALID`);
        } else {
          console.log(`  ${chalk.red('✗')} Ed25519 signature INVALID`);
        }
      } else if (publicKeyB64 && isV2 && signed.signature?.classical?.value) {
        const jsonStableStringify = (await import('json-stable-stringify')).default;
        const domainTag = signed.signature.domain_sep || 'DCP-BUNDLE-SIG-v2';
        const canon = jsonStableStringify(signed.bundle);
        const msg = naclUtil.decodeUTF8(`${domainTag}|${canon}`);
        const sig = naclUtil.decodeBase64(signed.signature.classical.value);
        const pk = naclUtil.decodeBase64(publicKeyB64);
        const ok = nacl.sign.detached.verify(msg, sig, pk);
        if (ok) {
          console.log(`  ${chalk.green('✓')} V2 classical signature VALID`);
        } else {
          console.log(`  ${chalk.red('✗')} V2 classical signature INVALID`);
        }

        if (signed.signature?.pq?.simulated) {
          console.log(`  ${chalk.yellow('⚠')} PQ signature simulated (ML-DSA-65 placeholder)`);
        }
      } else {
        console.log(chalk.yellow('  ⚠ No public key available for cryptographic verification'));
      }

      if (signed.bundle_manifest) {
        console.log(`  ${chalk.green('✓')} Bundle manifest present`);
      }
      if (signed.session_nonce) {
        console.log(`  ${chalk.green('✓')} Session nonce: ${signed.session_nonce.slice(0, 16)}...`);
      }
    } else {
      console.log(chalk.yellow('  ⚠ Not a signed bundle format — structural check only'));
    }

    console.log();
  } catch (err) {
    console.log(chalk.red(`\n  Error verifying bundle: ${err.message}\n`));
    process.exit(1);
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
