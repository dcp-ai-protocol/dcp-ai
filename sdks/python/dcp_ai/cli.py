"""
DCP CLI — Command-line interface for the Digital Citizenship Protocol.
Built with Typer.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import typer

app = typer.Typer(name="dcp", help="Digital Citizenship Protocol CLI")


@app.command()
def version() -> None:
    """Show the DCP SDK version."""
    from dcp_ai import __version__
    typer.echo(f"dcp-ai {__version__}")


@app.command()
def keygen(out_dir: str = "keys") -> None:
    """Generate a new Ed25519 keypair."""
    from dcp_ai.crypto import generate_keypair

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    kp = generate_keypair()
    (out / "public_key.txt").write_text(kp["public_key_b64"] + "\n")
    (out / "secret_key.txt").write_text(kp["secret_key_b64"] + "\n")
    typer.echo(f"Keypair written to {out_dir}/")


@app.command()
def validate(schema_name: str, json_path: str) -> None:
    """Validate a JSON file against a DCP schema."""
    from dcp_ai.schema import validate_schema

    data = json.loads(Path(json_path).read_text())
    result = validate_schema(schema_name, data)
    if result["valid"]:
        typer.echo(f"VALID ({schema_name})")
    else:
        for e in result.get("errors", []):
            typer.echo(f"  - {e}", err=True)
        raise typer.Exit(1)


@app.command()
def validate_bundle(bundle_path: str) -> None:
    """Validate a Citizenship Bundle JSON file."""
    from dcp_ai.schema import validate_bundle as _validate_bundle

    bundle = json.loads(Path(bundle_path).read_text())
    result = _validate_bundle(bundle)
    if result["valid"]:
        typer.echo("BUNDLE VALID (DCP-01/02/03)")
    else:
        for e in result.get("errors", []):
            typer.echo(f"  - {e}", err=True)
        raise typer.Exit(1)


@app.command()
def verify(signed_path: str, public_key_path: str | None = None) -> None:
    """Verify a signed bundle."""
    from dcp_ai.verify import verify_signed_bundle

    signed_bundle = json.loads(Path(signed_path).read_text())
    pk_b64 = Path(public_key_path).read_text().strip() if public_key_path else None
    result = verify_signed_bundle(signed_bundle, pk_b64)
    if result["verified"]:
        typer.echo("SIGNATURE VALID")
        typer.echo("BUNDLE INTEGRITY VALID")
        typer.echo("VERIFIED (SCHEMA + SIGNATURE)")
    else:
        for e in result.get("errors", []):
            typer.echo(e, err=True)
        raise typer.Exit(1)


@app.command()
def bundle_hash(bundle_path: str) -> None:
    """Compute the SHA-256 hash of a bundle."""
    import hashlib
    from dcp_ai.crypto import canonicalize

    bundle = json.loads(Path(bundle_path).read_text())
    hex_hash = hashlib.sha256(canonicalize(bundle).encode("utf-8")).hexdigest()
    typer.echo(f"sha256:{hex_hash}")


@app.command()
def merkle_root(bundle_path: str) -> None:
    """Compute the Merkle root of audit_entries in a bundle."""
    from dcp_ai.merkle import merkle_root_for_audit_entries

    bundle = json.loads(Path(bundle_path).read_text())
    entries = bundle.get("audit_entries", [])
    if not entries:
        typer.echo("audit_entries must be a non-empty array", err=True)
        raise typer.Exit(2)
    root = merkle_root_for_audit_entries(entries)
    typer.echo(f"sha256:{root}" if root else "null")


@app.command()
def intent_hash_cmd(intent_path: str) -> None:
    """Compute the intent_hash for an Intent JSON file."""
    from dcp_ai.merkle import intent_hash

    intent = json.loads(Path(intent_path).read_text())
    typer.echo(intent_hash(intent))


if __name__ == "__main__":
    app()
