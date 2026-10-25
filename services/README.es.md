<sub>[English](README.md) · **Español** · [Português](README.pt-BR.md) · [日本語](README.ja.md) · [中文](README.zh-CN.md)</sub>

<a id="dcp-infrastructure-services"></a>

# Servicios de infraestructura de DCP

> Traducción informativa de [la versión en inglés](README.md), actualizada el 25/10/2026. Si hay diferencias, prevalece el original inglés. Los identificadores y los bloques de código, incluidos los comentarios, se conservan sin traducir.

Microservicios HTTP opcionales que complementan el Gateway de referencia de DCP. Cada servicio funciona de forma independiente y puede desplegarse por separado o junto con los demás mediante Docker Compose.

<a id="architecture"></a>

## Arquitectura

```
                        ┌─────────────────────┐
                        │  DCP Reference       │
                        │  Gateway (:3000)     │
                        │  Verification +      │
                        │  Key Registry +      │
                        │  Policy Engine       │
                        └──────────┬──────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              │                    │                     │
    ┌─────────▼──────────┐  ┌─────▼──────────┐  ┌──────▼──────────┐
    │  Anchor Service    │  │ Transparency   │  │  Revocation     │
    │  (:3001)           │  │ Log (:3002)    │  │  Service (:3003)│
    │                    │  │                │  │                  │
    │  Bundle hash →     │  │ Append-only    │  │  V1: agent-level│
    │  Local records     │  │ Merkle tree +  │  │  V2: kid-level  │
    │  (L2 planned)      │  │ inclusion      │  │  + emergency    │
    │                    │  │ proofs         │  │  + short-lived  │
    └────────────────────┘  └────────────────┘  └─────────────────┘
```

<a id="services"></a>

## Servicios

| Servicio | Puerto | Estado | Descripción |
|---------|------|--------|-------------|
| [Anclaje](anchor/README.md) | 3001 | Parcial | Registros locales de hashes de bundles, con anclaje en blockchains L2 previsto. Los lotes Merkle funcionan en memoria; el envío on-chain no está implementado, por lo que los registros llevan `tx_hash: null`. |
| [Registro de transparencia](transparency-log/README.md) | 3002 | Funcional | Registro de solo adición al estilo CT: árbol Merkle RFC 6962, pruebas de inclusión y cabeceras de árbol firmadas con Ed25519. Almacenamiento en memoria. |
| [Revocación](revocation/README.md) | 3003 | Funcional | Los agentes registran claves mediante su pasaporte firmado; las revocaciones V1 a nivel de agente y V2 a nivel de kid deben firmarse con esas claves; botón de emergencia. Almacenamiento en memoria por defecto, con persistencia opcional en archivo. |

<a id="quick-start"></a>

## Inicio rápido

```bash
# Run all services with Docker Compose
(cd docker && docker compose up)

# Or run individually from the root of a checkout, after building the workspace SDK
# and installing the root package (the revocation service imports @dcp-ai/sdk):
#   (cd sdks/typescript && npm install && npm run build) && npm install
node services/anchor/index.js
node services/transparency-log/index.js
node services/revocation/index.js
```

<a id="data-flow"></a>

## Flujo de datos

1. **El agente se registra** mediante el Gateway (`POST /v2/passport/register`), y el operador lo registra en el servicio de revocación (`POST /v2/register`, token del operador), en ambos casos con su pasaporte autofirmado
2. **Se declara la intención** y se evalúa la política (`POST /v2/intent/declare`)
3. **Se firma y verifica el bundle** (`POST /v2/bundle/verify`)
4. **Se envía el hash** al servicio de anclaje (`POST /anchor`) para registrarlo localmente o agruparlo en lotes; el envío on-chain no está implementado
5. **Se registra el hash** en el registro de transparencia (`POST /add`)
6. **Se comprueba la revocación** antes de aceptar bundles: `GET /v2/check/kid/:kid` cubre las revocaciones a nivel de kid, de emergencia y por caducidad de cada kid registrado con `POST /v2/register`, y responde 404 (`registered: false`, estado desconocido) para cualquier otro kid; `GET /check/:agent_id` cubre las revocaciones a nivel de agente.

