<sub>[English](../../../../../spec/profiles/crypto/README.md) · [中文](../../../../zh-CN/spec/profiles/crypto/README.md) · [Español](../../../../es/spec/profiles/crypto/README.md) · [日本語](../../../../ja/spec/profiles/crypto/README.md) · **Português**</sub>

<a id="crypto-profile"></a>

# Perfil Crypto

> Tradução informativa da [especificação em inglês](../../../../../spec/profiles/crypto/README.md), atualizada em 28/10/2026. **A versão normativa é a inglesa**: esta tradução não tem valor normativo e, em caso de divergência, prevalece o inglês. Identificadores e blocos de código são mantidos sem tradução.

**Estado:** Publicado — v2.0  
**Escopo:** Seleção de algoritmos criptográficos, assinaturas compostas, agilidade criptográfica e política de verificador  

---

<a id="purpose"></a>

## Finalidade

O núcleo do DCP exige assinaturas criptográficas e funções hash, mas deliberadamente não impõe algoritmos específicos. O perfil Crypto define as escolhas criptográficas concretas usadas no DCP v2.0 e os mecanismos para fazê-las evoluir ao longo do tempo.

Essa separação garante que:

- O protocolo do núcleo sobreviva às transições de algoritmos (por exemplo, a migração pós-quântica) sem mudanças estruturais
- Os verificadores possam aplicar as suas próprias políticas de algoritmos conforme o contexto de risco
- As implementações possam começar com algoritmos clássicos e adotar os pós-quânticos quando estiverem prontas
- A descontinuação de um algoritmo não quebre a especificação do núcleo

<a id="what-lives-here-not-in-core"></a>

## O que fica aqui (não no núcleo)

<a id="algorithm-registry"></a>

### Registro de algoritmos

O conjunto de algoritmos de assinatura aprovados (Ed25519, ML-DSA-65, ML-DSA-87, SLH-DSA-192f), mecanismos de encapsulamento de chaves (X25519, ML-KEM-768, híbrido X25519+ML-KEM-768) e algoritmos hash (SHA-256, SHA3-256, SHA-384).

> *Nota informativa (25/10/2026), não faz parte do perfil:* nenhum SDK do DCP-AI implementa ainda o ML-DSA-87, e nenhum exporta a troca híbrida X25519+ML-KEM-768 ([docs/NIST_CONFORMITY.md](../../../../../docs/NIST_CONFORMITY.md)).

Veja a seção 2 do [DCP-AI v2.0](../../../../../spec/DCP-AI-v2.0.md) para o registro completo.

<a id="composite-signature-binding"></a>

### Vinculação de assinaturas compostas

O protocolo de vinculação `pq_over_classical`, que garante que nem o componente de assinatura clássico nem o pós-quântico possa ser removido:

1. A assinatura clássica assina `context || 0x00 || payload`
2. A assinatura PQ assina `context || 0x00 || payload || classical_sig`

Veja a seção 5 do [DCP-AI v2.0](../../../../../spec/DCP-AI-v2.0.md) para o protocolo de vinculação e o formato de transmissão.

<a id="domain-separation"></a>

### Separação de domínios

Etiquetas de contexto que impedem ataques de reenvio entre artefatos. Cada tipo de artefato tem uma etiqueta de contexto única (por exemplo, `DCP-AI.v2.AgentPassport`, `DCP-AI.v2.Intent`).

Veja a seção 4 do [DCP-AI v2.0](../../../../../spec/DCP-AI-v2.0.md) para a lista completa de etiquetas.

<a id="verification-modes"></a>

### Modos de verificação

Política decidida pelo verificador, que determina quais componentes de assinatura são exigidos:

- `classical_only` — apenas assinaturas clássicas são exigidas
- `hybrid_preferred` — a clássica é exigida e a PQ é recomendada
- `hybrid_required` — a clássica e a PQ são exigidas
- `pq_only` — apenas assinaturas PQ são exigidas (fase 3)

