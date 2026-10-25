<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · **Português**</sub>

<a id="documentation"></a>

# Documentação

> Tradução informativa da [versão em inglês](README.md), atualizada em 25/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

<a id="quick-start"></a>

## Início rápido

- [QUICKSTART.md](QUICKSTART.md) — Comece em poucos minutos (pacotes publicados e cópia do repositório)
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
- [ADMISSION.md](ADMISSION.md) — Aceitar bundles apenas de principais confiáveis, e o perfil strict-v1 (não publicado)
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

- [proposals/canonicalization-candidate](proposals/canonicalization-candidate/README.md) — O candidato inativo `dcp-jcs-v2` e suas APIs opt-in nos SDKs (não publicadas); `dcp-jcs-v1` continua sendo o único perfil

<a id="community--vision"></a>
<a id="community-vision"></a>

## Comunidade e visão

- [EARLY_ADOPTERS.md](EARLY_ADOPTERS.md) — Programa de adotantes iniciais, benefícios e requisitos
- [GENESIS_PAPER.md](GENESIS_PAPER.md) — Documento fundador

---

Para as especificações do protocolo, veja [spec/](../spec/). Para as diretrizes de contribuição, veja [CONTRIBUTING.md](../CONTRIBUTING.md).
