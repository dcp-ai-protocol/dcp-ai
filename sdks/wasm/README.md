# @dcp-ai/wasm — WebAssembly Module

Modulo WebAssembly del Digital Citizenship Protocol (DCP), compilado desde el Rust SDK. Verifica bundles y calcula hashes directamente en el navegador sin servidor.

## Instalacion

```bash
npm install @dcp-ai/wasm
```

## Build

```bash
# Build para navegador (web target)
npm run build

# Build para Node.js
npm run build:node
```

Internamente usa `wasm-pack`:
```bash
wasm-pack build --target web        # Browser
wasm-pack build --target nodejs     # Node.js
```

**Requisitos:** [wasm-pack](https://rustwasm.github.io/wasm-pack/installer/) y Rust toolchain con target `wasm32-unknown-unknown`.

## Quickstart — Browser

```html
<!DOCTYPE html>
<html>
<head>
  <title>DCP WASM Verification</title>
</head>
<body>
  <textarea id="bundle" rows="10" cols="60" placeholder="Pega un signed bundle JSON aqui..."></textarea>
  <br/>
  <button onclick="verify()">Verificar Bundle</button>
  <pre id="result"></pre>

  <script type="module">
    import init, {
      wasm_verify_signed_bundle,
      wasm_hash_object,
      wasm_generate_keypair,
    } from '@dcp-ai/wasm';

    // Inicializar WASM
    await init();

    // Generar keypair
    const keypairJson = wasm_generate_keypair();
    const keypair = JSON.parse(keypairJson);
    console.log('Public Key:', keypair.public_key_b64);

    // Verificar bundle
    window.verify = function() {
      const bundleJson = document.getElementById('bundle').value;
      const resultJson = wasm_verify_signed_bundle(bundleJson, null);
      const result = JSON.parse(resultJson);
      document.getElementById('result').textContent = JSON.stringify(result, null, 2);
    };

    // Hash de un objeto
    const hash = wasm_hash_object('{"agent_id":"agent-001"}');
    console.log('SHA-256:', hash);
  </script>
</body>
</html>
```

Tambien se incluye un ejemplo funcional completo en `example.html`.

## API Reference

### `wasm_verify_signed_bundle(signed_bundle_json, public_key_b64?)`

Verifica un Signed Bundle completo.

- **Parametros:**
  - `signed_bundle_json: string` — JSON del signed bundle
  - `public_key_b64: string | null` — Clave publica Ed25519 (base64). Si es `null`, usa la clave del bundle.
- **Retorna:** `string` — JSON con `{ "verified": boolean, "errors": string[] }`

```javascript
const result = JSON.parse(
  wasm_verify_signed_bundle(bundleJson, "BASE64_PUBLIC_KEY")
);
console.log(result.verified); // true o false
```

### `wasm_hash_object(json_str)`

Calcula el SHA-256 de un objeto JSON.

- **Parametros:** `json_str: string` — JSON a hashear
- **Retorna:** `string` — Hash hex SHA-256

```javascript
const hash = wasm_hash_object('{"agent_id":"agent-001"}');
// "a1b2c3..."
```

### `wasm_generate_keypair()`

Genera un par de claves Ed25519.

- **Retorna:** `string` — JSON con `{ "public_key_b64": "...", "secret_key_b64": "..." }`

```javascript
const keys = JSON.parse(wasm_generate_keypair());
console.log(keys.public_key_b64);
console.log(keys.secret_key_b64);
```

## Ejemplo incluido

El archivo `example.html` contiene una demo interactiva completa que:

1. Inicializa el modulo WASM
2. Permite pegar un signed bundle JSON
3. Verifica el bundle en el navegador
4. Muestra el resultado de la verificacion

Para usarlo, sirve el directorio con cualquier servidor HTTP:

```bash
npx serve .
# Abre http://localhost:3000/example.html
```

## Desarrollo

### Requisitos previos

```bash
# Instalar wasm-pack
curl https://rustwasm.github.io/wasm-pack/installer/init.sh -sSf | sh

# Instalar target WASM para Rust
rustup target add wasm32-unknown-unknown
```

### Build desde el Rust SDK

El modulo WASM se compila desde `sdks/rust/` con el feature `wasm` activado:

```bash
cd ../rust
wasm-pack build --target web --out-dir ../wasm/pkg
```

## Licencia

Apache-2.0
