<sub>[English](../../../../spec/core/dcp-core.md) · [中文](../../../zh-CN/spec/core/dcp-core.md) · [Español](../../../es/spec/core/dcp-core.md) · [日本語](../../../ja/spec/core/dcp-core.md) · **Português**</sub>

<a id="dcp-core-specification"></a>

# Especificação do núcleo do DCP

> Tradução informativa da [especificação em inglês](../../../../spec/core/dcp-core.md), atualizada em 25/10/2026. **A versão normativa é a inglesa**: esta tradução não tem valor normativo e, em caso de divergência, prevalece o inglês. Identificadores e blocos de código são mantidos sem tradução.

**Estado:** Publicado — v2.0  
**Versão:** 2.0  
**Data:** 2026-03-01  

---

<a id="1-introduction"></a>

## 1. Introdução

O Digital Citizenship Protocol (DCP) define uma camada portátil de responsabilização para agentes de IA que operam em redes abertas. O núcleo do DCP é a superfície mínima interoperável do protocolo: o conjunto de artefatos, relações e regras de verificação que toda implementação conforme deve suportar.

Um verificador que recebe um bundle do DCP pode responder a quatro perguntas sem depender de nenhuma autoridade central:

1. **Quem é responsável** por este agente?
2. **O que o agente declarou** que pretendia fazer?
3. **Qual resultado de política** foi aplicado a essa intenção?
4. **Qual evidência verificável** existe das ações do agente?

O núcleo do DCP define a estrutura e a semântica dessas respostas. Ele não prescreve algoritmos criptográficos específicos, mecanismos de transporte, políticas de governança nem infraestrutura operacional: isso pertence a perfis e serviços.

<a id="11-relationship-to-existing-specifications"></a>

### 1.1 Relação com as especificações existentes

Este documento é uma especificação editorial que organiza e unifica o material já publicado em:

- [DCP-01](../../../../spec/DCP-01.md) — Identidade e vinculação ao principal
- [DCP-02](../../../../spec/DCP-02.md) — Declaração de intenção e controle por política
- [DCP-03](../../../../spec/DCP-03.md) — Cadeia de auditoria e transparência
- [BUNDLE](../../../../spec/BUNDLE.md) — Formato do Citizenship Bundle
- [VERIFICATION](../../../../spec/VERIFICATION.md) — Lista de verificação
- [DCP-AI v2.0](../../../../spec/DCP-AI-v2.0.md) — Especificação normativa completa, incluindo as extensões pós-quânticas

Ele não substitui esses documentos. Oferece uma visão unificada do núcleo e esclarece a fronteira entre núcleo e perfis.

---

<a id="2-problem-statement"></a>

## 2. Definição do problema

Os agentes de IA operam cada vez mais de forma autônoma em redes abertas: chamam APIs, trocam dados, fazem transações e colaboram com outros agentes. Os mecanismos de autenticação existentes (chaves de API, tokens OAuth, certificados mTLS) estabelecem o *controle de acesso*, mas não a *responsabilização*.

Não há uma forma padronizada de responder:

- Quem implantou este agente e aceita a responsabilidade pelas suas ações?
- O que o agente declarou que faria antes de agir?
- A ação foi autorizada por uma política?
- Há um registro, que permita detectar adulterações, do que realmente aconteceu?

O núcleo do DCP trata essa lacuna definindo um conjunto mínimo e portátil de artefatos que qualquer agente pode levar e qualquer verificador pode avaliar.

---

<a id="3-scope"></a>

## 3. Escopo

<a id="in-scope-core"></a>

### Dentro do escopo (núcleo)

- Os seis artefatos do núcleo e os seus campos obrigatórios
- As relações entre artefatos (vinculação, hash, encadeamento)
- O modelo de verificação (o que um verificador deve conferir)
- O formato do bundle (como os artefatos são empacotados para o transporte)
- O requisito de assinaturas criptográficas (sem especificar algoritmos)
- O requisito de encadeamento por hash das entradas de auditoria (sem especificar funções hash)

<a id="out-of-scope-profiles-and-services"></a>

### Fora do escopo (perfis e serviços)

- Algoritmos criptográficos específicos → [perfil Crypto](../../../../spec/profiles/crypto/)
- Descoberta e comunicação entre agentes → [perfil A2A](../../../../spec/profiles/a2a/)
- Atribuição de níveis de risco, jurisdição, revogação, governança → [perfil Governance](../../../../spec/profiles/governance/)
- Servidores de verificação, ancoragem em blockchain, logs de transparência → serviços de infraestrutura
- Implementação do motor de políticas
- Implantação da infraestrutura de gestão de chaves
- Requisitos de transporte de rede além do formato de transmissão

