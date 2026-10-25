<sub>[English](AUDIT-v2.0-FINAL.md) · [中文](AUDIT-v2.0-FINAL.zh-CN.md) · [Español](AUDIT-v2.0-FINAL.es.md) · [日本語](AUDIT-v2.0-FINAL.ja.md) · **Português**</sub>

<a id="dcp-ai-v20-final-security-audit--all-13-gaps-verified-closed"></a>
<a id="dcp-ai-v20-final-security-audit-all-13-gaps-verified-closed"></a>

# Auditoria de segurança final do DCP-AI v2.0 — as 13 lacunas verificadas como fechadas

> Tradução informativa da [versão em inglês](AUDIT-v2.0-FINAL.md), atualizada em 25/10/2026. **Registro histórico datado**: não descreve o estado atual. Em caso de divergência, prevalece a versão em inglês.

**Data da auditoria:** 2026-02-26  
**Auditor:** DCP-AI Protocol Governance  
**Escopo:** Verificação completa do fechamento das lacunas do DCP-AI v2.0, fase 3  
**Resultado:** AS 13 LACUNAS FECHADAS  

> **Registro histórico, mantido como foi escrito.** Esta auditoria é datada de 26/02/2026. Revisões posteriores (outubro de 2026) ressalvam algumas das suas conclusões; o estado atual está nos documentos aqui vinculados, não neste registro:
>
> - **Lacuna nº 11 e a implementação de referência de HSM.** `HsmCryptoProvider` e `HsmProviderFactory` são um padrão simulado, não uma integração com HSM. Não são exportados por `@dcp-ai/sdk` e não têm vinculação PKCS#11; `sign` devolve um hash em vez de uma assinatura, e `verify` aceita qualquer assinatura do tamanho certo. Não devem ser usados para evidência real ([docs/NIST_CONFORMITY.md](../docs/NIST_CONFORMITY.md) §2.2).
> - **Lacuna nº 1.** A recuperação de chaves do SDK e `dcp recovery-setup` produzem as partes de Shamir, mas não as cifram com o KEM híbrido.
> - **Lacuna nº 4.** O servidor de referência confere a estrutura do `composite_sig` de um aviso, não a sua assinatura; o token de operador é a sua proteção ([server/README.md](../server/README.md)).
> - **Modo apenas PQ.** `pq_only` continua precisando dos bytes da assinatura clássica nos verificadores dos SDKs: a assinatura PQ os cobre sob `pq_over_classical`, então isso não significa que o componente clássico possa ser omitido.
> - **Lacuna nº 6.** Os auxiliares de hash duplo existem, mas os verificadores não recalculam `prev_hash_secondary` nem `audit_merkle_root_secondary` ([VERIFICATION.md](VERIFICATION.md), V2-11).
> - **`dcp audit gaps`** confere que arquivos existem e contêm marcadores, não o comportamento. Em 25/10/2026 ele informa a lacuna nº 7 como aberta, porque procura `integrations/fastapi/__init__.py`, que agora é `sdks/python/dcp_ai/fastapi/__init__.py`.

---

<a id="gap-verification-matrix"></a>

## Matriz de verificação das lacunas

<a id="gap-1-key-recovery-m-of-n-social-recovery"></a>

### Lacuna nº 1: Recuperação de chaves (recuperação social M de N)

- **Estado:** FECHADA
- **Implementação:** `sdks/typescript/src/core/key-recovery.ts`
- **CLI:** `dcp recovery-setup --threshold <M> --shares <N>`
- **Schema:** `schemas/v2/recovery_config.schema.json`
- **Verificação:** O esquema de Shamir divide o segredo mestre em N partes com limiar M. Partes cifradas com KEM híbrido. A recuperação exige M de N partes mais uma autenticação fora de banda.

<a id="gap-2-rpr-privacy--blinded-mode"></a>
<a id="gap-2-rpr-privacy-blinded-mode"></a>

### Lacuna nº 2: Privacidade do RPR — modo cego

- **Estado:** FECHADA
- **Implementação:** `sdks/typescript/src/core/blinded-rpr.ts`
- **Tipo:** `BlindedResponsiblePrincipalRecordV2` em `sdks/typescript/src/types/v2.ts`
- **Schema:** `schemas/v2/blinded_rpr.schema.json`
- **Verificação:** Os campos de dados pessoais são substituídos por `pii_hash`. Jurisdição, responsabilidade e chaves são mantidas. Divulgação regulatória por meio do RPR completo sob demanda.

<a id="gap-3-missing-v2-artifacts"></a>

### Lacuna nº 3: Artefatos V2 ausentes

- **Estado:** FECHADA
- **JurisdictionAttestationV2:** Tipo + schema (`schemas/v2/jurisdiction_attestation.schema.json`)
- **HumanConfirmationV2:** Tipo + schema (`schemas/v2/human_confirmation.schema.json`)
- **Verificação:** Os dois artefatos incluem assinaturas compostas e session_nonce para a vinculação de sessão.

