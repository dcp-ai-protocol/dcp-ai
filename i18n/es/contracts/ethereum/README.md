<sub>[English](../../../../contracts/ethereum/README.md) · [中文](../../../zh-CN/contracts/ethereum/README.md) · **Español** · [日本語](../../../ja/contracts/ethereum/README.md) · [Português](../../../pt-BR/contracts/ethereum/README.md)</sub>

<a id="dcpanchorsol--smart-contract"></a>
<a id="dcpanchorsol-smart-contract"></a>

# DCPAnchor.sol — contrato inteligente

> Traducción informativa de [la versión en inglés](../../../../contracts/ethereum/README.md), actualizada el 25/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

Contrato inteligente en Solidity para anclar hashes de Citizenship Bundles de DCP en blockchains L2 de EVM (Base, Arbitrum, Optimism). Admite anclaje individual, anclaje con compromiso y revelación (commit-reveal) y anclaje por lotes (raíz de Merkle del lote).

El servicio de anclaje de referencia (`services/anchor/`) todavía no llama a este contrato; véase [Integración con el servicio de anclaje](#integration-with-the-anchoring-service).

<a id="layout"></a>

## Estructura

```
contracts/ethereum/
  src/DCPAnchor.sol           the contract
  test/DCPAnchor.t.sol        forge tests (6 passing)
  script/Deploy.s.sol         deployment script
  foundry.toml                Foundry project config
  remappings.txt              import remappings
  .env.example                template for deployment secrets
  DEPLOY.md                   step-by-step deploy guide
```

<a id="quick-start"></a>

## Inicio rápido

```bash
cd contracts/ethereum
git clone --depth 1 https://github.com/foundry-rs/forge-std.git lib/forge-std
forge test -vv
```

<a id="deploy"></a>

## Despliegue

Consulta [DEPLOY.md](../../../../contracts/ethereum/DEPLOY.md) para el recorrido completo (Base Sepolia → Base mainnet, verificación en Basescan, conexión del servicio `anchor`).

Versión corta, después del paso [Configure](../../../../contracts/ethereum/DEPLOY.md#configure) de DEPLOY.md (cuenta en keystore, línea `PRIVATE_KEY`
eliminada de `.env`). Envía una transacción y gasta fondos en mainnet:
```bash
source .env
forge script script/Deploy.s.sol --rpc-url base --account my-deployer --broadcast --verify
```

<a id="overview"></a>

## Descripción general

El contrato `DCPAnchor` proporciona un registro on-chain inmutable de hashes de bundles. Una vez anclado, un hash no puede modificarse ni borrarse, así que el registro muestra que quien lo envió se comprometió con ese hash como tarde en el momento de su bloque. El contrato guarda el `bytes32` (y, para un lote, el `count`) tal como los declara quien los envía: no comprueba que el hash pertenezca a un bundle válido, no verifica ninguna firma ni prueba que ocurrieran los hechos que describe un bundle.

<a id="contract"></a>

## Contrato

**Solidity:** `^0.8.20`  
**Cabecera de licencia:** `SPDX-License-Identifier: MIT` en `src/DCPAnchor.sol` y `script/Deploy.s.sol` (véase [Licencia](#license))  
**Redes de destino:** Base, Arbitrum, Optimism (o cualquier L2 de EVM)

## API

Los fragmentos de Solidity de abajo son ilustraciones: valores como `0xabc123...` representan hashes `bytes32` completos.

<a id="admin-functions"></a>

### Funciones de administración

#### `addSubmitter(address submitter)`

Añade un remitente autorizado. Solo puede llamarla el propietario del contrato.

#### `removeSubmitter(address submitter)`

Quita un remitente autorizado. Solo puede llamarla el propietario del contrato.

#### `pause()` / `unpause()`

Mecanismo de pausa de emergencia. En pausa, todas las funciones de anclaje revierten. Solo puede llamarlas el propietario del contrato.

#### `transferOwnership(address newOwner)`

Transfiere la propiedad del contrato. No cambia `authorizedSubmitters`: el propietario anterior, al que el constructor
autorizó como desplegador, sigue siendo un remitente autorizado hasta que el nuevo propietario llame a `removeSubmitter`
para él. El propietario actual siempre supera la comprobación de remitente, incluso después de `removeSubmitter(owner)`.
Cuando rotes el propietario, quita también la entrada de remitente del propietario anterior.

<a id="write-functions"></a>

### Funciones de escritura

#### `anchorBundle(bytes32 bundleHash)`

Anclaje directo para remitentes de confianza en escenarios de bajo riesgo.

- **Requiere** un remitente autorizado o el propietario
- **Revierte** si `bundleHash` es cero
- **Revierte** si el hash ya se ancló
- **Revierte** si el contrato está en pausa
- **Emite** `BundleAnchored(bundleHash, msg.sender, block.timestamp)`

```solidity
dcpAnchor.anchorBundle(0xabc123...);
```

<a id="commit-reveal-front-running-protection"></a>

<a id="commit-reveal-limited-front-running-protection"></a>

#### Commit-reveal (protección limitada contra el front-running)

En los escenarios en que preocupa el front-running, usa el flujo de compromiso y revelación en dos fases. El compromiso
oculta el hash del bundle hasta la revelación y vincula la revelación a la dirección que se comprometió. Solo reserva
el `commitHash`, no el hash del bundle: `anchorBundle` sigue abierta a todo remitente autorizado y no consulta los
compromisos, así que otro remitente autorizado que conozca el hash puede anclarlo directamente antes de tu revelación.
No es una reserva exclusiva.

**Fase 1 — `commit(bytes32 commitHash)`**

Envía `keccak256(abi.encodePacked(bundleHash, salt, msg.sender))` para reservar un hueco.

**Fase 2 — `revealAndAnchorBundle(bytes32 bundleHash, bytes32 salt)`**

Revela el hash original y la sal para completar el anclaje. Si el compromiso se minó en el bloque `b`, la revelación necesita `block.number > b + COMMIT_DELAY` y `block.number <= b + COMMIT_EXPIRY`: con las constantes de abajo, desde el bloque `b + 2` hasta el bloque `b + 256`, ambos incluidos. El `keccak256("random-salt")` del ejemplo es determinista; en un uso real, la sal debe ser aleatoria e impredecible, y mantenerse privada hasta la revelación.

```solidity
bytes32 salt = keccak256("random-salt");
bytes32 commitHash = keccak256(abi.encodePacked(bundleHash, salt, msg.sender));
dcpAnchor.commit(commitHash);
// ... wait until block.number > commit block + COMMIT_DELAY (b + 2 or later, b + 256 at the latest) ...
dcpAnchor.revealAndAnchorBundle(bundleHash, salt);
```

#### `anchorBatch(bytes32 merkleRoot, uint256 count)`

Ancla una raíz de Merkle que representa un lote de bundles.

- **Requiere** un remitente autorizado o el propietario
- **Revierte** si `merkleRoot` es cero
- **Revierte** si `count` es cero o supera `MAX_BATCH_SIZE` (10000)
- **Revierte** si la raíz de Merkle ya se ancló
- **Revierte** si el contrato está en pausa
- **Emite** `BatchAnchored(merkleRoot, count, msg.sender, block.timestamp)`

```solidity
dcpAnchor.anchorBatch(0xdef456..., 50);
```

<a id="read-functions"></a>

### Funciones de lectura

#### `isAnchored(bytes32 bundleHash) → (bool exists, uint256 timestamp, address submitter)`

Consulta si un hash de bundle está anclado.

```solidity
(bool exists, uint256 ts, address submitter) = dcpAnchor.isAnchored(0xabc123...);
```

#### `isBatchAnchored(bytes32 merkleRoot) → (bool exists, uint256 timestamp, uint256 count, address submitter)`

Consulta si una raíz de Merkle de lote está anclada.

```solidity
(bool exists, uint256 ts, uint256 count, address submitter) = dcpAnchor.isBatchAnchored(0xdef456...);
```

<a id="storage"></a>

### Almacenamiento

| Variable | Tipo | Descripción |
|----------|------|-------------|
| `owner` | `address` | Propietario del contrato |
| `paused` | `bool` | Estado de la pausa de emergencia |
| `authorizedSubmitters` | `mapping(address => bool)` | Remitentes autorizados |
| `bundles` | `mapping(bytes32 => AnchorRecord)` | Registros de bundles individuales |
| `batches` | `mapping(bytes32 => AnchorRecord)` | Registros de raíces de Merkle de lotes |
| `commitments` | `mapping(bytes32 => Commitment)` | Compromisos del commit-reveal |
| `totalAnchors` | `uint256` | Total de anclajes individuales |
| `totalBatches` | `uint256` | Total de anclajes por lotes |

<a id="structs"></a>

### Estructuras

```solidity
struct AnchorRecord {
    address submitter;   // Who anchored the hash
    uint256 timestamp;   // When it was anchored (block.timestamp)
    uint256 count;       // Number of bundles (1 for individual, N for batch)
    bool exists;         // Whether the record exists
}

struct Commitment {
    address submitter;
    uint256 blockNumber;
    bool revealed;
}
```

<a id="constants"></a>

### Constantes

| Constante | Valor | Descripción |
|----------|-------|-------------|
| `MAX_BATCH_SIZE` | `10000` | Máximo de bundles por lote |
| `COMMIT_DELAY` | `1` | La revelación necesita `block.number > b + COMMIT_DELAY`, siendo `b` el bloque del compromiso (es decir, desde `b + 2`) |
| `COMMIT_EXPIRY` | `256` | La revelación necesita `block.number <= b + COMMIT_EXPIRY`; después, el compromiso ha caducado |

<a id="events"></a>

### Eventos

```solidity
event BundleAnchored(bytes32 indexed bundleHash, address indexed submitter, uint256 timestamp);
event BatchAnchored(bytes32 indexed merkleRoot, uint256 bundleCount, address indexed submitter, uint256 timestamp);
event CommitSubmitted(bytes32 indexed commitHash, address indexed submitter);
event SubmitterAdded(address indexed submitter);
event SubmitterRemoved(address indexed submitter);
event Paused(address indexed by);
event Unpaused(address indexed by);
event OwnerTransferred(address indexed oldOwner, address indexed newOwner);
```

<a id="deploy-1"></a>
<a id="deploy_1"></a>

## Despliegue

<a id="with-hardhat"></a>

### Con Hardhat

Este repositorio no tiene ningún proyecto Hardhat; en un proyecto Hardhat propio, con `DCPAnchor.sol` entre sus fuentes:

```javascript
const { ethers } = require("hardhat");

async function main() {
  const DCPAnchor = await ethers.getContractFactory("DCPAnchor");
  const anchor = await DCPAnchor.deploy();
  await anchor.waitForDeployment();
  console.log("DCPAnchor deployed to:", await anchor.getAddress());
}

main();
```

<a id="with-foundry"></a>

### Con Foundry

Desde `contracts/ethereum` (o usa `script/Deploy.s.sol`, como en [DEPLOY.md](../../../../contracts/ethereum/DEPLOY.md)). Envía una transacción y gasta fondos; usa preferentemente una cuenta en keystore (`--account`) en lugar de una clave en bruto:

```bash
forge create --rpc-url base_sepolia \
  --account my-deployer \
  --broadcast \
  src/DCPAnchor.sol:DCPAnchor
```

<a id="recommended-l2-networks"></a>

### Redes L2 recomendadas

| Red | Tipo |
|---------|------|
| **Base** | Optimistic Rollup |
| **Arbitrum** | Optimistic Rollup |
| **Optimism** | Optimistic Rollup |

Este repositorio no ha medido las comisiones de las redes; consulta las comisiones actuales antes de elegir.

<a id="full-example--anchor-and-verify"></a>
<a id="full-example-anchor-and-verify"></a>

## Ejemplo completo — anclar y verificar

El ejemplo ancla el `bundle_hash` de un bundle V1 firmado que ya has verificado. Después, `isAnchored` solo muestra que
ese hash se ancló, cuándo y por quién: no es una verificación DCP del bundle.

```javascript
// Fragment: CONTRACT_ADDRESS, ABI and signedBundle come from your deployment and application
const { ethers } = require("ethers");

// Connect
const provider = new ethers.JsonRpcProvider(process.env.ANCHOR_RPC_URL);
const wallet = new ethers.Wallet(process.env.ANCHOR_PRIVATE_KEY, provider);
const anchor = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

// Anchor the bundle's hash: the SHA-256 of its canonical form, as a signed V1 bundle carries it
// in signature.bundle_hash ("sha256:<hex>"), not a hash of JSON.stringify output
const bundleHash = "0x" + signedBundle.signature.bundle_hash.slice("sha256:".length);
const tx = await anchor.anchorBundle(bundleHash);
await tx.wait();
console.log("Anchored in tx:", tx.hash);

// Verify
const [exists, timestamp, submitter] = await anchor.isAnchored(bundleHash);
console.log("Exists:", exists);
console.log("Timestamp:", new Date(Number(timestamp) * 1000));
console.log("Submitter:", submitter);
```

<a id="integration-with-the-anchoring-service"></a>

## Integración con el servicio de anclaje

El servicio HTTP de `services/anchor/` está pensado para llamar a este contrato, pero **el envío on-chain todavía no está implementado**. Cuando lo esté:

- **Modo individual:** llamaría a `anchorBundle()` para cada hash
- **Modo por lotes:** acumularía hashes, calcularía la raíz de Merkle y llamaría a `anchorBatch()`

Hoy guarda registros locales en memoria con `tx_hash: null` y no lee `ANCHOR_RPC_URL`, `ANCHOR_PRIVATE_KEY` ni `ANCHOR_CONTRACT`; no le des ninguna clave de monedero ([services/anchor/README.md](../../../../services/anchor/README.md)).

<a id="development"></a>

## Desarrollo

```bash
# From contracts/ethereum, with Foundry
forge build
forge test
```

<a id="license"></a>

## Licencia

El repositorio tiene licencia Apache-2.0. Los archivos de Solidity llevan su propia cabecera
`SPDX-License-Identifier: MIT`; esta página no los vuelve a licenciar.
