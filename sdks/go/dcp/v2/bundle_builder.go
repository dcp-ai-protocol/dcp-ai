package v2

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"golang.org/x/crypto/sha3"
)

// BundleBuildInput holds the artifacts needed to build a V2 bundle.
type BundleBuildInput struct {
	RPR          interface{}   // responsible principal record payload
	Passport     interface{}   // agent passport payload
	Intent       interface{}   // intent payload
	Policy       interface{}   // policy decision payload
	AuditEntries []interface{} // audit event payloads
	SessionNonce string
}

// BuildBundleV2 constructs a CitizenshipBundleV2 from individual artifacts.
// It computes manifest hashes, dual Merkle roots, and assembles the bundle structure.
func BuildBundleV2(input BundleBuildInput) (*CitizenshipBundleV2, error) {
	hashArtifact := func(v interface{}) (string, string, error) {
		canonical, err := CanonicalizeV2(v)
		if err != nil {
			return "", "", fmt.Errorf("canonicalize: %w", err)
		}
		dh := DualHashCanonical(canonical)
		return "sha256:" + dh.SHA256, canonical, nil
	}

	rprHash, _, err := hashArtifact(input.RPR)
	if err != nil {
		return nil, fmt.Errorf("rpr hash: %w", err)
	}
	passportHash, _, err := hashArtifact(input.Passport)
	if err != nil {
		return nil, fmt.Errorf("passport hash: %w", err)
	}
	intentHash, _, err := hashArtifact(input.Intent)
	if err != nil {
		return nil, fmt.Errorf("intent hash: %w", err)
	}
	policyHash, _, err := hashArtifact(input.Policy)
	if err != nil {
		return nil, fmt.Errorf("policy hash: %w", err)
	}

	var sha256Leaves, sha3Leaves []string
	var auditEvents []AuditEventV2
	for _, entry := range input.AuditEntries {
		canonical, err := CanonicalizeV2(entry)
		if err != nil {
			continue
		}
		dh := DualHashCanonical(canonical)
		sha256Leaves = append(sha256Leaves, dh.SHA256)
		sha3Leaves = append(sha3Leaves, dh.SHA3256)

		auditEvents = append(auditEvents, AuditEventV2{})
	}

	auditMerkleSHA256 := computeMerkleRoot(sha256Leaves, merkleHashSHA256)
	auditMerkleSHA3 := computeMerkleRoot(sha3Leaves, merkleHashSHA3)

	if auditMerkleSHA256 == "" {
		auditMerkleSHA256 = strings.Repeat("0", 64)
	}
	if auditMerkleSHA3 == "" {
		auditMerkleSHA3 = strings.Repeat("0", 64)
	}

	manifest := BundleManifest{
		SessionNonce:             input.SessionNonce,
		RPRHash:                  rprHash,
		PassportHash:             passportHash,
		IntentHash:               intentHash,
		PolicyHash:               policyHash,
		AuditMerkleRoot:          "sha256:" + auditMerkleSHA256,
		AuditMerkleRootSecondary: "sha3-256:" + auditMerkleSHA3,
		AuditCount:               len(input.AuditEntries),
	}

	bundle := &CitizenshipBundleV2{
		DCPBundleVersion: "2.0",
		Manifest:         manifest,
		ResponsiblePrincipalRecord: SignedPayload{
			Payload:     input.RPR,
			PayloadHash: rprHash,
		},
		AgentPassport: SignedPayload{
			Payload:     input.Passport,
			PayloadHash: passportHash,
		},
		Intent: SignedPayload{
			Payload:     input.Intent,
			PayloadHash: intentHash,
		},
		PolicyDecision: SignedPayload{
			Payload:     input.Policy,
			PayloadHash: policyHash,
		},
		AuditEntries: auditEvents,
	}

	return bundle, nil
}

// SignBundleV2 signs a CitizenshipBundleV2 using composite signatures (Ed25519 + PQ).
// Returns a SignedBundleV2 with bundle-level signature.
func SignBundleV2(
	registry *AlgorithmRegistry,
	bundle *CitizenshipBundleV2,
	classicalKey CompositeKeyInfo,
	pqKey *CompositeKeyInfo,
) (*SignedBundleV2, error) {
	canonical, err := CanonicalizeV2(bundle.Manifest)
	if err != nil {
		return nil, fmt.Errorf("canonicalize manifest: %w", err)
	}

	manifestDH := DualHashCanonical(canonical)
	manifestHash := "sha256:" + manifestDH.SHA256

	var compositeSig *CompositeSignature
	kids := []string{classicalKey.Kid}

	if pqKey != nil {
		compositeSig, err = CompositeSign(registry, CtxBundle, []byte(canonical), classicalKey, *pqKey)
		if err != nil {
			return nil, fmt.Errorf("composite sign: %w", err)
		}
		kids = append(kids, pqKey.Kid)
	} else {
		compositeSig, err = ClassicalOnlySign(registry, CtxBundle, []byte(canonical), classicalKey)
		if err != nil {
			return nil, fmt.Errorf("classical sign: %w", err)
		}
	}

	signed := &SignedBundleV2{
		Bundle: *bundle,
		Signature: BundleSignatureV2{
			HashAlg:   "sha256",
			CreatedAt: time.Now().UTC().Format(time.RFC3339),
			Signer: BundleSignerV2{
				Type: "human",
				Kids: kids,
			},
			ManifestHash: manifestHash,
			CompositeSig: *compositeSig,
		},
	}
	return signed, nil
}

type merkleHashFunc func(left, right []byte) string

func merkleHashSHA256(left, right []byte) string {
	combined := append(left, right...)
	h := sha256.Sum256(combined)
	return hex.EncodeToString(h[:])
}

func merkleHashSHA3(left, right []byte) string {
	combined := append(left, right...)
	h := sha3.Sum256(combined)
	return hex.EncodeToString(h[:])
}

func computeMerkleRoot(hexLeaves []string, hashFn merkleHashFunc) string {
	if len(hexLeaves) == 0 {
		return ""
	}
	layer := make([]string, len(hexLeaves))
	copy(layer, hexLeaves)

	for len(layer) > 1 {
		if len(layer)%2 == 1 {
			layer = append(layer, layer[len(layer)-1])
		}
		var next []string
		for i := 0; i < len(layer); i += 2 {
			left, _ := hex.DecodeString(layer[i])
			right, _ := hex.DecodeString(layer[i+1])
			next = append(next, hashFn(left, right))
		}
		layer = next
	}
	return layer[0]
}
