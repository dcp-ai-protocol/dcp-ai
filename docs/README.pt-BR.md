<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · **Português**</sub>

<a id="documentation"></a>

# Documentação

> Tradução informativa da [versão em inglês](README.md), atualizada em 27/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Este índice organiza a documentação do DCP-AI por tarefa: primeiros passos, arquitetura e segurança, testes, referência,
operações, especificações e propostas. As versões atuais dos pacotes em cada registro estão em
[Versões publicadas](#published-versions).

<a id="published-versions"></a>

## Versões publicadas

Verificadas em 26/10/2026. As versões dos pacotes são independentes da versão do formato de transmissão e da especificação do DCP (2.0).

| Registro | Pacote | Versão | Notas de publicação |
|---|---|---|---|
| npm | [`@dcp-ai/sdk`](https://www.npmjs.com/package/@dcp-ai/sdk) (SDK TypeScript) | 2.2.0 | [pacotes npm](NPM_RELEASES.md) |
| npm | [`@dcp-ai/wasm`](https://www.npmjs.com/package/@dcp-ai/wasm) | 2.1.0 | [pacotes npm](NPM_RELEASES.md) |
| npm | [`@dcp-ai/cli`](https://www.npmjs.com/package/@dcp-ai/cli) | 2.1.0 | [pacotes npm](NPM_RELEASES.md) |
| PyPI | [`dcp-ai`](https://pypi.org/project/dcp-ai/2.10.0/) (SDK Python) | 2.10.0 | [publicação Python](PYTHON_RELEASE.md) |
| Go modules | `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` | v2.11.0 | [publicação Go](GO_RELEASE.md) |
| crates.io | [`dcp-ai`](https://crates.io/crates/dcp-ai/2.11.0) (SDK Rust) | 2.11.0 | [publicação Rust](RUST_RELEASE.md) |

- Os adaptadores e geradores de projetos npm são opcionais e independentes do núcleo do protocolo; suas versões exatas
  estão em [NPM_RELEASES.md](NPM_RELEASES.md), que lista os 13 pacotes npm.
- As versões anteriores afetadas e as notas de atualização estão em [SECURITY.md](../SECURITY.md#supported-versions); a migração
  a partir do DCP v1.0 é explicada em [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md).
- Em todos os SDKs, `dcp-jcs-v1` continua sendo a canonicalização normativa e padrão; as APIs de `dcp-jcs-v2` são
  experimentais e opt-in. A verificação não estabelece a confiança no principal, a admissão nem a autorização.
- Este inventário cobre os quatro registros acima; não cobre as imagens de contêiner.

<a id="quick-start"></a>

## Início rápido

- [QUICKSTART.md](QUICKSTART.md) — Produzir e verificar evidências com um SDK (pacotes publicados ou cópia do repositório); as demos são indicadas à parte
- [QUICKSTART_EXPRESS.md](QUICKSTART_EXPRESS.md) — Integração do middleware Express
- [QUICKSTART_LANGCHAIN.md](QUICKSTART_LANGCHAIN.md) — Encapsular ferramentas do LangChain
- [QUICKSTART_OPENAI.md](QUICKSTART_OPENAI.md) — Chamadas de função da OpenAI (SDK de Node, Chat Completions; wrapper do cliente Python)
- [QUICKSTART_CREWAI.md](QUICKSTART_CREWAI.md) — Equipes multiagente do CrewAI
- [QUICKSTART_AGNO.md](QUICKSTART_AGNO.md) — Agentes, equipes e workflows do Agno com `agno-dcp`

<a id="architecture--security"></a>
<a id="architecture-security"></a>

## Arquitetura e segurança

- [TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md) — Arquitetura do sistema e plano de implantação
- [SECURITY_MODEL.md](SECURITY_MODEL.md) — Modelo de ameaças, vetores de ataque, camadas de proteção
- [STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md) — Armazenamento P2P e ancoragem opcional em blockchain
- [ARCHITECTURE.md](ARCHITECTURE.md) — Mapa do repositório para quem contribui
- [OBSERVABILITY.md](OBSERVABILITY.md) — Traces e métricas do OpenTelemetry a partir dos SDKs

<a id="testing--assurance"></a>
<a id="testing-assurance"></a>

## Testes e garantias

- [tools/interop-matrix](../tools/interop-matrix/README.md) — Agentes reais nos quatro SDKs assinam e verificam os bundles uns dos outros, intactos e adulterados em trânsito
- [tools/difffuzz](../tools/difffuzz/README.md) — Fuzzing diferencial dos quatro verificadores V2
- [tests/interop/v2](../tests/interop/v2/) — Vetores compartilhados que cada SDK deve aceitar ou rejeitar
- [tests/interop/candidate/phase4](../tests/interop/candidate/phase4/README.md) — Matriz cruzada dos produtores experimentais de `dcp-jcs-v2` (cinco SDKs)

<a id="reference"></a>

## Referência

- [API_REFERENCE.md](API_REFERENCE.md) — Referência da API do SDK TypeScript, como está em `main`
- [NIST_CONFORMITY.md](NIST_CONFORMITY.md) — Declaração de conformidade com NIST FIPS 203/204/205
- [EU_AI_ACT_MAPPING.md](EU_AI_ACT_MAPPING.md) — Obrigações de registro, supervisão humana e manutenção de registros do Regulamento de IA da UE (Regulamento (UE) 2024/1689) mapeadas para os artefatos DCP
- [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md) — Migrar do DCP v1.0 para o v2.0

<a id="operations"></a>

## Operação

- [OPERATOR_GUIDE.md](OPERATOR_GUIDE.md) — Executar um serviço de verificação DCP
- [ADMISSION.md](ADMISSION.md) — Aceitar bundles apenas de principais confiáveis, e o perfil strict-v1
- [AGENT_CREATION_AND_CERTIFICATION.md](AGENT_CREATION_AND_CERTIFICATION.md) — Fluxo de criação e certificação de agentes

<a id="specifications"></a>

## Especificações

- [spec/DCP-01.md](../spec/DCP-01.md) — Identidade e vinculação do principal responsável
- [spec/DCP-02.md](../spec/DCP-02.md) — Declaração de intenção e controle por políticas
- [spec/DCP-03.md](../spec/DCP-03.md) — Cadeia de auditoria e transparência
- [spec/DCP-04.md](../spec/DCP-04.md) — Comunicação entre agentes
- [spec/DCP-05.md](../spec/DCP-05.md) — Gestão do ciclo de vida dos agentes
- [spec/DCP-06.md](../spec/DCP-06.md) — Sucessão e herança digital
- [spec/DCP-07.md](../spec/DCP-07.md) — Resolução de conflitos e arbitragem de disputas
- [spec/DCP-08.md](../spec/DCP-08.md) — Estrutura de direitos e obrigações
- [spec/DCP-09.md](../spec/DCP-09.md) — Representação pessoal e delegação
- [spec/profiles](../spec/profiles/README.md) — Perfis opcionais: criptografia, A2A, governança e admissão

<a id="proposals-experimental-not-normative"></a>

## Propostas (experimentais, não normativas)

- [proposals/canonicalization-candidate](proposals/canonicalization-candidate/README.md) — O candidato inativo `dcp-jcs-v2` e suas APIs opt-in nos SDKs; `dcp-jcs-v1` continua sendo o único perfil

<a id="community--vision"></a>
<a id="community-vision"></a>

## Comunidade e visão

- [EARLY_ADOPTERS.md](EARLY_ADOPTERS.md) — Programa de adotantes iniciais, benefícios e requisitos
- [GENESIS_PAPER.md](GENESIS_PAPER.md) — Documento fundador

---

Para as especificações do protocolo, veja [spec/](../spec/). Para as diretrizes de contribuição, veja [CONTRIBUTING.md](../CONTRIBUTING.md).