<a id="gap-4-algorithm-deprecation-protocol"></a>

### Lacuna nº 4: Protocolo de descontinuação de algoritmos

- **Estado:** FECHADA
- **Implementação:** `sdks/typescript/src/core/algorithm-advisory.ts`
- **Resposta automatizada:** função `autoApplyAdvisoriesToPolicy()`
- **Verificação de governança:** função `verifyGovernanceAdvisory()`
- **Schema:** `schemas/v2/algorithm_advisory.schema.json`
- **Servidor:** `POST /v2/advisory/publish`, `GET /v2/advisory/check`, `POST /v2/advisory/auto-apply`
- **CLI:** `dcp advisory check [url]`
- **Verificação:** Os avisos são assinados pela governança. Os verificadores removem automaticamente algoritmos descontinuados ou revogados, acrescentam substitutos e mudam automaticamente para pq_only quando todos os algoritmos clássicos são removidos.

<a id="gap-5-multi-party-authorization"></a>

### Lacuna nº 5: Autorização de várias partes

- **Estado:** FECHADA
- **Implementação:** `sdks/typescript/src/core/multi-party-auth.ts`
- **Schema:** `schemas/v2/multi_party_authorization.schema.json`
- **Servidor:** `POST /v2/multi-party/authorize`
- **Verificação:** Assinaturas compostas M de N exigidas. O papel de proprietário é sempre obrigatório. Papéis: owner, org_admin, recovery_contact.

<a id="gap-6-dual-hash-chains"></a>

### Lacuna nº 6: Cadeias de hash duplo

- **Estado:** FECHADA
- **Implementação:** `sdks/typescript/src/core/dual-hash.ts`
- **Verificação:** SHA-256 + SHA3-256 em paralelo. AuditEventV2 inclui `prev_hash_secondary` e `intent_hash_secondary`. O manifesto do bundle inclui `audit_merkle_root_secondary`.

<a id="gap-7-python-integrations-v2"></a>

### Lacuna nº 7: Integrações Python V2

- **Estado:** FECHADA
- **FastAPI:** `integrations/fastapi/__init__.py`
- **LangChain:** `integrations/langchain/`
- **OpenAI:** `integrations/openai/`
- **CrewAI:** `integrations/crewai/`
- **Verificação:** Todas as integrações atualizadas com a configuração de identidade V2, a assinatura composta, a propagação do nonce de sessão e a verificação V2.

<a id="gap-8-grpcprotobuf-v2-messages"></a>

### Lacuna nº 8: Mensagens gRPC/Protobuf V2

- **Estado:** FECHADA
- **Implementação:** `api/proto/dcp.proto`
- **Verificação:** Tipos de mensagem V2: CompositeSignature, SignedPayload, BundleManifest, AgentPassportV2, ResponsiblePrincipalRecordV2, IntentV2, PolicyDecisionV2, AuditEventV2, PQCheckpoint, SignedBundleV2.

<a id="gap-9-cli-v2-commands"></a>

### Lacuna nº 9: Comandos V2 da CLI

- **Estado:** FECHADA
- **Implementação:** `bin/dcp.js`
- **Comandos V2:** `keygen --hybrid`, `sign-bundle --composite`, `verify-bundle --policy`, `kid`, `recovery-setup`, `emergency-revoke`, `rotate-key`, `capabilities`, `advisory check`
- **Comandos da fase 3:** `keys rotate`, `keys certify`, `governance ceremony`, `governance sign-advisory`, `governance verify-advisory`, `audit gaps`
- **Verificação:** Cobertura completa na CLI das operações V1, V2 e da fase 3.

<a id="gap-10-nist-kat-validation"></a>

### Lacuna nº 10: Validação com KAT do NIST

- **Estado:** FECHADA
- **Provedores:** `sdks/typescript/src/providers/ml-dsa-65.ts`, `slh-dsa-192f.ts`
- **Verificação:** As implementações dos provedores fazem referência às normas FIPS 204/205. Estrutura de validação com KAT definida no plano de testes. O indicador `isConstantTime` do provedor é aplicado.

<a id="gap-11-secure-memory--hsm-provider"></a>
<a id="gap-11-secure-memory-hsm-provider"></a>

### Lacuna nº 11: Memória segura / provedor HSM

- **Estado:** FECHADA
- **Memória segura:** `sdks/typescript/src/core/secure-memory.ts` — `SecureKeyGuard` com zeragem segura no descarte
- **Provedor HSM:** `sdks/typescript/src/providers/hsm-provider.ts` — implementação de referência `HsmCryptoProvider`
- **Fábrica HSM:** `HsmProviderFactory` para suporte a HSM com vários algoritmos
- **Verificação:** HsmCryptoProvider implementa a interface CryptoProvider. As chaves privadas nunca entram na memória da aplicação. Gestão de sessões PKCS#11. Suporta Ed25519, ML-DSA-65, ML-DSA-87, SLH-DSA-192f.

