<sub>[English](../../../../../spec/profiles/crypto/README.md) · [中文](../../../../zh-CN/spec/profiles/crypto/README.md) · [Español](../../../../es/spec/profiles/crypto/README.md) · [日本語](../../../../ja/spec/profiles/crypto/README.md) · **Português**</sub>

<a id="crypto-profile"></a>

# Perfil Crypto

> Tradução informativa da [especificação em inglês](../../../../../spec/profiles/crypto/README.md), atualizada em 07/11/2026. **A versão normativa é a inglesa**: esta tradução não tem valor normativo e, em caso de divergência, prevalece o inglês. Identificadores e blocos de código são mantidos sem tradução.

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

<a id="p-ed-1-ed25519-acceptance-criterion"></a>

### P-ED-1: critério de aceitação do Ed25519

Uma assinatura `ed25519` `sig = R ‖ S` (64 bytes) de uma chave pública `A` (32 bytes) sobre uma mensagem `M` é aceita
se e somente se as quatro condições forem atendidas:

1. **Escalar.** S < L, lendo S como inteiro little-endian de 256 bits e com L = 2^252 + 27742317777372353535851937790883648493.
2. **Codificações canônicas.** A e R são canônicas: com `y` os 32 bytes lidos em little-endian com o bit 255 zerado,
   `s` o bit 255 e p = 2^255 − 19, `y < p`, e não ocorre `s = 1` com `y ∈ {1, p − 1}`.
3. **Ordem.** Nem A nem R é uma das 8 codificações de E[8], os pontos cuja ordem divide 8 (identidade incluída):

   ```
   0000000000000000000000000000000000000000000000000000000000000000
   0000000000000000000000000000000000000000000000000000000000000080
   0100000000000000000000000000000000000000000000000000000000000000
   26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc05
   26e8958fc2b227b045c3f489f2ef98f0d5dfac05d3c63339b13802886d53fc85
   c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac037a
   c7176a703d4dd84fba3c0b760d10670f2a2053fa2c39ccc64ec7fd7792ac03fa
   ecffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff7f
   ```

4. **Decodificação e equação.** A e R decodificam para pontos da curva, e [S]B = R + [k]A, sem cofator, entre esses
   pontos, com k = SHA-512(R ‖ A ‖ M) mod L calculado sobre os bytes originais de R e A.

P-ED-1 é um critério do DCP, não uma das opções da RFC 8032, cujo §5.1.7 usa o desafio não reduzido. Para A e R do
subgrupo de ordem prima, sua equação dá o mesmo resultado que as equações da RFC; o critério rejeita além disso a
identidade e os demais pontos de E[8]. Uma A ou uma R com componente de torção que não seja de ordem pequena é aceita se
a equação for satisfeita: P-ED-1 não exige pontos livres de torção.

**Implementação.** Os SDKs mantêm a verificação da equação da sua biblioteca (TweetNaCl, PyNaCl com libsodium,
`crypto/ed25519` do Go, `ed25519-dalek`) e verificam as condições 1 a 3 sobre os bytes antes de chamá-la: comparações
com constantes, sem aritmética de curva nova. A biblioteca continua garantindo que A e R são pontos válidos e que a
equação é satisfeita; algumas o fazem para R calculando a codificação canônica de [S]B − [k]A e comparando-a com os
bytes recebidos, uma verificação equivalente que não decodifica R. Uma
condição não atendida é uma rejeição (`false`), nunca um erro, e uma entrada que antes dava um erro (um tamanho, base64
inválido) dá o mesmo erro; uma chave pública que não decodifica continua sendo `false` em TypeScript, Python e Go e um
erro em Rust. As verificações se aplicam aos objetos assinados V1 e ao provedor Ed25519 V2 padrão, onde quer que um
componente `ed25519` seja verificado. Não mudam quais componentes um modo verifica: com `pq_only` só se aplicam onde o
componente clássico continua sendo verificado, como nos mandatos e confirmações do DCP-09, que verificam os dois
componentes em todo modo. O registro de provedores é do operador: P-ED-1 é o critério dos provedores padrão, não uma
garantia sobre um provedor próprio.

**Compatibilidade.** É uma mudança de aceitação intencional: rejeita-se uma assinatura com S ≥ L, com A ou R não
canônica, ou com A ou R em E[8], inclusive onde as bibliotecas de TypeScript, Go e Rust a aceitavam (o build oficial do
PyNaCl, com libsodium 1.0.20, já rejeitava essas entradas, segundo seu código e a amostra observada). Os signatários não
mudam: uma chave da sua geração de chaves e as assinaturas que produzem atendem P-ED-1, exceto um nonce com r ≡ 0 mod L,
que dá a identidade como R e é rejeitado sem exceção. Os formatos, os contextos, `dcp-jcs-v1`, os schemas, o perfil
candidato experimental e as APIs anteriores não mudam.

**Migração.** Só afeta a evidência que não atende P-ED-1. Conserve-a como está e nunca normalize bytes assinados:
codificar de novo A ou R muda k (e, no caso de A, o `kid`), e reduzir S muda os bytes da assinatura e a mensagem do
componente PQ, que assina também a assinatura clássica.

- S ≥ L, ou R não canônica ou em E[8]: assinar de novo com a mesma chave, se essa chave atender P-ED-1.
- A não canônica: sua codificação canônica é outra chave para o DCP, com outro `kid`, então é preciso rotacionar a chave
  e assinar de novo.
- A em E[8]: substituir a chave; assinar de novo com ela não adianta.

Vetores: [`tests/interop/v2/ed25519_ped1_vectors.json`](../../../../../tests/interop/v2/ed25519_ped1_vectors.json), verificados por
`tools/ed25519-review/check_ped1_vectors.py`. Quais verificadores aplicam P-ED-1 e quais ainda não está em
[SECURITY_COVERAGE.md](../../../../../docs/conformance/SECURITY_COVERAGE.md).

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
