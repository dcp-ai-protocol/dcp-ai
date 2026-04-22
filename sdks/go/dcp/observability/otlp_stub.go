//go:build !otlp

package observability

import "errors"

// initOTLPBridge reports that the OTLP exporter was requested but the SDK was
// built without the `otlp` build tag. Rebuild with `-tags otlp` (and add the
// go.opentelemetry.io/otel deps to your go.mod) to enable it.
func initOTLPBridge(_ string, _ string) (forward func(Event), shutdown func(), err error) {
	return nil, nil, errors.New(
		"otlp exporter not compiled in; rebuild dcp-ai/sdks/go with `-tags otlp` and add go.opentelemetry.io/otel* to your go.mod",
	)
}