<a id="authentication"></a>

## Autenticación

- Las escrituras de **revocación** están firmadas: el registro, por las propias claves del pasaporte; las revocaciones, por las claves registradas del agente. Las lecturas no lo están: las listas que sirve (`/list`, `/v2/list`, `/.well-known/dcp-revocations.json`) no llevan firma, por lo que el verificador confía en la URL del servicio y en su transporte. Registrar un `agent_id` nuevo también requiere el token del operador, para que nadie pueda reclamar primero el de otro. La revocación de emergencia necesita la preimagen del token registrado.
- Los **nuevos `agent_id`** los registra el operador, tanto en el Gateway (`POST /v2/passport/register`) como en el servicio de revocación (`POST /v2/register`); volver a registrarlos es autoservicio, firmado con las claves del agente.
- **Anclaje** `POST /flush` y **registro de transparencia** `POST /gossip/peers` requieren `Authorization: Bearer <OPERATOR_TOKEN>`; sin `OPERATOR_TOKEN` permanecen bloqueados. El registro consulta a sus pares por sí mismo, por lo que una lista abierta permitiría que cualquiera lo dirigiera a URL internas.
- Los cuerpos de solicitudes tienen un límite de 1 MB. Los límites de frecuencia (registros y revocaciones de emergencia, POST del Gateway) se basan en la dirección del socket; configura `TRUST_PROXY=true` solo detrás de un proxy que añada la IP del cliente a `X-Forwarded-For`.
- Cuando se llenan, los registros rechazan entradas nuevas (507) en lugar de expulsar las existentes: el servicio de revocación limita los agentes (`MAX_AGENTS`); el Gateway limita las claves (`MAX_REGISTERED_KEYS`, `MAX_KEYS_PER_AGENT` durante toda la vida de un agente) y conserva cuatro claves retiradas por agente. Las claves y firmas deben estar en base64 canónico con el tamaño exacto de su algoritmo. El registro de transparencia solo confía en cabeceras de árbol firmadas por pares cuyas claves se fijaron (`GOSSIP_PEERS=<url>#<key>`).

<a id="persistence"></a>

## Persistencia

Por defecto, los servicios mantienen su estado **en memoria**. Si no se configura persistencia, **ese estado no sobrevive a un reinicio**, un despliegue, una caída o la detención de la máquina:

- **Revocación**: olvidar las revocaciones deja a los agentes sin revocar. Configura `REVOCATION_STATE_PATH` para conservar registros y revocaciones en un archivo entre reinicios (el stack de Compose lo hace en un volumen); sin ello, `deploy/fly/revocation.toml` solo mantiene una máquina en ejecución para que la inactividad no borre el estado, pero los despliegues sí lo borran.
- **Registro de transparencia**: un reinicio crea un árbol nuevo y vacío, por lo que las STH y pruebas anteriores dejan de corresponder a él. Su configuración de Fly ya mantiene una máquina en ejecución.
- **Anclaje**: se pierden los hashes pendientes y los registros; su configuración de Fly todavía escala a cero, lo que no afecta a anclajes on-chain mientras no se haga ninguno.

Para producción, añade almacenamiento persistente (SQLite, PostgreSQL), además de un volumen de Fly donde haga falta. Otras limitaciones:

- **Anclaje**: integra ethers.js y un endpoint RPC de L2 real. El contrato `DCPAnchor.sol` está en `contracts/ethereum/`.
- **Revocación**: considera la distribución al estilo CRL (lista de revocación de certificados) u OCSP para despliegues de alta disponibilidad.

<a id="environment-variables"></a>

## Variables de entorno

Consulta los README de cada servicio para conocer los detalles de configuración:
- [Anclaje](anchor/README.md#configuration)
- [Registro de transparencia](transparency-log/README.md#configuration)
- [Revocación](revocation/README.md#configuration)
