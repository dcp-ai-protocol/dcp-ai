<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · **Português**</sub>

<a id="specs--dcp-ai-normative"></a>
<a id="specs-dcp-ai-normative"></a>

# Especificações — DCP-AI normativo

> Tradução informativa da [versão em inglês](README.md), atualizada em 25/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Especificações normativas do Digital Citizenship Protocol for AI Agents. A fonte da verdade dos formatos é o JSON Schema em `schemas/v1/` e `schemas/v2/`; estes documentos definem o escopo, os artefatos e como validá-los.

<a id="foundation-specifications-dcp-01--dcp-03"></a>
<a id="foundation-specifications-dcp-01-dcp-03"></a>

## Especificações fundamentais (DCP-01 – DCP-03)

| Especificação | Escopo | Artefatos |
|------|-------|-----------|
| [DCP-01](DCP-01.md) | Identidade e vinculação ao principal | Responsible Principal Record, Agent Passport, Revocation Record |
| [DCP-02](DCP-02.md) | Declaração de intenção e controle por política | Intent, PolicyDecision, HumanConfirmation (opcional) |
| [DCP-03](DCP-03.md) | Cadeia de auditoria e transparência | AuditEntry, encadeamento por prev_hash, Merkle opcional |
| [BUNDLE](BUNDLE.md) | Citizenship Bundle e Signed Bundle | Citizenship Bundle (L3), Signed Bundle (assinatura Ed25519, bundle_hash, merkle_root) |
| [VERIFICATION](VERIFICATION.md) | Lista de verificação | Passos normativos para verificar um Signed Bundle (schema, assinatura, expiração, revogação, intent_hash, cadeia de auditoria, Merkle; tudo local) |

**Validação** (`dcp` é a CLI de referência de um checkout, `node bin/dcp.js`): `dcp validate <schema> <json>`, `dcp validate-bundle <bundle.json>`, `dcp verify-bundle [--policy <mode>] <signed.json> [public_key.txt]`, `dcp intent-hash <intent.json>`.
**Conformidade:** `npm run conformance` valida L3-OBJECTS + L3-BUNDLE + L3-SIGNED + intent_hash e a cadeia de prev_hash.

Estes comandos e o DCP-01 ao DCP-03 descrevem os artefatos V1; os artefatos e as verificações V2 estão no
[DCP-AI v2.0](DCP-AI-v2.0.md) e na lista de verificação V2 de [VERIFICATION](VERIFICATION.md). Um bundle que é verificado é coerente
e assinado pelas chaves que lista; a confiança no seu principal é um passo à parte ([docs/ADMISSION.md](../docs/ADMISSION.md)).

---

<a id="communication--cryptography-dcp-04-v20"></a>
<a id="communication-cryptography-dcp-04-v20"></a>

## Comunicação e criptografia (DCP-04, v2.0)

| Documento | Escopo |
|----------|-------|
| [DCP-04](DCP-04.md) | Comunicação entre agentes |
| [DCP-AI v2.0](DCP-AI-v2.0.md) | Especificação normativa pós-quântica |
| [Perfil de canonicalização](CANONICALIZATION_PROFILE.md) | `dcp-jcs-v1` — canonicalização JSON exata byte a byte para cada assinatura, hash e folha de Merkle |
| [Auditoria de segurança](AUDIT-v2.0-FINAL.md) | Auditoria de segurança final da v2.0 de 26/02/2026 (13 lacunas fechadas); um registro histórico, com um aviso sobre o que revisões posteriores ressalvaram |

---

<a id="constitutional-framework-dcp-05--dcp-09"></a>
<a id="constitutional-framework-dcp-05-dcp-09"></a>

## Quadro constitucional (DCP-05 – DCP-09)

Especificações que regem o ciclo de vida do agente, a sucessão, a resolução de disputas, os direitos e a delegação: a camada constitucional do protocolo.

| Especificação | Escopo | Artefatos-chave |
|------|-------|---------------|
| [DCP-05](DCP-05.md) | Gestão do ciclo de vida do agente | CommissioningCertificate, VitalityReport, DecommissioningRecord |
| [DCP-06](DCP-06.md) | Sucessão e herança digital | DigitalTestament, SuccessionRecord, MemoryTransferManifest |
| [DCP-07](DCP-07.md) | Resolução de conflitos e arbitragem de disputas | DisputeRecord, ArbitrationResolution, JurisprudenceBundle, ObjectionRecord |
| [DCP-08](DCP-08.md) | Quadro de direitos e obrigações | RightsDeclaration, ObligationRecord, RightsViolationReport |
| [DCP-09](DCP-09.md) | Representação pessoal e delegação | DelegationMandate, AdvisoryDeclaration, PrincipalMirror, AwarenessThreshold |

**Schemas:** 18 JSON Schemas em `schemas/v2/` que cobrem todos os artefatos do DCP-05–09.
**Endpoints do servidor:** 31 endpoints REST no servidor de verificação de referência, sem autenticação nem verificação de assinaturas (veja [OPERATOR_GUIDE](../docs/OPERATOR_GUIDE.md#dcp-0509-service-endpoints)).
**Separação de domínios:** 7 contextos novos — `Lifecycle`, `Succession`, `Dispute`, `Rights`, `Delegation`, `Awareness`, `SubMandate`.

---

<a id="core-and-profiles"></a>

## Núcleo e perfis

A especificação está sendo organizada em um **núcleo** (protocolo mínimo interoperável) e **perfis** (extensões para necessidades específicas de implantação):

| Diretório | Escopo |
|-----------|-------|
| [core/](core/) | Núcleo do DCP — artefatos, modelo de verificação, estrutura do bundle |
| [profiles/](profiles/) | Perfis — extensões crypto, A2A e de governança |
| [profiles/crypto/](profiles/crypto/) | Seleção de algoritmos, assinaturas compostas, agilidade criptográfica |
| [profiles/a2a/](profiles/a2a/) | Descoberta de agentes, handshake, gestão de sessões |
| [profiles/governance/](profiles/governance/) | Níveis de risco, jurisdição, revogação, recuperação de chaves |
| [profiles/admission/](profiles/admission/) | Admissão: principais confiáveis e o perfil strict-v1 (nos SDKs em `main`, ainda não publicado) |

As especificações existentes (do DCP-01 ao DCP-09, BUNDLE, VERIFICATION, DCP-AI v2.0) continuam sendo a referência. Os documentos do núcleo e dos perfis oferecem contexto editorial e esclarecem a separação de responsabilidades. Veja o [ROADMAP](../ROADMAP.md) para a evolução prevista.
