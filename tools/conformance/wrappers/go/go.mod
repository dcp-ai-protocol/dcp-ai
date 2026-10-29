// External conformance wrapper for the Go SDK in this checkout (tools/conformance/README.md).
// The SDK is taken from ../../../../sdks/go through replace. The required versions and go.sum are a
// subset of the SDK's own (go mod tidy, offline), so no dependency version is chosen here. Build with tools/conformance/wrappers/build.mjs.
module github.com/dcp-ai-protocol/dcp-ai/tools/conformance/wrappers/go

go 1.25.0

require github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2 v2.0.0

require (
	github.com/cloudflare/circl v1.6.3 // indirect
	golang.org/x/crypto v0.55.0 // indirect
	golang.org/x/sys v0.47.0 // indirect
)

replace github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2 => ../../../../sdks/go
