package dcp

// The historical rejects that V2-2 now decides first (tests/interop/v2/schema_validation/regression_map.json): for
// these rows a test asserts the exact schema diagnostics both oracles report, instead of the historical error_contains,
// which belonged to a deeper check the row no longer reaches. Where that check stays reachable, the map names its
// coverage (schema-valid rows, deep_negatives.json or a helper's direct test; see dcp/v2/schema_v2_test.go).

import (
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"testing"
	"unicode/utf8"

	v2 "github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/v2"
)

type schemaRegressionRow struct {
	Fixture      string `json:"fixture"`
	Name         string `json:"name"`
	SchemaErrors []struct {
		Instance string  `json:"instance"`
		Keyword  string  `json:"keyword"`
		Member   *string `json:"member"`
	} `json:"schema_errors"`
}

var (
	regressionMapOnce sync.Once
	regressionMap     []schemaRegressionRow
	regressionMapErr  error
)

func loadRegressionMap(t *testing.T) []schemaRegressionRow {
	t.Helper()
	regressionMapOnce.Do(func() {
		_, thisFile, _, _ := runtime.Caller(0)
		data, err := os.ReadFile(filepath.Join(filepath.Dir(thisFile), "..", "..", "..", "tests", "interop", "v2", "schema_validation", "regression_map.json"))
		if err != nil {
			regressionMapErr = err
			return
		}
		var doc struct {
			Rows []schemaRegressionRow `json:"rows"`
		}
		regressionMapErr = json.Unmarshal(data, &doc)
		regressionMap = doc.Rows
	})
	if regressionMapErr != nil {
		t.Fatalf("regression_map.json: %v", regressionMapErr)
	}
	return regressionMap
}

// schemaFirstRow is the row of fixture (a file under tests/interop/v2/) named name, when V2-2 now decides it.
func schemaFirstRow(t *testing.T, fixture, name string) *schemaRegressionRow {
	t.Helper()
	rows := loadRegressionMap(t)
	for i := range rows {
		if rows[i].Fixture == "tests/interop/v2/"+fixture && rows[i].Name == name {
			return &rows[i]
		}
	}
	return nil
}

// boundedToken is the verifier's wording of a member name: RFC 6901 escaped, then cut to 64 code points.
func boundedToken(s string) string {
	s = strings.ReplaceAll(strings.ReplaceAll(s, "~", "~0"), "/", "~1")
	if utf8.RuneCountInString(s) <= 64 {
		return s
	}
	return string([]rune(s)[:64]) + "…[cut]"
}

func expectedDiagnostics(row *schemaRegressionRow) []string {
	want := make([]string, 0, len(row.SchemaErrors))
	for _, e := range row.SchemaErrors {
		instance := e.Instance
		if instance == "" {
			instance = "/"
		}
		line := "schema: " + instance + " " + e.Keyword
		if e.Member != nil {
			line += " " + boundedToken(*e.Member)
		}
		want = append(want, line)
	}
	sort.Strings(want)
	return want
}

// expectSchemaRejection: a rejection by V2-2 with exactly the oracles' schema errors (the first 16 and the marker
// when there are more).
func expectSchemaRejection(t *testing.T, r *v2.V2VerificationResult, row *schemaRegressionRow) {
	t.Helper()
	expectSchemaDiagnostics(t, r, expectedDiagnostics(row))
}

// expectSchemaDiagnostics: r is refused by V2-2 alone, with exactly want (sorted), or its first 16 and the marker.
func expectSchemaDiagnostics(t *testing.T, r *v2.V2VerificationResult, want []string) {
	t.Helper()
	if r.Verified {
		t.Fatal("bundle must be rejected")
	}
	if len(want) <= 16 {
		got := append([]string(nil), r.Errors...)
		sort.Strings(got)
		if strings.Join(got, "\n") != strings.Join(want, "\n") {
			t.Fatalf("schema errors %q, want %q", got, want)
		}
		return
	}
	if len(r.Errors) != 17 || r.Errors[16] != "schema: further errors not listed" {
		t.Fatalf("schema errors %q, want 16 and the marker", r.Errors)
	}
	for _, e := range r.Errors[:16] {
		if i := sort.SearchStrings(want, e); i == len(want) || want[i] != e {
			t.Fatalf("schema error %q is not one of %q", e, want)
		}
	}
}
