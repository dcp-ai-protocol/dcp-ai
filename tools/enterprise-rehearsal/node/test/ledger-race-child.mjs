// One contender of the two-process ledger test (TEST ONLY).
//   node node/test/ledger-race-child.mjs ROOT TENANT START_AT_MS KEYS_FILE
// Sleeps until START_AT_MS, tries to reserve every key and prints {"pid", "attempted", "won"} as JSON.
import fs from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { reserve } from '../ledger.mjs';

const [root, tenant, startAt, keysFile] = process.argv.slice(2);
const keys = JSON.parse(fs.readFileSync(keysFile, 'utf8'));
await sleep(Math.max(0, Number(startAt) - Date.now()));
const won = keys.filter((k) => reserve(root, tenant, k));
console.log(JSON.stringify({ pid: process.pid, attempted: keys.length, won }));
