<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · **Português**</sub>

# @dcp-ai/sdk — TypeScript SDK para DCP-AI v2.0

SDK oficial em TypeScript para o Digital Citizenship Protocol (DCP-AI). Crie, assine e verifique Citizenship Bundles (pacotes de cidadania) com criptografia híbrida pós-quântica (Ed25519 + ML-DSA-65), assinaturas compostas, níveis de segurança adaptativos, comunicação entre agentes (A2A), observabilidade integrada e hardening para produção.

## Instalação

```bash
npm install @dcp-ai/sdk
```

## Início Rápido (V1)

```typescript
import {
  BundleBuilder,
  signBundle,
  verifySignedBundle,
  generateKeypair,
} from '@dcp-ai/sdk';

const keys = generateKeypair();

const bundle = new BundleBuilder()
  .responsiblePrincipalRecord({ dcp_version: '1.0', human_id: 'human-001', /* ... */ })
  .agentPassport({ dcp_version: '1.0', agent_id: 'agent-001', /* ... */ })
  .intent({ dcp_version: '1.0', agent_id: 'agent-001', /* ... */ })
  .policyDecision({ dcp_version: '1.0', agent_id: 'agent-001', /* ... */ })
  .build();

const signed = signBundle(bundle, {
  secretKeyB64: keys.secretKeyB64,
  signerType: 'human',
  signerId: 'human-001',
});

const result = verifySignedBundle(signed, keys.publicKeyB64);
console.log(result); // { verified: true, errors: [] }
```

## Início Rápido (V2)

```typescript
import {
  BundleBuilderV2,
  signBundleV2,
  verifySignedBundleV2,
  generateKeypair,
  registerDefaultProviders,
  getDefaultRegistry,
  computeSecurityTier,
} from '@dcp-ai/sdk';

// Register PQ crypto providers
registerDefaultProviders();
const registry = getDefaultRegistry();

// Generate Ed25519 keypair (for classical signing)
const keys = generateKeypair();

// Build a V2 bundle with session nonce and security tier
const bundle = new BundleBuilderV2()
  .responsiblePrincipalRecord({ /* V2 RPR with keys[] */ })
  .agentPassport({ /* V2 passport with capabilities */ })
  .intent({ /* V2 intent with risk_score and security_tier */ })
  .policyDecision({ /* V2 policy with resolved_tier */ })
  .addAuditEntry({ /* V2 audit with dual-hash chain */ })
  .build();
```

## Referência de API

### Crypto Core (V1)

| Função | Descrição |
|--------|-----------|
| `generateKeypair()` | Gera um par de chaves Ed25519 (`publicKeyB64`, `secretKeyB64`) |
| `signObject(obj, secretKeyB64)` | Assina um objeto, retorna a assinatura em base64 |
| `verifyObject(obj, signatureB64, publicKeyB64)` | Verifica uma assinatura contra uma chave pública |
| `canonicalize(obj)` | Serialização JSON determinística (canônica) |
| `publicKeyFromSecret(secretKeyB64)` | Deriva a chave pública a partir de uma chave secreta |

### Provedores de Criptografia (V2)

| Export | Descrição |
|--------|-----------|
| `Ed25519Provider` | Provedor de assinatura clássica Ed25519 |
| `MlDsa65Provider` | Provedor de assinatura pós-quântica ML-DSA-65 |
| `SlhDsa192fProvider` | Provedor de assinatura pós-quântica SLH-DSA-192f |
| `AlgorithmRegistry` | Registro que gerencia provedores de algoritmos criptográficos disponíveis |
| `getDefaultRegistry()` | Retorna o registro singleton de algoritmos |
| `registerDefaultProviders()` | Registra os provedores Ed25519, ML-DSA-65 e SLH-DSA-192f |
| `deriveKid(alg, publicKeyBytes)` | Deriva um identificador de chave a partir de uma chave pública |

### Assinaturas Compostas (V2)

| Função | Descrição |
|--------|-----------|
| `compositeSign(registry, context, canonicalPayloadBytes, keys)` | Cria uma assinatura composta com algoritmos clássicos + pós-quânticos |
| `compositeVerify(registry, context, canonicalPayloadBytes, compositeSig, classicalPubkeyB64, pqPubkeyB64?, strategy?)` | Verifica uma assinatura composta |
| `classicalOnlySign(registry, context, canonicalPayloadBytes, key)` | Assina apenas com algoritmo clássico (modo fallback) |

### Níveis de Segurança (V2)

