<sub>[English](../../SECURITY.md) · [中文](../zh-CN/SECURITY.md) · [Español](../es/SECURITY.md) · [日本語](../ja/SECURITY.md) · **Português**</sub>

<a id="security-policy"></a>

# Política de segurança

> Tradução informativa da [versão em inglês](../../SECURITY.md), atualizada em 05/11/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

<a id="reporting-a-vulnerability"></a>

## Relatar uma vulnerabilidade

**NÃO relate vulnerabilidades de segurança em issues públicas do GitHub.**

Se você descobrir uma vulnerabilidade de segurança no protocolo DCP-AI, em seus SDKs, serviços ou contratos inteligentes, relate-a de forma responsável:

- **E-mail:** security@dcp-ai.org
- **GitHub:** use o [Private Vulnerability Reporting](https://github.com/dcp-ai-protocol/dcp-ai/security/advisories/new)

Inclua o máximo de detalhes possível:
- Descrição da vulnerabilidade
- Passos para reproduzi-la
- Componente afetado (protocolo, SDK, serviço, contrato)
- Avaliação do impacto potencial

<a id="response-timeline"></a>

## Prazos de resposta

| Etapa | Prazo |
|-------|-----------|
| Confirmação de recebimento | Em até 48 horas |
| Avaliação inicial | Em até 7 dias |
| Correção (crítica/alta) | Em até 30 dias |
| Correção (média/baixa) | Em até 90 dias |

<a id="scope"></a>

## Escopo

<a id="in-scope"></a>

### Dentro do escopo

- Falhas criptográficas (assinaturas Ed25519, hashes SHA-256, árvores de Merkle)
- Contorno da verificação de bundles (assinatura, bundle_hash, merkle_root, cadeias de hashes)
- Vulnerabilidades dos SDKs (TypeScript, Python, Go, Rust, WASM)
- Erros do contrato inteligente (DCPAnchor.sol)
- Vulnerabilidades dos serviços HTTP (anchor, transparency-log, revocation)
- Contorno dos middlewares (integrações Express e FastAPI)
- Ataques no nível do protocolo (manipulação de esquemas, quebras da cadeia de hashes)
- Falhas criptográficas pós-quânticas (assinaturas ML-DSA-65/87, KEM ML-KEM-768, SLH-DSA-192f)
- Vulnerabilidades da vinculação de assinaturas compostas (ataques de remoção de pq_over_classical)
- Fraquezas na derivação de chaves do KEM híbrido (X25519 + ML-KEM-768)
- Vulnerabilidades do protocolo de handshake A2A (sequestro de sessão, repetição)
- Ataques de rebaixamento do nível de segurança
- Inconsistências da cadeia dupla de hashes (SHA-256 + SHA3-256)
- Integridade da cadeia de checkpoints PQ
- Contorno das tags de separação de domínio
- Repetição ou emenda do nonce de sessão
- Consumo desproporcional de recursos ou esgotamento algorítmico: uma entrada que faz um verificador, um SDK ou um serviço de referência usar CPU, memória ou tempo de forma desproporcional ao seu tamanho, mostrada com uma reprodução local limitada

<a id="out-of-scope"></a>

### Fora do escopo

- Identidades autodeclaradas sem atestação jurisdicional (por projeto; veja [docs/SECURITY_MODEL.md](../../docs/SECURITY_MODEL.md))
- Operadores que executam código de verificação modificado (cada operador é responsável pela própria implantação)
- Carga ou inundação contra infraestrutura em produção, ou qualquer outro teste disruptivo de serviços implantados: não autorizado
- Ataques de engenharia social contra as pessoas que guardam chaves

<a id="supported-versions"></a>

## Versões suportadas

Relatórios são recebidos para qualquer versão publicada e para a `main`. Receber um relatório não significa que uma versão contenha a sua correção nem que vá recebê-la. As correções são feitas na `main` e chegam aos usuários só numa versão posterior; nenhum backport, versão de manutenção ou suporte de longo prazo é prometido. Os pacotes não compartilham um único número de versão; os pacotes npm `@dcp-ai/*` seguem as suas próprias linhas de versões.

| Versão | Situação |
|---------|--------|
| Últimas publicadas: `@dcp-ai/sdk` 2.2.1, `@dcp-ai/wasm` 2.1.1, `@dcp-ai/cli` 2.1.1, `dcp-ai` 2.10.1 (PyPI), Go `v2.11.1`, Rust `dcp-ai` 2.11.1 | Atuais. Incluem as correções do verificador de 26/10/2026 e as verificações secundárias SHA3-256 de 28/10/2026, não as correções posteriores da `main` listadas no [dossiê de auditoria](../../docs/conformance/AUDIT_DOSSIER.md#artifacts) |
| Versões mínimas publicadas com as correções do verificador de 26/10/2026: `@dcp-ai/sdk` 2.2.0, `@dcp-ai/wasm` e `@dcp-ai/cli` 2.1.0, `dcp-ai` 2.10.0 (PyPI), Go `v2.11.0`, Rust `dcp-ai` 2.11.0 | Substituídas: não verificam os campos secundários SHA3-256, que as últimas versões verificam; atualize |
| `@dcp-ai/sdk` 2.1.x | Afetadas: `verifySignedBundleV2` pode ser contornado; corrigido em 2.2.0 (veja a nota a seguir) |
| `@dcp-ai/express` e `@dcp-ai/openclaw` 2.0.0 | Afetadas: aceitam bundles V2 com estrutura válida sem verificar as suas assinaturas; não as use para verificar bundles V2. Corrigido em 2.1.0 |
| Integração FastAPI do `dcp-ai` 2.9.0 (PyPI) | Afetada para V2; corrigida em 2.10.0 |
| Outras versões publicadas anteriores | Não avaliadas frente a essas correções: nenhuma cobertura é declarada para elas. Relatórios são recebidos |
| Outros adaptadores e geradores npm: `@dcp-ai/anthropic-mcp` e `@dcp-ai/google-a2a` 2.1.0; `@dcp-ai/autogen`, `@dcp-ai/w3c-did` e os geradores `create-*` 2.0.1 | Opcionais e fora do núcleo do protocolo; os seus limites estão nos seus READMEs e no [inventário npm](../../docs/NPM_RELEASES.md) |
| 1.0.x | Linha anterior: relatórios são recebidos; nenhuma versão de manutenção está programada ou prometida |
| < 1.0 | Sem suporte |

`@dcp-ai/sdk` 2.2.0 foi publicado no npm em 26/10/2026 como `latest`, com as correções do verificador. As versões anteriores afetadas não recebem as correções automaticamente.

**Campos secundários SHA3-256 (28/10/2026).** `@dcp-ai/sdk` 2.2.1, `@dcp-ai/wasm` 2.1.1, `dcp-ai` 2.10.1 (PyPI), Go v2.11.1 e Rust `dcp-ai` 2.11.1 verificam os campos secundários SHA3-256 opcionais do [V2-11](../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) quando estão presentes; as versões anteriores, incluindo 2.2.0, 2.1.0, 2.10.0 e 2.11.0, não o fazem. Atualize com `npm install @dcp-ai/sdk@^2.2.1` ou o equivalente do seu ecossistema, e renove o lockfile. Os adaptadores publicados `@dcp-ai/express`, `@dcp-ai/openclaw`, `@dcp-ai/anthropic-mcp` e `@dcp-ai/google-a2a` 2.1.0 não foram republicados: dependem de `@dcp-ai/sdk` `^2.2.0` e obtêm as verificações secundárias quando seu lockfile resolve `@dcp-ai/sdk` 2.2.1 ou posterior. Veja o [inventário de pacotes npm publicados](../../docs/NPM_RELEASES.md) e [Versões publicadas](../../docs/README.md#published-versions).

**Integrações afetadas e corrigidas (26/10/2026).** `@dcp-ai/express` 2.0.0 e `@dcp-ai/openclaw` 2.0.0 aceitam bundles V2 com estrutura válida sem verificar suas assinaturas. Ambos estão corrigidos na versão npm 2.1.0, com `@dcp-ai/sdk` `^2.2.0`. Não use 2.0.0 para verificar bundles V2. A integração FastAPI de `dcp-ai` 2.9.0 continua afetada; a implementação corrigida já está publicada no PyPI 2.10.0. Veja as [notas de atualização Python](../../docs/PYTHON_RELEASE.md). Veja [Express](../../integrations/express/README.md), [OpenClaw](../../integrations/openclaw/README.md) e [FastAPI](../../integrations/fastapi/README.md). O suporte a um pacote não significa que todas as versões antigas contenham as correções.

<a id="disclosure-policy"></a>

## Política de divulgação

- Seguimos a divulgação coordenada: as correções são desenvolvidas em privado e publicadas antes da divulgação pública.
- Quem relatar receberá crédito no aviso de segurança (a menos que prefira o anonimato).
- Não tomaremos medidas legais contra pesquisadores que sigam esta política.

<a id="rewards"></a>

## Recompensas

Não há um programa de recompensas com valores fixos, e nenhuma recompensa é garantida. Os mantenedores podem oferecer uma recompensa caso a caso por um relatório; só um acordo explícito com eles a compromete. O crédito no aviso é descrito em Política de divulgação.

> **Nota (05/11/2026).** Até esta data esta seção listava faixas fixas de recompensa por gravidade, marcadas explicitamente como não confirmadas porque o [GOVERNANCE.md](../../GOVERNANCE.md) e o [docs/EARLY_ADOPTERS.md](../../docs/EARLY_ADOPTERS.md) descreviam recompensas caso a caso. Esta página agora indica recompensas caso a caso, como esses dois documentos.

Consulte o [docs/EARLY_ADOPTERS.md](../../docs/EARLY_ADOPTERS.md#security-disclosure) para ver como a divulgação de segurança se encaixa no programa de primeiros adotantes.

<a id="security-model"></a>

## Modelo de segurança

Para uma análise detalhada da arquitetura de segurança do protocolo, de seus vetores de ataque e de suas camadas de proteção, veja [docs/SECURITY_MODEL.md](../../docs/SECURITY_MODEL.md) e [docs/NIST_CONFORMITY.md](../../docs/NIST_CONFORMITY.md). Para uma revisão independente, comece pelo [dossiê de auditoria](../../docs/conformance/AUDIT_DOSSIER.md): a sua base, os comandos de reprodução, os artefatos e os limites conhecidos.

<a id="protocol-integrity"></a>

## Integridade do protocolo

Compare os arquivos de esquema V1 locais com o manifesto local de impressões digitais:

```bash
dcp integrity
```

Isso compara os bytes dos esquemas V1 com `protocol_fingerprints.json`. Não verifica os esquemas V2, o comportamento da implementação nem a conformidade, e o manifesto local não é uma âncora de confiança autenticada. Veja [docs/SECURITY_MODEL.md](../../docs/SECURITY_MODEL.md#protocol-fingerprints) para mais detalhes.
