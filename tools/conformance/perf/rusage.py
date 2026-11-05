"""Memory launcher of tools/conformance-perf-scale.js (format dcp-ai-perf-rusage/1). Standard library only, no shell.

    python -I rusage.py -- <child command> [args...]

Starts the child once with this process's stdin (the request), reads its stdout up to STDOUT_LIMIT bytes (beyond it
the child is killed and the output is reported as over the limit), then waits for that exact PID with os.wait4 and
writes one JSON document: the child's exit, its stdout (base64), wall time, CPU time and the kernel's high-water
resident set size of that process (ru_maxrss). It is the peak of the whole child process over its lifetime (runtime,
imports, request decoding, warmup, verification and result), not an allocation of the verifier and not a sampled
value. ru_maxrss is in bytes on macOS and in KiB on Linux; on any other platform the unit is unknown and every memory
value is null with the reason, never 0. This process runs in the process group the runner creates, so the runner's
deadline and cleanup reach the child too. A usage error exits 2; otherwise this exits 0 and the runner judges the
document.
"""

import base64
import json
import os
import subprocess
import sys
import time

FORMAT = "dcp-ai-perf-rusage/1"
STDOUT_LIMIT = 4 * 1024 * 1024
UNITS = {"darwin": ("bytes", 1), "linux": ("KiB", 1024)}


def main(argv):
    if len(argv) < 2 or argv[0] != "--":
        sys.stderr.write("usage: rusage.py -- <command> [args...]\n")
        return 2
    started = time.monotonic_ns()
    try:
        child = subprocess.Popen(argv[1:], stdin=None, stdout=subprocess.PIPE, shell=False)
    except OSError as e:
        sys.stderr.write(f"rusage: cannot start the child: {e}\n")
        return 3
    chunks, size, over = [], 0, False
    while True:
        chunk = child.stdout.read1(65536)
        if not chunk:
            break
        size += len(chunk)
        if size > STDOUT_LIMIT:
            over = True
            child.kill()
            break
        chunks.append(chunk)
    child.stdout.close()
    _, status, usage = os.wait4(child.pid, 0)
    wall = time.monotonic_ns() - started
    unit = UNITS.get(sys.platform)
    raw = usage.ru_maxrss
    doc = {
        "format": FORMAT,
        "platform": sys.platform,
        "child": {"exit_code": os.waitstatus_to_exitcode(status) if os.WIFEXITED(status) else None,
                  "signal": os.WTERMSIG(status) if os.WIFSIGNALED(status) else None},
        "stdout_over_limit": over,
        "stdout_b64": base64.b64encode(b"".join(chunks)).decode("ascii"),
        "wall_ns": wall,
        "utime_ns": round(usage.ru_utime * 1e9),
        "stime_ns": round(usage.ru_stime * 1e9),
        "ru_maxrss_raw": raw if unit else None,
        "ru_maxrss_unit": unit[0] if unit else None,
        "peak_rss_bytes": raw * unit[1] if unit else None,
        "unavailable_reason": None if unit else f"the ru_maxrss unit of platform {sys.platform} is not known here",
    }
    sys.stdout.write(json.dumps(doc))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
