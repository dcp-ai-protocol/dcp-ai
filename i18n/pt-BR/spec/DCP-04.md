<sub>[English](../../../spec/DCP-04.md) · [中文](../../zh-CN/spec/DCP-04.md) · [Español](../../es/spec/DCP-04.md) · [日本語](../../ja/spec/DCP-04.md) · **Português**</sub>

<a id="dcp-04-agent-to-agent-communication"></a>

# DCP-04: Comunicação entre agentes

> Tradução informativa da [especificação em inglês](../../../spec/DCP-04.md), atualizada em 25/10/2026. **A versão normativa é a inglesa**: esta tradução não tem valor normativo e, em caso de divergência, prevalece o inglês. Identificadores e blocos de código são mantidos sem tradução.

## Status
Publicada — v2.0 (extensão; as revisões são acompanhadas conforme o retorno de quem a adota)

<a id="abstract"></a>

## Resumo
Esta especificação define como agentes certificados pelo DCP descobrem uns aos outros, estabelecem canais de comunicação com autenticação mútua e proteção pós-quântica e trocam mensagens totalmente integradas à trilha de auditoria.

<a id="1-introduction"></a>

## 1. Introdução

DCP-01 a DCP-03 definem a identidade, a intenção e a auditoria de agentes individuais. O DCP-04 estende o protocolo à interação direta entre agentes, a base dos fluxos de trabalho corporativos com vários agentes.

Sem A2A, o DCP só oferece verificação passiva (o agente apresenta o bundle a um verificador). O DCP-04 permite a interação ativa: um agente da Organização A pode negociar com um agente da Organização B, ambos com autenticação mútua pós-quântica.

<a id="11-design-principles"></a>

### 1.1 Princípios de design
- Autenticação mútua antes de qualquer troca de dados
- Segurança pós-quântica do handshake até o fim da sessão
- Cada mensagem A2A gera uma entrada de auditoria
- Nenhum intermediário central necessário (P2P)
- Compatível com as camadas de transporte existentes (WebSocket, gRPC, HTTP/2)

<a id="12-threat-model"></a>

### 1.2 Modelo de ameaças
- Adversário quântico que coleta agora para decifrar depois (harvest-now-decrypt-later)
- Intermediário (man-in-the-middle) entre agentes
- Personificação de agentes legítimos
- Sequestro da sessão após o handshake
- Repetição de mensagens A2A entre sessões

<a id="2-agent-discovery-protocol"></a>

## 2. Protocolo de descoberta de agentes

<a id="21-well-known-endpoint"></a>

### 2.1 Endpoint conhecido

Os agentes publicam sua disponibilidade por meio de `.well-known/dcp-agent-directory.json`:

```json
{
  "dcp_version": "2.0",
  "organization": "Acme Corp",
  "agents": [
    {
      "agent_id": "agent:acme-purchasing-001",
      "agent_name": "Acme Purchasing Agent",
      "capabilities": ["negotiate", "purchase_order", "invoice"],
      "bundle_endpoint": "https://acme.com/.well-known/dcp/agents/001/bundle.json",
      "a2a_endpoint": "wss://acme.com/dcp/a2a",
      "a2a_transports": ["websocket", "grpc"],
      "security_tier_minimum": "elevated",
      "supported_algorithms": {
        "signing": ["ed25519", "ml-dsa-65"],
        "kem": ["x25519-ml-kem-768"]
      },
      "status": "active",
      "updated_at": "2026-02-28T00:00:00Z"
    }
  ],
  "directory_signature": {
    "alg": "ed25519",
    "kid": "org-signing-key-kid",
    "sig_b64": "..."
  }
}
```

<a id="22-discovery-flow"></a>

### 2.2 Fluxo de descoberta

1. O agente A resolve o domínio do agente B
2. O agente A obtém `https://<domain>/.well-known/dcp-agent-directory.json`
3. O agente A verifica a assinatura do diretório
4. O agente A seleciona um agente pelas capacidades exigidas
5. O agente A obtém o bundle assinado do agente B a partir do `bundle_endpoint`
6. O agente A verifica localmente o bundle do agente B