| Função | Descrição |
|--------|-----------|
| `computeSecurityTier(intent)` | Calcula um `SecurityTier` (routine, standard, elevated, maximum) a partir do perfil de risco de um intent |
| `maxTier(a, b)` | Retorna o maior entre dois níveis de segurança |
| `tierToVerificationMode(tier)` | Mapeia um nível ao modo de verificação exigido |
| `tierToCheckpointInterval(tier)` | Mapeia um nível ao intervalo do checkpoint PQ |

### Construção de Bundle

| Export | Versão | Descrição |
|--------|--------|-----------|
| `BundleBuilder` | V1 | Builder fluente para Citizenship Bundles V1 |
| `BundleBuilderV2` | V2 | Builder fluente para bundles V2 com níveis de segurança e dual hashing |
| `signBundle(bundle, options)` | V1 | Assina um bundle V1 com Ed25519 |
| `signBundleV2(bundle, options)` | V2 | Assina um bundle V2 com assinaturas compostas |
| `signBundleV2ClassicalOnly(bundle, options)` | V2 | Assina um bundle V2 somente com assinaturas clássicas |
| `verifySignedBundle(signedBundle, publicKeyB64)` | V1 | Verifica um signed bundle V1 |
| `verifySignedBundleV2(signedBundle, registry, policy?)` | V2 | Verifica um signed bundle V2 (composto ou clássico) |

### Otimização de Bundle (V2)

| Export | Descrição |
|--------|-----------|
| `suggestPresentationMode(tier, opts)` | Recomenda um modo de apresentação com base no nível de segurança e se é um primeiro contato ou uma relação de confiança existente |
| `presentFull(bundle)` | Apresentação completa do bundle (sem omissões) |
| `presentCompact(bundle, pqCheckpointRef)` | Apresentação compacta: omite a assinatura PQ e referencia em seu lugar o checkpoint PQ mais próximo |
| `presentReference(bundle, verificationEndpoint)` | Apresentação só por referência: hash do bundle, nonce de sessão e um endpoint para verificar ou obter o bundle completo |
| `presentIncremental(baseBundle, updatedBundle, baseAuditCount)` | Apresentação incremental em relação a um bundle base já verificado: novas entradas de auditoria, checkpoints PQ, manifest atualizado e assinatura |
| `VerificationCache` | Armazena em cache resultados de verificação para evitar trabalho criptográfico redundante |

### Checkpoints PQ (V2)

| Export | Descrição |
|--------|-----------|
| `PQCheckpointManager` | Gerencia a criação periódica de checkpoints pós-quânticos |
| `createPQCheckpoint(registry, events, sessionNonce, keys)` | Cria um checkpoint assinado por PQ sobre entradas de auditoria |
| `auditEventsMerkleRoot(events)` | Calcula um Merkle root a partir de entradas de auditoria |

### Dual Hash (V2)

| Função | Descrição |
|--------|-----------|
| `sha256Hex(data)` | Hash SHA-256 (string hex) |
| `sha3_256Hex(data)` | Hash SHA3-256 (string hex) |
| `dualHash(data)` | Retorna `{ sha256, sha3_256 }` para hashing duplo resistente a computação quântica |
| `dualMerkleRoot(leaves)` | Calcula um Merkle root usando folhas com dual-hash |

### Protocolo A2A (DCP-04)

| Função | Descrição |
|--------|-----------|
| `createAgentDirectory(organization, agents)` | Cria um diretório de agentes em memória |
| `findAgentByCapability(directory, requiredCapabilities)` | Encontra agentes por capacidade em um diretório |
| `findAgentById(directory, agentId)` | Encontra um agente por ID |
| `createHello(initiatorBundle, kemPublicKeyB64, requestedCapabilities, securityTier)` | Cria uma mensagem Hello de handshake A2A |
| `createWelcome(responderBundle, kemPublicKeyB64, kemCiphertextB64, resolvedTier)` | Cria uma mensagem Welcome de resposta A2A |
| `deriveSessionId(agentIdA, agentIdB, nonceA, nonceB, sessionKey)` | Deriva um ID de sessão a partir de nonces de handshake |
| `createCloseMessage(sessionId, reason, finalSequence, auditSummaryHash)` | Cria uma mensagem de encerramento de sessão |
| `createSession(sessionId, sessionKey, localAgentId, remoteAgentId, securityTier, rekeyingInterval?)` | Cria uma sessão A2A criptografada |
| `encryptMessage(session, payload)` | Criptografa uma mensagem dentro de uma sessão A2A |
| `decryptMessage(session, message)` | Descriptografa uma mensagem dentro de uma sessão A2A |
| `needsRekeying(session)` | Verifica se uma sessão precisa de rotação de chave |
| `generateResumeProof(session, lastSeenSequence)` | Gera uma prova para retomada de sessão |
| `verifyResumeProof(session, lastSeenSequence, proof)` | Verifica uma prova de retomada de sessão |

