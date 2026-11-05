<sub>[English](../../../../tests/nist-kat/README.md) · [Español](../../../es/tests/nist-kat/README.md) · **Português** · [日本語](../../../ja/tests/nist-kat/README.md) · [中文](../../../zh-CN/tests/nist-kat/README.md)</sub>

<a id="nist-kat-known-answer-test-compliance"></a>

# Conformidade NIST KAT (testes de resposta conhecida)

> Tradução informativa da [versão em inglês](../../../../tests/nist-kat/README.md), atualizada em 05/11/2026. Em caso de diferença, prevalece o original em inglês. Identificadores e blocos de código, incluindo comentários, são mantidos sem tradução.

Este diretório contém vetores de resposta conhecida e testes de propriedades usados pelos provedores criptográficos do DCP-AI. Passar nesses testes comprova o comportamento coberto, não a conformidade completa do algoritmo nem a validação NIST de um módulo criptográfico; veja [conformidade NIST e escopo](../../../../docs/NIST_CONFORMITY.md).

<a id="structure"></a>

## Estrutura

```
nist-kat/
  ed25519/
    vectors.json    -- RFC 8032 deterministic test vectors
  ml-dsa-65/
    vectors.json    -- FIPS 204 property test configuration
    acvp_sigver_tg3.json                  -- NIST ACVP sigVer test group 3 (ML-DSA-65, external, pure)
    wycheproof_mldsa_65_verify_test.json  -- C2SP Wycheproof ML-DSA-65 verification vectors
  ml-kem-768/
    vectors.json    -- FIPS 203 NIST ACVP decapsulation and key-check vectors
  slh-dsa-192f/
    vectors.json    -- FIPS 205 NIST ACVP signature-verification vectors
```

## Ed25519

Ed25519 (RFC 8032) usa assinatura determinística. `vectors.json` contém os vetores de teste exatos da seção 7.1 da RFC 8032. Todos os SDKs DEVEM produzir assinaturas idênticas para a chave secreta e a mensagem indicadas.

## ML-DSA-65