<a id="23-capability-matching"></a>

### 2.3 Correspondência de capacidades

As capacidades são strings de um registro. Entre as capacidades padrão estão:

- `negotiate` — Pode participar de fluxos de negociação
- `purchase_order` — Pode emitir ou receber pedidos de compra
- `invoice` — Pode emitir ou processar faturas
- `data_query` — Pode responder a consultas de dados
- `task_delegate` — Pode aceitar tarefas delegadas
- `approval` — Pode aprovar ou rejeitar solicitações
- `notification` — Pode enviar e receber notificações

Capacidades personalizadas devem (MUST) usar notação de domínio reverso: `com.acme.custom_capability`.

<a id="3-handshake-protocol"></a>

## 3. Protocolo de handshake

<a id="31-overview"></a>

### 3.1 Visão geral

O handshake A2A estabelece uma sessão com autenticação mútua e proteção pós-quântica. Ele usa o KEM híbrido (X25519 + ML-KEM-768) já definido na especificação principal v2.0.

```
Agent A (Initiator)                    Agent B (Responder)
    |                                       |
    |── A2A_HELLO ─────────────────────────>|
    |   { signed_bundle_A, kem_pk_A,        |
    |     nonce_A, supported_algs }         |
    |                                       |
    |<────────────────────── A2A_WELCOME ───|
    |   { signed_bundle_B, kem_pk_B,        |
    |     nonce_B, kem_ciphertext_BA }      |
    |                                       |
    |── A2A_CONFIRM ───────────────────────>|
    |   { kem_ciphertext_AB,                |
    |     encrypted_confirm(nonce_A+B) }    |
    |                                       |
    |<──────────────────── A2A_ESTABLISHED ─|
    |   { encrypted_ack, session_id }       |
    |                                       |
    |══ Encrypted A2A Messages ════════════>|
    |<═════════════════════════════════════ ═|
```

### 3.2 A2A_HELLO

Enviada pelo iniciador para começar o handshake.

```json
{
  "type": "A2A_HELLO",
  "protocol_version": "2.0",
  "initiator_bundle": { "...SignedBundleV2..." },
  "ephemeral_kem_public_key": {
    "alg": "x25519-ml-kem-768",
    "public_key_b64": "..."
  },
  "nonce": "<32 random bytes, hex>",
  "supported_algorithms": {
    "signing": ["ed25519", "ml-dsa-65"],
    "kem": ["x25519-ml-kem-768"],
    "cipher": ["aes-256-gcm"]
  },
  "requested_capabilities": ["negotiate", "purchase_order"],
  "security_tier": "elevated",
  "timestamp": "2026-02-28T00:00:00Z"
}
```

### 3.3 A2A_WELCOME

Enviada pelo respondente depois de verificar o bundle do iniciador.

```json
{
  "type": "A2A_WELCOME",
  "protocol_version": "2.0",
  "responder_bundle": { "...SignedBundleV2..." },
  "ephemeral_kem_public_key": {
    "alg": "x25519-ml-kem-768",
    "public_key_b64": "..."
  },
  "nonce": "<32 random bytes, hex>",
  "kem_ciphertext": {
    "alg": "x25519-ml-kem-768",
    "ciphertext_b64": "..."
  },
  "selected_algorithms": {
    "signing": "ed25519",
    "kem": "x25519-ml-kem-768",
    "cipher": "aes-256-gcm"
  },
  "resolved_security_tier": "elevated",
  "timestamp": "2026-02-28T00:00:00Z"
}
```

<a id="34-key-derivation"></a>

### 3.4 Derivação da chave

As duas partes derivam a chave de sessão:

```
shared_secret_BA = decapsulate(kem_ciphertext_BA, sk_A)
shared_secret_AB = decapsulate(kem_ciphertext_AB, sk_B)

session_key = HKDF-SHA256(
  salt = nonce_A || nonce_B,
  ikm  = shared_secret_BA || shared_secret_AB,
  info = "DCP-AI.v2.A2A.SessionKey",
  len  = 32
)
```

