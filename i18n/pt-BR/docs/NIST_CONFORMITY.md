<sub>[English](../../../docs/NIST_CONFORMITY.md) · [中文](../../zh-CN/docs/NIST_CONFORMITY.md) · [Español](../../es/docs/NIST_CONFORMITY.md) · [日本語](../../ja/docs/NIST_CONFORMITY.md) · **Português**</sub>

<a id="dcp-ai-nist-post-quantum-cryptography-conformity-statement"></a>

# Declaração de conformidade do DCP-AI com a criptografia pós-quântica do NIST

> Tradução informativa da [versão em inglês](../../../docs/NIST_CONFORMITY.md), atualizada em 28/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

**Versão da especificação:** 2.0
**Última atualização:** 25/10/2026
**Status:** Vigente — descreve os SDKs de `main` em 25/10/2026; os pacotes publicados podem estar atrasados (veja a seção *Release status* de cada SDK)

Este documento descreve como o DCP-AI se alinha às normas de criptografia pós-quântica do NIST e oferece uma avaliação de conformidade para implementadores. O DCP-AI incorpora algoritmos das FIPS 203, FIPS 204 e FIPS 205 como componentes centrais de sua arquitetura de segurança pós-quântica híbrida.

> **Algoritmos, não módulos validados.** Usar algoritmos especificados pelas FIPS 203, 204 e 205 não é uma validação FIPS 140-3. A validação se aplica a um módulo criptográfico, testado e listado pelo [Cryptographic Module Validation Program](https://csrc.nist.gov/projects/cryptographic-module-validation-program/validated-modules) do NIST. Este repositório não tem evidência de que as bibliotecas da §8 sejam módulos validados e não faz nenhuma afirmação sobre a FIPS 140. Ele também não tem integração com módulos de segurança de hardware (HSM): veja a §2.2.

---

<a id="1-standards-coverage"></a>

## 1. Cobertura de normas

| Norma do NIST | Algoritmo | Uso no DCP-AI | Incluído | Notas |
|---------------|-----------|-------------|---------|-------|
| FIPS 203 | ML-KEM-768 | KEM híbrido para sessões A2A, criptografia de envelopes | Python, Go, Rust, WASM (provedor público); TypeScript (interno, não exportado) | Nenhum SDK exporta a troca híbrida X25519 + ML-KEM-768; as sessões A2A recebem uma chave de sessão que quem chama deriva (§8). |
| FIPS 204 | ML-DSA-65 | Assinaturas pós-quânticas na vinculação composta | Os 5 SDKs | Assinatura PQ principal. |
| FIPS 204 | ML-DSA-87 | Assinaturas pós-quânticas de alta garantia | Não implementado | Identificador reservado no schema de chaves; nenhum SDK tem um provedor. |
| FIPS 205 | SLH-DSA-192f | Esquema de assinatura de reserva baseado em hash | TypeScript, Python, Rust, Go, WASM | Reserva ativa (SLH-DSA-SHA2-192f). |
| FIPS 205 | SLH-DSA-256f | Assinaturas baseadas em hash de nível 5 | Não incluído | Reservado. |
| SP 800-208 | LMS / XMSS | Não usado | Não se aplica | Só contexto: o DCP-AI usa SLH-DSA sem estado, não LMS/XMSS (§2.4). |

---

<a id="2-algorithm-parameter-mapping"></a>

## 2. Correspondência dos parâmetros dos algoritmos

<a id="21-ml-kem-fips-203--key-encapsulation"></a>
<a id="21-ml-kem-fips-203-key-encapsulation"></a>

### 2.1 ML-KEM (FIPS 203) — Encapsulamento de chaves

A especificação do DCP-AI usa ML-KEM-768 em uma construção híbrida com X25519 para estabelecer sessões entre agentes (A2A) e para a criptografia de envelopes opcional. Nenhum SDK executa essa troca: quem chama a realiza e é dono da chave de sessão (veja o fim desta seção).

| Parâmetro | Valor da FIPS 203 | Valor do DCP-AI | Notas |
|-----------|---------------|-------------|-------|
| Conjunto de parâmetros | ML-KEM-768 | `ml-kem-768` | Nível de segurança 3 do NIST |
| Tamanho da chave pública | 1184 bytes | 1184 bytes | Conforme |
| Tamanho do texto cifrado | 1088 bytes | 1088 bytes | Conforme |
| Tamanho do segredo compartilhado | 32 bytes | 32 bytes | Conforme |
| Construção híbrida | N/A | X25519 + ML-KEM-768 | Segredo compartilhado combinado via HKDF-SHA256 |
| Identificador no DCP-AI | N/A | `x25519-ml-kem-768` | Identificador do KEM híbrido |
| Derivação de chaves | N/A | HKDF-SHA256 (RFC 5869) | Chave de sessão A2A: `info = "DCP-AI.v2.A2A.SessionKey"` ([DCP-04](../../../spec/DCP-04.md) §3.4) |

**Uso no DCP-AI:**

- **Handshake A2A (DCP-04, construção especificada):** as duas partes trocam chaves públicas efêmeras do KEM híbrido. Cada parte encapsula para a chave da outra. As chaves de sessão são derivadas combinando os dois segredos compartilhados via HKDF-SHA256. Quem chama realiza esses passos; as funções de sessão do SDK recebem a chave resultante.
- **Recuperação de chaves (§11.2 da especificação):** a especificação criptografa com o KEM híbrido as partes Shamir SSS destinadas aos contatos de recuperação. O `setupKeyRecovery` do SDK e o `dcp recovery-setup` produzem as partes, mas não as criptografam; o `dcp recovery-setup` grava cada parte em seu próprio arquivo com modo `0600`.

**Construção do KEM híbrido na especificação** (tamanhos da tabela de algoritmos do [DCP-AI v2.0](../../../spec/DCP-AI-v2.0.md); chave de sessão do DCP-04 §3.4):

```
combined_pk = x25519_pk || ml_kem_768_pk       (1216 bytes)
combined_ct = x25519_ct || ml_kem_768_ct       (1120 bytes)
session_key = HKDF-SHA256(
  salt = nonce_A || nonce_B,
  ikm  = shared_secret_BA || shared_secret_AB,
  info = "DCP-AI.v2.A2A.SessionKey",
  len  = 32
)
```

**O código-fonte TypeScript tem um KEM híbrido interno com outra codificação.** `HybridKemProvider` (com `X25519KemProvider` e `MlKem768Provider`) está em `sdks/typescript/src`, mas não é exportado de `@dcp-ai/sdk`, então não faz parte da API do pacote. Ele não é a concatenação binária acima:

- sua chave pública combinada, sua chave secreta e seu texto cifrado são, cada um, o base64 de um objeto JSON `{ "classical": …, "pq": … }`, cujo componente X25519 é codificado em DER (SPKI, 44 bytes, na chave pública e no texto cifrado; PKCS#8 na chave secreta), não nos 32 bytes brutos, e cujos componentes ML-KEM-768 têm 1184 bytes (chave pública) e 1088 bytes (texto cifrado);
- seu segredo compartilhado é `HKDF-SHA256(ikm = x25519_ss || ml_kem_768_ss, salt = "DCP-AI.v2.HybridKEM", info = "x25519-ml-kem-768")`.

Nenhum SDK executa a troca do DCP-04 por você: a chave de sessão A2A da §3.4 é derivada por quem chama e passada às funções de sessão do SDK.

<a id="22-ml-dsa-fips-204--digital-signatures"></a>
<a id="22-ml-dsa-fips-204-digital-signatures"></a>

### 2.2 ML-DSA (FIPS 204) — Assinaturas digitais

O DCP-AI usa ML-DSA-65 como algoritmo principal de assinatura pós-quântica em vinculação composta com Ed25519. ML-DSA-87 está reservado, não implementado.

<a id="ml-dsa-65-primary"></a>

#### ML-DSA-65 (principal)

| Parâmetro | Valor da FIPS 204 | Valor do DCP-AI | Notas |
|-----------|---------------|-------------|-------|
| Conjunto de parâmetros | ML-DSA-65 | `ml-dsa-65` | Nível de segurança 3 do NIST |
| Tamanho da chave pública | 1952 bytes | 1952 bytes | Conforme |
| Tamanho da chave secreta | 4032 bytes | 4032 bytes | Conforme |
| Tamanho da assinatura | 3309 bytes | 3309 bytes | Conforme |
| Separação de domínios | parâmetro de string de contexto | Prefixo com tag de contexto | Veja a seção 3 |
| Assinatura aleatorizada | Com proteção (padrão) ou determinística | Conforme o provedor | Com proteção nos provedores TypeScript (padrão de `@noble/post-quantum`) e Rust (`try_sign` de `fips204`); determinística no provedor Go (`SignTo` da CIRCL com `randomized = false`); o Python segue o padrão de `pqcrypto`, que não é verificado aqui. As duas variantes são assinaturas FIPS 204 válidas e são verificadas da mesma forma |

<a id="ml-dsa-87-high-assurance--reserved"></a>
<a id="ml-dsa-87-high-assurance-reserved"></a>

#### ML-DSA-87 (alta garantia — reservado)

ML-DSA-87 está reservado para uso futuro de alta garantia. `ml-dsa-87` é um valor aceito de `alg` no schema de chaves, e os tamanhos abaixo são os da FIPS 204, mas nenhum SDK consegue gerar chaves, assinar ou verificar com ele, e a CLI de referência se recusa a gerar suas chaves.

O código-fonte do SDK TypeScript contém `HsmCryptoProvider` (`sdks/typescript/src/providers/hsm-provider.ts`), que lista `ml-dsa-87`. É um **padrão simulado**, não uma integração com HSM: não é exportado nem registrado, não tem vínculo PKCS#11, gera «chaves públicas» aleatórias, produz um hash onde deveria haver uma assinatura e seu `verify` aceita qualquer assinatura com o comprimento certo. Não deve ser usado para assinar nem para verificar evidência real.

| Parâmetro | Valor da FIPS 204 | Valor do DCP-AI | Notas |
|-----------|---------------|-------------|-------|
| Conjunto de parâmetros | ML-DSA-87 | `ml-dsa-87` | Nível de segurança 5 do NIST |
| Tamanho da chave pública | 2592 bytes | 2592 bytes | Conforme |
| Tamanho da chave secreta | 4896 bytes | 4896 bytes | Conforme |
| Tamanho da assinatura | 4627 bytes | 4627 bytes | Conforme |
| Status | — | Reservado | Não implementado em nenhum SDK. |

**Uso no DCP-AI:**

- **Assinaturas compostas:** ML-DSA-65 assina a concatenação (context_tag || 0x00 || payload || classical_sig) no modo de vinculação `pq_over_classical`.
- **Checkpoints PQ:** ML-DSA-65 assina raízes de Merkle de lotes de eventos de auditoria.
- **Assinatura de bundles:** as assinaturas compostas no nível do bundle combinam Ed25519 com ML-DSA-65.

<a id="23-slh-dsa-fips-205--stateless-hash-based-signatures"></a>
<a id="23-slh-dsa-fips-205-stateless-hash-based-signatures"></a>

### 2.3 SLH-DSA (FIPS 205) — Assinaturas baseadas em hash sem estado

O DCP-AI usa SLH-DSA-192f como esquema de assinatura pós-quântica de reserva. A segurança do SLH-DSA se baseia apenas em hipóteses sobre funções hash, o que oferece defesa em profundidade se as hipóteses baseadas em reticulados (ML-DSA) forem enfraquecidas.

<a id="slh-dsa-192f-backup"></a>

#### SLH-DSA-192f (reserva)

| Parâmetro | Valor da FIPS 205 | Valor do DCP-AI | Notas |
|-----------|---------------|-------------|-------|
| Conjunto de parâmetros | SLH-DSA-SHA2-192f | `slh-dsa-192f` | Nível de segurança 3 do NIST, variante rápida |
| Tamanho da chave pública | 48 bytes | 48 bytes | Conforme |
| Tamanho da chave secreta | 96 bytes | 96 bytes | Conforme |
| Tamanho da assinatura | 35.664 bytes | 35.664 bytes | Conforme |
| Funções hash | Conjunto de parâmetros SHA2 (SHA-256 e SHA-512) | Conjunto de parâmetros SHA2 | Conforme |

<a id="slh-dsa-256f-reserved"></a>

#### SLH-DSA-256f (reservado)

| Parâmetro | Valor da FIPS 205 | Valor do DCP-AI | Notas |
|-----------|---------------|-------------|-------|
| Conjunto de parâmetros | SLH-DSA-SHA2-256f | `slh-dsa-256f` | Nível de segurança 5 do NIST |
| Tamanho da chave pública | 64 bytes | 64 bytes | Reservado para uso futuro |
| Tamanho da assinatura | 49.856 bytes | 49.856 bytes | Reservado para uso futuro |

**Uso no DCP-AI:**

- **Alternativa de algoritmo:** se o ML-DSA for objeto de um aviso de governança que o declare obsoleto, os verificadores podem passar a usar SLH-DSA-192f como componente PQ das assinaturas compostas.
- **Auditorias de alta garantia:** organizações com postura de segurança conservadora podem exigir SLH-DSA junto com ML-DSA.

<a id="24-sp-800-208-context-only"></a>

### 2.4 SP 800-208 (só contexto)

A NIST SP 800-208 cobre os esquemas de assinatura baseados em hash com estado LMS e XMSS. Seus principais requisitos são operacionais: nunca reutilizar uma chave de assinatura de uso único e manter o estado de assinatura (o índice da próxima chave não usada) persistente e consistente. O DCP-AI não implementa LMS nem XMSS, então a SP 800-208 não se aplica a ele, e este documento não afirma nenhuma conformidade com ela. Em vez disso, o DCP-AI usa SLH-DSA sem estado (FIPS 205), que não tem estado de assinatura a manter. Essa escolha evita o risco de sincronização de estado em implantações distribuídas de agentes; não é conformidade com a SP 800-208, e o `kid` determinístico, que só nomeia uma chave pública, também não é.

---

<a id="3-domain-separation-and-context-binding"></a>

## 3. Separação de domínios e vinculação ao contexto

A FIPS 204 (ML-DSA) admite uma string de contexto opcional para separação de domínios. O DCP-AI não a usa: ele coloca a separação de domínios na própria mensagem, assim:

```
signed_bytes = UTF8(context_tag) || 0x00 || canonical_payload_bytes
```

A assinatura clássica (Ed25519) assina esses bytes como estão. Na vinculação `pq_over_classical`, a assinatura PQ os assina seguidos dos bytes da assinatura clássica (§2.2), então as duas assinaturas não cobrem a mesma mensagem. A tag de contexto do DCP é um prefixo dentro da mensagem, não a string de contexto da FIPS 204: os provedores dos SDKs chamam o ML-DSA com um `ctx` vazio. O byte separador 0x00 evita ambiguidade entre as tags de contexto e os dados do payload.

| Tag de contexto do DCP | Corresponde a |
|-----------------|---------|
| `DCP-AI.v2.AgentPassport` | Assinatura da identidade do agente |
| `DCP-AI.v2.ResponsiblePrincipal` | Assinatura do Responsible Principal Record |
| `DCP-AI.v2.Intent` | Assinatura da declaração de intenção |
| `DCP-AI.v2.PolicyDecision` | Assinatura da decisão de política |
| `DCP-AI.v2.AuditEvent` | Assinatura de checkpoints PQ e da compactação de auditoria (as entradas de auditoria V2 não são assinadas uma a uma) |
| `DCP-AI.v2.Bundle` | Assinatura no nível do bundle |
| `DCP-AI.v2.Revocation` | Assinatura do registro de revogação |
| `DCP-AI.v2.KeyRotation` | Prova de rotação de chaves |
| `DCP-AI.v2.Governance` | Operações de governança |

É uma seleção. `DCP_CONTEXTS` no SDK TypeScript lista 19 tags de contexto, incluindo as do DCP-05 ao DCP-09;
`DCP-AI.v2.Governance` não é uma delas: o módulo de governança do TypeScript a define como sua própria constante.

---

<a id="4-test-vector-references"></a>

## 4. Referências a vetores de teste

<a id="41-nist-kat-directory"></a>

### 4.1 Diretório de KAT do NIST

O DCP-AI mantém vetores Known Answer Test em `tests/nist-kat/`:

```
tests/nist-kat/
  ed25519/
    vectors.json    -- RFC 8032 Section 7.1 deterministic test vectors
  ml-dsa-65/
    vectors.json    -- FIPS 204 property test configuration
  ml-kem-768/
    vectors.json    -- FIPS 203 NIST ACVP decapsulation and key-check vectors
  slh-dsa-192f/
    vectors.json    -- FIPS 205 NIST ACVP signature-verification vectors
```

Consulte [`tests/nist-kat/README.md`](../../../tests/nist-kat/README.md) para saber o que cada arquivo verifica.

As tabelas das §4.3 a §4.5 e as listas da §5 indicam a cobertura que uma implementação deveria alcançar; não são uma
certificação. Nenhum arquivo cobre sozinho toda a matriz: `tests/nist-kat/` contém os vetores listados acima, as demais
linhas dependem dos testes próprios de cada SDK, que podem não cobrir todas elas, e o diretório não tem nenhum vetor para
a construção híbrida.

### 4.2 Ed25519 (RFC 8032)

O Ed25519 é determinístico. Os vetores de teste vêm diretamente da seção 7.1 da RFC 8032. Todos os SDKs do DCP-AI DEVEM produzir assinaturas idênticas para um mesmo par (secret_key, message).

### 4.3 ML-DSA-65 (FIPS 204)

O ML-DSA-65 admite assinatura aleatorizada e determinística; os provedores atuais dos SDKs usam modos diferentes, como descrito na seção 2.2. A comparação direta com os KAT exige controlar a aleatoriedade da assinatura, que varia entre bibliotecas criptográficas. O DCP-AI exercita as propriedades a seguir; essas checagens não equivalem a uma validação completa do algoritmo ou do módulo pelo NIST:

| Teste | Descrição | Requisito |
|------|-------------|------|
| Conformidade de tamanhos | Chave pública = 1952 B, assinatura = 3309 B | DEVE passar |
| Ida e volta | `verify(pk, sign(sk, msg), msg) == true` | DEVE passar |
| Rejeição com outra chave | `verify(pk_other, sign(sk, msg), msg) == false` | DEVE passar |
| Verificação entre SDKs | Uma assinatura do SDK A é verificada no SDK B | DEVE passar |
| kid determinístico | `kid(alg, pk)` é idêntico em todos os SDKs | DEVE passar |
| Separação de domínios | Uma assinatura com a tag de contexto A não é verificada com a tag B | DEVE passar |
| Vinculação composta | Remover a assinatura clássica invalida a assinatura PQ | DEVE passar |

### 4.4 SLH-DSA-192f (FIPS 205)

| Teste | Descrição | Requisito |
|------|-------------|------|
| Conformidade de tamanhos | Chave pública = 48 B, assinatura = 35.664 B | DEVE passar |
| Ida e volta | Assinar e depois verificar funciona | DEVE passar |
| Rejeição com outra chave | Verificar com outra chave falha | DEVE passar |
| Verificação entre SDKs | Interoperabilidade entre SDKs | DEVE passar |

### 4.5 ML-KEM-768 (FIPS 203)

| Teste | Descrição | Requisito |
|------|-------------|------|
| Conformidade de tamanhos | Chave pública = 1184 B, texto cifrado = 1088 B, SS = 32 B | DEVE passar |
| Ida e volta | `decapsulate(encapsulate(pk)) == shared_secret` | DEVE passar |
| Rejeição implícita | Desencapsular com outra chave retorna um segredo compartilhado diferente, não um erro (rejeição implícita da FIPS 203); o mesmo vale para um texto cifrado modificado | DEVE passar |
| Checagens de entrada | Entradas malformadas são rejeitadas com um erro: comprimentos errados, uma chave de encapsulamento com coeficientes ≥ q, uma chave de desencapsulamento com um `H(ek)` errado | DEVE passar |
| Construção híbrida | A saída combinada do HKDF coincide com a de referência | DEVE passar |

<a id="46-running-kat-tests"></a>

### 4.6 Execução dos testes KAT

```bash
# From the repository root; each line runs in a subshell, so the working directory does not change.
# They use the tools and dependencies already installed for each SDK; nothing here installs them.

# TypeScript SDK (vitest, from the SDK's own node_modules)
(cd sdks/typescript && ./node_modules/.bin/vitest run src/__tests__/nist-kat.test.ts)

# Python SDK (pytest)
(cd sdks/python && python3 -m pytest tests/test_nist_kat.py -v)

# Go SDK (conformance + interop + PQ providers in one run)
(cd sdks/go && go test ./...)

# Rust SDK (dedicated integration test)
(cd sdks/rust && cargo test --test nist_kat)
```

---

<a id="5-conformity-checklist-for-implementers"></a>

## 5. Lista de verificação de conformidade para implementadores

Use esta lista para verificar se a sua implementação do DCP-AI está em conformidade com as normas pós-quânticas do NIST.

<a id="51-ml-kem-768-fips-203-checklist"></a>

### 5.1 Lista do ML-KEM-768 (FIPS 203)

- [ ] O tamanho da chave pública é exatamente 1184 bytes
- [ ] O tamanho do texto cifrado é exatamente 1088 bytes
- [ ] O tamanho do segredo compartilhado é exatamente 32 bytes
- [ ] O encapsulamento usa uma implementação conforme a FIPS 203
- [ ] O desencapsulamento usa uma implementação conforme a FIPS 203
- [ ] A construção híbrida combina os segredos compartilhados de X25519 e ML-KEM-768 via HKDF-SHA256
- [ ] O parâmetro info do HKDF inclui uma tag de contexto do DCP-AI
- [ ] As chaves efêmeras são geradas por sessão (sigilo futuro)
- [ ] Os testes KAT passam para tamanho, ida e volta, rejeição implícita (outra chave ou um texto cifrado modificado dão um segredo compartilhado diferente) e checagens de entrada

<a id="52-ml-dsa-65-fips-204-checklist"></a>

### 5.2 Lista do ML-DSA-65 (FIPS 204)

- [ ] O tamanho da chave pública é exatamente 1952 bytes
- [ ] O tamanho da assinatura é exatamente 3309 bytes
- [ ] A assinatura usa uma implementação conforme a FIPS 204
- [ ] A verificação usa uma implementação conforme a FIPS 204
- [ ] As tags de contexto de separação de domínios são prefixadas antes de assinar
- [ ] Vinculação composta: a assinatura PQ cobre `context || 0x00 || payload || classical_sig`
- [ ] Derivação do kid: `hex(SHA-256(UTF8("ml-dsa-65") || 0x00 || raw_pk))[0:32]`
- [ ] Os testes KAT passam para tamanho, ida e volta, outra chave, entre SDKs e separação de domínios

<a id="53-ml-dsa-87-fips-204-checklist"></a>

### 5.3 Lista do ML-DSA-87 (FIPS 204)

Para uma implementação futura: hoje nenhum SDK do DCP-AI implementa ML-DSA-87 (§2.2).

- [ ] O tamanho da chave pública é exatamente 2592 bytes
- [ ] O tamanho da assinatura é exatamente 4627 bytes
- [ ] A mesma separação de domínios e a mesma vinculação composta que o ML-DSA-65
- [ ] A derivação do kid usa `"ml-dsa-87"` como identificador de algoritmo
- [ ] Os testes KAT passam

<a id="54-slh-dsa-192f-fips-205-checklist"></a>

### 5.4 Lista do SLH-DSA-192f (FIPS 205)

- [ ] O tamanho da chave pública é exatamente 48 bytes
- [ ] O tamanho da assinatura é exatamente 35.664 bytes
- [ ] A assinatura usa uma implementação conforme a FIPS 205
- [ ] A verificação usa uma implementação conforme a FIPS 205
- [ ] O mesmo padrão de separação de domínios que o ML-DSA
- [ ] A derivação do kid usa `"slh-dsa-192f"` como identificador de algoritmo
- [ ] Os testes KAT passam

<a id="55-general-cryptographic-checklist"></a>

### 5.5 Lista criptográfica geral

- [ ] Todas as operações PQ usam implementações de tempo constante quando possível
- [ ] As chaves privadas são zeradas após o uso (descarte seguro de memória)
- [ ] As chaves privadas são guardadas em um armazenamento adequado ao risco da implantação (este repositório não fornece integração com HSM/TPM)
- [ ] O sistema de avisos de algoritmos está implementado para a agilidade criptográfica
- [ ] Campos numéricos só inteiros (sem ponto flutuante) em todos os payloads assinados
- [ ] Canonicalização `dcp-jcs-v1` (baseada na RFC 8785 JCS), o perfil padrão e o único normativo, para toda assinatura de JSON; o candidato experimental `dcp-jcs-v2` só com uma ativação explícita

---

<a id="6-migration-path-classical-to-post-quantum"></a>

## 6. Caminho de migração: da criptografia clássica à pós-quântica

O DCP-AI define um caminho de migração em três fases, da segurança só clássica à pós-quântica.

As fases são o plano recomendado escrito em abril de 2026, não uma descrição do que os verificadores fazem hoje. Hoje,
`verifySignedBundleV2` só aceita bundles V2; se um bundle V1 é aceito é decidido por um roteador por versão ou por um
middleware conforme a sua política (`allow_v1_bundles`), que pode recusá-lo, mas não emite por si só nenhum aviso de
obsolescência ([MIGRATION_V1_V2.md](../../../docs/MIGRATION_V1_V2.md#32-coexistence-strategy)). Com `hybrid_preferred`, a ausência da assinatura PQ só é tolerada onde o modo efetivo (o mais
estrito entre o modo da política e o do nível de risco) permite, e uma assinatura PQ presente, mas inválida, é sempre
recusada.

<a id="phase-1-hybrid-introduction"></a>

### Fase 1: introdução híbrida

| Aspecto | Estado |
|--------|-------|
| Modo de verificação padrão | `hybrid_preferred` |
| Assinaturas clássicas | Obrigatórias |
| Assinaturas PQ | Recomendadas, não obrigatórias |
| Bundles V1 | Aceitos |
| Vinculação composta | Disponível, não obrigatória |

Ações para implementadores:
1. Integrar um provedor de ML-DSA-65 junto ao Ed25519.
2. Gerar pares de chaves híbridos (Ed25519 + ML-DSA-65).
3. Produzir assinaturas compostas quando possível.
4. Os bundles V1 continuam sendo verificados normalmente.

<a id="phase-2-hybrid-required"></a>

### Fase 2: híbrido obrigatório

| Aspecto | Estado |
|--------|-------|
| Modo de verificação padrão | `hybrid_required` |
| Assinaturas clássicas | Obrigatórias |
| Assinaturas PQ | Obrigatórias |
| Bundles V1 | Aceitos com avisos |
| Vinculação composta | Obrigatória para a V2 |

Ações para implementadores:
1. Todos os bundles V2 DEVEM incluir assinaturas compostas.
2. A política do verificador impõe `min_pq >= 1`.
3. As cadeias de hash duplo (SHA-256 + SHA3-256) DEVERIAM ser ativadas.
4. Os bundles V1 emitem avisos de obsolescência.

<a id="phase-3-pq-only-future-as-a-default"></a>

### Fase 3: só PQ (futura como padrão)

O modo de verificação `pq_only` já está implementado nos verificadores; o que é futuro é torná-lo o padrão.

| Aspecto | Estado |
|--------|-------|
| Modo de verificação padrão | `pq_only` |
| Assinaturas clássicas | Continuam fazendo parte da assinatura composta; com `pq_only`, a sua verificação pode deixar de ser um requisito de aceitação |
| Assinaturas PQ | Obrigatórias |
| Bundles V1 | Rejeitados |
| Vinculação composta | Continua sendo `pq_over_classical`: a assinatura PQ é verificada sobre a mensagem com separação de domínios e os bytes da assinatura clássica, então uma assinatura sem parte clássica não é um formato aceito |

Ações para implementadores:
1. A verificação clássica pode deixar de ser um requisito de aceitação; a assinatura clássica continua no formato composto.
2. Os bundles V1 são rejeitados por padrão.
3. O sistema de avisos de governança pode declarar obsoletos os algoritmos clássicos.
4. O SLH-DSA-192f fornece uma reserva se o ML-DSA for enfraquecido.

<a id="migration-timeline-recommended"></a>

### Cronograma de migração (recomendado)

Este cronograma foi escrito em abril de 2026 e é mantido como foi escrito. Em 25/10/2026, a política de verificador padrão de todos os SDKs usava `hybrid_preferred` (com `classical_only` para os passaportes de baixo risco), e o servidor de referência iniciava em `hybrid_required`; nenhum aviso de governança havia acionado a fase 3.

```
2026 Q1-Q2    Phase 1: Hybrid Introduction  [CURRENT]
              - SDKs v2.0.x ship composite signatures
              - Verifiers accept both V1 and V2 bundles
              - Early-adopter integrations surface real-world load

2026 Q3-Q4    Phase 2: Hybrid Required
              - Verifier policies default to hybrid_required
              - V1 bundles emit deprecation warnings
              - Wider production deployments

2027+         Phase 3: PQ-Only (conditional)
              - Triggered by a governance advisory if classical
                algorithms are weakened
              - V1 bundle rejection
              - Full post-quantum operation
```

---

<a id="7-nist-pq-standards-transition-guidance-alignment"></a>

## 7. Alinhamento com as diretrizes de transição para as normas PQ do NIST

O DCP-AI se alinha às diretrizes de transição publicadas pelo NIST para a criptografia pós-quântica:

| Diretriz do NIST | Implementação no DCP-AI |
|--------------|----------------------|
| Começar cedo as implantações híbridas | Assinaturas compostas híbridas desde o lançamento da v2.0 |
| Usar algoritmos aprovados das FIPS 203/204/205 | ML-KEM-768, ML-DSA-65, SLH-DSA-192f (ML-DSA-87 reservado, não implementado) |
| Manter a agilidade criptográfica | Registro de algoritmos + sistema de avisos + abstração de provedores |
| Planejar a obsolescência de algoritmos | Avisos assinados pela governança com resposta automática |
| Proteger dados de longa duração | Trilhas de auditoria encadeadas por hash; as cadeias de hash duplo são produzidas, e os verificadores V2 desde `@dcp-ai/sdk` 2.2.1, `@dcp-ai/wasm` 2.1.1, `dcp-ai` 2.10.1 (PyPI), Go v2.11.1 e Rust `dcp-ai` 2.11.1 verificam os campos secundários presentes (as versões anteriores não) ([STORAGE_AND_ANCHORING.md](../../../docs/STORAGE_AND_ANCHORING.md#dual-hash-chains)) |
| Usar construções híbridas durante a transição | Vinculação composta `pq_over_classical` |
| Módulos de segurança de hardware para guardar as chaves | Não implementado: não há integração com HSM/TPM; o `HsmCryptoProvider` do código-fonte é uma simulação (§2.2) |
| Testar a interoperabilidade | Validação KAT entre SDKs, suíte de testes de conformidade |

---

<a id="8-cryptographic-library-requirements"></a>

## 8. Requisitos das bibliotecas criptográficas

As implementações DEVEM usar bibliotecas criptográficas que forneçam implementações de algoritmos conformes ao NIST.

<a id="libraries-used-by-each-shipped-sdk"></a>

### Bibliotecas usadas por cada SDK incluído

| SDK | Biblioteca | Algoritmos |
|-----|---------|-----------|
| TypeScript (`@dcp-ai/sdk`) | `@noble/post-quantum` | ML-DSA-65, SLH-DSA-192f; ML-KEM-768 (interno, não exportado) |
| TypeScript (`@dcp-ai/sdk`) | `tweetnacl` | Ed25519 |
| TypeScript (`@dcp-ai/sdk`) | `crypto` do Node.js | SHA-256, SHA3-256, HMAC-SHA256 (HKDF); X25519 (interno, não exportado) |
| Python (`dcp-ai`) | `pqcrypto` ≥ 1.0 (crates Rust da Backbone, sem auditoria independente) | ML-DSA-65, ML-KEM-768, SLH-DSA-192f |
| Python (`dcp-ai`) | `pynacl` (libsodium) | Ed25519 |
| Go (`sdks/go/v2`) | `github.com/cloudflare/circl` | ML-DSA-65, ML-KEM-768, SLH-DSA-192f |
| Go (`sdks/go/v2`) | `crypto/ed25519` (biblioteca padrão) | Ed25519 |
| Rust (crate `dcp-ai`) | `fips203`, `fips204`, `fips205` (integritychain) | ML-KEM-768, ML-DSA-65, SLH-DSA-192f |
| Rust (crate `dcp-ai`) | `ed25519-dalek` | Ed25519 |
| WASM (`@dcp-ai/wasm`) | Compilado a partir do crate Rust acima | O mesmo conjunto do Rust |

Os SDKs Python, Go e Rust expõem o ML-KEM-768 como primitiva KEM (`MlKem768Provider`), e o `@dcp-ai/wasm` o expõe como funções `wasm_ml_kem_768_*`. O SDK TypeScript tem provedores de ML-KEM-768, X25519 e híbridos em seu código-fonte, mas não os exporta. Nenhum SDK executa a troca híbrida X25519 + ML-KEM-768 do DCP-04: as duas partes derivam a chave de sessão por conta própria e a passam às funções de sessão (`create_session` no Python, `CreateSession` no Go). O módulo A2A do Rust cobre apenas a descoberta, as mensagens do handshake e os IDs de sessão.

<a id="library-audit-requirements"></a>

### Requisitos de auditoria das bibliotecas

Em implantações de produção, as bibliotecas criptográficas DEVERIAM:
- Ter passado por uma auditoria de segurança independente
- Implementar operações de tempo constante nos ramos que dependem de segredos
- Fornecer APIs seguras para zerar a memória
- Passar nos vetores KAT do NIST para todos os algoritmos PQ

---

<a id="9-references"></a>

## 9. Referências

- **FIPS 203** — NIST, «Module-Lattice-Based Key-Encapsulation Mechanism Standard», agosto de 2024.
- **FIPS 204** — NIST, «Module-Lattice-Based Digital Signature Standard», agosto de 2024.
- **FIPS 205** — NIST, «Stateless Hash-Based Digital Signature Standard», agosto de 2024.
- **SP 800-208** — NIST, «Recommendation for Stateful Hash-Based Signature Schemes», outubro de 2020.
- **RFC 5869** — Krawczyk, H. e P. Eronen, «HMAC-based Extract-and-Expand Key Derivation Function (HKDF)», maio de 2010.
- **RFC 8032** — Josefsson, S. e I. Liusvaara, «Edwards-Curve Digital Signature Algorithm (EdDSA)», janeiro de 2017.
- **RFC 8785** — Rundgren, A., Jordan, B. e S. Erdtman, «JSON Canonicalization Scheme (JCS)», junho de 2020.
- **Especificação normativa do DCP-AI v2.0** — `spec/DCP-AI-v2.0.md`
- **Modelo de segurança do DCP-AI** — `docs/SECURITY_MODEL.md`
- **README dos KAT do NIST do DCP-AI** — `tests/nist-kat/README.md`