---

<a id="4-core-artifacts"></a>

## 4. Artefatos do núcleo

O núcleo do DCP define seis artefatos. Um Citizenship Bundle válido contém os seis (embora a evidência da ação possa conter uma ou mais entradas).

<a id="41-responsible-principal-binding"></a>

### 4.1 Vinculação ao principal responsável

Todo agente deve (MUST) estar vinculado a um principal responsável: uma pessoa, organização ou entidade jurídica que aceita responder pelas ações do agente.

O registro de vinculação contém:

- Um identificador único do principal
- O tipo de entidade (pessoa física, pessoa jurídica)
- A jurisdição sob a qual o principal opera
- Material de chaves criptográficas para a verificação de assinaturas
- Um compromisso de revogação (que permite uma revogação de emergência sem assinatura)
- A versão do protocolo e a vinculação de sessão

A vinculação estabelece a cadeia de responsabilização: se um agente se comportar mal, o principal responsável pode ser identificado.

Veja o [DCP-01](../../../../spec/DCP-01.md) para a definição normativa e `schemas/v1/responsible_principal_record.schema.json` para o schema.

<a id="42-agent-passport"></a>

### 4.2 Passaporte do agente

Cada agente traz um passaporte que estabelece a sua identidade e o liga ao seu principal responsável. O passaporte contém:

- Um identificador único do agente
- Um nome legível por pessoas
- As capacidades declaradas
- Um hash criptográfico do registro de vinculação do principal responsável (`owner_rpr_hash`)
- O material de chaves próprio do agente
- O estado (active, suspended, revoked)
- A versão do protocolo e a vinculação de sessão

O passaporte é assinado pelo principal responsável. Um verificador pode confirmar que o agente está autorizado conferindo a assinatura do principal e a ligação por hash.

Veja o [DCP-01](../../../../spec/DCP-01.md) para a definição normativa e `schemas/v1/agent_passport.schema.json` para o schema.

<a id="43-intent-declaration"></a>

### 4.3 Declaração de intenção

Antes de realizar qualquer ação, um agente deve (MUST) declarar a sua intenção. A intenção é uma descrição estruturada de:

- Qual ação o agente planeja realizar
- Qual é o alvo da ação
- Quais classificações de dados estão envolvidas
- Uma pontuação de risco avaliada

A intenção tem dois propósitos: permite o controle por política (seção 4.4) e cria um registro de compromisso prévio que pode ser comparado com o comportamento real na trilha de auditoria.

Veja o [DCP-02](../../../../spec/DCP-02.md) para a definição normativa e `schemas/v1/intent.schema.json` para o schema.

<a id="44-policy-outcome"></a>

### 4.4 Resultado de política

Cada intenção recebe um resultado de política de um motor de políticas. O motor de políticas é externo ao DCP: o protocolo define apenas o formato do resultado:

- **Decisão:** approve, escalate ou block
- **Hash da intenção:** vinculação criptográfica à intenção avaliada
- **Condições:** restrições opcionais da aprovação (limites de taxa, confirmação humana etc.)

O núcleo do DCP exige que exista um resultado de política para cada intenção de um bundle. Ele não exige nenhum motor de políticas nem algoritmo de decisão específico.

Veja o [DCP-02](../../../../spec/DCP-02.md) para a definição normativa e `schemas/v1/policy_decision.schema.json` para o schema.

<a id="45-action-evidence"></a>

### 4.5 Evidência da ação

Cada ação produz uma ou mais entradas de auditoria que formam um log encadeado por hash que permite detectar adulterações. Cada entrada contém:

- Um identificador único do evento
- O tipo de evento
- Uma referência ao agente e à intenção
- Um hash da intenção (que liga a evidência à declaração)
- Um hash da entrada de auditoria anterior (`prev_hash`), formando uma cadeia imutável
- Um carimbo de data/hora

A primeira entrada de uma cadeia usa o valor sentinela `"GENESIS"` como `prev_hash`. As entradas seguintes se encadeiam à anterior por meio de `SHA-256(canonical(previous_entry))`.

Opcionalmente, uma raiz de Merkle pode ser calculada sobre todas as entradas, dando um único hash que resume toda a trilha de auditoria.

Veja o [DCP-03](../../../../spec/DCP-03.md) para a definição normativa e `schemas/v1/audit_entry.schema.json` para o schema.

<a id="46-bundle-manifest"></a>

### 4.6 Manifesto do bundle

