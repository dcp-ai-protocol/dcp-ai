<sub>[English](../../../../tests/nist-kat/README.md) · [Español](../../../es/tests/nist-kat/README.md) · **Português** · [日本語](../../../ja/tests/nist-kat/README.md) · [中文](../../../zh-CN/tests/nist-kat/README.md)</sub>

<a id="nist-kat-known-answer-test-compliance"></a>

# Conformidade NIST KAT (testes de resposta conhecida)

> Tradução informativa da [versão em inglês](../../../../tests/nist-kat/README.md), atualizada em 25/10/2026. Em caso de diferença, prevalece o original em inglês. Identificadores e blocos de código, incluindo comentários, são mantidos sem tradução.

Este diretório contém vetores de resposta conhecida e testes de propriedades usados pelos provedores criptográficos do DCP-AI. Passar nesses testes comprova o comportamento coberto, não a conformidade completa do algoritmo nem a validação NIST de um módulo criptográfico; veja [conformidade NIST e escopo](../../../../docs/NIST_CONFORMITY.md).

<a id="structure"></a>

## Estrutura

```
nist-kat/
  ed25519/
    vectors.json    -- RFC 8032 deterministic test vectors
  ml-dsa-65/
    vectors.json    -- FIPS 204 property test configuration
  ml-kem-768/
    vectors.json    -- FIPS 203 NIST ACVP decapsulation and key-check vectors
  slh-dsa-192f/
    vectors.json    -- FIPS 205 NIST ACVP signature-verification vectors
```

## Ed25519

Ed25519 (RFC 8032) usa assinatura determinística. `vectors.json` contém os vetores de teste exatos da seção 7.1 da RFC 8032. Todos os SDKs DEVEM produzir assinaturas idênticas para a chave secreta e a mensagem indicadas.

## ML-DSA-65

A assinatura ML-DSA-65 (FIPS 204) é hedged (aleatorizada) nos provedores TypeScript e Rust e determinística no provedor Go; ambas as variantes são válidas e verificadas da mesma forma. Vetores KAT diretos exigem controle da semente, que varia entre implementações. As verificações aqui cobrem:

1. **Conformidade de tamanhos** - chave pública (1952 B), assinatura (3309 B)
2. **Ciclo completo** - assinar e depois verificar tem sucesso
3. **Rejeição de outra chave** - a verificação com uma chave diferente falha
4. **Verificação entre SDKs** - assinaturas do SDK TypeScript são verificadas em todos os outros SDKs
5. **kid determinístico** - a derivação do kid é reproduzível entre SDKs

## ML-KEM-768

A desencapsulação ML-KEM-768 (FIPS 203) é determinística, então os casos `(dk, c) -> k` do NIST ACVP (`ML-KEM-encapDecap-FIPS203`) são KATs reais para qualquer implementação, incluindo a rejeição implícita de um texto cifrado modificado. O arquivo também contém as verificações de entrada do FIPS 203: uma chave de encapsulação com coeficientes >= q e uma chave de desencapsulação com `H(ek)` incorreto devem ser rejeitadas.

## SLH-DSA-192f

A assinatura SLH-DSA-SHA2-192f (FIPS 205) é aleatorizada; portanto, os vetores são casos de verificação de assinaturas do NIST ACVP (`SLH-DSA-sigVer-FIPS205`, interface externa, modo puro). O caso válido só verifica quando se aplica o prefixo `0x00 || len(ctx) || ctx` do FIPS 205, que o SPHINCS+ anterior ao padrão omite. O DCP assina com contexto vazio; esses casos têm um contexto, então os testes o passam explicitamente.

Ambos os arquivos registram a versão do ACVP-Server e o SHA-256 do arquivo de origem. Os valores são copiados literalmente: nunca os edite para corresponder a um SDK.

<a id="phase-1-gate"></a>

## Critério de aprovação da fase 1

O job de testes de cada SDK na CI executa seus testes KAT: TypeScript `src/__tests__/nist-kat.test.ts`, Python `tests/test_nist_kat.py`, Go `dcp/nist_kat_test.go` (dentro de `go test ./...`) e Rust `tests/nist_kat.rs`. Um KAT que falha faz o job falhar.
