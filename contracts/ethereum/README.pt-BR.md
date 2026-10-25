<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · **Português**</sub>

<a id="dcpanchorsol--smart-contract"></a>
<a id="dcpanchorsol-smart-contract"></a>

# DCPAnchor.sol — contrato inteligente

> Tradução informativa da [versão em inglês](README.md), atualizada em 25/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Contrato inteligente em Solidity para ancorar hashes de Citizenship Bundles do DCP em blockchains L2 de EVM (Base, Arbitrum, Optimism). Suporta ancoragem individual, ancoragem com compromisso e revelação (commit-reveal) e ancoragem em lote (raiz de Merkle do lote).

O serviço de ancoragem de referência (`services/anchor/`) ainda não chama este contrato; veja [Integração com o serviço de ancoragem](#integration-with-the-anchoring-service).

<a id="layout"></a>

## Estrutura

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

## Início rápido

```bash
cd contracts/ethereum
git clone --depth 1 https://github.com/foundry-rs/forge-std.git lib/forge-std
forge test -vv
```

<a id="deploy"></a>

## Implantação

Consulte [DEPLOY.md](DEPLOY.md) para o passo a passo completo (Base Sepolia → Base mainnet, verificação no Basescan, conexão do serviço `anchor`).

Versão curta, depois da etapa [Configure](DEPLOY.md#configure) do DEPLOY.md (conta em keystore, linha `PRIVATE_KEY`
removida do `.env`). Ela envia uma transação e gasta fundos na mainnet:
```bash
source .env
forge script script/Deploy.s.sol --rpc-url base --account my-deployer --broadcast --verify
```

<a id="overview"></a>

## Visão geral

O contrato `DCPAnchor` fornece um registro on-chain imutável de hashes de bundles. Uma vez ancorado, um hash não pode ser modificado nem apagado, então o registro mostra que quem o enviou se comprometeu com esse hash até o momento do seu bloco. O contrato guarda o `bytes32` (e, para um lote, o `count`) tal como quem os envia os declara: ele não checa se o hash pertence a um bundle válido, não verifica nenhuma assinatura nem prova que os fatos que um bundle descreve aconteceram.

<a id="contract"></a>

## Contrato

**Solidity:** `^0.8.20`  
**Cabeçalho de licença:** `SPDX-License-Identifier: MIT` em `src/DCPAnchor.sol` e `script/Deploy.s.sol` (veja [Licença](#license))  
**Redes de destino:** Base, Arbitrum, Optimism (ou qualquer L2 de EVM)

## API

Os trechos de Solidity abaixo são ilustrações: valores como `0xabc123...` representam hashes `bytes32` completos.

<a id="admin-functions"></a>

### Funções de administração

#### `addSubmitter(address submitter)`

Adiciona um remetente autorizado. Só o dono do contrato pode chamá-la.

#### `removeSubmitter(address submitter)`

Remove um remetente autorizado. Só o dono do contrato pode chamá-la.

#### `pause()` / `unpause()`

Mecanismo de pausa de emergência. Em pausa, todas as funções de ancoragem revertem. Só o dono do contrato pode chamá-las.

#### `transferOwnership(address newOwner)`

Transfere a propriedade do contrato. Ela não altera `authorizedSubmitters`: o dono anterior, que o construtor autorizou
como implantador, continua sendo um remetente autorizado até que o novo dono chame `removeSubmitter` para ele. O dono
atual sempre passa na checagem de remetente, mesmo depois de `removeSubmitter(owner)`. Ao trocar o dono, remova também a
entrada de remetente do dono anterior.

<a id="write-functions"></a>

### Funções de escrita

#### `anchorBundle(bytes32 bundleHash)`

Ancoragem direta para remetentes confiáveis em cenários de baixo risco.

- **Exige** um remetente autorizado ou o dono
- **Reverte** se `bundleHash` for zero
- **Reverte** se o hash já tiver sido ancorado
- **Reverte** se o contrato estiver em pausa
- **Emite** `BundleAnchored(bundleHash, msg.sender, block.timestamp)`

```solidity
dcpAnchor.anchorBundle(0xabc123...);
```

<a id="commit-reveal-front-running-protection"></a>

<a id="commit-reveal-limited-front-running-protection"></a>

#### Commit-reveal (proteção limitada contra front-running)

Nos cenários em que o front-running é uma preocupação, use o fluxo de compromisso e revelação em duas fases. O
compromisso oculta o hash do bundle até a revelação e vincula a revelação ao endereço que se comprometeu. Ele reserva
só o `commitHash`, não o hash do bundle: `anchorBundle` continua aberta a todo remetente autorizado e não consulta os
compromissos, então outro remetente autorizado que conheça o hash pode ancorá-lo diretamente antes da sua revelação.
Não é uma reserva exclusiva.

**Fase 1 — `commit(bytes32 commitHash)`**

Envie `keccak256(abi.encodePacked(bundleHash, salt, msg.sender))` para reservar uma vaga.

**Fase 2 — `revealAndAnchorBundle(bytes32 bundleHash, bytes32 salt)`**

Revele o hash original e o sal para concluir a ancoragem. Se o compromisso foi minerado no bloco `b`, a revelação precisa de `block.number > b + COMMIT_DELAY` e `block.number <= b + COMMIT_EXPIRY`: com as constantes abaixo, do bloco `b + 2` ao bloco `b + 256`, inclusive. O `keccak256("random-salt")` do exemplo é determinístico; em uso real, o sal deve ser aleatório e imprevisível, e permanecer privado até a revelação.

```solidity
bytes32 salt = keccak256("random-salt");
bytes32 commitHash = keccak256(abi.encodePacked(bundleHash, salt, msg.sender));
dcpAnchor.commit(commitHash);
// ... wait until block.number > commit block + COMMIT_DELAY (b + 2 or later, b + 256 at the latest) ...
dcpAnchor.revealAndAnchorBundle(bundleHash, salt);
```

#### `anchorBatch(bytes32 merkleRoot, uint256 count)`

Ancora uma raiz de Merkle que representa um lote de bundles.

- **Exige** um remetente autorizado ou o dono
- **Reverte** se `merkleRoot` for zero
- **Reverte** se `count` for zero ou passar de `MAX_BATCH_SIZE` (10000)
- **Reverte** se a raiz de Merkle já tiver sido ancorada
- **Reverte** se o contrato estiver em pausa
- **Emite** `BatchAnchored(merkleRoot, count, msg.sender, block.timestamp)`

```solidity
dcpAnchor.anchorBatch(0xdef456..., 50);
```

<a id="read-functions"></a>

### Funções de leitura

#### `isAnchored(bytes32 bundleHash) → (bool exists, uint256 timestamp, address submitter)`

Consulta se um hash de bundle está ancorado.

```solidity
(bool exists, uint256 ts, address submitter) = dcpAnchor.isAnchored(0xabc123...);
```

#### `isBatchAnchored(bytes32 merkleRoot) → (bool exists, uint256 timestamp, uint256 count, address submitter)`

Consulta se uma raiz de Merkle de lote está ancorada.

```solidity
(bool exists, uint256 ts, uint256 count, address submitter) = dcpAnchor.isBatchAnchored(0xdef456...);
```

<a id="storage"></a>

### Armazenamento

| Variável | Tipo | Descrição |
|----------|------|-------------|
| `owner` | `address` | Dono do contrato |
| `paused` | `bool` | Estado da pausa de emergência |
| `authorizedSubmitters` | `mapping(address => bool)` | Remetentes autorizados |
| `bundles` | `mapping(bytes32 => AnchorRecord)` | Registros de bundles individuais |
| `batches` | `mapping(bytes32 => AnchorRecord)` | Registros de raízes de Merkle de lotes |
| `commitments` | `mapping(bytes32 => Commitment)` | Compromissos do commit-reveal |
| `totalAnchors` | `uint256` | Total de ancoragens individuais |
| `totalBatches` | `uint256` | Total de ancoragens em lote |

### Structs

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

| Constante | Valor | Descrição |
|----------|-------|-------------|
| `MAX_BATCH_SIZE` | `10000` | Máximo de bundles por lote |
| `COMMIT_DELAY` | `1` | A revelação precisa de `block.number > b + COMMIT_DELAY`, sendo `b` o bloco do compromisso (ou seja, a partir de `b + 2`) |
| `COMMIT_EXPIRY` | `256` | A revelação precisa de `block.number <= b + COMMIT_EXPIRY`; depois disso, o compromisso expirou |

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

## Implantação

<a id="with-hardhat"></a>

### Com Hardhat

Este repositório não tem nenhum projeto Hardhat; em um projeto Hardhat próprio, com `DCPAnchor.sol` entre as suas fontes:

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

### Com Foundry

A partir de `contracts/ethereum` (ou use `script/Deploy.s.sol`, como em [DEPLOY.md](DEPLOY.md)). Ele envia uma transação e gasta fundos; prefira uma conta em keystore (`--account`) a uma chave bruta:

```bash
forge create --rpc-url base_sepolia \
  --account my-deployer \
  --broadcast \
  src/DCPAnchor.sol:DCPAnchor
```

<a id="recommended-l2-networks"></a>

### Redes L2 recomendadas

| Rede | Tipo |
|---------|------|
| **Base** | Optimistic Rollup |
| **Arbitrum** | Optimistic Rollup |
| **Optimism** | Optimistic Rollup |

Este repositório não mediu as taxas das redes; confira as taxas atuais antes de escolher.

<a id="full-example--anchor-and-verify"></a>
<a id="full-example-anchor-and-verify"></a>

## Exemplo completo — ancorar e verificar

O exemplo ancora o `bundle_hash` de um bundle V1 assinado que você já verificou. Depois, `isAnchored` só mostra que esse
hash foi ancorado, quando e por quem: não é uma verificação DCP do bundle.

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

## Integração com o serviço de ancoragem

O serviço HTTP em `services/anchor/` foi feito para chamar este contrato, mas **o envio on-chain ainda não está implementado**. Quando estiver:

- **Modo individual:** chamaria `anchorBundle()` para cada hash
- **Modo em lote:** acumularia hashes, calcularia a raiz de Merkle e chamaria `anchorBatch()`

Hoje ele mantém registros locais em memória com `tx_hash: null` e não lê `ANCHOR_RPC_URL`, `ANCHOR_PRIVATE_KEY` nem `ANCHOR_CONTRACT`; não lhe dê nenhuma chave de carteira ([services/anchor/README.md](../../services/anchor/README.md)).

<a id="development"></a>

## Desenvolvimento

```bash
# From contracts/ethereum, with Foundry
forge build
forge test
```

<a id="license"></a>

## Licença

O repositório é licenciado sob Apache-2.0. Os arquivos Solidity trazem o seu próprio cabeçalho
`SPDX-License-Identifier: MIT`; esta página não os relicencia.
