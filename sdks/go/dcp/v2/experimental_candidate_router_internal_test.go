package v2

// The grammar walker of the experimental router (phase 2) against the phase 1 scanner, on every corpus
// input that is UTF-8 without a BOM; the encoding layer keeps its own precedence, checked apart.

import (
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestExperimentalCandidateGrammarWalkerMatchesPhase1(t *testing.T) {
	compared := 0
	for _, name := range []string{"baseline-corpus.json", "corpus.json"} {
		data, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "docs", "proposals", "canonicalization-candidate", name))
		if err != nil {
			t.Fatal(err)
		}
		var file struct {
			Cases []struct {
				ID        string  `json:"id"`
				InputJSON *string `json:"input_json"`
				InputHex  *string `json:"input_hex"`
			} `json:"cases"`
		}
		if err := json.Unmarshal(data, &file); err != nil {
			t.Fatal(err)
		}
		for _, c := range file.Cases {
			var input []byte
			if c.InputHex != nil {
				input, _ = hex.DecodeString(*c.InputHex)
			} else {
				input = []byte(*c.InputJSON)
			}
			p1, err := ExperimentalCandidateIngress(input)
			if err != nil {
				t.Fatal(err)
			}
			if !p1.Accepted && (p1.Class == "BOM" || p1.Class == "UTF8_INVALID") {
				continue
			}
			w := candidateWalkGrammar(input, 0, len(input), 0)
			if !p1.Accepted && p1.Class == "SYNTAX" {
				if w.ok || w.offset != p1.Offset {
					t.Errorf("%s: walker ok=%v offset=%d, phase 1 SYNTAX@%d", c.ID, w.ok, w.offset, p1.Offset)
				}
			} else if !w.ok {
				t.Errorf("%s: walker refused at %d, phase 1 has no grammar error", c.ID, w.offset)
			}
			compared++
		}
	}
	if compared != 234 { // 274 corpus inputs, 40 with a BOM or invalid UTF-8
		t.Fatalf("compared %d inputs", compared)
	}
	ff := []byte("[,\"\xff\"]")
	if p1, _ := ExperimentalCandidateIngress(ff); p1.Class != "UTF8_INVALID" {
		t.Errorf("phase 1 on an invalid byte after a grammar error: %s", p1.Class)
	}
	if w := candidateWalkGrammar(ff, 0, len(ff), 0); w.ok || w.offset != 1 {
		t.Errorf("walker on an invalid byte: ok=%v offset=%d", w.ok, w.offset)
	}
	bom := []byte("\xef\xbb\xbf{}")
	if w := candidateWalkGrammar(bom, 0, len(bom), 0); w.ok || w.offset != 0 {
		t.Errorf("walker on a BOM: ok=%v offset=%d", w.ok, w.offset)
	}
}
