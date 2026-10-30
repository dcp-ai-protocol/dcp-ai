<sub>[English](../../../../spec/core/README.md) · [中文](../../../zh-CN/spec/core/README.md) · [Español](../../../es/spec/core/README.md) · [日本語](../../../ja/spec/core/README.md) · **Português**</sub>

<a id="dcp-core"></a>

# Núcleo do DCP

> Tradução informativa da [especificação em inglês](../../../../spec/core/README.md), atualizada em 25/10/2026. **A versão normativa é a inglesa**: esta tradução não tem valor normativo e, em caso de divergência, prevalece o inglês. Identificadores e blocos de código são mantidos sem tradução.

Este diretório contém a **especificação do núcleo** do Digital Citizenship Protocol: a superfície mínima interoperável do protocolo que toda implementação do DCP deve suportar.

<a id="what-is-dcp-core"></a>

## O que é o núcleo do DCP

O núcleo do DCP define os artefatos, as suas relações e o modelo de verificação que permitem a qualquer verificador avaliar:

- **Quem é responsável** por um agente (vinculação ao principal responsável)
- **O que o agente declarou** que pretendia fazer (declaração de intenção)
- **Qual resultado de política** foi aplicado (decisão de política)
- **Qual evidência verificável** foi produzida (evidência da ação / trilha de auditoria)
- **Como todos os artefatos são empacotados** para uma verificação portátil (manifesto do bundle)

O núcleo é deliberadamente mínimo. Ele define *o que* deve estar presente e *como* verificá-lo, mas delega aos **perfis** *como* assinar, *quais* algoritmos usar, *como* os agentes se descobrem e *como* as políticas de governança são aplicadas.

<a id="core-artifacts"></a>

## Artefatos do núcleo

| Artefato | Finalidade | Especificação existente |
|----------|---------|---------------|
| Responsible Principal Record | Vincula um agente a uma pessoa ou entidade jurídica | [DCP-01](../../../../spec/DCP-01.md) (como “Responsible Principal Record”) |
| Agent Passport | Identidade, capacidades e material de chaves do agente | [DCP-01](../../../../spec/DCP-01.md) |
| Intent Declaration | Declaração estruturada anterior à ação | [DCP-02](../../../../spec/DCP-02.md) |
| Policy Outcome | Decisão de autorização sobre uma intenção | [DCP-02](../../../../spec/DCP-02.md) |
| Action Evidence | Entradas de auditoria encadeadas por hash | [DCP-03](../../../../spec/DCP-03.md) |
| Bundle Manifest | Pacote portátil que vincula todos os artefatos | [BUNDLE](../../../../spec/BUNDLE.md) |

<a id="documents"></a>

## Documentos

- [dcp-core.md](../../../../spec/core/dcp-core.md) — especificação editorial do núcleo, com a justificativa completa e as definições dos artefatos

<a id="relationship-to-existing-specs"></a>

## Relação com as especificações existentes

A especificação do núcleo é uma camada editorial que organiza as especificações normativas existentes (do DCP-01 ao DCP-03, BUNDLE, VERIFICATION) em um núcleo coerente. Ela não as substitui: oferece uma visão unificada da superfície mínima do protocolo.

<a id="what-is-not-core"></a>

## O que NÃO é núcleo

O seguinte fica explicitamente fora do núcleo e pertence a perfis ou serviços:

- Algoritmos criptográficos específicos (Ed25519, ML-DSA-65 etc.) → [perfil Crypto](../../../../spec/profiles/crypto/)
- Descoberta e comunicação entre agentes → [perfil A2A](../../../../spec/profiles/a2a/)
- Níveis de risco, jurisdição, revogação, governança → [perfil Governance](../../../../spec/profiles/governance/)
- Servidores de verificação, ancoragem, logs de transparência → serviços de infraestrutura

<a id="implementation-notes-informative"></a>

## Notas de implementação (informativas)

> **Acrescentadas em 25/10/2026. Não normativas.** Estas notas não acrescentam nenhum requisito nem mudam nada do que está acima: descrevem como
> o código de referência em `main` se relaciona com este texto. Onde divergem, prevalece o texto normativo acima.

- Os artefatos do núcleo existem em duas versões do formato de transmissão. V1 (`schemas/v1/`): sem manifesto, sem envelopes `SignedPayload`, sem
  `session_nonce`, uma assinatura Ed25519 sobre o bundle e pelo menos uma entrada de auditoria. V2 (`schemas/v2/`, especificada no
  [DCP-AI v2.0](../../../../spec/DCP-AI-v2.0.md)): um manifesto assinado que se compromete com cada artefato, envelopes `SignedPayload` para o
  RPR, o passaporte, a intenção e a decisão de política, um nonce de sessão, assinaturas compostas e uma trilha de auditoria que pode estar
  vazia.
- No V2 o RPR traz as `binding_keys` do principal e o passaporte é assinado pelas próprias chaves do agente. Um bundle
  que é verificado prova que as suas assinaturas correspondem às chaves que ele lista, não quem é o principal: a confiança vem do
  conjunto de confiança do verificador ([docs/ADMISSION.md](../../../../docs/ADMISSION.md)).
