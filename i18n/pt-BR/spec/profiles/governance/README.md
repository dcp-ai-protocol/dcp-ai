<sub>[English](../../../../../spec/profiles/governance/README.md) · [中文](../../../../zh-CN/spec/profiles/governance/README.md) · [Español](../../../../es/spec/profiles/governance/README.md) · [日本語](../../../../ja/spec/profiles/governance/README.md) · **Português**</sub>

<a id="governance-profile"></a>

# Perfil Governance

> Tradução informativa da [especificação em inglês](../../../../../spec/profiles/governance/README.md), atualizada em 25/10/2026. **A versão normativa é a inglesa**: esta tradução não tem valor normativo e, em caso de divergência, prevalece o inglês. Identificadores e blocos de código são mantidos sem tradução.

**Estado:** Publicado — v2.0  
**Escopo:** Níveis de risco, atestação de jurisdição, revogação, recuperação de chaves e operações de governança  

---

<a id="purpose"></a>

## Finalidade

O núcleo do DCP define os artefatos e o modelo de verificação. O perfil Governance define as políticas, as regras e os mecanismos operacionais que determinam como esses artefatos são geridos ao longo do seu ciclo de vida: quem pode revogar um agente, como os níveis de risco são atribuídos, quais requisitos jurisdicionais se aplicam e como as chaves são recuperadas.

Isso fica explicitamente fora do núcleo porque:

- As políticas de governança dependem da implantação (uma implantação governamental tem regras diferentes das de uma startup)
- A atribuição de níveis de risco depende do contexto do verificador, não da estrutura do protocolo
- Os requisitos jurisdicionais variam conforme o país e o quadro regulatório
- Os mecanismos de recuperação de chaves e de revogação envolvem infraestrutura operacional
- As cerimônias de governança exigem uma coordenação entre várias partes que vai além da verificação

<a id="what-lives-here-not-in-core"></a>

## O que fica aqui (não no núcleo)

<a id="adaptive-security-tiers"></a>

### Níveis de segurança adaptativos

O sistema de quatro níveis (routine, standard, elevated, maximum) que seleciona automaticamente o nível de proteção criptográfica conforme a pontuação de risco da intenção, a classificação dos dados e o tipo de ação.

Veja a seção 14 do [DCP-AI v2.0](../../../../../spec/DCP-AI-v2.0.md).

<a id="jurisdiction-attestation"></a>

### Atestação de jurisdição

Atestações opcionais de autoridades governamentais ou credenciadas que certificam a identidade em um registro de vinculação ao principal para uma jurisdição específica.

Veja a seção “Jurisdiction Attestation” do [DCP-01](../../../../../spec/DCP-01.md).

<a id="revocation"></a>

### Revogação

Mecanismos para revogar agentes:

- **Revogação padrão** por meio de Revocation Records assinados ([DCP-01](../../../../../spec/DCP-01.md))
- **Revogação de emergência** por meio de um token de revogação registrado previamente (sem necessidade de assinatura)
- **Listas de revogação jurisdicionais** publicadas por autoridades

Veja a seção 11.3 do [DCP-AI v2.0](../../../../../spec/DCP-AI-v2.0.md) e a lacuna nº 13 do [relatório de AUDIT](../../../../../spec/AUDIT-v2.0-FINAL.md).

<a id="key-recovery"></a>

### Recuperação de chaves

Recuperação social M de N usando o compartilhamento de segredos de Shamir, com as partes cifradas por meio de um KEM híbrido.

Veja a seção 11.2 do [DCP-AI v2.0](../../../../../spec/DCP-AI-v2.0.md) e a lacuna nº 1 do [relatório de AUDIT](../../../../../spec/AUDIT-v2.0-FINAL.md).

<a id="key-rotation"></a>

### Rotação de chaves

Cerimônia de rotação: a chave nova assina uma prova de posse, a chave antiga contra-assina a autorização, com uma janela de carência configurável.

Veja a seção 11.1 do [DCP-AI v2.0](../../../../../spec/DCP-AI-v2.0.md).

<a id="governance-key-ceremonies"></a>

### Cerimônias de chaves de governança

Operações de governança M de N entre várias partes para assinar avisos de algoritmos e decisões do protocolo.

Veja a seção 13.1 do [DCP-AI v2.0](../../../../../spec/DCP-AI-v2.0.md) e a seção “Governance Key Ceremony” do [relatório de AUDIT](../../../../../spec/AUDIT-v2.0-FINAL.md).

<a id="verifier-authoritative-policy"></a>

### Política decidida pelo verificador

O princípio de que a política de assinaturas é definida pela configuração do verificador, não pelo agente. Inclui a regra de nunca rebaixar os níveis de segurança.

Veja a seção 7.2 do [DCP-AI v2.0](../../../../../spec/DCP-AI-v2.0.md).

<a id="what-stays-in-core"></a>

## O que permanece no núcleo

- A existência de um compromisso de revogação na vinculação ao principal (o campo `revocation_token`)
- O campo `status` do passaporte do agente (active/suspended/revoked)
- O artefato de resultado de política (mas não como as decisões de política são tomadas)
- A trilha de auditoria (mas não quais eventos de governança são registrados)

<a id="normative-references"></a>

## Referências normativas

- [DCP-01](../../../../../spec/DCP-01.md) — atestação de jurisdição, Revocation Records
- [DCP-AI v2.0](../../../../../spec/DCP-AI-v2.0.md) — seções 7.2 (política de verificador), 11 (gestão de chaves), 13 (governança), 14 (níveis de segurança)
- [Armazenamento e ancoragem](../../../../../docs/STORAGE_AND_ANCHORING.md) — listas de revogação, logs de transparência
- [Guia do operador](../../../../../docs/OPERATOR_GUIDE.md) — operar um serviço de verificação

<a id="implementation-notes-informative"></a>

## Notas de implementação (informativas)

> **Acrescentadas em 25/10/2026. Não normativas.** Estas notas não acrescentam nenhum requisito nem mudam nada do que está acima: descrevem como
> o código de referência em `main` se relaciona com este texto. Onde divergem, prevalece o texto normativo acima.

- Nenhum schema de RPR tem um campo `revocation_token`. O schema do passaporte V2 tem um
  `emergency_revocation_token` opcional, o compromisso que a revogação de emergência verifica; o passaporte V1 não tem nenhum.
- O enum `status` do passaporte é `active`, `suspended` e `revoked` no V1, e acrescenta `commissioned`, `declining` e
  `decommissioned` no V2 (seis estados).
- Os auxiliares de recuperação de chaves dos SDKs dividem e reconstroem um segredo com o esquema de Shamir e devolvem as partes como estão:
  eles não cifram as partes com o KEM híbrido nem as distribuem. Cifrar e entregar cada parte é tarefa de
  quem chama.