<a id="35-session-binding"></a>

### 3.5 Vinculação da sessão

A sessão fica vinculada às identidades dos dois agentes:

```
session_id = SHA-256(
  "DCP-AI.v2.A2A.Session" || 0x00 ||
  agent_id_A || 0x00 ||
  agent_id_B || 0x00 ||
  nonce_A || nonce_B ||
  session_key
)[0:32] (hex)
```

<a id="4-session-management"></a>

## 4. Gerenciamento de sessões

<a id="41-session-state"></a>

### 4.1 Estado da sessão

Cada sessão mantém:

- `session_id`: identificador único da sessão
- `session_key`: chave simétrica derivada
- `message_counter_send`: contador monotonicamente crescente de mensagens enviadas
- `message_counter_recv`: contador monotonicamente crescente de mensagens recebidas
- `created_at`: carimbo de data/hora da criação da sessão
- `last_activity`: carimbo de data/hora da última mensagem
- `security_tier`: nível de segurança resolvido para a sessão
- `rekeying_interval`: mensagens antes da renovação da chave (padrão: 1000)

<a id="42-message-format"></a>

### 4.2 Formato das mensagens

```json
{
  "session_id": "<hex>",
  "sequence": 42,
  "type": "A2A_MESSAGE",
  "encrypted_payload": "<base64>",
  "iv": "<base64, 12 bytes>",
  "tag": "<base64, 16 bytes>",
  "sender_agent_id": "agent:acme-001",
  "timestamp": "2026-02-28T00:00:00Z"
}
```

Cifragem: AES-256-GCM com:

- Chave: `session_key`
- IV: 12 bytes aleatórios por mensagem
- AAD: `session_id || sequence || sender_agent_id || timestamp`

<a id="43-rekeying"></a>

### 4.3 Renovação da chave

Quando `message_counter_send` atinge o `rekeying_interval`:

1. O iniciador envia `A2A_REKEY` com uma nova chave pública KEM efêmera
2. O respondente responde com o texto cifrado KEM
3. Uma nova chave de sessão é derivada:
```
new_session_key = HKDF-SHA256(
  salt = old_session_key,
  ikm  = new_shared_secret,
  info = "DCP-AI.v2.A2A.Rekey" || session_id,
  len  = 32
)
```
4. Os dois contadores voltam a 0

<a id="44-session-termination"></a>

### 4.4 Encerramento da sessão

Qualquer uma das partes pode encerrá-la:

```json
{
  "type": "A2A_CLOSE",
  "session_id": "<hex>",
  "reason": "complete",
  "final_sequence": 157,
  "audit_summary_hash": "sha256:<hex>",
  "timestamp": "2026-02-28T00:00:00Z"
}
```

Motivos: `complete`, `timeout`, `error`, `revocation`, `policy_violation`.

<a id="45-session-resume"></a>

### 4.5 Retomada da sessão

Uma sessão estabelecida anteriormente pode ser retomada se as duas partes guardarem o estado da sessão:

```json
{
  "type": "A2A_RESUME",
  "session_id": "<hex>",
  "last_seen_sequence": 157,
  "resume_proof": "<HMAC-SHA256(session_key, session_id || last_seen_sequence)>"
}
```

O respondente valida a prova e confirma com `A2A_RESUMED` ou rejeita com `A2A_RESUME_REJECTED` (o que exige um novo handshake completo).

<a id="5-trust-model"></a>

## 5. Modelo de confiança

<a id="51-direct-trust"></a>

### 5.1 Confiança direta

Dois agentes confiam um no outro após a verificação mútua dos bundles durante o handshake. A confiança é estabelecida por sessão e, por padrão, não é transitiva.

<a id="52-organizational-trust"></a>

### 5.2 Confiança organizacional

Se o agente A confia na chave de assinatura da Organização X e o diretório da Organização X lista o agente B, o agente A pode estender sua confiança ao agente B sob a autoridade da Organização X.

<a id="53-transitive-trust-optional"></a>

### 5.3 Confiança transitiva (opcional)

