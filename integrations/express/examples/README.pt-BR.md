<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · **Português**</sub>

<a id="examples"></a>

# Exemplos

> Tradução informativa da [versão em inglês](README.md), atualizada em 25/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Os dois são executados offline com os vetores de admissão compartilhados (`tests/interop/v2/admission_vectors.json`):
chaves e bundles sintéticos, o conjunto de confiança do operador e o perfil `strict-v1`, e um relógio fixado na hora
dos vetores.

A partir da raiz do repositório, compile primeiro o SDK do workspace em um subshell para que o comando seguinte continue começando nessa raiz:

```bash
(cd sdks/typescript && npm install && npm run build)
cd integrations/express && npm install && npm run build
node examples/strict-v1-body.mjs      # the recommended transport, checked over real HTTP
node examples/strict-v1.mjs           # the shortest strict-v1 setup
```

<a id="strict-v1-bodymjs-the-bundle-in-the-json-body"></a>

## `strict-v1-body.mjs`: o bundle no corpo JSON

Envia requisições HTTP reais a um servidor em `127.0.0.1`, checa cada resultado, fecha o servidor e sai com 1 se algum
resultado não for o esperado. `--report FILE` grava os resultados como JSON.

| Requisição | Resultado esperado |
|---|---|
| Bundle híbrido confiável em `signed_bundle` do corpo | `200`; a rota é executada com `req.dcpAgent.admission`, `actionAuthorized: false` |
| Bundle de um principal desconhecido | `403`, `TRUST_PRINCIPAL_UNKNOWN`; a rota não é executada |
| Bundle assinado para outro verificador | `403`, `PROFILE_AUDIENCE_MISMATCH` e `VERIFICATION_FAILED`; a rota não é executada |
| Corpo acima do orçamento | `413` do analisador do corpo: o middleware, a verificação, a confiança e a revogação nunca são executados |
| O mesmo bundle híbrido em `X-DCP-Bundle` | `431` do Node antes de o Express ver a requisição (só quando o bundle passa de `http.maxHeaderSize`) |

Contadores registram até onde cada requisição chegou (Express, depois do analisador do corpo, a fonte de confiança, a
fonte de revogação, a rota), então se mostra que o `413` para antes da verificação, não só antes da rota.

Um bundle admitido é **evidência**: autêntico e assinado para um principal em que você confia. Não é uma permissão para
executar a ação; `actionAuthorized` é sempre `false`, e a sua própria autorização decide o que a requisição pode fazer.

<a id="why-the-body"></a>

### Por que o corpo

Um bundle V2 híbrido traz chaves e assinaturas Ed25519 e ML-DSA-65: o bundle base dos vetores tem 32.996 bytes (33.014
em `{"signed_bundle": …}`). O limite padrão do Node para todos os cabeçalhos de uma requisição juntos é de 16 KiB
(`http.maxHeaderSize`), então o bundle em `X-DCP-Bundle` é recusado com `431` antes que qualquer middleware seja
executado. Proxies e balanceadores de carga têm os seus próprios limites de cabeçalhos. O cabeçalho continua suportado
para bundles que cabem em todos os limites do caminho; este exemplo não aumenta `maxHeaderSize`, e você também não
deveria fazê-lo para que um bundle híbrido caiba.

<a id="the-body-budget"></a>

### O orçamento do corpo

`BODY_BUDGET_BYTES` (64 KiB) é uma escolha deste exemplo, não um limite do protocolo: cerca de duas vezes o seu maior
bundle. Defina o seu para a sua implantação:

- Meça o maior bundle que você aceita. Ele cresce com a trilha de auditoria (cada entrada do bundle dos vetores tem cerca
  de 530 bytes) e com os checkpoints PQ, e os demais campos do corpo da sua requisição se somam a ele.
- Passe o orçamento ao analisador do corpo antes de `dcpVerify` (`express.json({ limit })`), e mantenha o mesmo limite,
  ou um maior, em todos os proxies na frente do servidor.
- Tudo o que passar do orçamento recebe `413` antes da verificação. Um orçamento pequeno demais recusa evidência válida;
  um grande demais permite que um cliente faça o servidor analisar corpos grandes.
