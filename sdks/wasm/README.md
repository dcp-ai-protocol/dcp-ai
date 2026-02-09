# @dcp-ai/wasm — WebAssembly Module

WebAssembly module for the Digital Citizenship Protocol (DCP), compiled from the Rust SDK. Verify bundles and compute hashes directly in the browser without a server.

## Installation

```bash
npm install @dcp-ai/wasm
```

## Build

```bash
# Build for browser (web target)
npm run build

# Build for Node.js
npm run build:node
```

Internally uses `wasm-pack`:
```bash
wasm-pack build --target web        # Browser
wasm-pack build --target nodejs     # Node.js
```

**Requirements:** [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/) and the Rust toolchain with the `wasm32-unknown-unknown` target.

## Quickstart — Browser

```html
<!DOCTYPE html>
<html>
<head>
  <title>DCP WASM Verification</title>
</head>
<body>
  <textarea id="bundle" rows="10" cols="60" placeholder="Paste a signed bundle JSON here..."></textarea>
  <br/>
  <button onclick="verify()">Verify Bundle</button>
  <pre id="result"></pre>

  <script type="module">
    import init, {
      wasm_verify_signed_bundle,
      wasm_hash_object,
      wasm_generate_keypair,
    } from '@dcp-ai/wasm';

    // Initialize WASM
    await init();

    // Generate keypair
    const keypairJson = wasm_generate_keypair();
    const keypair = JSON.parse(keypairJson);
    console.log('Public Key:', keypair.public_key_b64);

    // Verify bundle
    window.verify = function() {
      const bundleJson = document.getElementById('bundle').value;
      const resultJson = wasm_verify_signed_bundle(bundleJson, null);
      const result = JSON.parse(resultJson);
      document.getElementById('result').textContent = JSON.stringify(result, null, 2);
    };

    // Hash an object
    const hash = wasm_hash_object('{"agent_id":"agent-001"}');
    console.log('SHA-256:', hash);
  </script>
</body>
</html>
```

A fully functional example is also included in `example.html`.

## API Reference

### `wasm_verify_signed_bundle(signed_bundle_json, public_key_b64?)`

Verifies a complete Signed Bundle.

- **Parameters:**
  - `signed_bundle_json: string` — JSON of the signed bundle
  - `public_key_b64: string | null` — Ed25519 public key (base64). If `null`, uses the key from the bundle.
- **Returns:** `string` — JSON with `{ "verified": boolean, "errors": string[] }`

```javascript
const result = JSON.parse(
  wasm_verify_signed_bundle(bundleJson, "BASE64_PUBLIC_KEY")
);
console.log(result.verified); // true or false
```

### `wasm_hash_object(json_str)`

Computes the SHA-256 hash of a JSON object.

- **Parameters:** `json_str: string` — JSON to hash
- **Returns:** `string` — SHA-256 hex hash

```javascript
const hash = wasm_hash_object('{"agent_id":"agent-001"}');
// "a1b2c3..."
```

### `wasm_generate_keypair()`

Generates an Ed25519 key pair.

- **Returns:** `string` — JSON with `{ "public_key_b64": "...", "secret_key_b64": "..." }`

```javascript
const keys = JSON.parse(wasm_generate_keypair());
console.log(keys.public_key_b64);
console.log(keys.secret_key_b64);
```

## Included Example

The `example.html` file contains a complete interactive demo that:

1. Initializes the WASM module
2. Allows pasting a signed bundle JSON
3. Verifies the bundle in the browser
4. Displays the verification result

To use it, serve the directory with any HTTP server:

```bash
npx serve .
# Open http://localhost:3000/example.html
```

## Development

### Prerequisites

```bash
# Install wasm-pack
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

# Install WASM target for Rust
rustup target add wasm32-unknown-unknown
```

### Build from the Rust SDK

The WASM module is compiled from `sdks/rust/` with the `wasm` feature enabled:

```bash
cd ../rust
wasm-pack build --target web --out-dir ../wasm/pkg
```

## License

Apache-2.0
