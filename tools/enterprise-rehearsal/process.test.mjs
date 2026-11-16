import test from 'node:test';
import assert from 'node:assert/strict';
import { ServerProcess } from './process.mjs';

const ready = `console.log(JSON.stringify({ev:'ready',port:12345}));`;
const quit = code => `process.stdin.on('data',()=>process.exit(${code}));`;
const launch = (source, options) => new ServerProcess([process.execPath, '-e', source], options);

test('healthy child readiness and clean shutdown', async () => {
  const child = launch(ready + quit(0));
  try { await child.ready(2000); assert.equal(child.port, 12345); }
  finally { assert.equal((await child.stop(1000)).clean, true); }
});
test('missing readiness cannot pass', async () => {
  const child = launch(quit(0));
  try { await assert.rejects(child.ready(100), /deadline/); }
  finally { assert.equal((await child.stop(1000)).clean, true); }
});
test('spawn failure cannot pass or hang cleanup', async () => {
  const child = new ServerProcess(['/mp05-nonexistent-test-only']);
  await assert.rejects(child.ready(1000));
  assert.equal((await child.stop(100)).clean, false);
});
test('exit failure remains failure after readiness', async () => {
  const child = launch(ready + quit(7));
  await child.ready(2000);
  const result = await child.stop(1000);
  assert.equal(result.clean, false); assert.equal(result.exit.code, 7);
});
test('failed ps is not an empty process table', async () => {
  const child = launch(ready + quit(0), { ps: '/mp05-no-ps-test-only' });
  await child.ready(2000);
  const result = await child.stop(1000);
  assert.equal(result.clean, false); assert.equal(result.group_left, null);
});
test('unknown and duplicate control events fail closed', async () => {
  for (const events of [`console.log('{"ev":"unknown"}');`, ready + ready]) {
    const child = launch(events + quit(0));
    // Observe the protocol violation, rather than assuming a fixed startup time.
    const deadline = Date.now() + 2000;
    while (!child.failure && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    try { assert(child.failure); await assert.rejects(child.ready(1000), /control event/); }
    finally { assert.equal((await child.stop(1000)).clean, false); }
  }
});
test('successful parent with retained descendant is still failure', async () => {
  const child = launch(`const {spawn}=require('node:child_process'); spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});` + ready + quit(0));
  await child.ready(2000);
  const result = await child.stop(1000);
  assert.equal(result.clean, false);
  assert(result.retained_before_cleanup.length > 0);
  assert.deepEqual(result.group_left, []);
});
test('shutdown deadline forces cleanup and fails', async () => {
  const child = launch(ready + 'setInterval(()=>{},1000);');
  await child.ready(2000);
  const result = await child.stop(100);
  assert.equal(result.clean, false); assert.equal(result.exit, null);
  assert.deepEqual(result.group_left, []);
});
