# dcp-ai-go — Go SDK

Official Go SDK for the Digital Citizenship Protocol (DCP). Native Go types, Ed25519, SHA-256, and full bundle verification.

## Installation

```bash
go get github.com/dcp-ai/dcp-ai-go/dcp
```

**Requires:** Go 1.21+

## Quickstart

```go
package main

import (
    "fmt"
    "github.com/dcp-ai/dcp-ai-go/dcp"
)

func main() {
    // 1. Generate Ed25519 keypair
    keys, err := dcp.GenerateKeypair()
    if err != nil {
        panic(err)
    }
    fmt.Println("Public Key:", keys.PublicKeyB64)

    // 2. Sign an object
    obj := map[string]interface{}{
        "agent_id": "agent-001",
        "action":   "api_call",
    }
    sig, err := dcp.SignObject(obj, keys.SecretKeyB64)
    if err != nil {
        panic(err)
    }

    // 3. Verify signature
    ok, err := dcp.VerifyObject(obj, sig, keys.PublicKeyB64)
    if err != nil {
        panic(err)
    }
    fmt.Println("Verified:", ok) // true

    // 4. Hash an object
    hash, err := dcp.HashObject(obj)
    if err != nil {
        panic(err)
    }
    fmt.Println("SHA-256:", hash)
}
```

### Verify a Signed Bundle

```go
package main

import (
    "encoding/json"
    "fmt"
    "os"
    "github.com/dcp-ai/dcp-ai-go/dcp"
)

func main() {
    data, _ := os.ReadFile("citizenship_bundle.signed.json")

    var sb dcp.SignedBundle
    json.Unmarshal(data, &sb)

    result := dcp.VerifySignedBundle(&sb, "BASE64_PUBLIC_KEY")
    fmt.Println("Verified:", result.Verified)
    if len(result.Errors) > 0 {
        fmt.Println("Errors:", result.Errors)
    }
}
```

## API Reference

### Crypto

| Function | Signature | Description |
|----------|-----------|-------------|
| `GenerateKeypair()` | `() (*Keypair, error)` | Generates an Ed25519 key pair |
| `SignObject(obj, secretKeyB64)` | `(interface{}, string) (string, error)` | Signs, returns base64 |
| `VerifyObject(obj, sigB64, pubKeyB64)` | `(interface{}, string, string) (bool, error)` | Verifies signature |
| `Canonicalize(obj)` | `(interface{}) (string, error)` | Deterministic JSON |

### Hashing & Merkle

| Function | Signature | Description |
|----------|-----------|-------------|
| `HashObject(obj)` | `(interface{}) (string, error)` | SHA-256 hex of canonical JSON |
| `MerkleRootFromHexLeaves(leaves)` | `([]string) (string, error)` | Merkle root from hex leaves |

### Verification

```go
func VerifySignedBundle(sb *SignedBundle, publicKeyB64 string) *VerificationResult
```

Verifies: Ed25519 signature, `bundle_hash`, `merkle_root`, `intent_hash` chain, `prev_hash` chain.

Returns `VerificationResult`:
```go
type VerificationResult struct {
    Verified bool     `json:"verified"`
    Errors   []string `json:"errors"`
}
```

### Types

```go
type Keypair struct {
    PublicKeyB64  string
    SecretKeyB64  string
}

type HumanBindingRecord struct { ... }
type AgentPassport struct { ... }
type Intent struct { ... }
type IntentTarget struct { ... }
type PolicyDecision struct { ... }
type AuditEntry struct { ... }
type AuditEvidence struct { ... }
type CitizenshipBundle struct { ... }
type SignedBundle struct { ... }
type BundleSignature struct { ... }
type Signer struct { ... }
type RevocationRecord struct { ... }
```

All structs have `json:` tags for correct serialization/deserialization.

## Development

```bash
# Build
go build ./...

# Tests
go test ./...

# Format
go fmt ./...

# Verify dependencies
go mod tidy
```

### Dependencies

- `golang.org/x/crypto` — Ed25519

## License

Apache-2.0
