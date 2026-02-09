# DCPAnchor.sol — Smart Contract

Contrato inteligente Solidity para anclar hashes de Citizenship Bundles DCP en blockchains EVM L2 (Base, Arbitrum, Optimism). Soporta anclaje individual y por lotes (batch Merkle root).

## Overview

El contrato `DCPAnchor` provee un registro inmutable on-chain de bundle hashes. Una vez anclado, un hash no puede ser modificado ni eliminado, proporcionando evidencia criptografica de la existencia de un bundle en un momento determinado.

## Contrato

**Solidity:** `^0.8.20`  
**Licencia:** MIT  
**Redes objetivo:** Base, Arbitrum, Optimism (u otra EVM L2)

## API

### Funciones de escritura

#### `anchorBundle(bytes32 bundleHash)`

Ancla un hash de bundle individual.

- **Reverts** si `bundleHash` es cero
- **Reverts** si el hash ya fue anclado
- **Emite** `BundleAnchored(bundleHash, msg.sender, block.timestamp)`

```solidity
// Ejemplo
dcpAnchor.anchorBundle(0xabc123...);
```

#### `anchorBatch(bytes32 merkleRoot, uint256 count)`

Ancla un Merkle root que representa un lote de bundles.

- **Reverts** si `merkleRoot` es cero
- **Reverts** si `count` es cero
- **Reverts** si el Merkle root ya fue anclado
- **Emite** `BatchAnchored(merkleRoot, count, msg.sender, block.timestamp)`

```solidity
// Ejemplo: anclar un batch de 50 bundles
dcpAnchor.anchorBatch(0xdef456..., 50);
```

### Funciones de lectura

#### `isAnchored(bytes32 bundleHash) → (bool exists, uint256 timestamp)`

Consulta si un bundle hash esta anclado.

```solidity
(bool exists, uint256 ts) = dcpAnchor.isAnchored(0xabc123...);
```

#### `isBatchAnchored(bytes32 merkleRoot) → (bool exists, uint256 timestamp)`

Consulta si un Merkle root de batch esta anclado.

```solidity
(bool exists, uint256 ts) = dcpAnchor.isBatchAnchored(0xdef456...);
```

### Storage

| Variable | Tipo | Descripcion |
|----------|------|-------------|
| `bundles` | `mapping(bytes32 => AnchorRecord)` | Registros de bundles individuales |
| `batches` | `mapping(bytes32 => AnchorRecord)` | Registros de batch Merkle roots |
| `totalAnchors` | `uint256` | Total de anclajes individuales |
| `totalBatches` | `uint256` | Total de batch anclajes |

### Structs

```solidity
struct AnchorRecord {
    address submitter;   // Quien anclo el hash
    uint256 timestamp;   // Cuando se anclo (block.timestamp)
    bool exists;         // Si el registro existe
}
```

### Eventos

```solidity
event BundleAnchored(
    bytes32 indexed bundleHash,
    address indexed submitter,
    uint256 timestamp
);

event BatchAnchored(
    bytes32 indexed merkleRoot,
    uint256 bundleCount,
    address indexed submitter,
    uint256 timestamp
);
```

## Deploy

### Con Hardhat

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

### Con Foundry

```bash
forge create --rpc-url $RPC_URL \
  --private-key $PRIVATE_KEY \
  src/DCPAnchor.sol:DCPAnchor
```

### Redes L2 recomendadas

| Red | Tipo | Costo estimado por tx |
|-----|------|----------------------|
| **Base** | Optimistic Rollup | ~$0.001-0.01 |
| **Arbitrum** | Optimistic Rollup | ~$0.001-0.01 |
| **Optimism** | Optimistic Rollup | ~$0.001-0.01 |

El uso de L2 reduce los costos de gas >100x comparado con Ethereum mainnet, manteniendo la seguridad de L1.

## Ejemplo completo — Anclar y verificar

```javascript
const { ethers } = require("ethers");

// Conectar
const provider = new ethers.JsonRpcProvider(process.env.ANCHOR_RPC_URL);
const wallet = new ethers.Wallet(process.env.ANCHOR_PRIVATE_KEY, provider);
const anchor = new ethers.Contract(CONTRACT_ADDRESS, ABI, wallet);

// Anclar un bundle hash
const bundleHash = ethers.keccak256(ethers.toUtf8Bytes("bundle-content"));
const tx = await anchor.anchorBundle(bundleHash);
await tx.wait();
console.log("Anclado en tx:", tx.hash);

// Verificar
const [exists, timestamp] = await anchor.isAnchored(bundleHash);
console.log("Existe:", exists);
console.log("Timestamp:", new Date(Number(timestamp) * 1000));
```

## Integracion con el Anchoring Service

El servicio HTTP `services/anchor/` interactua con este contrato automaticamente:

- **Modo individual:** Llama a `anchorBundle()` por cada hash
- **Modo batch:** Acumula hashes, calcula Merkle root y llama a `anchorBatch()`

Configurar via variables de entorno:
```bash
ANCHOR_RPC_URL=https://mainnet.base.org
ANCHOR_PRIVATE_KEY=0x...
ANCHOR_CONTRACT=0x...
```

## Desarrollo

```bash
# Con Hardhat
npx hardhat compile
npx hardhat test

# Con Foundry
forge build
forge test
```

## Licencia

MIT