A confiança transitiva deve (MUST) ser habilitada explicitamente e tem profundidade limitada:

```json
{
  "trust_policy": {
    "allow_transitive": true,
    "max_depth": 2,
    "require_tier": "elevated",
    "trusted_organizations": ["org:acme", "org:globex"]
  }
}
```

Se `max_depth` for 2: A confia em B, B confia em C, A pode (MAY) confiar em C. Uma profundidade 0 significa apenas confiança direta (padrão).

<a id="54-trust-revocation"></a>

### 5.4 Revogação da confiança

Se o bundle de um agente for revogado durante uma sessão ativa:

1. A sessão deve (MUST) ser encerrada imediatamente
2. Uma entrada de auditoria `revocation` deve (MUST) ser criada
3. As mensagens em trânsito devem (MUST) ser descartadas
4. A contraparte deve (MUST) ser notificada por `A2A_CLOSE` com o motivo `revocation`

<a id="6-audit-integration"></a>

## 6. Integração com a auditoria

<a id="61-a2a-audit-events"></a>

### 6.1 Eventos de auditoria A2A

Cada interação A2A gera entradas de auditoria nas cadeias de auditoria dos dois agentes:

**Eventos de handshake:**

- `a2a_hello_sent` / `a2a_hello_received`
- `a2a_session_established`

**Eventos de mensagem:**

- `a2a_message_sent` / `a2a_message_received`

**Eventos de sessão:**

- `a2a_rekey`
- `a2a_session_closed`
- `a2a_session_resumed`

<a id="62-audit-entry-for-a2a"></a>

### 6.2 Entrada de auditoria para A2A

```json
{
  "dcp_version": "2.0",
  "event_id": "evt:<uuid>",
  "event_type": "a2a_message_sent",
  "agent_id": "agent:acme-001",
  "session_id": "<hex>",
  "counterparty_agent_id": "agent:globex-002",
  "sequence": 42,
  "payload_hash": "sha256:<hash of decrypted payload>",
  "timestamp": "2026-02-28T00:00:00Z",
  "prev_hash": "sha256:<hash of previous audit entry>",
  "prev_hash_secondary": "sha3-256:<hash>"
}
```

<a id="63-cross-chain-verification"></a>

### 6.3 Verificação entre cadeias

As cadeias de auditoria dos dois agentes referenciam a mesma sessão. Um auditor terceiro pode verificar a consistência:

1. Obtendo as entradas de auditoria dos dois agentes para a sessão
2. Verificando se os hashes das mensagens coincidem entre remetente e destinatário
3. Verificando se os números de sequência são consistentes
4. Verificando se os carimbos de data/hora estão dentro de uma diferença aceitável (configurável, 30 segundos por padrão)

<a id="7-wire-format"></a>

## 7. Formato de transmissão

<a id="71-transport-requirements"></a>

### 7.1 Requisitos de transporte

As mensagens A2A podem (MAY) ser transportadas sobre:

- **WebSocket** (recomendado para conexões bidirecionais e persistentes)
- **gRPC** (recomendado para ambientes corporativos de alta vazão)
- **HTTP/2 Server-Sent Events** (para fluxos unidirecionais)

O handshake deve (MUST) ser concluído em até 10 segundos. A entrega de mensagens deve (MUST) ter semântica de no máximo uma vez.

<a id="72-cbor-encoding"></a>

### 7.2 Codificação CBOR

As mensagens A2A deveriam (SHOULD) usar codificação CBOR (RFC 8949) por eficiência de transporte:

- Mensagens de handshake: JSON (para facilitar a depuração)
- Mensagens de sessão: CBOR (por desempenho)

Content-Type: `application/cbor` para CBOR, `application/json` para JSON.

<a id="8-security-considerations"></a>

## 8. Considerações de segurança

<a id="81-forward-secrecy"></a>

### 8.1 Sigilo futuro

As chaves KEM efêmeras oferecem sigilo futuro (forward secrecy). Comprometer as chaves de longo prazo não revela as chaves de sessões passadas.

<a id="82-post-quantum-security"></a>

### 8.2 Segurança pós-quântica