<a id="gap-12-version--capability-negotiation"></a>
<a id="gap-12-version-capability-negotiation"></a>

### Lacuna nº 12: Negociação de versão e capacidades

- **Estado:** FECHADA
- **Servidor:** `GET /.well-known/dcp-capabilities.json`
- **Cabeçalhos:** suporte ao cabeçalho `DCP-Version`
- **CLI:** `dcp capabilities <endpoint>`
- **Verificação:** O documento de capacidades inclui as versões, os algoritmos, os formatos de transmissão e as funcionalidades suportados, e o hash da política de verificador.

<a id="gap-13-emergency-revocation-panic-button"></a>

### Lacuna nº 13: Revogação de emergência (botão de pânico)

- **Estado:** FECHADA
- **Implementação:** `sdks/typescript/src/core/emergency-revocation.ts`
- **Schema:** `schemas/v2/emergency_revocation.schema.json`
- **Servidor:** `POST /v2/emergency-revoke` com limitação de taxa
- **CLI:** `dcp emergency-revoke --agent <id> --token <secret>`
- **Verificação:** Token de revogação registrado previamente (compromisso SHA-256). Revelar a pré-imagem revoga todas as chaves do agente. Uso único. Com limitação de taxa.

---

<a id="phase-3-specific-verifications"></a>

## Verificações específicas da fase 3

<a id="pq-only-mode"></a>

### Modo apenas PQ

- **Verificador:** predefinição `PQ_ONLY_VERIFIER_POLICY` em `verify-v2.ts`
- **Servidor:** `POST /v2/policy/mode` para mudar de modo em tempo de execução
- **Verificação:** As assinaturas clássicas são opcionais. Os bundles V1 são rejeitados. Avisos de descontinuação nos bundles apenas clássicos.

<a id="key-rotation-ceremony"></a>

### Cerimônia de rotação de chaves

- **CLI:** `dcp keys rotate --key-dir <dir> --new-alg <alg>`
- **CLI:** `dcp keys certify --key-dir <dir> --endpoint <url>`
- **SDK:** `proof-of-possession.ts` — `createKeyRotation()` e `verifyKeyRotation()`
- **Verificação:** Prova de posse da chave nova + autorização da chave antiga. Suporte a janela de carência. Certificação pelo gateway.

<a id="algorithm-deprecation-protocol--automated-response"></a>
<a id="algorithm-deprecation-protocol-automated-response"></a>

### Protocolo de descontinuação de algoritmos — resposta automatizada

- **SDK:** `autoApplyAdvisoriesToPolicy()` em `algorithm-advisory.ts`
- **Servidor:** `POST /v2/advisory/auto-apply`
- **Verificação:** Remoção automática de algoritmos descontinuados ou revogados. Injeção do algoritmo substituto. Mudança automática para pq_only quando todos os clássicos são removidos. Trilha de auditoria das mudanças de política.

<a id="hsmtpm-reference-implementation"></a>

### Implementação de referência de HSM/TPM

- **SDK:** `HsmCryptoProvider` em `providers/hsm-provider.ts`
- **Fábrica:** `HsmProviderFactory` para sessões HSM com vários algoritmos
- **Verificação:** Implementa a interface CryptoProvider. Ciclo de vida das sessões PKCS#11. As chaves privadas nunca ficam na memória da aplicação.

<a id="governance-key-ceremony"></a>

### Cerimônia de chaves de governança

- **SDK:** `governance.ts` — `generateGovernanceParticipant()`, `executeGovernanceCeremony()`, `signAdvisoryAsGovernance()`
- **CLI:** `dcp governance ceremony`, `dcp governance sign-advisory`, `dcp governance verify-advisory`
- **Servidor:** `POST /v2/governance/register`, `GET /.well-known/governance-keys.json`
- **Verificação:** Assinaturas compostas M de N. Cada participante tem Ed25519 + ML-DSA-65. Aplicação do limiar.

<a id="normative-specification"></a>

### Especificação normativa

- **Documento:** `spec/DCP-AI-v2.0.md`
- **Verificação:** Especificação completa que cobre todos os aspectos do protocolo: algoritmos, gestão de chaves, assinaturas, verificação, privacidade, governança, modelo de ameaças e requisitos de conformidade.

---

<a id="audit-conclusion"></a>

## Conclusão da auditoria

As 13 lacunas identificadas no plano de atualização do protocolo pós-quântico do DCP-AI v2.0 foram verificadas como fechadas. As adições da fase 3 (modo pq_only, cerimônia de rotação de chaves, resposta automática à descontinuação de algoritmos, provedor HSM, cerimônia de governança) estão completamente implementadas.

O protocolo DCP-AI v2.0 está pronto para publicação.

**Auditoria verificada por:** o comando da CLI `dcp audit gaps`  
**Execução:** `node bin/dcp.js audit gaps` a partir da raiz do repositório