O Citizenship Bundle é o pacote portátil que reúne todos os artefatos. Um bundle contém exatamente:

- Um registro de vinculação ao principal responsável
- Um passaporte do agente
- Uma declaração de intenção
- Um resultado de política
- Uma ou mais entradas de evidência da ação (trilha de auditoria)

O Signed Bundle envolve o Citizenship Bundle com uma assinatura criptográfica, um `bundle_hash` (hash do bundle canônico) e, opcionalmente, uma `merkle_root` sobre as entradas de auditoria.

Veja o [BUNDLE](../../../../spec/BUNDLE.md) para a definição normativa e `schemas/v1/citizenship_bundle.schema.json` / `schemas/v1/signed_bundle.schema.json` para os schemas.

---

<a id="5-verification-model"></a>

## 5. Modelo de verificação

Um verificador que recebe um Signed Bundle executa as verificações a seguir. Todas são locais: nenhuma chamada a servidor é necessária.

1. **Validação contra o schema** — o bundle e os seus artefatos internos estão conformes aos schemas esperados
2. **Verificação da assinatura** — a assinatura do bundle é válida para a chave pública do assinante
3. **Integridade do hash** — o `bundle_hash` coincide com o hash recalculado do bundle canônico
4. **Validade do principal** — o registro do principal responsável não expirou
5. **Estado do agente** — o estado do passaporte do agente é `active`
6. **Vinculação à intenção** — o `intent_hash` de cada entrada de auditoria coincide com o hash da intenção declarada
7. **Integridade da cadeia de auditoria** — a cadeia de `prev_hash` é válida desde `GENESIS` em todas as entradas
8. **Raiz de Merkle** (se presente) — a raiz de Merkle declarada coincide com a raiz recalculada

Verificações opcionais adicionais (definidas em perfis, não no núcleo):

- Consulta a listas de revogação (perfil Governance)
- Verificação da atestação de jurisdição (perfil Governance)
- Prova de inclusão em log de transparência (perfil Governance)
- Verificação da ancoragem em blockchain (perfil Governance)
- Verificação de assinaturas compostas / PQ (perfil Crypto)

Veja o [VERIFICATION](../../../../spec/VERIFICATION.md) para a lista de verificação normativa completa.

---

<a id="6-security-notes"></a>

## 6. Notas de segurança

<a id="61-algorithm-independence"></a>

### 6.1 Independência dos algoritmos

O núcleo do DCP exige assinaturas criptográficas e funções hash, mas não impõe algoritmos específicos. Essa separação permite:

- Que as implementações comecem com algoritmos clássicos e adotem os pós-quânticos depois
- Que os verificadores apliquem as suas próprias políticas de algoritmos
- Que o protocolo sobreviva às transições de algoritmos sem quebrar a especificação do núcleo

O [perfil Crypto](../../../../spec/profiles/crypto/) define os algoritmos específicos, a vinculação de assinaturas compostas e os mecanismos de agilidade criptográfica usados no DCP v2.0.

<a id="62-trust-model"></a>

### 6.2 Modelo de confiança

O DCP não pressupõe uma autoridade central. A verificação é local e P2P: um verificador precisa apenas do Signed Bundle e (opcionalmente) de um conjunto de registros de revogação. A confiança no principal responsável é estabelecida por meio do registro de vinculação e da sua cadeia de assinaturas, não por meio de um registro centralizado.

<a id="63-privacy"></a>

### 6.3 Privacidade

