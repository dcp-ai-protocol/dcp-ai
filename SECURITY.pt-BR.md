<sub>[English](SECURITY.md) · [中文](SECURITY.zh-CN.md) · [Español](SECURITY.es.md) · [日本語](SECURITY.ja.md) · **Português**</sub>

<a id="security-policy"></a>

# Política de segurança

> Tradução informativa da [versão em inglês](SECURITY.md), atualizada em 25/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

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

<a id="out-of-scope"></a>

### Fora do escopo

- Identidades autodeclaradas sem atestação jurisdicional (por projeto; veja [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md))
- Operadores que executam código de verificação modificado (cada operador é responsável pela própria implantação)
- Negação de serviço (questão de infraestrutura, não do protocolo)
- Ataques de engenharia social contra as pessoas que guardam chaves

<a id="supported-versions"></a>

## Versões suportadas

Os pacotes não compartilham um único número de versão; os pacotes npm `@dcp-ai/*` seguem suas próprias linhas de versão.

| Versão | Suportada |
|---------|-----------|
| 2.10.x (`dcp-ai` no crates.io, módulo Go `sdks/go/v2`) | Sim |
| 2.9.x (`dcp-ai` no PyPI e no crates.io, módulo Go `sdks/go/v2`) | Sim |
| 2.8.x (`dcp-ai` no PyPI e no crates.io, módulo Go `sdks/go/v2`) | Sim |
| 2.2.x (`@dcp-ai/sdk`) | Sim |
| 2.1.x (`@dcp-ai/sdk`) | Não: `verifySignedBundleV2` pode ser contornado; a correção está na 2.2.x (veja a nota abaixo) |
| 2.1.x (`@dcp-ai/wasm`, `@dcp-ai/openclaw`) | Sim |
| 2.0.x (`@dcp-ai/wasm`, `@dcp-ai/cli` e os demais pacotes npm `@dcp-ai/*`) | Sim |
| 1.0.x   | Sim (manutenção) |
| < 1.0   | Não        |

`@dcp-ai/sdk` 2.2.0 está marcado com a tag `v2.10.0`, mas não está no npm: em 25/10/2026 o registro do npm tinha 2.0.0, 2.1.0 e 2.1.1, com 2.1.1 como `latest`. Até que a 2.2.0 seja publicada, a correção só está disponível compilando o SDK a partir de uma cópia deste repositório (`cd sdks/typescript && npm install && npm run build`); uma versão instalada pelo npm continua afetada.

**Versões de integrações afetadas conhecidas (25/10/2026):** a tabela de suporte não significa que um build publicado contenha todas as correções de `main`. `@dcp-ai/express` 2.0.0 e `@dcp-ai/openclaw` 2.0.0 no npm, e a integração FastAPI do `dcp-ai` 2.9.0 no PyPI, aceitam bundles V2 estruturalmente válidos sem verificar criptograficamente suas assinaturas. Esses caminhos estão corrigidos em `main`, mas nenhum pacote corrigido foi publicado ainda. Não use essas versões para verificar bundles V2. Veja as instruções para usar uma cópia do repositório e os avisos de publicação nos READMEs de [Express](integrations/express/README.md), [OpenClaw](integrations/openclaw/README.md) e [FastAPI](integrations/fastapi/README.md). Este aviso não muda a política de versões suportadas acima.

<a id="disclosure-policy"></a>

## Política de divulgação

- Seguimos a divulgação coordenada: as correções são desenvolvidas em privado e publicadas antes da divulgação pública.
- Quem relatar receberá crédito no aviso de segurança (a menos que prefira o anonimato).
- Não tomaremos medidas legais contra pesquisadores que sigam esta política.

<a id="bug-bounty"></a>

## Programa de recompensas

O DCP-AI mantém um programa de recompensas por vulnerabilidades de segurança:

| Gravidade | Recompensa |
|----------|--------|
| Crítica (quebra da criptografia PQ, contorno de assinaturas) | $5,000 - $15,000 |
| Alta (contorno da verificação, vazamento de chaves) | $1,000 - $5,000 |
| Média (rebaixamento de nível, manipulação da cadeia) | $500 - $1,000 |
| Baixa (divulgação de informações, DoS) | $100 - $500 |

> **Nota (25/10/2026): os documentos divergem.** Esta tabela traz faixas fixas de recompensa, enquanto [GOVERNANCE.md](GOVERNANCE.md) e [docs/EARLY_ADOPTERS.md](docs/EARLY_ADOPTERS.md) dizem que as recompensas são decididas caso a caso, sem faixas fixas. Os textos são mantidos como estão até que um mantenedor confirme qual se aplica; até lá, considere qualquer recompensa como não confirmada e pergunte aos mantenedores.

Veja [docs/EARLY_ADOPTERS.md](docs/EARLY_ADOPTERS.md) para todos os detalhes do programa.

<a id="security-model"></a>

## Modelo de segurança

Para uma análise detalhada da arquitetura de segurança do protocolo, de seus vetores de ataque e de suas camadas de proteção, veja [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) e [docs/NIST_CONFORMITY.md](docs/NIST_CONFORMITY.md).

<a id="protocol-integrity"></a>

## Integridade do protocolo

Compare os arquivos de esquema V1 locais com o manifesto local de impressões digitais:

```bash
dcp integrity
```

Isso compara os bytes dos esquemas V1 com `protocol_fingerprints.json`. Não verifica os esquemas V2, o comportamento da implementação nem a conformidade, e o manifesto local não é uma âncora de confiança autenticada. Veja [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md#protocol-fingerprints) para mais detalhes.
