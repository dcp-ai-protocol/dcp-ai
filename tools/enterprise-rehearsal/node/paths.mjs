// Path guards of the MP-05 rehearsal kit (TEST ONLY). Standard library only, so that the launcher can use them from the
// checkout without loading any package.
import fs from 'node:fs';
import path from 'node:path';

/**
 * Refuses a directory inside a Git work tree, so that generated material and secrets never go into a checkout. The
 * check is physical: the nearest existing ancestor is resolved through symbolic links, and both its real ancestors
 * and the lexical ones are searched for .git. A symbolic link that cannot be resolved is refused too.
 */
export function assertOutsideGit(dir) {
  const lexical = path.resolve(dir);
  let existing = lexical;
  while (!fs.lstatSync(existing, { throwIfNoEntry: false })) existing = path.dirname(existing);
  let physical;
  try {
    physical = fs.realpathSync(existing);
  } catch {
    throw new Error(`${dir}: ${existing} is a symbolic link that cannot be resolved`);
  }
  for (const start of [lexical, physical]) {
    for (let d = start; ; d = path.dirname(d)) {
      if (fs.existsSync(path.join(d, '.git'))) throw new Error(`${dir} is inside the Git work tree ${d}`);
      if (path.dirname(d) === d) break;
    }
  }
}