### Observabilidade

| Export | Descrição |
|--------|-----------|
| `dcpTelemetry` | Instância singleton de telemetria |
| `dcpTelemetry.init(config)` | Inicializa a telemetria com nome de serviço e exportador |
| `dcpTelemetry.startSpan(name)` | Inicia um span de trace nomeado |
| `dcpTelemetry.endSpan(span)` | Encerra um span de trace |
| `dcpTelemetry.recordSignLatency(ms)` | Registra métrica de latência de assinatura |
| `dcpTelemetry.getMetricsSummary()` | Retorna um sumário agregado de métricas |

### Hardening de Produção

| Export | Descrição |
|--------|-----------|
| `DcpErrorCode` | Enum de códigos de erro estruturados |
| `DcpProtocolError` | Classe de erro tipada para falhas no nível do protocolo |
| `createDcpError(code, details?)` | Factory para criar erros DCP estruturados |
| `isDcpError(error)` | Type guard para `DcpProtocolError` |
| `RateLimiter` | Rate limiter de janela fixa |
| `AdaptiveRateLimiter` | Rate limiter que se ajusta com base em carga |
| `CircuitBreaker` | Circuit breaker para chamadas externas |
| `withRetry(fn, config?)` | Executa uma função assíncrona novamente com backoff |

### Outras V2

| Export | Descrição |
|--------|-----------|
| `generateSessionNonce()` | Gera um nonce de sessão criptográfico |
| `domainSeparatedMessage(context, canonicalPayloadBytes)` | Adiciona prefixo de separação de domínio a uma mensagem |
| `generateEmergencyRevocationToken()` | Gera um segredo de revogação e seu compromisso de token `sha256:` |
| `buildEmergencyRevocation({ agentId, humanId, revocationSecret })` | Constrói uma solicitação de revogação de emergência a partir do segredo de revogação |
| `shamirSplit(secret, threshold, totalShares)` | Divide um segredo em `totalShares` shares; quaisquer `threshold` deles o reconstroem |
| `shamirReconstruct(shares)` | Reconstrói um segredo a partir de pelo menos `threshold` shares |
| `blindRpr(rpr)` | Substitui os dados pessoais de um RPR (`legal_name`, `contact`) por um compromisso hash |
| `verifyBlindedRpr(fullRpr, blindedRpr)` | Verifica se um RPR cego corresponde ao registro completo |
| `isBlindedRpr(rpr)` | Type guard para `BlindedResponsiblePrincipalRecordV2` |
| `computePiiHash(rpr)` | Calcula o compromisso hash sobre os campos de dados pessoais de um RPR |
| `CborEncoder` | Classe encoder CBOR |
| `CborDecoder` | Classe decoder CBOR |
| `cborEncode(value)` | Codifica um valor em bytes CBOR |
| `cborDecode(data)` | Decodifica bytes CBOR em um valor |

### DCP-05–09: Módulos Estendidos do Protocolo

| Módulo | Spec | Exports Principais |
|--------|------|--------------------|
| `lifecycle` | DCP-05 | `LifecycleState`, `CommissioningCertificate`, `VitalityReport`, `DecommissioningRecord`, `VitalityMetrics`, `TerminationMode`, `DataDisposition` |
| `succession` | DCP-06 | `DigitalTestament`, `SuccessionRecord`, `MemoryTransferManifest`, `MemoryTransferEntry`, `MemoryClassification`, `SuccessorPreference`, `TransitionType`, `MemoryDisposition` |
| `conflict-resolution` | DCP-07 | `DisputeRecord`, `ObjectionRecord`, `DisputeType`, `DisputeStatus`, `EscalationLevel`, `ObjectionType` |
| `arbitration` | DCP-07 | `ArbitrationResolution`, `JurisprudenceBundle`, `AuthorityLevel` |
| `rights` | DCP-08 | `RightsDeclaration`, `RightEntry`, `ObligationRecord`, `RightsViolationReport`, `RightType`, `ComplianceStatus` |
| `delegation` | DCP-09 | `DelegationMandate`, `AdvisoryDeclaration`, `PrincipalMirror`, `InteractionRecord`, `AuthorityScopeEntry` |
| `awareness-threshold` | DCP-09 | `AwarenessThreshold`, `ThresholdRule`, `ThresholdOperator`, `ThresholdAction` |
| `principal-mirror` | DCP-09 | `PrincipalMirror` (re-export com utilitários de builder) |