A assinatura ML-DSA-65 (FIPS 204) é hedged (aleatorizada) nos provedores TypeScript e Rust e determinística no provedor Go; ambas as variantes são válidas e verificadas da mesma forma. Reproduzir KATs de assinatura exige controlar a aleatoriedade da assinatura, que cada implementação expõe de forma diferente, por isso a assinatura é coberta por estas verificações de propriedades; a verificação não precisa desse controle e é coberta pelos [vetores de verificação](#ml-dsa-65-verification-vectors) abaixo. As verificações de propriedades cobrem:

1. **Conformidade de tamanhos** - chave pública (1952 B), assinatura (3309 B)
2. **Ciclo completo** - assinar e depois verificar tem sucesso
3. **Rejeição de outra chave** - a verificação com uma chave diferente falha
4. **Verificação entre SDKs** - assinaturas do SDK TypeScript são verificadas em todos os outros SDKs
5. **kid determinístico** - a derivação do kid é reproduzível entre SDKs

<a id="ml-dsa-65-verification-vectors"></a>
<a id="verification-vectors"></a>

### Vetores de verificação

Duas fontes independentes de casos de verificação ML-DSA-65 passam pelo provedor real de cada SDK:

| Arquivo | Origem | Fixado em | SHA-256 |
|---|---|---|---|
| `acvp_sigver_tg3.json` | NIST ACVP-Server `gen-val/json-files/ML-DSA-sigVer-FIPS204/internalProjection.json`, grupo de testes 3 (ML-DSA-65, interface externa, modo puro, 15 casos) | commit `a7f283cdc87d2d6dd93c1bac59e5622c5f9f8324` | arquivo de origem `47cdd6314c7f746d02421ffcba89d4dbc7bb875ac49e07a029fdfc26fba55437`; este arquivo `bacf4ad8e55db0594d8bf2878ca3bd3cb80cfa680aaf05ca8e1788d896f63eb8` |
| `wycheproof_mldsa_65_verify_test.json` | C2SP Wycheproof `testvectors_v1/mldsa_65_verify_test.json` (210 casos), Apache-2.0; não é uma fonte NIST | commit `20b256949ea8f21a11375619b1825027ca0668bd` | `1ca235f61928421a173a171780beb00264ae9155dc33c52a11e1766cc7979034` (o arquivo é uma cópia byte a byte) |

`acvp_sigver_tg3.json` contém o grupo de testes copiado sem alterações, com um objeto `_source` que indica o caminho, o commit e o SHA-256 do arquivo de origem e o aviso do NIST que o acompanha. Fixa-se um commit e não uma tag, porque tags podem mudar. Os valores são copiados literalmente: nunca os edite para coincidir com um SDK.

Todos os provedores dos SDKs verificam com o contexto vazio do FIPS 204 (o DCP coloca sua separação de domínio na mensagem; consulte o [§3 de conformidade NIST](../../../../docs/NIST_CONFORMITY.md)), por isso só os casos com contexto vazio passam por eles:

- **Executados: 204 casos, 77 válidos e 127 inválidos.** NIST tc39, o único caso do grupo de testes 3 com contexto vazio (inválido), e os 203 casos do Wycheproof sem contexto ou com contexto vazio (77 válidos, 126 inválidos).
- **Excluídos, e verificados por ID:** NIST tc31 a tc45 exceto tc39 (contextos não vazios, incluindo os três casos válidos tc33, tc43 e tc44), e Wycheproof tc3, tc4, tc5 e tc153 a tc156 (contextos não vazios). Os grupos de pré-hash e de interface interna não são usados.
- **Veredictos:** um caso válido deve retornar `true`. Um caso inválido deve retornar `false`, exceto em Go e Rust, onde o provedor retorna um erro para uma chave ou assinatura de comprimento incorreto: esse erro só conta nesses casos (Go: Wycheproof tc69, tc70, tc158 e tc159; Rust: esses e tc6, tc7 e tc157) e só com o erro de comprimento exato do provedor. Qualquer outro erro ou pânico faz o teste falhar.

Cada SDK tem três testes: um verifica o SHA-256 dos dois arquivos, as contagens e os IDs excluídos; outro verifica que o provedor é o do SDK; e o teste de veredictos executa os casos e falha se não forem executados exatamente 204. O destino WASM é o provedor Rust compilado para `wasm32-unknown-unknown` e executado com `wasm-bindgen-test` (`sdks/rust/tests/wasm_mldsa65_vectors.rs` no Node, `wasm_mldsa65_vectors_browser.rs` em um navegador), com os arquivos incorporados na compilação; ele compartilha a implementação Rust e não é uma quinta biblioteca. O pacote npm `@dcp-ai/wasm` não expõe uma verificação ML-DSA bruta, por isso esses vetores não passam pelos seus exports.

Limites: passar nesses casos não é validação NIST (CAVP nem CMVP) de nenhuma biblioteca ou módulo. Contextos não vazios, ML-DSA com pré-hash, a interface interna e a assinatura não são cobertos por vetores. Os nomes dos flags do Wycheproof e dos motivos do ACVP são mantidos como registrados na origem; não afirmam qual condição do FIPS 204 cada caso exercita.

## ML-KEM-768

A desencapsulação ML-KEM-768 (FIPS 203) é determinística, então os casos `(dk, c) -> k` do NIST ACVP (`ML-KEM-encapDecap-FIPS203`) são KATs reais para qualquer implementação, incluindo a rejeição implícita de um texto cifrado modificado. O arquivo também contém as verificações de entrada do FIPS 203: uma chave de encapsulação com coeficientes >= q e uma chave de desencapsulação com `H(ek)` incorreto devem ser rejeitadas.

## SLH-DSA-192f

A assinatura SLH-DSA-SHA2-192f (FIPS 205) é aleatorizada; portanto, os vetores são casos de verificação de assinaturas do NIST ACVP (`SLH-DSA-sigVer-FIPS205`, interface externa, modo puro). O caso válido só verifica quando se aplica o prefixo `0x00 || len(ctx) || ctx` do FIPS 205, que o SPHINCS+ anterior ao padrão omite. O DCP assina com contexto vazio; esses casos têm um contexto, então os testes o passam explicitamente.

Ambos os arquivos registram a versão do ACVP-Server e o SHA-256 do arquivo de origem. Os valores são copiados literalmente: nunca os edite para corresponder a um SDK.

<a id="phase-1-gate"></a>

## Critério de aprovação da fase 1

O job de testes de cada SDK na CI executa seus testes KAT: TypeScript `src/__tests__/nist-kat.test.ts`, Python `tests/test_nist_kat.py`, Go `dcp/nist_kat_test.go` (dentro de `go test ./...`) e Rust `tests/nist_kat.rs`. O job WASM executa `sdks/rust/tests/wasm_mldsa65_vectors.rs` no Node com `wasm-pack test` e falha a menos que seus três testes passem. Um KAT que falha faz o job falhar.
