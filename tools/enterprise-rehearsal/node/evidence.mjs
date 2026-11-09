// Where a run keeps its TEST ONLY secrets and its evidence (TEST ONLY). Standard library only: the runner uses it in its
// finally, and the launcher uses it when the runner died before its finally could run.
import fs from 'node:fs';
import path from 'node:path';

const exists = (p) => fs.lstatSync(p, { throwIfNoEntry: false }) !== undefined;
const lanes = (runDir) => {
  const dir = path.join(runDir, 'lanes');
  return exists(dir) ? fs.readdirSync(dir).sort().map((n) => path.join(dir, n)) : [];
};

/** The secret directories of a run: material/secrets and lanes/<lane>/state/secrets, those that exist. */
export function secretDirs(runDir) {
  return [path.join(runDir, 'material', 'secrets'), ...lanes(runDir).map((l) => path.join(l, 'state', 'secrets'))].filter(exists);
}

/** Everything else a run leaves, as scan roots: never a secret directory. */
export function evidenceRoots(runDir) {
  const roots = ['report.json', 'plan.json', path.join('material', 'public'), path.join('material', 'oob')].map((r) => path.join(runDir, r));
  for (const l of lanes(runDir)) {
    roots.push(...fs.readdirSync(l).filter((n) => n !== 'state').map((n) => path.join(l, n)), path.join(l, 'state', 'operator'));
  }
  return roots.filter(exists);
}
