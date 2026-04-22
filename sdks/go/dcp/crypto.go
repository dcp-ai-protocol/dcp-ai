package dcp

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"time"

	"github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/observability"
)

// Canonicalize returns deterministic JSON (sorted keys, compact).
func Canonicalize(obj interface{}) (string, error) {
	// Marshal to JSON, then re-parse to sort keys
	data, err := json.Marshal(obj)
	if err != nil {
		return "", err
	}
	var raw interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		return "", err
	}
	sorted := sortJSON(raw)
	result, err := json.Marshal(sorted)
	if err != nil {
		return "", err
	}
	return string(result), nil
}

// sortJSON recursively sorts map keys for deterministic JSON.
func sortJSON(v interface{}) interface{} {
	switch val := v.(type) {
	case map[string]interface{}:
		sorted := make(map[string]interface{})
		keys := make([]string, 0, len(val))
		for k := range val {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			sorted[k] = sortJSON(val[k])
		}
		return sorted
	case []interface{}:
		for i, item := range val {
			val[i] = sortJSON(item)
		}
		return val
	default:
		return v
	}
}

// Keypair holds an Ed25519 keypair encoded in base64.
type Keypair struct {
	PublicKeyB64  string
	SecretKeyB64  string
}

// GenerateKeypair creates a new Ed25519 keypair.
func GenerateKeypair() (*Keypair, error) {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	return &Keypair{
		PublicKeyB64:  base64.StdEncoding.EncodeToString(pub),
		SecretKeyB64:  base64.StdEncoding.EncodeToString(priv),
	}, nil
}

// SignObject signs a canonical JSON object with Ed25519. Returns base64 signature.
func SignObject(obj interface{}, secretKeyB64 string) (string, error) {
	tel := observability.Default()
	spanID := tel.StartSpan("dcp.sign", map[string]interface{}{"algorithm": "ed25519"})
	start := time.Now()

	canon, err := Canonicalize(obj)
	if err != nil {
		tel.RecordError("sign", err.Error())
		tel.EndSpanWith(spanID, observability.SpanError, err.Error())
		return "", fmt.Errorf("canonicalize: %w", err)
	}
	sk, err := base64.StdEncoding.DecodeString(secretKeyB64)
	if err != nil {
		tel.RecordError("sign", err.Error())
		tel.EndSpanWith(spanID, observability.SpanError, err.Error())
		return "", fmt.Errorf("decode secret key: %w", err)
	}
	privKey := ed25519.PrivateKey(sk)
	sig := ed25519.Sign(privKey, []byte(canon))

	tel.RecordSignLatency(float64(time.Since(start).Microseconds())/1000.0, "ed25519")
	tel.EndSpan(spanID)
	return base64.StdEncoding.EncodeToString(sig), nil
}

// VerifyObject verifies an Ed25519 detached signature on a JSON object.
func VerifyObject(obj interface{}, signatureB64, publicKeyB64 string) (bool, error) {
	tel := observability.Default()
	spanID := tel.StartSpan("dcp.verify", map[string]interface{}{"algorithm": "ed25519"})
	start := time.Now()

	canon, err := Canonicalize(obj)
	if err != nil {
		tel.RecordError("verify", err.Error())
		tel.EndSpanWith(spanID, observability.SpanError, err.Error())
		return false, fmt.Errorf("canonicalize: %w", err)
	}
	sig, err := base64.StdEncoding.DecodeString(signatureB64)
	if err != nil {
		tel.RecordError("verify", err.Error())
		tel.EndSpanWith(spanID, observability.SpanError, err.Error())
		return false, fmt.Errorf("decode signature: %w", err)
	}
	pk, err := base64.StdEncoding.DecodeString(publicKeyB64)
	if err != nil {
		tel.RecordError("verify", err.Error())
		tel.EndSpanWith(spanID, observability.SpanError, err.Error())
		return false, fmt.Errorf("decode public key: %w", err)
	}
	ok := ed25519.Verify(ed25519.PublicKey(pk), []byte(canon), sig)
	tel.RecordVerifyLatency(float64(time.Since(start).Microseconds())/1000.0, "ed25519")
	tel.EndSpan(spanID)
	return ok, nil
}

// HashObject computes SHA-256 of canonical JSON. Returns hex string.
func HashObject(obj interface{}) (string, error) {
	canon, err := Canonicalize(obj)
	if err != nil {
		return "", err
	}
	h := sha256.Sum256([]byte(canon))
	return hex.EncodeToString(h[:]), nil
}

// DetectDCPVersion inspects a decoded JSON artifact and returns its DCP
// version string ("1.0", "2.0") or "" if unrecognized.
func DetectDCPVersion(artifact map[string]interface{}) string {
	if v, ok := artifact["dcp_version"].(string); ok {
		if v == "1.0" || v == "2.0" {
			return v
		}
	}
	if v, ok := artifact["dcp_bundle_version"].(string); ok && v == "2.0" {
		return "2.0"
	}
	if bundle, ok := artifact["bundle"].(map[string]interface{}); ok {
		if v, ok := bundle["dcp_bundle_version"].(string); ok && v == "2.0" {
			return "2.0"
		}
	}
	return ""
}

// MerkleRootFromHexLeaves computes Merkle root from hex leaf hashes.
func MerkleRootFromHexLeaves(leaves []string) (string, error) {
	if len(leaves) == 0 {
		return "", nil
	}
	layer := make([]string, len(leaves))
	copy(layer, leaves)

	for len(layer) > 1 {
		if len(layer)%2 == 1 {
			layer = append(layer, layer[len(layer)-1])
		}
		var next []string
		for i := 0; i < len(layer); i += 2 {
			left, err := hex.DecodeString(layer[i])
			if err != nil {
				return "", err
			}
			right, err := hex.DecodeString(layer[i+1])
			if err != nil {
				return "", err
			}
			combined := append(left, right...)
			h := sha256.Sum256(combined)
			next = append(next, hex.EncodeToString(h[:]))
		}
		layer = next
	}
	return layer[0], nil
}