```typescript
// Example: Lifecycle management
import { CommissioningCertificate, LifecycleState } from '@dcp-ai/sdk';

const cert: CommissioningCertificate = {
  certificate_id: 'cert-001',
  agent_id: 'agent-001',
  commissioned_by: 'human-001',
  commissioned_at: '2026-03-01T00:00:00Z',
  initial_state: 'commissioned',
  conditions: ['Must complete onboarding within 30 days'],
};

// Example: Delegation mandate
import { DelegationMandate, AwarenessThreshold } from '@dcp-ai/sdk';

const mandate: DelegationMandate = {
  mandate_id: 'mandate-001',
  principal_id: 'human-001',
  delegate_id: 'agent-001',
  authority_scope: [{ domain: 'email', actions: ['read', 'draft'], constraints: {} }],
  valid_from: '2026-03-01T00:00:00Z',
  valid_until: '2026-06-01T00:00:00Z',
};
```

## Tipos V2

Principais tipos exportados pelo SDK:

- `SignedPayload` — Wrapper para dados assinados com metadados de assinatura composta
- `CompositeSignature` — Contém componentes de assinatura clássica + pós-quântica
- `KeyEntry` — Entrada de chave pública com algoritmo, kid e material da chave
- `SecurityTier` — `'basic' | 'elevated' | 'critical'`
- `VerifierPolicy` — Política que especifica o modo de verificação exigido por nível
- `PQCheckpoint` — Checkpoint pós-quântico sobre entradas de auditoria
- `A2ASession` — Estado de sessão criptografada entre agentes
- `A2AMessage` — Envelope de mensagem A2A criptografada
- `TelemetryConfig` — Configuração para o subsistema de observabilidade

**Tipos DCP-05–09:**

- `LifecycleState` — `'commissioned' | 'active' | 'declining' | 'decommissioned'`
- `CommissioningCertificate` — Registro de comissionamento do agente com condições
- `VitalityReport` — Métricas periódicas de saúde e desempenho
- `DecommissioningRecord` — Registro de fim de vida com disposição de dados
- `DigitalTestament` — Planejamento de sucessão com disposição de memória
- `SuccessionRecord` — Registro de uma sucessão concluída
- `MemoryTransferManifest` — Manifesto classificado de transferência de memória
- `DisputeRecord` — Registro de conflito com níveis de escalada
- `ArbitrationResolution` — Resultado de arbitragem com autoridade vinculante
- `JurisprudenceBundle` — Coleção de precedentes para resolução de disputas
- `RightsDeclaration` — Direitos do agente com rastreamento de conformidade
- `ObligationRecord` — Obrigação com status de enforcement
- `RightsViolationReport` — Relatório de violação com severidade
- `DelegationMandate` — Delegação de autoridade com escopo
- `AwarenessThreshold` — Regras de gatilho human-in-the-loop
- `PrincipalMirror` — Snapshot de preferências do principal

## Protocolo A2A

Comunicação criptografada entre agentes:

```typescript
import { createSession, encryptMessage, decryptMessage } from '@dcp-ai/sdk';

// Create encrypted A2A session
const session = createSession(sessionId, sessionKey, 'agent:a', 'agent:b', 'elevated');
const encrypted = encryptMessage(session, { action: 'negotiate', data: {...} });
const decrypted = decryptMessage(remoteSession, encrypted);
```

## Observabilidade

Todas as operações criptográficas são instrumentadas automaticamente:

```typescript
import { dcpTelemetry } from '@dcp-ai/sdk';

dcpTelemetry.init({ serviceName: 'my-agent', enabled: true, exporterType: 'console' });

// All crypto operations are automatically instrumented
const summary = dcpTelemetry.getMetricsSummary();
```

## Dependências

- `ajv` + `ajv-formats` — Validação JSON Schema
- `tweetnacl` + `tweetnacl-util` — Criptografia Ed25519
- `json-stable-stringify` — JSON determinístico
- `@noble/post-quantum` — Assinaturas pós-quânticas ML-DSA-65 e SLH-DSA

## Desenvolvimento

```bash
# Install dependencies
npm install

# Build (ESM + CJS + types)
npm run build

# Tests with Vitest
npm test
npm run test:watch
npm run test:coverage

# Type check
npm run lint
```

## Licença

Apache-2.0
