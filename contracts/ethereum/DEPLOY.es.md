<sub>[English](DEPLOY.md) · [中文](DEPLOY.zh-CN.md) · **Español** · [日本語](DEPLOY.ja.md) · [Português](DEPLOY.pt-BR.md)</sub>

<a id="deploying-dcpanchorsol"></a>

# Desplegar `DCPAnchor.sol`

> Traducción informativa de [la versión en inglés](DEPLOY.md), actualizada el 25/10/2026. Si difieren, prevalece la versión en inglés. Los identificadores, comandos y bloques de código se conservan sin traducir.

`DCPAnchor.sol` registra hashes de bundles en una L2 compatible con EVM: un registro, que permite detectar manipulaciones y que cualquiera puede verificar, de que un hash se envió como tarde en un bloque determinado. No comprueba el bundle que hay detrás del hash. Esta guía recorre su despliegue en **Base**, con notas para otras cadenas.

> **El servicio de anclaje de referencia todavía no usa el contrato.** `services/anchor/` guarda registros locales en memoria con `tx_hash: null`: no lee ninguna URL RPC, clave de monedero ni dirección de contrato. Una vez desplegado, el contrato recibe anclajes desde tu propio código o con `cast`, con una clave de remitente que guardas en un keystore o en un gestor de secretos. Los comandos de esta guía que envían transacciones (`--broadcast`, `cast send`) gastan fondos reales en mainnet y no se ejecutaron para esta página.

<a id="what-you-need"></a>

## Qué necesitas

1. **Foundry** (conjunto de herramientas para Solidity). Instalación:
   ```bash
   curl -L https://foundry.paradigm.xyz | bash
   foundryup
   ```
