#!/usr/bin/env node

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import prompts from 'prompts';
import chalk from 'chalk';
import ora from 'ora';
import { generateKeys, generateHybridKeys, generateRPR, generatePassport, generateSessionNonce } from '../lib/identity.js';
import { saveConfig, ensureDcpDir } from '../lib/config.js';

const BANNER = `
${chalk.cyan('╔══════════════════════════════════════════════════════╗')}
${chalk.cyan('║')}  ${chalk.bold.white('DCP-AI')} ${chalk.gray('Digital Citizenship Protocol for AI Agents')}  ${chalk.cyan('║')}
${chalk.cyan('║')}  ${chalk.yellow('v2.0')}  ${chalk.gray('— Interactive Setup Wizard')}                   ${chalk.cyan('║')}
${chalk.cyan('╚══════════════════════════════════════════════════════╝')}
`;

const JURISDICTIONS = [
  { title: 'United States', value: 'US' },
  { title: 'European Union', value: 'EU' },
  { title: 'United Kingdom', value: 'GB' },
  { title: 'Canada', value: 'CA' },
  { title: 'Australia', value: 'AU' },
  { title: 'Japan', value: 'JP' },
  { title: 'Singapore', value: 'SG' },
  { title: 'Switzerland', value: 'CH' },
  { title: 'Germany', value: 'DE' },
  { title: 'France', value: 'FR' },
  { title: 'India', value: 'IN' },
  { title: 'Brazil', value: 'BR' },
  { title: 'Other (specify)', value: '__other__' },
];

const FRAMEWORKS = [
  { title: 'LangChain', value: 'langchain' },
  { title: 'CrewAI', value: 'crewai' },
  { title: 'OpenAI Agents SDK', value: 'openai' },
  { title: 'Express.js', value: 'express' },
  { title: 'FastAPI (Python)', value: 'fastapi' },
  { title: 'None / Custom', value: 'none' },
];

const SECURITY_TIERS = [
  { title: 'Routine    — Low-risk, informational tasks', value: 'routine' },
  { title: 'Standard   — Normal business operations', value: 'standard' },
  { title: 'Elevated   — Sensitive data or financial ops', value: 'elevated' },
  { title: 'Maximum    — Critical infrastructure / PII', value: 'maximum' },
];

