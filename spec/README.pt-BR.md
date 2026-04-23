<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · **Português**</sub>

# Specs — DCP-AI normativas

Especificações normativas para o Digital Citizenship Protocol for AI Agents. A fonte de verdade para os formatos está em JSON Schema em `schemas/v1/` e `schemas/v2/`; estes documentos definem o escopo, artefatos e como validar.

## Especificações Fundamentais (DCP-01 – DCP-03)

| Spec | Escopo | Artefatos |
|------|--------|-----------|
| [DCP-01](DCP-01.md) | Identity & Principal Binding | Responsible Principal Record, Agent Passport, Revocation Record |
| [DCP-02](DCP-02.md) | Intent Declaration & Policy Gating | Intent, PolicyDecision, HumanConfirmation (opcional) |
| [DCP-03](DCP-03.md) | Audit Chain & Transparency | AuditEntry, encadeamento por prev_hash, Merkle opcional |
| [BUNDLE](BUNDLE.md) | Citizenship Bundle & Signed Bundle | Citizenship Bundle (L3), Signed Bundle (assinatura Ed25519, bundle_hash, merkle_root) |
| [VERIFICATION](VERIFICATION.md) | Checklist de verificação | Passos normativos para verificar um Signed Bundle (schema, assinatura, expiração, revogação, intent_hash, cadeia de auditoria, merkle; tudo local) |

**Validação:** `dcp validate <schema> <json>`, `dcp validate-bundle <bundle.json>`, `dcp verify-bundle <signed.json> <public_key.txt>`, `dcp intent-hash <intent.json>`.
**Conformance:** `npm run conformance` valida L3-OBJECTS + L3-BUNDLE + L3-SIGNED + cadeia de intent_hash e prev_hash.

---

## Comunicação e Criptografia (DCP-04, v2.0)

| Documento | Escopo |
|-----------|--------|
| [DCP-04](DCP-04.md) | Agent-to-Agent Communication |
| [DCP-AI v2.0](DCP-AI-v2.0.md) | Post-Quantum Normative Specification |
| [Security Audit](AUDIT-v2.0-FINAL.md) | Auditoria de Segurança Final v2.0 (13 gaps fechados) |

---

## Framework Constitucional (DCP-05 – DCP-09)

Especificações que governam ciclo de vida do agente, sucessão, resolução de disputas, direitos e delegação — a camada constitucional do protocolo.

| Spec | Escopo | Artefatos-Chave |
|------|--------|-----------------|
| [DCP-05](DCP-05.md) | Agent Lifecycle Management | CommissioningCertificate, VitalityReport, DecommissioningRecord |
| [DCP-06](DCP-06.md) | Digital Succession & Inheritance | DigitalTestament, SuccessionRecord, MemoryTransferManifest |
| [DCP-07](DCP-07.md) | Conflict Resolution & Dispute Arbitration | DisputeRecord, ArbitrationResolution, JurisprudenceBundle, ObjectionRecord |
| [DCP-08](DCP-08.md) | Rights & Obligations Framework | RightsDeclaration, ObligationRecord, RightsViolationReport |
| [DCP-09](DCP-09.md) | Personal Representation & Delegation | DelegationMandate, AdvisoryDeclaration, PrincipalMirror, AwarenessThreshold |

**Schemas:** 18 JSON Schemas em `schemas/v2/` cobrindo todos os artefatos DCP-05–09.
**Endpoints do servidor:** 31 endpoints REST no servidor de verificação (veja [OPERATOR_GUIDE](../docs/OPERATOR_GUIDE.md)).
**Separação de domínio:** 6 novos contextos — `Lifecycle`, `Succession`, `Dispute`, `Rights`, `Delegation`, `Awareness`.

---

## Core e Profiles

A especificação está sendo organizada em um **Core** (protocolo mínimo interoperável) e **Profiles** (extensões para necessidades específicas de implantação):

| Diretório | Escopo |
|-----------|--------|
| [core/](core/) | DCP Core — artefatos, modelo de verificação, estrutura de bundle |
| [profiles/](profiles/) | Profiles — extensões de crypto, A2A, governança |
| [profiles/crypto/](profiles/crypto/) | Seleção de algoritmos, assinaturas compostas, agilidade criptográfica |
| [profiles/a2a/](profiles/a2a/) | Descoberta de agentes, handshake, gerenciamento de sessão |
| [profiles/governance/](profiles/governance/) | Níveis de risco, jurisdição, revogação, recuperação de chave |

As specs existentes (DCP-01 a DCP-09, BUNDLE, VERIFICATION, DCP-AI v2.0) permanecem autoritativas. Os documentos de core e profile fornecem contexto editorial e esclarecem a separação de responsabilidades. Veja o [ROADMAP](../ROADMAP.md) para a evolução planejada.