O núcleo suporta um modo cego em que os campos de dados pessoais da vinculação ao principal são substituídos por um hash de compromisso com sal (`pii_hash`, veja o [DCP-AI v2.0 §12.1](../../../../spec/DCP-AI-v2.0.md#121-blinded-rpr)). Os campos que não são dados pessoais (chaves, jurisdição, responsabilidade) são mantidos para a verificação. O registro completo pode ser revelado às partes autorizadas sob demanda.

<a id="64-replay-protection"></a>

### 6.4 Proteção contra reenvio

No DCP v2.0, um campo `session_nonce` liga todos os artefatos de um bundle a uma única sessão. Os verificadores devem conferir que todos os artefatos compartilham o mesmo nonce. Isso impede ataques de emenda de sessões. A vinculação de sessão é normativamente obrigatória na v2.0, mas não existia na v1.0.

---

<a id="7-extensibility"></a>

## 7. Extensibilidade

O núcleo do DCP foi projetado para ser estendido por meio de perfis. Um perfil:

- Não deve (MUST NOT) contradizer os requisitos do núcleo
- Pode (MAY) definir artefatos, campos ou passos de verificação adicionais
- Pode (MAY) especificar escolhas de algoritmos, vinculações de transporte ou políticas de governança
- É versionado de forma independente do núcleo

Uma implementação conforme do núcleo é válida sem nenhum perfil. Os perfis acrescentam capacidades, não requisitos.

Os perfis definidos atualmente são:

| Perfil | Escopo | Documento |
|---------|-------|----------|
| Crypto | Algoritmos, assinaturas compostas, agilidade criptográfica | [spec/profiles/crypto/](../../../../spec/profiles/crypto/) |
| A2A | Descoberta de agentes, handshake, gestão de sessões | [spec/profiles/a2a/](../../../../spec/profiles/a2a/) |
| Governance | Níveis de risco, jurisdição, revogação, recuperação | [spec/profiles/governance/](../../../../spec/profiles/governance/) |

---

<a id="references"></a>

## Referências

- [DCP-01](../../../../spec/DCP-01.md) — Identidade e vinculação ao principal
- [DCP-02](../../../../spec/DCP-02.md) — Declaração de intenção e controle por política
- [DCP-03](../../../../spec/DCP-03.md) — Cadeia de auditoria e transparência
- [DCP-04](../../../../spec/DCP-04.md) — Comunicação entre agentes
- [BUNDLE](../../../../spec/BUNDLE.md) — Formato do Citizenship Bundle
- [VERIFICATION](../../../../spec/VERIFICATION.md) — Lista de verificação
- [DCP-AI v2.0](../../../../spec/DCP-AI-v2.0.md) — Especificação normativa pós-quântica
- [ROADMAP](../../../../ROADMAP.md) — Roadmap da evolução do projeto

<a id="implementation-notes-informative"></a>

## Notas de implementação (informativas)

> **Acrescentadas em 25/10/2026. Não normativas.** Estas notas não acrescentam nenhum requisito nem mudam nada do que está acima: descrevem como
> o código de referência em `main` se relaciona com este texto. Onde divergem, prevalece o texto normativo acima.

- **Nomes de campos.** Algumas descrições do §4 são conceituais e não correspondem campo a campo aos schemas. Nenhum schema de RPR
  tem um campo de compromisso de revogação; o passaporte V2 tem um `emergency_revocation_token` opcional. Nenhum schema de passaporte
  tem um nome nem um `owner_rpr_hash`: o passaporte aponta para o principal com
  `principal_binding_reference`. A pontuação de risco está na decisão de política (`risk_score`), não na intenção, e a
  decisão de política se refere à sua intenção por `intent_id` e lista as condições em `required_confirmation`. As entradas de auditoria
  têm um `audit_id` e um `outcome`, não um tipo de evento.
- **V1 e V2.** O bundle do §4.6 e as verificações do §5 são os do V1: uma assinatura Ed25519 sobre o bundle e pelo
  menos uma entrada de auditoria. Um bundle V2 traz um manifesto assinado que se compromete com cada artefato, envelopes `SignedPayload`
  para os quatro artefatos principais, um nonce de sessão e assinaturas compostas, e pode ter uma trilha de auditoria
  vazia ([VERIFICATION.md](../../../../spec/VERIFICATION.md), lista de verificação V2).
- **Quem assina o passaporte.** No V2 o agente assina o seu próprio passaporte com as `keys` do passaporte; ele fica vinculado ao
  principal pela assinatura do principal sobre o manifesto, feita com as `binding_keys` do RPR (VERIFICATION.md V2-6).
- **Evidência de auditoria (§4.5, §6).** Uma trilha de auditoria verificada mostra que as entradas registradas estão íntegras e foram comprometidas
  pelas chaves que o bundle lista; não mostra que as ações realmente aconteceram, e a cadeia não é imutável
  diante de quem detém essas chaves e assina uma nova. Nem a verificação nem a admissão autorizam uma ação por
  si sós.
- **Confiança (§6.2).** Um bundle que é verificado prova que as suas assinaturas correspondem às chaves que lista; não prova quem
  é o principal, já que qualquer pessoa pode criar um RPR. A confiança em um principal vem do conjunto de confiança próprio do verificador:
  veja [docs/ADMISSION.md](../../../../docs/ADMISSION.md) e o [perfil de admissão](../../../../spec/profiles/admission/).
- **Perfis (§7).** “Válida sem nenhum perfil” se refere à interoperabilidade dos artefatos do núcleo. Não isenta
  uma implementação dos requisitos do núcleo, e uma implantação continua aplicando a sua própria política de verificador e, quando
  o usa, o perfil de admissão.
