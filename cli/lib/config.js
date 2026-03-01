import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const DCP_DIR = '.dcp';
const CONFIG_FILE = 'config.json';

export function findConfigDir(startDir = process.cwd()) {
  let dir = resolve(startDir);
  const root = resolve('/');

  while (dir !== root) {
    const candidate = join(dir, DCP_DIR);
    if (existsSync(candidate)) return candidate;
    dir = resolve(dir, '..');
  }

  return null;
}

export async function loadConfig(startDir) {
  const dcpDir = findConfigDir(startDir);
  if (!dcpDir) return null;

  try {
    const raw = await readFile(join(dcpDir, CONFIG_FILE), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function saveConfig(config, baseDir = process.cwd()) {
  const dcpDir = join(baseDir, DCP_DIR);
  if (!existsSync(dcpDir)) {
    await mkdir(dcpDir, { recursive: true });
  }
  await writeFile(
    join(dcpDir, CONFIG_FILE),
    JSON.stringify(config, null, 2) + '\n',
    'utf-8'
  );
}

export async function ensureDcpDir(baseDir = process.cwd()) {
  const dcpDir = join(baseDir, DCP_DIR);
  const keysDir = join(dcpDir, 'keys');

  await mkdir(keysDir, { recursive: true });
  return { dcpDir, keysDir };
}
