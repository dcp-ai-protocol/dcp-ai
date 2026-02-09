# dcp-ai-go — Go SDK

SDK oficial de Go para el Digital Citizenship Protocol (DCP). Tipos nativos Go, Ed25519, SHA-256 y verificacion completa de bundles.

## Instalacion

```bash
go get github.com/dcp-ai/dcp-ai-go/dcp
```

**Requiere:** Go 1.21+

## Quickstart

```go
package main

import (
    "fmt"
    "github.com/dcp-ai/dcp-ai-go/dcp"
)

func main() {
    // 1. Generar keypair Ed25519
    keys, err := dcp.GenerateKeypair()
    if err != nil {
        panic(err)
    }
    fmt.Println("Public Key:", keys.PublicKeyB64)

    // 2. Firmar un objeto
    obj := map[string]interface{}{
        "agent_id": "agent-001",
        "action":   "api_call",
    }
    sig, err := dcp.SignObject(obj, keys.SecretKeyB64)
    if err != nil {
        panic(err)
    }

    // 3. Verificar firma
    ok, err := dcp.VerifyObject(obj, sig, keys.PublicKeyB64)
    if err != nil {
        panic(err)
    }
    fmt.Println("Verificado:", ok) // true

    // 4. Hash de un objeto
    hash, err := dcp.HashObject(obj)
    if err != nil {
        panic(err)
    }
    fmt.Println("SHA-256:", hash)
}
```

### Verificar un Signed Bundle

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
    fmt.Println("Verificado:", result.Verified)
    if len(result.Errors) > 0 {
        fmt.Println("Errores:", result.Errors)
    }
}
```

## API Reference

### Crypto

| Funcion | Firma | Descripcion |
|---------|-------|-------------|
| `GenerateKeypair()` | `() (*Keypair, error)` | Genera par de claves Ed25519 |
| `SignObject(obj, secretKeyB64)` | `(interface{}, string) (string, error)` | Firma, retorna base64 |
| `VerifyObject(obj, sigB64, pubKeyB64)` | `(interface{}, string, string) (bool, error)` | Verifica firma |
| `Canonicalize(obj)` | `(interface{}) (string, error)` | JSON deterministico |

### Hashing & Merkle

| Funcion | Firma | Descripcion |
|---------|-------|-------------|
| `HashObject(obj)` | `(interface{}) (string, error)` | SHA-256 hex del JSON canonical |
| `MerkleRootFromHexLeaves(leaves)` | `([]string) (string, error)` | Raiz Merkle desde hojas hex |

### Verificacion

```go
func VerifySignedBundle(sb *SignedBundle, publicKeyB64 string) *VerificationResult
```

Verifica: firma Ed25519, `bundle_hash`, `merkle_root`, cadena `intent_hash`, cadena `prev_hash`.

Retorna `VerificationResult`:
```go
type VerificationResult struct {
    Verified bool     `json:"verified"`
    Errors   []string `json:"errors"`
}
```

### Tipos

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

Todos los structs tienen tags `json:` para serializar/deserializar correctamente.

## Desarrollo

```bash
# Build
go build ./...

# Tests
go test ./...

# Formatear
go fmt ./...

# Verificar dependencias
go mod tidy
```

### Dependencias

- `golang.org/x/crypto` — Ed25519

## Licencia

Apache-2.0
