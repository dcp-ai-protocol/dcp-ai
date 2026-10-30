#!/usr/bin/env node
// Launches one command for tools/conformance/perf.js under runProcess (tools/conformance/external.js): this process
// is the leader of the group runProcess creates and signals, and the command runs inside that group, so the deadline,
// SIGTERM, SIGKILL and cleanup reach it and its descendants. It applies the working directory and environment
// runProcess does not take.
//
//   node launch.mjs capture|log <cwd> <env JSON object> -- <command> [args...]
//
// capture: the command's stdout is this process's stdout (a version query). log: its stdout goes to stderr (a build
// log, kept and truncated by runProcess). Exits with the command's code, or 128 + the signal number.
import { spawn } from "child_process";
import os from "os";

const [mode, cwd, envJson, sep, cmd, ...args] = process.argv.slice(2);
let env;
try { env = JSON.parse(envJson); } catch { env = null; }
if (!["capture", "log"].includes(mode) || !cwd || env === null || typeof env !== "object" || sep !== "--" || !cmd) {
  process.stderr.write("usage: launch.mjs capture|log <cwd> <env JSON> -- <command> [args...]\n");
  process.exit(2);
}
const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", mode === "capture" ? "inherit" : process.stderr, "inherit"] });
child.on("error", (e) => { process.stderr.write(`launch: ${e.message}\n`); process.exit(127); });
child.on("exit", (code, signal) => process.exit(code ?? 128 + (os.constants.signals[signal] ?? 0)));
