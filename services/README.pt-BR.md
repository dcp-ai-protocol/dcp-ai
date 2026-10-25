<sub>[English](README.md) · [Español](README.es.md) · **Português** · [日本語](README.ja.md) · [中文](README.zh-CN.md)</sub>

<a id="dcp-infrastructure-services"></a>

# Serviços de infraestrutura DCP

> Tradução informativa da [versão em inglês](README.md), atualizada em 25/10/2026. Em caso de diferença, prevalece o original em inglês. Identificadores e blocos de código, incluindo comentários, são mantidos sem tradução.

Microsserviços HTTP opcionais que complementam o Gateway de referência DCP. Cada serviço funciona de forma independente e pode ser implantado sozinho ou em conjunto via Docker Compose.

<a id="architecture"></a>

## Arquitetura

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

## Serviços

| Serviço | Porta | Status | Descrição |
|---------|------|--------|-------------|
| [Ancoragem](anchor/README.md) | 3001 | Parcial | Registros locais de hashes de bundles, com ancoragem em blockchains L2 planejada. Os lotes Merkle funcionam em memória; o envio on-chain não está implementado, então os registros contêm `tx_hash: null`. |
| [Log de transparência](transparency-log/README.md) | 3002 | Funcional | Log somente de acréscimo no estilo CT: árvore Merkle RFC 6962, provas de inclusão e cabeçalhos de árvore assinados com Ed25519. Armazenamento em memória. |
| [Revogação](revocation/README.md) | 3003 | Funcional | Agentes registram chaves com seu passaporte assinado; revogações V1 no nível do agente e V2 no nível de kid devem ser assinadas por essas chaves; botão de emergência. Armazenamento em memória por padrão, com persistência opcional em arquivo. |

<a id="quick-start"></a>

## Início rápido

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

## Fluxo de dados

1. **O agente se registra** pelo Gateway (`POST /v2/passport/register`), e o operador o registra no serviço de revogação (`POST /v2/register`, token do operador), ambos com seu passaporte autoassinado
2. **A intenção é declarada** e a política é avaliada (`POST /v2/intent/declare`)
3. **O bundle é assinado e verificado** (`POST /v2/bundle/verify`)
4. **O hash é enviado** ao serviço de ancoragem (`POST /anchor`) para registro local ou agrupamento em lote; o envio on-chain não está implementado
5. **O hash é registrado** no log de transparência (`POST /add`)
6. **A revogação é consultada** antes de aceitar bundles: `GET /v2/check/kid/:kid` cobre revogações no nível de kid, de emergência e por expiração de cada kid registrado com `POST /v2/register`, e responde 404 (`registered: false`, status desconhecido) para qualquer outro kid; `GET /check/:agent_id` cobre as revogações no nível do agente.

<a id="authentication"></a>

## Autenticação

- Escritas de **revogação** são assinadas: o registro, pelas próprias chaves do passaporte; as revogações, pelas chaves registradas para o agente. Leituras não são: as listas servidas (`/list`, `/v2/list`, `/.well-known/dcp-revocations.json`) não têm assinatura, então o verificador confia na URL e no transporte do serviço. Registrar um novo `agent_id` também exige o token do operador, para ninguém reivindicar primeiro o de outra pessoa. A revogação de emergência exige a pré-imagem do token registrado.
- **Novos `agent_id`s** são registrados pelo operador, no Gateway (`POST /v2/passport/register`) e no serviço de revogação (`POST /v2/register`); o recadastramento é de autosserviço, assinado pelas chaves do agente.
- **Ancoragem** `POST /flush` e **log de transparência** `POST /gossip/peers` exigem `Authorization: Bearer <OPERATOR_TOKEN>`; sem `OPERATOR_TOKEN`, continuam bloqueados. O log consulta seus pares por conta própria, então uma lista aberta permitiria que qualquer pessoa o direcionasse a URLs internas.
- Corpos de requisições são limitados a 1 MB. Limites de taxa (registros e revogações de emergência, POSTs do Gateway) usam o endereço do socket; defina `TRUST_PROXY=true` apenas atrás de um proxy que acrescente o IP do cliente a `X-Forwarded-For`.
- Ao ficarem cheios, os registros recusam novas entradas (507) em vez de expulsar as existentes: o serviço de revogação limita agentes (`MAX_AGENTS`); o Gateway limita chaves (`MAX_REGISTERED_KEYS`, `MAX_KEYS_PER_AGENT` ao longo da vida do agente) e mantém quatro chaves aposentadas por agente. Chaves e assinaturas devem ser base64 canônico com o tamanho exato de seu algoritmo. O log de transparência só confia em cabeçalhos de árvore assinados por pares com chaves fixadas (`GOSSIP_PEERS=<url>#<key>`).

<a id="persistence"></a>

## Persistência

Por padrão, os serviços mantêm seu estado **em memória**. Sem persistência configurada, **esse estado não sobrevive a uma reinicialização**, implantação, falha ou máquina parada:

- **Revogação**: esquecer revogações faz os agentes deixarem de ser revogados. Defina `REVOCATION_STATE_PATH` para manter registros e revogações em um arquivo entre reinicializações (o stack Compose faz isso em um volume); sem isso, `deploy/fly/revocation.toml` apenas mantém uma máquina ligada para que a inatividade não apague o estado, mas as implantações ainda o apagam.
- **Log de transparência**: reiniciar cria uma árvore nova e vazia, então STHs e provas anteriores deixam de corresponder a ela. Sua configuração Fly já mantém uma máquina em execução.
- **Ancoragem**: hashes pendentes e registros são perdidos; sua configuração Fly ainda escala para zero, o que não afeta ancoragens on-chain enquanto nenhuma for realizada.

Para produção, adicione armazenamento persistente (SQLite, PostgreSQL), além de um volume Fly quando necessário. Outras limitações:

- **Ancoragem**: integre ethers.js e um endpoint RPC L2 real. O contrato `DCPAnchor.sol` está em `contracts/ethereum/`.
- **Revogação**: considere distribuição no estilo CRL (lista de revogação de certificados) ou OCSP para implantações de alta disponibilidade.

<a id="environment-variables"></a>

## Variáveis de ambiente

Veja os READMEs de cada serviço para detalhes de configuração:
- [Ancoragem](anchor/README.md#configuration)
- [Log de transparência](transparency-log/README.md#configuration)
- [Revogação](revocation/README.md#configuration)
