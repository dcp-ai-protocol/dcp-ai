module github.com/dcp-ai-protocol/dcp-ai/tools/difffuzz/shims/go

go 1.25.0

require github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2 v2.0.0

require (
	github.com/cloudflare/circl v1.6.3 // indirect
	golang.org/x/crypto v0.55.0 // indirect
	golang.org/x/sys v0.47.0 // indirect
)

replace github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2 => ../../../../sdks/go
