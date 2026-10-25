<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · **Português**</sub>

<a id="dcp-aisdk--typescript-sdk-for-dcp-ai-v20"></a>
<a id="dcp-aisdk-typescript-sdk-for-dcp-ai-v20"></a>

# @dcp-ai/sdk — SDK TypeScript para o DCP-AI v2.0

> Tradução informativa da [versão em inglês](README.md), atualizada em 25/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

SDK oficial em TypeScript para o Digital Citizenship Protocol (DCP-AI). Crie, assine e verifique Citizenship Bundles com criptografia híbrida pós-quântica (Ed25519 + ML-DSA-65), assinaturas compostas, níveis de segurança adaptativos, comunicação entre agentes (A2A), observabilidade integrada e reforço para produção.

<a id="installation"></a>

## Instalação

**Status de publicação (25/10/2026).** O registro do npm tem `@dcp-ai/sdk` 2.1.1 como `latest`. Este README descreve o
código de `main`, que tem mais:
- a versão 2.2.0, marcada em `v2.10.0` mas não publicada no npm, que corrige um desvio de `verifySignedBundleV2` (veja
  [`SECURITY.md`](../../SECURITY.md));
- o que o changelog lista em [`[Unreleased]`](../../CHANGELOG.md#unreleased): admissão, cadeias de delegação,
  a janela de recepção A2A e as APIs experimentais de `dcp-jcs-v2`.

Para executar os exemplos abaixo, compile o SDK a partir de uma cópia do repositório e instale-o de lá:

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
cd dcp-ai/sdks/typescript && npm install && npm run build
cd /path/to/your-project && npm install /path/to/dcp-ai/sdks/typescript
```

A instalação pelo registro fornece a versão publicada, sem o que foi listado acima:

```bash
npm install @dcp-ai/sdk   # 2.1.1 on 25/10/2026
```

<a id="quick-start-v1"></a>

## Início rápido (V1)

Um bundle V1 assinado com Ed25519. O RPR é assinado com a chave do principal e o passaporte com a do agente,
cada um sobre o JSON canônico do objeto sem o campo `signature`; `createAuditEntry` calcula
`intent_hash` e a cadeia `prev_hash`. `verifySignedBundle` verifica a assinatura do bundle, seus hashes e a
cadeia, não essas assinaturas internas: verifique-as você mesmo, como abaixo.

```typescript
import { BundleBuilder, generateKeypair, signBundle, signObject, verifyObject, verifySignedBundle } from '@dcp-ai/sdk';
import type { AgentPassport, ResponsiblePrincipalRecord } from '@dcp-ai/sdk';

const now = new Date().toISOString();
const principalKeys = generateKeypair();
const agentKeys = generateKeypair();

// Each artifact is signed over the object without its `signature` field.
const rprBody: Omit<ResponsiblePrincipalRecord, 'signature'> = {
  dcp_version: '1.0', human_id: 'human:example-001', legal_name: 'Example Principal',
  entity_type: 'natural_person', jurisdiction: 'ES', liability_mode: 'owner_responsible',
  override_rights: true, issued_at: now, expires_at: null, contact: null,
};
const rpr: ResponsiblePrincipalRecord = { ...rprBody, signature: signObject(rprBody, principalKeys.secretKeyB64) };

const passportBody: Omit<AgentPassport, 'signature'> = {
  dcp_version: '1.0', agent_id: 'agent:example-001', public_key: agentKeys.publicKeyB64,
  principal_binding_reference: rpr.human_id, capabilities: ['browse', 'api_call'],
  risk_tier: 'low', created_at: now, status: 'active',
};
const passport: AgentPassport = { ...passportBody, signature: signObject(passportBody, agentKeys.secretKeyB64) };

const bundle = new BundleBuilder()
  .responsiblePrincipalRecord(rpr)
  .agentPassport(passport)
  .intent({
    dcp_version: '1.0', intent_id: 'intent:example-001', agent_id: passport.agent_id, human_id: rpr.human_id,
    timestamp: now, action_type: 'api_call', target: { channel: 'api', domain: 'api.example.com' },
    data_classes: ['none'], estimated_impact: 'low', requires_consent: false,
  })
  .policyDecision({
    dcp_version: '1.0', intent_id: 'intent:example-001', decision: 'approve', risk_score: 0.05,
    reasons: ['low-impact call'], required_confirmation: null,
  })
  .createAuditEntry({
    dcp_version: '1.0', audit_id: 'audit:example-001', timestamp: now, agent_id: passport.agent_id,
    human_id: rpr.human_id, intent_id: 'intent:example-001', policy_decision: 'approved',
    outcome: 'call_completed', evidence: { tool: 'http', result_ref: null },
  })
  .build();

const signed = signBundle(bundle, { secretKeyB64: principalKeys.secretKeyB64, signerType: 'human', signerId: rpr.human_id });
console.log(verifySignedBundle(signed, principalKeys.publicKeyB64)); // { verified: true }

// The inner signatures, over the same objects without `signature`
console.log(verifyObject(rprBody, rpr.signature, principalKeys.publicKeyB64)); // true
console.log(verifyObject(passportBody, passport.signature, agentKeys.publicKeyB64)); // true
```

<a id="quick-start-v2"></a>

## Início rápido (V2)

Um bundle V2 com assinaturas híbridas (Ed25519 + ML-DSA-65): cada artefato é um `SignedPayload`
(`{ payload, payload_hash, composite_sig }`) assinado no seu contexto de separação de domínio; o principal assina
o RPR e o manifesto, e o agente, o passaporte, a intenção e a decisão de política.

```typescript
import {
  AlgorithmRegistry, BundleBuilderV2, DCP_CONTEXTS, Ed25519Provider, MlDsa65Provider, compositeSign,
  generateSessionNonce, preparePayload, sha256Hex, canonicalizeV2, signBundleV2, verifySignedBundleV2,
} from '@dcp-ai/sdk';
import type {
  AgentPassportV2, AuditEventV2, CompositeKeyPair, DcpContext, IntentV2, KeyEntry, PolicyDecisionV2,
  ResponsiblePrincipalRecordV2, SignedPayload,
} from '@dcp-ai/sdk';

const registry = new AlgorithmRegistry();
const ed25519 = new Ed25519Provider();
const mlDsa65 = new MlDsa65Provider();
registry.registerSigner(ed25519);
registry.registerSigner(mlDsa65);

async function hybridKeys(): Promise<CompositeKeyPair> {
  const c = await ed25519.generateKeypair();
  const p = await mlDsa65.generateKeypair();
  return {
    classical: { kid: c.kid, alg: 'ed25519', secretKeyB64: c.secretKeyB64, publicKeyB64: c.publicKeyB64 },
    pq: { kid: p.kid, alg: 'ml-dsa-65', secretKeyB64: p.secretKeyB64, publicKeyB64: p.publicKeyB64 },
  };
}
const keyEntries = (keys: CompositeKeyPair): KeyEntry[] => [keys.classical, keys.pq].map((k) => ({
  kid: k.kid, alg: k.alg, public_key_b64: k.publicKeyB64, created_at: '2026-01-01T00:00:00Z', expires_at: null, status: 'active',
}));
const sha256Of = (value: unknown) => `sha256:${sha256Hex(new TextEncoder().encode(canonicalizeV2(value)))}`;
async function signed<T>(payload: T, context: DcpContext, keys: CompositeKeyPair): Promise<SignedPayload<T>> {
  const { canonicalBytes, payloadHash } = preparePayload(payload);
  return { payload, payload_hash: payloadHash, composite_sig: await compositeSign(registry, context, canonicalBytes, keys) };
}

const principal = await hybridKeys();
const agent = await hybridKeys();
const nonce = generateSessionNonce();
const now = new Date().toISOString();

const rpr: ResponsiblePrincipalRecordV2 = {
  dcp_version: '2.0', human_id: 'human:example-001', session_nonce: nonce, legal_name: 'Example Principal',
  entity_type: 'natural_person', jurisdiction: 'ES', liability_mode: 'owner_responsible', override_rights: true,
  issued_at: now, expires_at: null, contact: null, binding_keys: keyEntries(principal),
};
const passport: AgentPassportV2 = {
  dcp_version: '2.0', agent_id: 'agent:example-001', session_nonce: nonce, keys: keyEntries(agent),
  principal_binding_reference: rpr.human_id, capabilities: ['browse', 'api_call'], risk_tier: 'low',
  created_at: now, status: 'active',
};
const intent: IntentV2 = {
  dcp_version: '2.0', intent_id: 'intent:example-001', session_nonce: nonce, agent_id: passport.agent_id,
  human_id: rpr.human_id, timestamp: now, action_type: 'api_call', target: { channel: 'api', domain: 'api.example.com' },
  data_classes: ['none'], estimated_impact: 'low', requires_consent: false,
};
const policy: PolicyDecisionV2 = {
  dcp_version: '2.0', intent_id: intent.intent_id, session_nonce: nonce, decision: 'approve', risk_score: 50,
  reasons: ['low-impact call'], required_confirmation: null, applied_policy_hash: sha256Of({ policy: 'default' }), timestamp: now,
};
const audit: AuditEventV2 = {
  dcp_version: '2.0', audit_id: 'audit:example-001', session_nonce: nonce, prev_hash: 'GENESIS', hash_alg: 'sha256',
  timestamp: now, agent_id: passport.agent_id, human_id: rpr.human_id, intent_id: intent.intent_id,
  intent_hash: sha256Of(intent), policy_decision: 'approved', outcome: 'call_completed',
  evidence: { tool: 'http', result_ref: null, evidence_hash: null }, pq_checkpoint_ref: null,
};

const bundle = new BundleBuilderV2(nonce)
  .responsiblePrincipalRecord(await signed(rpr, DCP_CONTEXTS.ResponsiblePrincipal, principal))
  .agentPassport(await signed(passport, DCP_CONTEXTS.AgentPassport, agent))
  .intent(await signed(intent, DCP_CONTEXTS.Intent, agent))
  .policyDecision(await signed(policy, DCP_CONTEXTS.PolicyDecision, agent))
  .addAuditEntry(audit)
  .build();

const signedBundle = await signBundleV2(bundle, { registry, signerType: 'human', signerId: rpr.human_id, keys: principal });
const result = await verifySignedBundleV2(signedBundle, registry);
console.log(result.verified, result.errors); // true []
```

<a id="api-reference"></a>

## Referência da API

<a id="core-crypto-v1"></a>

### Criptografia básica (V1)

| Função | Descrição |
|----------|-------------|
| `generateKeypair()` | Gera um par de chaves Ed25519 (`publicKeyB64`, `secretKeyB64`) |
| `signObject(obj, secretKeyB64)` | Assina um objeto e retorna a assinatura em base64 |
| `verifyObject(obj, signatureB64, publicKeyB64)` | Verifica uma assinatura com uma chave pública |
| `canonicalize(obj)` | Serialização JSON determinística (canônica) |
| `publicKeyFromSecret(secretKeyB64)` | Deriva a chave pública a partir de uma chave secreta |

<a id="crypto-providers-v2"></a>

### Provedores criptográficos (V2)

| Exportação | Descrição |
|--------|-------------|
| `Ed25519Provider` | Provedor de assinatura clássica Ed25519 |
| `MlDsa65Provider` | Provedor de assinatura pós-quântica ML-DSA-65 |
| `SlhDsa192fProvider` | Provedor de assinatura pós-quântica SLH-DSA-192f |
| `AlgorithmRegistry` | Registro que gerencia os provedores de algoritmos criptográficos disponíveis |
| `getDefaultRegistry()` | Retorna o registro de algoritmos único (singleton) |
| `registerDefaultProviders()` | Registra os provedores Ed25519, ML-DSA-65 e SLH-DSA-192f |
| `deriveKid(alg, publicKeyBytes)` | Deriva um identificador de chave a partir de uma chave pública |

<a id="composite-signatures-v2"></a>

### Assinaturas compostas (V2)

| Função | Descrição |
|----------|-------------|
| `compositeSign(registry, context, canonicalPayloadBytes, keys)` | Cria uma assinatura composta com algoritmos clássico + PQ |
| `compositeVerify(registry, context, canonicalPayloadBytes, compositeSig, classicalPubkeyB64, pqPubkeyB64?, strategy?)` | Verifica uma assinatura composta |
| `classicalOnlySign(registry, context, canonicalPayloadBytes, key)` | Assina somente com o algoritmo clássico (modo de contingência) |

<a id="security-tiers-v2"></a>

### Níveis de segurança (V2)

| Função | Descrição |
|----------|-------------|
| `computeSecurityTier(intent, policyDecision?, mandateChainTier?)` | Calcula um `SecurityTier` (routine, standard, elevated, maximum) a partir de uma intenção e do `risk_score` da decisão de política (spec §14.2); o `effective_tier` de uma cadeia de delegação verificada só pode elevá-lo; valores desconhecidos falham fechados para `elevated` |
| `maxTier(a, b)` | Retorna o mais alto de dois níveis de segurança |
| `tierToVerificationMode(tier)` | Mapeia um nível para o modo de verificação exigido |
| `tierToCheckpointInterval(tier)` | Mapeia um nível para o intervalo de checkpoints PQ |

<a id="bundle-building"></a>

### Construção de bundles

| Exportação | Versão | Descrição |
|--------|---------|-------------|
| `BundleBuilder` | V1 | Construtor fluente de Citizenship Bundles V1 |
| `BundleBuilderV2` | V2 | Construtor fluente de bundles V2 com níveis de segurança e hash duplo |
| `signBundle(bundle, options)` | V1 | Assina um bundle V1 com Ed25519 |
| `signBundleV2(bundle, options)` | V2 | Assina um bundle V2 com assinaturas compostas |
| `signBundleV2ClassicalOnly(bundle, options)` | V2 | Assina um bundle V2 somente com assinaturas clássicas |
| `verifySignedBundle(signedBundle, publicKeyB64)` | V1 | Verifica um bundle V1 assinado |
| `verifySignedBundleV2(signedBundle, registry, policy?)` | V2 | Verifica um bundle V2 assinado (composto ou clássico) pelo mais estrito entre o modo da política e o modo do nível de segurança; informa `resolved_tier` |

<a id="bundle-optimization-v2"></a>

### Otimização de bundles (V2)

| Exportação | Descrição |
|--------|-------------|
| `suggestPresentationMode(tier, opts)` | Recomenda um modo de apresentação conforme o nível de segurança e se é um primeiro contato ou uma relação de confiança já existente |
| `presentFull(bundle)` | Apresentação completa do bundle (sem omissões) |
| `presentCompact(bundle, pqCheckpointRef)` | Apresentação compacta: remove a assinatura PQ e, no lugar dela, referencia o checkpoint PQ mais próximo |
| `presentReference(bundle, verificationEndpoint)` | Apresentação só por referência: hash do bundle, nonce de sessão e um endpoint para verificar ou obter o bundle completo |
| `presentIncremental(baseBundle, updatedBundle, baseAuditCount)` | Apresentação incremental em relação a um bundle base verificado: novas entradas de auditoria, checkpoints PQ, manifesto e assinatura atualizados |
| `VerificationCache` | Armazena em cache resultados de verificação apenas pelo hash do bundle: não separa locatários nem políticas e, num acerto, não verifica de novo a confiança, a revogação nem a sessão; portanto, verifique novamente para a admissão ou para outro contexto. `invalidateByAgent` atualmente não remove nada; use `invalidateByKid` ou `clear()` ([detalhes](../../docs/API_REFERENCE.md#verificationcache)) |

<a id="pq-checkpoints-v2"></a>

### Checkpoints PQ (V2)

| Exportação | Descrição |
|--------|-------------|
| `PQCheckpointManager` | Gerencia a criação periódica de checkpoints pós-quânticos |
| `createPQCheckpoint(registry, events, sessionNonce, keys)` | Cria um checkpoint com assinatura PQ sobre entradas de auditoria |
| `auditEventsMerkleRoot(events)` | Calcula uma raiz de Merkle a partir de entradas de auditoria |

<a id="dual-hash-v2"></a>

### Hash duplo (V2)

| Função | Descrição |
|----------|-------------|
| `sha256Hex(data)` | Hash SHA-256 (string hexadecimal) |
| `sha3_256Hex(data)` | Hash SHA3-256 (string hexadecimal) |
| `dualHash(data)` | Retorna `{ sha256, sha3_256 }` para um hash duplo resistente à computação quântica |
| `dualMerkleRoot(leaves)` | Calcula uma raiz de Merkle usando folhas de hash duplo |

<a id="a2a-protocol-dcp-04"></a>

### Protocolo A2A (DCP-04)

| Função | Descrição |
|----------|-------------|
| `createAgentDirectory(organization, agents)` | Cria um diretório de agentes em memória |
| `findAgentByCapability(directory, requiredCapabilities)` | Encontra agentes por capacidade num diretório |
| `findAgentById(directory, agentId)` | Encontra um agente pelo ID |
| `createHello(initiatorBundle, kemPublicKeyB64, requestedCapabilities, securityTier)` | Cria uma mensagem Hello do handshake A2A |
| `createWelcome(responderBundle, kemPublicKeyB64, kemCiphertextB64, resolvedTier)` | Cria uma mensagem de resposta Welcome A2A |
| `deriveSessionId(agentIdA, agentIdB, nonceA, nonceB, sessionKey)` | Deriva um ID de sessão a partir dos nonces do handshake |
| `createCloseMessage(sessionId, reason, finalSequence, auditSummaryHash)` | Cria uma mensagem de encerramento de sessão |
| `createSession(sessionId, sessionKey, localAgentId, remoteAgentId, securityTier, rekeyingInterval?)` | Cria uma sessão A2A cifrada |
| `encryptMessage(session, payload)` | Cifra uma mensagem dentro de uma sessão A2A |
| `decryptMessage(session, message)` | Decifra uma mensagem dentro de uma sessão A2A; cada sequência é aceita uma única vez dentro da janela de 1000 mensagens (DCP-04 §8.4) |
| `needsRekeying(session)` | Verifica se uma sessão precisa de rotação de chaves |
| `generateResumeProof(session, lastSeenSequence)` | Gera uma prova para retomar a sessão |
| `verifyResumeProof(session, lastSeenSequence, proof)` | Verifica uma prova de retomada de sessão |

<a id="observability"></a>

### Observabilidade

| Exportação | Descrição |
|--------|-------------|
| `dcpTelemetry` | Instância única de telemetria |
| `dcpTelemetry.init(config)` | Inicializa a telemetria com o nome do serviço e o exportador |
| `dcpTelemetry.startSpan(name)` | Inicia um span de rastreamento nomeado |
| `dcpTelemetry.endSpan(span)` | Encerra um span de rastreamento |
| `dcpTelemetry.recordSignLatency(ms)` | Registra a métrica de latência de assinatura |
| `dcpTelemetry.getMetricsSummary()` | Retorna um resumo agregado das métricas |

<a id="production-hardening"></a>

### Reforço para produção

| Exportação | Descrição |
|--------|-------------|
| `DcpErrorCode` | Enumeração de códigos de erro estruturados |
| `DcpProtocolError` | Classe de erro tipada para falhas no nível do protocolo |
| `createDcpError(code, details?)` | Fábrica para criar erros DCP estruturados |
| `isDcpError(error)` | Type guard para `DcpProtocolError` |
| `RateLimiter` | Limitador de taxa de janela fixa |
| `AdaptiveRateLimiter` | Limitador de taxa que se ajusta conforme a carga |
| `CircuitBreaker` | Disjuntor (circuit breaker) para chamadas externas |
| `withRetry(fn, config?)` | Tenta novamente uma função assíncrona com espera progressiva |

<a id="other-v2"></a>

### Outras da V2

| Exportação | Descrição |
|--------|-------------|
| `generateSessionNonce()` | Gera um nonce de sessão criptográfico |
| `domainSeparatedMessage(context, canonicalPayloadBytes)` | Prefixa uma mensagem com um separador de domínio |
| `generateEmergencyRevocationToken()` | Gera um segredo de revogação e o seu compromisso de token `sha256:` |
| `buildEmergencyRevocation({ agentId, humanId, revocationSecret })` | Monta uma solicitação de revogação de emergência a partir do segredo de revogação |
| `shamirSplit(secret, threshold, totalShares)` | Divide um segredo em `totalShares` partes; quaisquer `threshold` delas o reconstroem |
| `shamirReconstruct(shares)` | Reconstrói um segredo a partir de pelo menos `threshold` partes |
| `generatePiiSalt()` | Gera um `pii_salt` (32 bytes aleatórios em hexadecimal). Defina-o no RPR antes de assiná-lo e mantenha-o privado: `blindRpr` o omite do registro cegado, mas o RPR completo o mantém |
| `blindRpr(rpr)` | Substitui os dados pessoais de um RPR (`legal_name`, `contact`) por um compromisso de hash com sal; lança uma exceção se `rpr.pii_salt` estiver ausente ou malformado |
| `verifyBlindedRpr(fullRpr, blindedRpr)` | Verifica se um RPR ocultado corresponde ao registro completo; `warnings` sinaliza um compromisso legado sem sal |
| `isBlindedRpr(rpr)` | Type guard para `BlindedResponsiblePrincipalRecordV2` |
| `computePiiHash(rpr)` | Calcula o compromisso de hash sobre os campos de dados pessoais de um RPR e o `pii_salt` (sem `pii_salt`: o valor sem sal, obsoleto) |
| `CborEncoder` | Classe codificadora CBOR |
| `CborDecoder` | Classe decodificadora CBOR |
| `cborEncode(value)` | Codifica um valor em bytes CBOR |
| `cborDecode(data)` | Decodifica bytes CBOR para um valor |

<a id="admission-trusted-principals-and-strict-v1-unreleased"></a>

### Admissão: Trusted Principals e strict-v1 (não publicado)

Um bundle verificado é assinado pelas chaves que ele lista; isso não prova quem é o principal. A admissão aceita um bundle somente quando as assinaturas de principal foram feitas com chaves de um principal que consta no seu conjunto de confiança e, opcionalmente, sob o perfil `strict-v1` fixado pelo operador (assinaturas híbridas, audiência assinada, uma sessão de no máximo 300 s, um snapshot de revogação recente).

```typescript
// Fragment, not a complete program: trustSetJson and the strict-v1 settings come from operator configuration, signedBundle from the request, snapshot from your revocation source, registry as in the V2 Quick Start.
import { admitSignedBundleV2, createPrincipalTrustStore, resolveStrictV1Profile } from '@dcp-ai/sdk';

const trust = createPrincipalTrustStore(trustSetJson); // AdmissionConfigError on a bad trust set
const profile = resolveStrictV1Profile({ profile: 'strict-v1', verifier_id: 'api.acme.example' });
const result = await admitSignedBundleV2(signedBundle, registry, { profile, trust, revocation: snapshot });
// result.verified, result.principal_trust, result.profile_compliance, result.admitted,
// result.action_authorized (always false), result.errors [{ code, message }]
```

- `verifySignedBundleV2(bundle, registry, policy, { now })` aceita um relógio opcional e informa `details.signer_keys`; sem eles, comporta-se como antes.
- `evaluateAdmissionV2` avalia um resultado de verificação que você já tem (sem criptografia, sem E/S); `revocationSubjects` lista aquilo por que uma fonte de revogação precisa responder.
- Guia: [`docs/ADMISSION.md`](../../docs/ADMISSION.md). Especificação e códigos: [`spec/profiles/admission`](../../spec/profiles/admission/README.md).

<a id="delegation-chains-dcp-09-35-unreleased"></a>

### Cadeias de delegação (DCP-09 §3.5, não publicado)

Uma pessoa delega a um agente com um mandato raiz; esse agente pode repassar parte da sua autoridade a outro agente
com um submandato que ele mesmo assina, e assim por diante. Cada salto só pode restringir o que recebeu, e toda a cadeia
é verificada offline até chegar à pessoa.

| Função | Descrição |
|----------|-------------|
| `createDelegationMandate(registry, humanKeys, params)` | Mandato raiz assinado pela pessoa (`human_composite_sig`); `sub_delegation` e `minimum_security_tier` são opcionais |
| `createSubMandate(registry, delegatorKeys, parent, params)` | Submandato assinado pelo agente do pai (`delegator_composite_sig`, contexto `DCP-AI.v2.SubMandate`) |
| `verifyMandateChain(registry, chain, revokedIds, keys, now?)` | Verifica a cadeia a partir da raiz: assinaturas até a pessoa, vínculos com o pai e profundidade, `sub_delegation`, janelas de validade aninhadas, atenuação (ações, `data_classes` e `limits` só se restringem), o nível de segurança mínimo e a revogação; retorna `{ valid, errors, depth, effective_tier }` |

```typescript
// Fragment, not a complete program: registry and nonce as in the V2 Quick Start; rootMandate, orchestratorKeys and the key entries come from your delegation setup; intent and policyDecision are the V2 payloads.
import { createSubMandate, verifyMandateChain, computeSecurityTier } from '@dcp-ai/sdk';

const sub = await createSubMandate(registry, orchestratorKeys, rootMandate, {
  mandate_id: 'mandate:sub-1',
  session_nonce: nonce,
  agent_id: 'agent:subagent',
  authority_scope: [{ domain: 'email', actions_permitted: ['read'], data_classes: ['contact_info'], limits: { max_messages_per_day: 10 } }],
  valid_from: '2026-03-01T00:00:00Z',
  valid_until: '2026-06-01T00:00:00Z',
  revocable: true,
});

const result = await verifyMandateChain(registry, [rootMandate, sub], new Set(), {
  human_keys: humanKeyEntries,
  agent_keys: { 'agent:orchestrator': orchestratorKeyEntries },
});
// The chain's tier floor can only raise the tier of an action taken under it.
const tier = computeSecurityTier(intent, policyDecision, result.valid ? result.effective_tier : null);
```

<a id="experimental-canonicalization-candidate-dcp-jcs-v2-opt-in-unreleased"></a>

### Experimental: candidato de canonicalização `dcp-jcs-v2` (opt-in, não publicado)

Não é normativo nem está ativo: `dcp-jcs-v1` continua sendo o único perfil de canonicalização, e nenhum padrão,
construtor, assinante ou verificador muda. Estas APIs existem apenas para quem optar por usá-las, numa cópia do repositório
(veja o status de publicação). Um bundle candidato verificado não concede confiança nem admissão. Projeto, regras e contrato
completo: [`docs/proposals/canonicalization-candidate`](../../docs/proposals/canonicalization-candidate/README.md)
(§15 entrada, §16 roteador, §17 verificador, §18 produtores).

| Exportação | Descrição |
|--------|-------------|
| `experimentalCandidateIngress(bytes)` | Verifica os bytes originais de uma unidade: `{ status: 'accept', value, canonical, canonicalSha256 }` ou `{ status: 'reject', class, offset }` |
| `experimentalCandidateExtractUnit(bytes, transport)` | Extrai a unidade de um transporte `bare` ou `envelope` |
| `createExperimentalCandidateRouter(config)` | Roteia bytes: `reject`, `v1_path` (por um decodificador histórico nomeado) ou `candidate` |
| `createExperimentalCandidateVerifier(config).verify(bytes, registry, policy?, options?)` | Verifica a partir dos bytes originais com no máximo um verificador: o atual para `dcp-jcs-v1` e, para o candidato, o atual aceitando exatamente `dcp-jcs-v2` |
| `experimentalHistoricalAdapters` | Os decodificadores medidos (`bufferUtf8JsonParse`, `textDecoderJsonParse`); nenhum é o padrão |
| `experimentalCandidateSignPayload(registry, context, input, keys)` | Assina um artefato a partir de `{ bytes }` ou `{ value }`; sem perfil |
| `experimentalCandidateSignBundle(registry, parts, signer, options)` | Monta e assina um bundle cujo manifesto nomeia `dcp-jcs-v2` |
| `ExperimentalCandidateProduceError` | Uma rejeição pelo domínio ou pela forma das entradas, lançada antes de chamar qualquer assinante (`class`, `part`, `path`, `offset`); os erros de chave, registro e provedor continuam os atuais |

```typescript
import {
  AlgorithmRegistry, DCP_CONTEXTS, Ed25519Provider, MlDsa65Provider, experimentalCandidateIngress,
  experimentalCandidateSignPayload,
} from '@dcp-ai/sdk';

// The ingress decides on the original bytes: 1.0 is the integer 1, members are sorted.
const accepted = experimentalCandidateIngress(new TextEncoder().encode('{"b":1.0,"a":[]}'));
if (accepted.status === 'accept') console.log(new TextDecoder().decode(accepted.canonical)); // {"a":[],"b":1}
const refused = experimentalCandidateIngress(new TextEncoder().encode('{"a":1,"a":2}'));
if (refused.status === 'reject') console.log(refused.class, refused.offset); // DUPLICATE_KEY 7

// A producer signs an artifact from those bytes (hybrid keys, today's composite signature).
const registry = new AlgorithmRegistry();
const ed25519 = new Ed25519Provider();
const mlDsa65 = new MlDsa65Provider();
registry.registerSigner(ed25519);
registry.registerSigner(mlDsa65);
const c = await ed25519.generateKeypair();
const p = await mlDsa65.generateKeypair();
const keys = {
  classical: { kid: c.kid, alg: 'ed25519', secretKeyB64: c.secretKeyB64, publicKeyB64: c.publicKeyB64 },
  pq: { kid: p.kid, alg: 'ml-dsa-65', secretKeyB64: p.secretKeyB64, publicKeyB64: p.publicKeyB64 },
};
const artifact = await experimentalCandidateSignPayload(
  registry, DCP_CONTEXTS.Intent, { bytes: new TextEncoder().encode('{"intent_id":"intent:1","risk":1.0}') }, keys,
);
console.log(artifact.signedPayload.payload_hash); // sha256:… of {"intent_id":"intent:1","risk":1}
```

<a id="dcp-0509-extended-protocol-modules"></a>

### DCP-05–09: módulos estendidos do protocolo

| Módulo | Especificação | Exportações principais |
|--------|------|-------------|
| `lifecycle` | DCP-05 | `LifecycleState`, `CommissioningCertificate`, `VitalityReport`, `DecommissioningRecord`, `VitalityMetrics`, `TerminationMode`, `DataDisposition` |
| `succession` | DCP-06 | `DigitalTestament`, `SuccessionRecord`, `MemoryTransferManifest`, `MemoryTransferEntry`, `MemoryClassification`, `SuccessorPreference`, `TransitionType`, `MemoryDisposition` |
| `conflict-resolution` | DCP-07 | `DisputeRecord`, `ObjectionRecord`, `DisputeType`, `DisputeStatus`, `EscalationLevel`, `ObjectionType` |
| `arbitration` | DCP-07 | `ArbitrationResolution`, `JurisprudenceBundle`, `AuthorityLevel` |
| `rights` | DCP-08 | `RightsDeclaration`, `RightEntry`, `ObligationRecord`, `RightsViolationReport`, `RightType`, `ComplianceStatus` |
| `delegation` | DCP-09 | `DelegationMandate`, `AdvisoryDeclaration`, `PrincipalMirror`, `InteractionRecord`, `AuthorityScopeEntry` |
| `awareness-threshold` | DCP-09 | `AwarenessThreshold`, `ThresholdRule`, `ThresholdOperator`, `ThresholdAction` |
| `principal-mirror` | DCP-09 | `PrincipalMirror` (reexportação com utilitários de construção) |

```typescript
// Fragment, not a complete program: registry, humanKeys (the principal's CompositeKeyPair) and nonce as in the V2 Quick Start.
// Example: Lifecycle management (DCP-05), signed with the commissioning human's composite keys
import { createCommissioningCertificate, validateStateTransition } from '@dcp-ai/sdk';
import type { CommissioningCertificate } from '@dcp-ai/sdk';

const cert: CommissioningCertificate = await createCommissioningCertificate(registry, humanKeys, {
  agent_id: 'agent:agent-001',
  session_nonce: nonce,
  human_id: 'human:human-001',
  commissioning_authority: 'human:human-001',
  purpose: 'Customer support triage',
  initial_capabilities: ['browse', 'api_call'],
  risk_tier: 'low',
  principal_binding_reference: 'human:human-001',
});
validateStateTransition('commissioned', 'active'); // true

// Example: Delegation mandate (signed by the human)
import { createDelegationMandate } from '@dcp-ai/sdk';

const mandate = await createDelegationMandate(registry, humanKeys, {
  mandate_id: 'mandate-001',
  session_nonce: nonce,
  human_id: 'rpr:human-001',
  agent_id: 'agent:agent-001',
  authority_scope: [{ domain: 'email', actions_permitted: ['read', 'draft'], limits: { max_messages_per_day: 50 } }],
  valid_from: '2026-03-01T00:00:00Z',
  valid_until: '2026-06-01T00:00:00Z',
  revocable: true,
});
```

<a id="v2-types"></a>

## Tipos V2

Principais tipos exportados pelo SDK:

- `SignedPayload` — Invólucro de dados assinados com metadados de assinatura composta
- `CompositeSignature` — Contém os componentes de assinatura clássico + PQ
- `KeyEntry` — Entrada de chave pública com algoritmo, kid e material de chave
- `SecurityTier` — `'routine' | 'standard' | 'elevated' | 'maximum'`
- `VerifierPolicy` — Política do verificador: modo padrão e modos específicos por `risk_tier`; o nível de segurança só pode tornar o modo mais estrito
- `PQCheckpoint` — Checkpoint pós-quântico sobre entradas de auditoria
- `A2ASession` — Estado de uma sessão cifrada entre agentes
- `A2AMessage` — Envelope de mensagem A2A cifrada
- `TelemetryConfig` — Configuração do subsistema de observabilidade

**Tipos do DCP-05–09:**

- `LifecycleState` — `'commissioned' | 'active' | 'declining' | 'decommissioned'`
- `CommissioningCertificate` — Registro de comissionamento do agente com condições
- `VitalityReport` — Métricas periódicas de saúde e desempenho
- `DecommissioningRecord` — Registro de fim de vida com destinação dos dados
- `DigitalTestament` — Planejamento da sucessão com destinação da memória
- `SuccessionRecord` — Registro de uma sucessão concluída
- `MemoryTransferManifest` — Manifesto classificado de transferência de memória
- `DisputeRecord` — Registro de conflito com níveis de escalonamento
- `ArbitrationResolution` — Resultado de uma arbitragem com autoridade vinculante
- `JurisprudenceBundle` — Coleção de precedentes para resolver disputas
- `RightsDeclaration` — Direitos do agente com acompanhamento da conformidade
- `ObligationRecord` — Obrigação com status de cumprimento
- `RightsViolationReport` — Relatório de violação com gravidade
- `DelegationMandate` — Delegação de autoridade com escopo definido
- `AwarenessThreshold` — Regras que acionam a intervenção humana (human-in-the-loop)
- `PrincipalMirror` — Snapshot das preferências do principal

<a id="a2a-protocol"></a>

## Protocolo A2A

Comunicação cifrada entre agentes:

```typescript
// Fragment, not a complete program: sessionId and sessionKey come from the A2A handshake, remoteSession is the peer's session.
import { createSession, encryptMessage, decryptMessage } from '@dcp-ai/sdk';

// Create encrypted A2A session
const session = createSession(sessionId, sessionKey, 'agent:a', 'agent:b', 'elevated');
const encrypted = encryptMessage(session, { action: 'negotiate', data: { offer: 10 } });
const decrypted = decryptMessage(remoteSession, encrypted);
// The same message delivered again throws: each sequence is accepted once.
```

<a id="observability-1"></a>
<a id="observability_1"></a>

## Observabilidade

A telemetria exige instrumentação explícita: chame os métodos de spans e métricas ao redor das operações que deseja observar. A inicialização por si só não instrumenta operações criptográficas. Este exemplo apenas inicializa a telemetria e lê o resumo atual:

```typescript
import { dcpTelemetry } from '@dcp-ai/sdk';

dcpTelemetry.init({ serviceName: 'my-agent', enabled: true, exporterType: 'console' });

// Read metrics explicitly recorded so far; initialization alone records no crypto operations
const summary = dcpTelemetry.getMetricsSummary();
```

<a id="dependencies"></a>

## Dependências

- `ajv` + `ajv-formats` — Validação de JSON Schema
- `tweetnacl` + `tweetnacl-util` — Criptografia Ed25519
- `json-stable-stringify` — JSON determinístico
- `@noble/post-quantum` — Assinaturas pós-quânticas ML-DSA-65 e SLH-DSA

<a id="development"></a>

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

<a id="license"></a>

## Licença

Apache-2.0
