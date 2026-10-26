<sub>[English](TESTING.md) · [中文](TESTING.zh-CN.md) · [Español](TESTING.es.md) · [日本語](TESTING.ja.md) · **Português**</sub>

<a id="testing-dcp-aicli"></a>

# Testes do `@dcp-ai/cli`

> Tradução informativa da [versão em inglês](TESTING.md), atualizada em 26/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

O CLI 2.1.0 publicado requer `@dcp-ai/sdk` `^2.2.0`, disponível no npm. Estes testes do repositório usam deliberadamente o SDK compilado do mesmo checkout para cobrir mudanças de código antes de uma publicação futura.

```bash
cd sdks/typescript && npm install && npm run build
cd ../../cli
npm install --no-save --package-lock=false --ignore-scripts --install-links ../sdks/typescript
npm test                        # both suites
npm run test:negative-control   # must print "failed as required"
```

`--install-links` copia o SDK compilado para `cli/node_modules` em vez de criar um link, e as demais opções deixam `package.json` e o lockfile intactos e não executam scripts de instalação. A CI faz o mesmo no job `cli` de `.github/workflows/ci.yml`, no Node 20 e 22. Esse job não instala a raiz do repositório, então nada é resolvido por um `node_modules` da raiz.

## Suítes

- `__tests__/verify-s-range.test.mjs`: verificação V1, o intervalo S do Ed25519 (RFC 8032 §5.1.7), os códigos de saída e a rejeição do formato V2 histórico.
- `__tests__/verify-v2-normative.test.mjs`: bundles V2 com o verificador normativo (os vetores entre SDKs, o envelope pré-normativo, a fixação de chave do `.dcp`), as cópias dos schemas em `lib/schemas/v2` e os arquivos empacotados executados por conta própria. Os seus processos filhos rodam com `Date.now` fixo, então o resultado não depende da data.

Cada caso executa `bin/dcp-ai.js` em um processo filho, em um diretório temporário novo sem nenhum `.dcp/` acima dele.

<a id="negative-control"></a>

## Controle negativo

Com `DCP_NEGATIVE_CONTROL=1`, cada suíte inverte um caso positivo. `__tests__/negative-control.mjs` executa as duas suítes dessa forma. Ele só passa quando a execução sai com 1, exatamente esses dois casos falham, cada um em uma asserção, e todos os outros testes passam, nenhum cancelado ou pulado. Qualquer outro resultado o faz falhar, inclusive uma suíte que não carrega.

O verificador de referência e o playground têm os seus próprios testes do intervalo S (`tools/crypto-s-range.test.mjs`, `tools/playground-s-range.test.mjs`), que o job `conformance` executa.
