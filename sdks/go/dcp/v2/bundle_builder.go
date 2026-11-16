package v2

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"golang.org/x/crypto/sha3"
)

// BundleBuildInput holds the signed artifacts needed to build a V2 bundle.
// Sign each payload with SignPayload: the RPR with the principal's
// binding_keys, the passport, intent and policy decision with the passport keys.
type BundleBuildInput struct {
	RPR          SignedPayload
	Passport     SignedPayload
	Intent       SignedPayload
	Policy       SignedPayload
	AuditEntries []AuditEventV2
	SessionNonce string
}

// BuildBundleV2 assembles a CitizenshipBundleV2 from signed artifacts.
// It computes manifest hashes and dual Merkle roots over the audit entries.
func BuildBundleV2(input BundleBuildInput) (*CitizenshipBundleV2, error) {
	hashPayload := func(sp SignedPayload) (string, error) {
		canonical, err := CanonicalizeV2(sp.Payload)
		if err != nil {
			return "", fmt.Errorf("canonicalize: %w", err)
		}
		return "sha256:" + DualHashCanonical(canonical).SHA256, nil
	}

	rprHash, err := hashPayload(input.RPR)
	if err != nil {
		return nil, fmt.Errorf("rpr hash: %w", err)
	}
	passportHash, err := hashPayload(input.Passport)
	if err != nil {
		return nil, fmt.Errorf("passport hash: %w", err)
	}
	intentHash, err := hashPayload(input.Intent)
	if err != nil {
		return nil, fmt.Errorf("intent hash: %w", err)
	}
	policyHash, err := hashPayload(input.Policy)
	if err != nil {
		return nil, fmt.Errorf("policy hash: %w", err)
	}

	auditEntries := input.AuditEntries
	if auditEntries == nil {
		auditEntries = []AuditEventV2{}
	}
	var sha256Leaves, sha3Leaves []string
	for i, entry := range auditEntries {
		canonical, err := CanonicalizeV2(entry)
		if err != nil {
			return nil, fmt.Errorf("audit entry %d: %w", i, err)
		}
		dh := DualHashCanonical(canonical)
		sha256Leaves = append(sha256Leaves, dh.SHA256)
		sha3Leaves = append(sha3Leaves, dh.SHA3256)
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
		AuditCount:               len(auditEntries),
		CanonicalizationProfile:  "dcp-jcs-v1",
	}

	bundle := &CitizenshipBundleV2{
		DCPBundleVersion:           "2.0",
		Manifest:                   manifest,
		ResponsiblePrincipalRecord: input.RPR,
		AgentPassport:              input.Passport,
		Intent:                     input.Intent,
		PolicyDecision:             input.Policy,
		AuditEntries:               auditEntries,
	}

	return bundle, nil
}

// SignBundleV2 signs a CitizenshipBundleV2 using composite signatures (Ed25519 + PQ).
// Returns a SignedBundleV2 with bundle-level signature. The signer is the bundle's
// responsible principal: signer.type "human" and signer.id the RPR's human_id.
// When the manifest has a SessionExpiresAt and no SessionIssuedAt, the signed
// manifest gets the signing time as its SessionIssuedAt (VERIFICATION.md V2-4);
// bundle itself is not changed.
func SignBundleV2(
	registry *AlgorithmRegistry,
	bundle *CitizenshipBundleV2,
	classicalKey CompositeKeyInfo,
	pqKey *CompositeKeyInfo,
) (*SignedBundleV2, error) {
	signerID := principalID(bundle.ResponsiblePrincipalRecord)
	if signerID == "" {
		return nil, errors.New("responsible_principal_record has no human_id to name as the bundle signer")
	}
	now := time.Now().UTC().Format(time.RFC3339)
	manifest := bundle.Manifest
	if manifest.SessionExpiresAt != "" && manifest.SessionIssuedAt == "" {
		manifest.SessionIssuedAt = now
	}
	canonical, err := CanonicalizeV2(manifest)
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
			CreatedAt: now,
			Signer: BundleSignerV2{
				Type: "human",
				ID:   signerID,
				Kids: kids,
			},
			ManifestHash: manifestHash,
			CompositeSig: *compositeSig,
		},
	}
	signed.Bundle.Manifest = manifest
	return signed, nil
}

// principalID is the human_id of an RPR, whether its payload is a map or a struct.
func principalID(rpr SignedPayload) string {
	raw, err := json.Marshal(rpr.Payload)
	if err != nil {
		return ""
	}
	var p struct {
		HumanID string `json:"human_id"`
	}
	_ = json.Unmarshal(raw, &p)
	return p.HumanID
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
