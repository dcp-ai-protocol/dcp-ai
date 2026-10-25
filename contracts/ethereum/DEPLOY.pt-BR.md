<sub>[English](DEPLOY.md) · [中文](DEPLOY.zh-CN.md) · [Español](DEPLOY.es.md) · [日本語](DEPLOY.ja.md) · **Português**</sub>

<a id="deploying-dcpanchorsol"></a>

# Implantar o `DCPAnchor.sol`

> Tradução informativa da [versão em inglês](DEPLOY.md), atualizada em 25/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

O `DCPAnchor.sol` registra hashes de bundles em uma L2 compatível com EVM: um registro, que permite detectar adulterações e que qualquer pessoa pode verificar, de que um hash foi enviado até um determinado bloco. Ele não checa o bundle por trás do hash. Este guia mostra a implantação na **Base**, com notas para outras cadeias.

> **O serviço de ancoragem de referência ainda não usa o contrato.** `services/anchor/` mantém registros locais em memória com `tx_hash: null`: não lê nenhuma URL de RPC, chave de carteira nem endereço de contrato. Depois de implantado, o contrato recebe ancoragens do seu próprio código ou via `cast`, com uma chave de remetente que você guarda em um keystore ou em um gerenciador de segredos. Os comandos deste guia que enviam transações (`--broadcast`, `cast send`) gastam fundos reais na mainnet e não foram executados para esta página.

<a id="what-you-need"></a>

## Do que você precisa

1. **Foundry** (conjunto de ferramentas para Solidity). Instalação:
   ```bash
   curl -L https://foundry.paradigm.xyz | bash
   foundryup
   ```