async function run() {
  console.log(BANNER);
  console.log(chalk.gray('  This wizard will set up DCP digital citizenship in the'));
  console.log(chalk.gray('  current directory. You can change settings later in .dcp/config.json\n'));

  const response = await prompts(
    [
      {
        type: 'text',
        name: 'entityName',
        message: 'Entity name (your name or org)',
        validate: (v) => (v.trim().length > 0 ? true : 'Entity name is required'),
      },
      {
        type: 'select',
        name: 'jurisdiction',
        message: 'Primary jurisdiction',
        choices: JURISDICTIONS,
      },
      {
        type: (prev) => (prev === '__other__' ? 'text' : null),
        name: 'jurisdictionCustom',
        message: 'Enter jurisdiction code (ISO 3166-1 alpha-2)',
        validate: (v) => (v.trim().length >= 2 ? true : 'Please enter a valid code'),
      },
      {
        type: 'select',
        name: 'framework',
        message: 'Agent framework',
        choices: FRAMEWORKS,
      },
      {
        type: 'select',
        name: 'securityTier',
        message: 'Default security tier',
        choices: SECURITY_TIERS,
        initial: 1,
      },
      {
        type: 'confirm',
        name: 'hybridKeys',
        message: 'Generate hybrid keys (Ed25519 + ML-DSA-65 post-quantum)?',
        initial: (prev) => prev === 'elevated' || prev === 'maximum',
      },
    ],
    {
      onCancel: () => {
        console.log(chalk.yellow('\n  Setup cancelled.\n'));
        process.exit(0);
      },
    }
  );

  const jurisdiction =
    response.jurisdiction === '__other__'
      ? response.jurisdictionCustom.trim().toUpperCase()
      : response.jurisdiction;

  console.log();
  const sessionNonce = generateSessionNonce();
  const useHybrid = response.hybridKeys;

  const spinner = ora('Generating Ed25519 keypair...').start();
  let keys;

  if (useHybrid) {
    const hybrid = generateHybridKeys();
    keys = {
      publicKey: hybrid.classical.publicKey,
      secretKey: hybrid.classical.secretKey,
      publicKeyRaw: hybrid.classical.publicKeyRaw,
      secretKeyRaw: hybrid.classical.secretKeyRaw,
      pq: hybrid.pq,
    };
    spinner.succeed('Ed25519 keypair generated');

    const spinnerPQ = ora('Generating ML-DSA-65 post-quantum keypair...').start();
    await new Promise((r) => setTimeout(r, 300));
    spinnerPQ.succeed(
      'ML-DSA-65 hybrid keypair generated ' + chalk.gray('(simulated — production requires FIPS 204 library)')
    );
  } else {
    keys = generateKeys();
    spinner.succeed('Ed25519 keypair generated');
  }

  const spinnerFiles = ora('Creating .dcp/ directory structure...').start();
  const { dcpDir, keysDir } = await ensureDcpDir();

  const config = {
    dcp_version: '2.0',
    entity_name: response.entityName,
    jurisdiction,
    framework: response.framework,
    default_security_tier: response.securityTier,
    hybrid_keys: useHybrid,
    session_nonce: sessionNonce,
    created_at: new Date().toISOString(),
  };
  await saveConfig(config);

  await writeFile(join(keysDir, 'ed25519_public.key'), keys.publicKey + '\n', 'utf-8');
  await writeFile(join(keysDir, 'ed25519_secret.key'), keys.secretKey + '\n', 'utf-8');

  if (useHybrid && keys.pq) {
    await writeFile(join(keysDir, 'ml_dsa_65_public.key'), keys.pq.publicKey + '\n', 'utf-8');
    await writeFile(join(keysDir, 'ml_dsa_65_secret.key'), keys.pq.secretKey + '\n', 'utf-8');
  }

  const rpr = generateRPR(response.entityName, jurisdiction, keys, { sessionNonce });
  await writeFile(
    join(dcpDir, 'identity.json'),
    JSON.stringify(rpr, null, 2) + '\n',
    'utf-8'
  );

  const agentName = `${response.entityName.toLowerCase().replace(/\s+/g, '-')}-agent-001`;
  const passport = generatePassport(
    agentName,
    ['api_call', 'data_retrieval'],
    jurisdiction,
    keys,
    rpr,
    { sessionNonce }
  );
  await writeFile(
    join(dcpDir, 'passport.json'),
    JSON.stringify(passport, null, 2) + '\n',
    'utf-8'
  );

  spinnerFiles.succeed('DCP directory created');

  console.log();
  console.log(chalk.green.bold('  ✓ DCP Digital Citizenship initialized!\n'));
  console.log(chalk.white('  Created files:'));
  console.log(chalk.gray('    .dcp/config.json          — DCP configuration'));
  console.log(chalk.gray('    .dcp/keys/ed25519_public.key'));
  console.log(chalk.gray('    .dcp/keys/ed25519_secret.key'));
  if (useHybrid) {
    console.log(chalk.gray('    .dcp/keys/ml_dsa_65_public.key'));
    console.log(chalk.gray('    .dcp/keys/ml_dsa_65_secret.key'));
  }
  console.log(chalk.gray('    .dcp/identity.json        — Responsible Principal Record (RPR)'));
  console.log(chalk.gray('    .dcp/passport.json        — Agent Passport'));
  console.log();
  console.log(chalk.white('  Next steps:'));
  console.log(chalk.cyan('    1.') + ' Review .dcp/config.json and adjust settings');
  console.log(chalk.cyan('    2.') + ' Keep .dcp/keys/*_secret.key safe — ' + chalk.red('do not commit them'));
  console.log(chalk.cyan('    3.') + ' Add .dcp/keys/ to your .gitignore');
  console.log(chalk.cyan('    4.') + ' Integrate with your agent using @dcp-ai/sdk');
  console.log(chalk.cyan('    5.') + ' Run ' + chalk.bold('dcp-ai status') + ' to verify your setup');
  console.log();
}

run().catch((err) => {
  console.error(chalk.red('\n  Error: ') + err.message);
  process.exit(1);
});
