// Control fixture, not an implementation: writes its pid to argv[2], ignores SIGTERM and never answers.
// With argv[3] = 'spawn-detached' it instead starts a detached copy of itself (which writes the pid),
// waits one second and exits 0, leaving that copy behind.
import fs from 'node:fs';
import { spawn } from 'node:child_process';

if (process.argv[3] === 'spawn-detached') {
  spawn(process.execPath, [process.argv[1], process.argv[2]], { detached: true, stdio: 'ignore' }).unref();
  setTimeout(() => process.exit(0), 1000);
} else {
  fs.writeFileSync(process.argv[2], String(process.pid));
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
}
