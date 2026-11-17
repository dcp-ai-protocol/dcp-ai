#!/usr/bin/env python3
"""Check an existing crate's version without publication credentials.

Run in the crate directory with Python >=3.11 and curl. A complete, valid 200
response from the sparse index identifies existing versions, including yanked
versions and SemVer build-metadata equivalents. Absence is established only by
that valid index containing no equivalent version. Any other response stops the
release, including 404: first publication of a new crate is outside this helper.
--registry is for local tests; the workflow always uses https://index.crates.io.
Contract: https://doc.rust-lang.org/cargo/reference/registry-index.html
"""
import argparse
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import tomllib
from urllib.parse import quote, urlsplit

REGISTRY = "https://index.crates.io"
MAX_BODY = 256 * 1024
NAME = re.compile(r"[A-Za-z][A-Za-z0-9_-]{0,63}\Z")
NUMBER = r"(?:0|[1-9][0-9]*)"
PRE_ID = rf"(?:{NUMBER}|[0-9]*[A-Za-z-][0-9A-Za-z-]*)"
VERSION = re.compile(rf"{NUMBER}\.{NUMBER}\.{NUMBER}(?:-{PRE_ID}(?:\.{PRE_ID})*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?\Z")


def reject(message):
    raise ValueError(message)


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            reject("registry JSON contains duplicate keys")
        result[key] = value
    return result


def identity():
    with open("Cargo.toml", "rb") as source:
        package = tomllib.load(source).get("package", {})
    if not isinstance(package, dict):
        reject("Cargo.toml needs a package table")
    name, version = package.get("name"), package.get("version")
    if not isinstance(name, str) or not NAME.fullmatch(name):
        reject("Cargo.toml needs an explicit, valid package.name")
    if not isinstance(version, str) or not VERSION.fullmatch(version):
        reject("Cargo.toml needs an explicit SemVer package.version (workspace inheritance is not supported)")
    return name, version


def fetch(registry, name, timeout):
    lower = name.lower()
    prefix = str(len(lower)) if len(lower) < 3 else f"3/{lower[0]}" if len(lower) == 3 else f"{lower[:2]}/{lower[2:4]}"
    url = f"{registry}/{prefix}/{quote(lower, safe='')}"
    with tempfile.TemporaryDirectory(prefix="dcp-crates-check-") as tmp:
        body_path = Path(tmp, "body")
        command = [
            "curl", "--disable", "--silent", "--show-error", "--proto", "=http,https",
            "--max-time", str(timeout), "--connect-timeout", str(min(timeout, 10)),
            "--max-filesize", str(MAX_BODY), "--output", str(body_path),
            "--write-out", "%{http_code}", "--header", "Accept: application/json",
            "--user-agent", "dcp-ai-release-check (https://github.com/dcp-ai-protocol/dcp-ai)", url,
        ]
        # No curlrc, proxy, registry token, or caller HTTP configuration is used.
        # curl enforces the transfer deadline; the outer timeout also bounds an
        # unresponsive curl executable. No --location: redirects are errors.
        response = subprocess.run(command, env={"PATH": os.environ.get("PATH", os.defpath)},
                                  capture_output=True, timeout=timeout + 1)
        if response.returncode:
            reject(f"registry query failed (curl exit {response.returncode}); publication stopped")
        if response.stdout != b"200":
            reject("registry did not return an existing crate index (200); publication stopped")
        with body_path.open("rb") as body_file:
            body = body_file.read(MAX_BODY + 1)
        if len(body) > MAX_BODY:
            reject("registry response exceeds the release-check byte limit")
        text = body.decode("utf-8")
        if not text:
            reject("registry returned an empty index")
        # Only LF separates index records; Unicode line separators may appear
        # inside a JSON string and must not split that record.
        lines = text.removesuffix("\n").split("\n")
        return [json.loads(line, object_pairs_hook=unique_object,
                           parse_constant=lambda _: reject("non-JSON numeric constant")) for line in lines]


def decide(records, name, version):
    versions = set()
    for record in records:
        if not isinstance(record, dict):
            reject("registry index entry is not an object")
        found = record.get("vers")
        if (record.get("name") != name or not isinstance(found, str) or not VERSION.fullmatch(found)
                or type(record.get("yanked")) is not bool or not isinstance(record.get("deps"), list)
                or not isinstance(record.get("features"), dict)
                or not isinstance(record.get("cksum"), str)
                or not re.fullmatch(r"[0-9a-f]{64}", record["cksum"])
                or type(record.get("v", 1)) is not int or record.get("v", 1) not in (1, 2)):
            reject("registry index identity, version, or required fields are invalid/unsupported")
        normalized = found.split("+", 1)[0]
        if normalized in versions:
            reject("registry index contains duplicate equivalent versions")
        versions.add(normalized)
    # Validate every row before deciding, even if an earlier row already matches.
    # Yanked versions still exist; metadata does not create a publishable version.
    return version in versions


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry", default=REGISTRY)
    parser.add_argument("--timeout-seconds", type=float, default=30)
    args = parser.parse_args()
    target = urlsplit(args.registry)
    if (target.scheme not in ("http", "https") or not target.hostname
            or target.username is not None or target.password is not None
            or target.query or target.fragment or target.path not in ("", "/")):
        reject("invalid registry URL")
    if not math.isfinite(args.timeout_seconds) or not 0 < args.timeout_seconds <= 300:
        reject("timeout must be positive and at most 300 seconds")
    output = os.environ.get("GITHUB_OUTPUT")
    if not output:
        reject("GITHUB_OUTPUT is required")
    name, version = identity()
    query_version = version.split("+", 1)[0]
    records = fetch(args.registry.rstrip("/"), name, args.timeout_seconds)
    skip = decide(records, name, query_version)
    # Write only after a conclusive response. Errors never write skip=false.
    with open(output, "a", encoding="utf-8") as stream:
        stream.write(f"version={version}\nskip={str(skip).lower()}\n")
    print(f"{name}@{version}: {'already published (including yanked versions)' if skip else 'absence confirmed'}")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, TypeError, subprocess.SubprocessError) as error:
        print(f"::error::{error}", file=sys.stderr)
        sys.exit(1)
