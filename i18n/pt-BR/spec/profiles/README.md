<sub>[English](../../../../spec/profiles/README.md) · [中文](../../../zh-CN/spec/profiles/README.md) · [Español](../../../es/spec/profiles/README.md) · [日本語](../../../ja/spec/profiles/README.md) · **Português**</sub>

<a id="dcp-profiles"></a>

# Perfis do DCP

> Tradução informativa da [especificação em inglês](../../../../spec/profiles/README.md), atualizada em 25/10/2026. **A versão normativa é a inglesa**: esta tradução não tem valor normativo e, em caso de divergência, prevalece o inglês. Identificadores e blocos de código são mantidos sem tradução.

Os perfis são extensões que se apoiam no [núcleo do DCP](../../../../spec/core/) para atender necessidades específicas de implantação. Eles não são necessários para a interoperabilidade básica: uma implementação conforme do núcleo é válida sem nenhum perfil.

<a id="available-profiles"></a>

## Perfis disponíveis

| Perfil | Escopo | Diretório |
|---------|-------|-----------|
| **Crypto** | Seleção de algoritmos, assinaturas híbridas/PQ, vinculação composta, agilidade criptográfica, política de verificador | [crypto/](../../../../spec/profiles/crypto/) |
| **A2A** | Descoberta de agentes, estabelecimento de sessões, vinculações de transporte, troca de mensagens | [a2a/](../../../../spec/profiles/a2a/) |
| **Governance** | Níveis de risco, atestação de jurisdição, revogação, recuperação de chaves, cerimônias de governança | [governance/](../../../../spec/profiles/governance/) |
| **Admission** | Conjuntos de confiança de principais e o perfil `strict-v1` definido pelo operador, acima da verificação | [admission/](../../../../spec/profiles/admission/) |

<a id="design-principles"></a>

## Princípios de design

- Os perfis não devem (MUST NOT) contradizer os requisitos do núcleo do DCP
- Os perfis podem (MAY) definir artefatos, campos ou passos de verificação adicionais
- Os perfis podem (MAY) especificar escolhas de algoritmos, vinculações de transporte ou políticas de governança
- Uma implementação conforme do núcleo é válida sem nenhum perfil
- Os perfis são versionados de forma independente do núcleo

<a id="relationship-to-existing-specs"></a>

## Relação com as especificações existentes

A estrutura de perfis oferece um quadro organizacional para material que já existe no repositório:

- O **perfil Crypto** se baseia nas seções 2–5 do [DCP-AI v2.0](../../../../spec/DCP-AI-v2.0.md) (algoritmos, assinaturas compostas, modos de verificação)
- O **perfil A2A** se baseia no [DCP-04](../../../../spec/DCP-04.md) (comunicação entre agentes)
- O **perfil Governance** se baseia nas seções 13–14 do [DCP-AI v2.0](../../../../spec/DCP-AI-v2.0.md) (governança, níveis de segurança adaptativos) e no [DCP-01](../../../../spec/DCP-01.md) (atestação de jurisdição, revogação)

As especificações normativas existentes continuam sendo a referência. Estes README de perfis oferecem contexto editorial e explicam a separação entre o que cabe ao núcleo e aos perfis.

<a id="implementation-notes-informative"></a>

## Notas de implementação (informativas)

> **Acrescentadas em 25/10/2026. Não normativas.** Estas notas não acrescentam nenhum requisito nem mudam nada do que está acima: descrevem como
> o código de referência em `main` se relaciona com este texto. Onde divergem, prevalece o texto normativo acima.

- “Válida sem nenhum perfil” se refere à interoperabilidade dos artefatos do núcleo. Não isenta uma implementação
  dos requisitos do núcleo, e uma implantação continua aplicando a sua própria política de verificador (por exemplo, o modo de
  verificação que um nível de risco exige) e, quando o usa, o perfil de admissão.
- Um bundle que é verificado é internamente coerente e assinado pelas chaves que ele mesmo lista; isso por si só não torna
  o seu principal confiável, não o admite nem autoriza uma ação. A confiança em um principal vem do conjunto de
  confiança próprio do verificador: veja [docs/ADMISSION.md](../../../../docs/ADMISSION.md) e o [perfil de admissão](../../../../spec/profiles/admission/).