Veja a seção 7 do [DCP-AI v2.0](../../../../../spec/DCP-AI-v2.0.md) para os modos de verificação e o formato da política de verificador.

<a id="crypto-agility"></a>

### Agilidade criptográfica

O sistema de avisos de algoritmos, que permite que autoridades de governança descontinuem ou revoguem algoritmos por meio de avisos assinados, com resposta automatizada dos verificadores.

Veja a seção 13.2 do [DCP-AI v2.0](../../../../../spec/DCP-AI-v2.0.md) e a lacuna nº 4 do [relatório de AUDIT](../../../../../spec/AUDIT-v2.0-FINAL.md).

<a id="dual-hash-chains"></a>

### Cadeias de hash duplo

Cadeias de hash SHA-256 e SHA3-256 paralelas para as entradas de auditoria, dando continuidade se uma família de hash for comprometida.

Veja a seção 10.3 do [DCP-AI v2.0](../../../../../spec/DCP-AI-v2.0.md).

<a id="what-stays-in-core"></a>

## O que permanece no núcleo

- O requisito de que os artefatos sejam assinados (mas não com qual algoritmo)
- O requisito de que as entradas de auditoria sejam encadeadas por hash (mas não com qual função hash)
- A estrutura do bundle e o modelo de verificação
- Os conceitos `bundle_hash` e `merkle_root`

<a id="normative-references"></a>

## Referências normativas

- [DCP-AI v2.0](../../../../../spec/DCP-AI-v2.0.md) — seções 2 (registro de algoritmos), 4 (separação de domínios), 5 (assinaturas compostas), 7 (modos de verificação), 10.3 (hash duplo), 13.2 (sistema de avisos)
- [Conformidade com o NIST](../../../../../docs/NIST_CONFORMITY.md) — conformidade com a criptografia pós-quântica do NIST
- [Modelo de segurança](../../../../../docs/SECURITY_MODEL.md) — modelo de ameaças e camadas de proteção

<a id="implementation-notes-informative"></a>

## Notas de implementação (informativas)

> **Acrescentadas em 25/10/2026. Não normativas.** Estas notas não acrescentam nenhum requisito nem mudam nada do que está acima: descrevem como
> o código de referência em `main` se relaciona com este texto. Onde divergem, prevalece o texto normativo acima.

- A vinculação composta torna a remoção detectável apenas onde o verificador a exige. O modo que conta é
  o efetivo que o verificador resolve, que pode ser mais estrito que o `default_mode` solicitado depois de aplicados o nível de
  risco, o nível de segurança e a política. Nos verificadores dos SDKs, remover a assinatura PQ e
  rerrotular a vinculação como `classical_only` é aceito quando o modo efetivo é `classical_only` ou
  `hybrid_preferred` (com um aviso em `hybrid_preferred`), e recusado quando é `hybrid_required` ou `pq_only`.
  Apenas uma assinatura PQ explicitamente ausente pode ser tolerada: uma assinatura PQ presente sob
  `pq_over_classical` e inválida é recusada em todos os modos, e todas as demais verificações continuam valendo.
- `pq_only` nos verificadores dos SDKs continua esperando a vinculação `pq_over_classical` com os bytes da assinatura clássica
  presentes, porque a assinatura PQ os cobre; ele não aceita um bundle que traga apenas uma assinatura PQ.
- O sistema de avisos não é automático: um verificador aplica um aviso quando o seu operador o carrega e chama os
  auxiliares de avisos ou ajusta a política de acordo.
- Os verificadores dos SDKs verificam a cadeia de auditoria SHA-256 e a raiz de Merkle; desde `@dcp-ai/sdk` 2.2.1, `@dcp-ai/wasm` 2.1.1, `dcp-ai` 2.10.1 (PyPI), Go v2.11.1 e Rust `dcp-ai` 2.11.1, também verificam os campos secundários SHA3-256 presentes (V2-11 do [VERIFICATION.md](../../../../../spec/VERIFICATION.md) e sua errata), o que as versões anteriores não fazem.