2. **Un monedero** con algo de gas en la cadena de destino. Las comisiones cambian según la red; consúltalas antes de desplegar.
3. **Una clave de API de un explorador de bloques** (gratuita) si quieres que el código fuente se verifique automáticamente para que la ABI aparezca en Basescan/Etherscan. Regístrate en [basescan.org/apis](https://basescan.org/apis).

<a id="configure"></a>

## Configuración

```bash
cd contracts/ethereum
cp .env.example .env
# Edit .env with your RPC URL and BASESCAN_API_KEY, and remove or comment out its PRIVATE_KEY line
```

Guarda la clave del desplegador en un keystore de Foundry, no en `.env`:
```bash
cast wallet import my-deployer --interactive   # paste the key once; stored encrypted on disk
```
Los comandos de abajo firman con `--account my-deployer`.

Cómo elige la clave `script/Deploy.s.sol`: lee `PRIVATE_KEY` con `vm.envOr("PRIVATE_KEY", uint256(0))`. Un `uint256` válido distinto de cero ahí tiene prioridad sobre el keystore y el script difunde la transacción con él. Cuando `PRIVATE_KEY` falta o vale `0`, llama a `vm.startBroadcast()` y se aplican las opciones `--account` (o `--sender`). Un marcador mal formado, como la línea `PRIVATE_KEY=0x` que trae `.env.example`, puede no interpretarse. Así que, para usar el keystore, quita o comenta la línea `PRIVATE_KEY` de tu `.env` copiado antes de `source .env`. El script no lee `DEPLOYER_ACCOUNT`: pasa tú `--account` (por ejemplo, `--account "$DEPLOYER_ACCOUNT"`).

Instala `forge-std` si falta `lib/forge-std`:
```bash
git clone --depth 1 https://github.com/foundry-rs/forge-std.git lib/forge-std
```

<a id="test-locally"></a>

## Pruebas locales

```bash
forge test -vv
```

Resultado esperado: 6 pruebas pasan en unos segundos.

<a id="deploy-to-a-testnet-first-base-sepolia"></a>

## Despliega primero en una red de pruebas (Base Sepolia)

```bash
source .env
forge script script/Deploy.s.sol \
  --rpc-url base_sepolia \
  --account my-deployer \
  --broadcast \
  --verify
```

Obtienes una transacción en [sepolia.basescan.org](https://sepolia.basescan.org/) y una dirección de contrato. Pruébalo haciendo un anclaje desde la CLI:

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

## Despliegue en Base mainnet

Cuando el despliegue en la red de pruebas funcione bien:

```bash
source .env
forge script script/Deploy.s.sol \
  --rpc-url base \
  --account my-deployer \
  --broadcast \
  --verify \
  --priority-gas-price 1gwei
```

Guarda la dirección en algún sitio duradero (README, wiki de operaciones y el `.well-known/dcp-capabilities.json` de tu servidor de verificación).

<a id="anchoring-to-it"></a>

## Anclar en él

El servicio de anclaje no está conectado al contrato: no lee `ANCHOR_RPC_URL`, `ANCHOR_PRIVATE_KEY` ni `ANCHOR_CONTRACT`, así que no le des ninguna clave de monedero. Hasta que lo esté, ancla desde tu propio código o con `cast`, como en la prueba en la red de pruebas de arriba, usando una cuenta de remitente de un keystore de Foundry (`--account`) en lugar de una clave en bruto en la línea de comandos.

Buena práctica: el remitente no es el propietario. La clave del propietario se guarda en almacenamiento en frío y solo se usa para las funciones del propietario: `addSubmitter`, `removeSubmitter`, `pause`, `unpause` y `transferOwnership`. El remitente es una clave en caliente con un saldo modesto que se recarga periódicamente. El desplegador es el propietario y también está autorizado a enviar. Define `INITIAL_SUBMITTER` antes de desplegar para autorizar un remitente distinto en la misma ejecución.

<a id="other-chains"></a>

## Otras cadenas

Todos los comandos de despliegue anteriores funcionan sin cambios en las demás L2 de EVM. Cambia el alias de `--rpc-url` (la lista está en `foundry.toml` → `rpc_endpoints`):

| Cadena | Alias | Notas |
|---|---|---|
| **Base** | `base` | L2 de Coinbase |
| Optimism | `optimism` | La misma OP Stack que Base |
| Arbitrum | `arbitrum` | Arbitrum One |
| Sepolia | `sepolia` | Red de pruebas de Ethereum (sin fondos reales) |
| Base Sepolia | `base_sepolia` | Red de pruebas de Base (sin fondos reales); el ensayo general recomendado |

Cada alias lee su URL RPC del entorno (`BASE_RPC_URL`, `OPTIMISM_RPC_URL`, …). Este repositorio no ha medido las comisiones en ninguna de ellas.

<a id="upgrades--migrations"></a>
<a id="upgrades-migrations"></a>

## Actualizaciones / migraciones

`DCPAnchor.sol` **no es actualizable** por diseño: los anclajes tienen que ser inmutables para que el modelo de seguridad se sostenga. Si necesitas cambiar el contrato (p. ej., añadir un evento nuevo), despliega un contrato nuevo, dirige a tus remitentes a la nueva dirección y deja el contrato antiguo como referencia histórica. Los verificadores posteriores pueden leer de ambos mediante su registro local de contratos de anclaje.

<a id="rollback-plan"></a>

## Plan de vuelta atrás

- El anclaje es opcional en el protocolo DCP, pero la política de un consumidor puede exigirlo. Si un contrato deja de poder usarse (remitente comprometido, caída de la cadena), deja de enviarle anclajes. Los verificadores recurren al registro de transparencia o a la cadena de auditoría simple solo donde su propia política lo permita expresamente; este repositorio no implementa ninguna conmutación de ese tipo. (El servicio de anclaje no tiene un modo `disabled`; sus modos son `individual` y `batch`, y de todos modos no envía nada on-chain).
- Para rotar remitentes: `cast send <ADDR> "removeSubmitter(address)" <OLD> --rpc-url <alias> --account <owner keystore>`, y después añade el nuevo de la misma manera.
- Para rotar el propietario: `transferOwnership` no toca `authorizedSubmitters`, así que el propietario anterior (autorizado en el despliegue) todavía puede enviar. Tras la transferencia, el nuevo propietario lo quita con `removeSubmitter`.
- Para pausar todos los anclajes nuevos en una emergencia: `cast send <ADDR> "pause()" --rpc-url <alias> --account <owner keystore>` (`unpause()` los reanuda).