2. **Uma carteira** com algum gas na cadeia de destino. As taxas mudam conforme a rede; confira-as antes de implantar.
3. **Uma chave de API de um explorador de blocos** (gratuita) se você quiser que o código-fonte seja verificado automaticamente para que a ABI apareça no Basescan/Etherscan. Cadastre-se em [basescan.org/apis](https://basescan.org/apis).

<a id="configure"></a>

## Configuração

```bash
cd contracts/ethereum
cp .env.example .env
# Edit .env with your RPC URL and BASESCAN_API_KEY, and remove or comment out its PRIVATE_KEY line
```

Guarde a chave do implantador em um keystore do Foundry, não no `.env`:
```bash
cast wallet import my-deployer --interactive   # paste the key once; stored encrypted on disk
```
Os comandos abaixo assinam com `--account my-deployer`.

Como o `script/Deploy.s.sol` escolhe a chave: ele lê `PRIVATE_KEY` com `vm.envOr("PRIVATE_KEY", uint256(0))`. Um `uint256` válido e diferente de zero ali tem prioridade sobre o keystore, e o script transmite com ele. Quando `PRIVATE_KEY` está ausente ou vale `0`, ele chama `vm.startBroadcast()` e as opções `--account` (ou `--sender`) se aplicam. Um marcador malformado, como a linha `PRIVATE_KEY=0x` que o `.env.example` traz, pode não ser interpretado. Então, para usar o keystore, remova ou comente a linha `PRIVATE_KEY` do seu `.env` copiado antes de `source .env`. O script não lê `DEPLOYER_ACCOUNT`: passe `--account` você mesmo (por exemplo, `--account "$DEPLOYER_ACCOUNT"`).

Instale o `forge-std` se `lib/forge-std` estiver faltando:
```bash
git clone --depth 1 https://github.com/foundry-rs/forge-std.git lib/forge-std
```

<a id="test-locally"></a>

## Testes locais

```bash
forge test -vv
```

Resultado esperado: 6 testes passam em poucos segundos.

<a id="deploy-to-a-testnet-first-base-sepolia"></a>

## Implante primeiro em uma rede de teste (Base Sepolia)

```bash
source .env
forge script script/Deploy.s.sol \
  --rpc-url base_sepolia \
  --account my-deployer \
  --broadcast \
  --verify
```

Você obtém uma transação em [sepolia.basescan.org](https://sepolia.basescan.org/) e um endereço de contrato. Teste-o fazendo uma ancoragem pela CLI:

```bash
ADDR=0x...   # the deployed address

# Register a separate submitter (the deployer is already authorised; skip if it submits)
# cast send $ADDR "addSubmitter(address)" 0xYOUR_SUBMITTER \
#   --rpc-url base_sepolia --account my-deployer

# Anchor a dummy bundle hash (a full bytes32: 0x and 64 hex digits)
HASH=0x1111111111111111111111111111111111111111111111111111111111111111
cast send $ADDR "anchorBundle(bytes32)" $HASH \
  --rpc-url base_sepolia --account my-deployer

# Confirm: (exists, timestamp, submitter)
cast call $ADDR "isAnchored(bytes32)(bool,uint256,address)" $HASH --rpc-url base_sepolia
```

<a id="deploy-to-base-mainnet"></a>

## Implantação na Base mainnet

Quando a implantação na rede de teste estiver saudável:

```bash
source .env
forge script script/Deploy.s.sol \
  --rpc-url base \
  --account my-deployer \
  --broadcast \
  --verify \
  --priority-gas-price 1gwei
```

Guarde o endereço em algum lugar durável (README, wiki de operações e o `.well-known/dcp-capabilities.json` do seu servidor de verificação).

<a id="anchoring-to-it"></a>

## Ancorar nele

O serviço de ancoragem não está conectado ao contrato: ele não lê `ANCHOR_RPC_URL`, `ANCHOR_PRIVATE_KEY` nem `ANCHOR_CONTRACT`, então não lhe dê nenhuma chave de carteira. Até que esteja, ancore a partir do seu próprio código ou com `cast`, como no teste na rede de teste acima, usando uma conta de remetente de um keystore do Foundry (`--account`) em vez de uma chave bruta na linha de comando.

Boa prática: o remetente não é o dono. A chave do dono fica em armazenamento a frio e só é usada para as funções do dono: `addSubmitter`, `removeSubmitter`, `pause`, `unpause` e `transferOwnership`. O remetente é uma chave quente com um saldo modesto que é recarregado periodicamente. O implantador é o dono e também está autorizado a enviar. Defina `INITIAL_SUBMITTER` antes de implantar para autorizar um remetente separado na mesma execução.

<a id="other-chains"></a>

## Outras cadeias

Todos os comandos de implantação acima funcionam sem alterações nas outras L2s de EVM. Troque o alias de `--rpc-url` (a lista está em `foundry.toml` → `rpc_endpoints`):

| Cadeia | Alias | Notas |
|---|---|---|
| **Base** | `base` | L2 da Coinbase |
| Optimism | `optimism` | A mesma OP Stack da Base |
| Arbitrum | `arbitrum` | Arbitrum One |
| Sepolia | `sepolia` | Rede de teste do Ethereum (sem fundos reais) |
| Base Sepolia | `base_sepolia` | Rede de teste da Base (sem fundos reais); o ensaio geral recomendado |

Cada alias lê a sua URL de RPC do ambiente (`BASE_RPC_URL`, `OPTIMISM_RPC_URL`, …). Este repositório não mediu as taxas em nenhuma delas.

<a id="upgrades--migrations"></a>
<a id="upgrades-migrations"></a>

## Atualizações / migrações

O `DCPAnchor.sol` **não é atualizável** por projeto: as ancoragens precisam ser imutáveis para que o modelo de segurança se sustente. Se precisar mudar o contrato (por exemplo, acrescentar um evento novo), implante um contrato novo, aponte os seus remetentes para o novo endereço e deixe o contrato antigo como referência histórica. Os verificadores posteriores podem ler dos dois por meio do seu registro local de contratos de ancoragem.

<a id="rollback-plan"></a>

## Plano de reversão

- A ancoragem é opcional no protocolo DCP, mas a política de um consumidor pode exigi-la. Se um contrato ficar inutilizável (remetente comprometido, indisponibilidade da cadeia), pare de enviar para ele. Os verificadores recorrem ao log de transparência ou à cadeia de auditoria simples só onde a sua própria política permitir isso expressamente; este repositório não implementa nenhum failover desse tipo. (O serviço de ancoragem não tem um modo `disabled`; os seus modos são `individual` e `batch`, e, de qualquer forma, ele não envia nada on-chain.)
- Para trocar remetentes: `cast send <ADDR> "removeSubmitter(address)" <OLD> --rpc-url <alias> --account <owner keystore>`, e depois adicione o novo da mesma forma.
- Para trocar o dono: `transferOwnership` não mexe em `authorizedSubmitters`, então o dono anterior (autorizado na implantação) ainda pode enviar. Depois da transferência, o novo dono o remove com `removeSubmitter`.
- Para pausar todas as novas ancoragens em uma emergência: `cast send <ADDR> "pause()" --rpc-url <alias> --account <owner keystore>` (`unpause()` as retoma).