O KEM híbrido (X25519 + ML-KEM-768) oferece segurança contra adversários clássicos e quânticos. A chave de sessão é segura se qualquer um dos dois KEM componentes for seguro.

<a id="83-denial-of-service"></a>

### 8.3 Negação de serviço

As implementações deveriam (SHOULD):

- Limitar a taxa de mensagens A2A_HELLO por origem
- Exigir um bundle válido antes das operações KEM
- Aplicar limites de conexão por agente
- Usar prova de trabalho para iniciadores anônimos (opcional)

<a id="84-message-ordering"></a>

### 8.4 Ordem das mensagens

Os números de sequência impedem a repetição e a reordenação. As implementações devem (MUST) rejeitar mensagens com:

- Números de sequência duplicados
- Números de sequência mais de 1000 à frente do último recebido (janela)
- Números de sequência abaixo do último recebido (exceto dentro da janela)

<a id="9-conformance"></a>

## 9. Conformidade

Uma implementação está em conformidade com o DCP-04 se:

1. Implementa o protocolo de handshake definido na seção 3
2. Usa KEM híbrido para o estabelecimento de chaves
3. Cifra todas as mensagens de sessão com AES-256-GCM
4. Gera entradas de auditoria para todos os eventos A2A
5. Oferece suporte à renovação da chave de sessão
6. Implementa a verificação de confiança por meio da validação de bundles
7. Respeita os requisitos do nível de segurança

<a id="references"></a>

## Referências

- DCP-01: Identidade e vinculação ao principal
- DCP-02: Declaração de intenção e controle por políticas
- DCP-03: Cadeia de auditoria e transparência
- FIPS 203: ML-KEM (mecanismo de encapsulamento de chaves baseado em reticulados modulares)
- RFC 5869: HKDF
- RFC 8949: CBOR
- RFC 8446: TLS 1.3 (inspiração para o design do handshake)

---

*Esta especificação foi cocriada por uma pessoa e um agente de IA: o primeiro protocolo A2A para a cidadania digital, projetado para governar as próprias interações que possibilita.*

<a id="implementation-notes-informative"></a>

## Notas de implementação (informativas)

> **Acrescentadas em 25/10/2026. Não normativas.** Estas notas não acrescentam nenhum requisito nem mudam nada do que está acima: descrevem como
> o código de referência em `main` se relaciona com este texto. Onde divergem, prevalece o texto normativo acima.

- **O que os SDKs implementam.** Em `main` todos os SDKs constroem `A2A_HELLO` e `A2A_WELCOME`; nenhum implementa
  `A2A_CONFIRM` / `A2A_ESTABLISHED` nem a derivação de chave de §3.4, só o SDK de TypeScript tem o KEM híbrido
  X25519 + ML-KEM-768 e o SDK de Rust não tem camada de sessão
  ([tools/interop-matrix](../../../tools/interop-matrix/README.md#roadmap)). Nenhum SDK ou serviço declara conformidade com
  o DCP-04 tal como §9 a define.
- **O que as funções auxiliares não fazem.** As funções auxiliares de TypeScript constroem mensagens, diretórios e
  objetos de sessão, e cifram e decifram mensagens de sessão com uma chave fornecida por quem chama: `createSession`
  recebe a `session_key` como argumento e não a deriva. Elas não executam o handshake, a troca KEM, a verificação nem a
  admissão do bundle da contraparte, o transporte de rede nem as entradas de auditoria de §6; tudo isso fica a cargo de
  quem chama.
- **Entradas de auditoria.** Não há JSON Schema para a entrada de auditoria A2A de §6.2; sua forma (`event_id`,
  `event_type`) difere de `schemas/v2/audit_entry.schema.json` (`audit_id`, `outcome`). As mensagens A2A de §2 a §4
  também não têm schema em `schemas/v2/`. Para os tipos do SDK, consulte [docs/API_REFERENCE.md](../../../docs/API_REFERENCE.md).
- Os exemplos são ilustrações com marcadores (`...`, `<hex>`, `<uuid>`), não fixtures.
