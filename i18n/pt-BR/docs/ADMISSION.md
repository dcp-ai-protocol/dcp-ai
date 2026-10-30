<sub>[English](../../../docs/ADMISSION.md) · [中文](../../zh-CN/docs/ADMISSION.md) · [Español](../../es/docs/ADMISSION.md) · [日本語](../../ja/docs/ADMISSION.md) · **Português**</sub>

<a id="admission-trusted-principals-and-the-strict-v1-profile"></a>

# Admissão: principais confiáveis e o perfil strict-v1

> Tradução informativa da [versão em inglês](../../../docs/ADMISSION.md), atualizada em 26/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Um bundle verificado prova sua integridade e que foi assinado pelas chaves que lista. Qualquer pessoa pode criar um registro de principal responsável com qualquer `human_id` e chaves próprias, então a verificação sozinha não diz **quem** é o principal.

A admissão acrescenta o que um operador precisa para aceitar evidências apenas de principais em que já confia:

- **Principais confiáveis.** O operador fornece um conjunto de confiança: o `human_id` de cada principal e as chaves públicas com que ele pode assinar. Um bundle só é admitido se as chaves que de fato verificaram as assinaturas do principal (o RPR e o manifesto do bundle, clássica e pós-quântica) forem chaves confiáveis desse principal, ativas e dentro da janela de validade.
- **O perfil strict-v1.** Opcional, versionado e fixado pelo operador: assinaturas híbridas em todos os níveis de risco, um `intended_verifier` assinado igual ao `verifier_id` do operador, uma janela de sessão assinada de no máximo 300 segundos e um snapshot de revogação com no máximo 300 segundos de idade.

> **Estado de publicação (26/10/2026).** A admissão e `strict-v1` estão publicados em `@dcp-ai/sdk` 2.2.0, Express/OpenClaw 2.1.0, Python `dcp-ai` 2.10.0, Go `v2.11.0` e Rust `dcp-ai` 2.11.0. Veja [npm](../../../docs/NPM_RELEASES.md), [Python](../../../docs/PYTHON_RELEASE.md), [Go](../../../docs/GO_RELEASE.md) e [Rust](../../../docs/RUST_RELEASE.md). O servidor de referência e o CLI da raiz continuam sendo executados de um checkout.

A definição normativa, com todas as regras e códigos de erro, é [`spec/profiles/admission`](../../../spec/profiles/admission/README.md). Os vetores de teste compartilhados estão em [`tests/interop/v2/admission_vectors.json`](../../../tests/interop/v2/admission_vectors.json).

<a id="it-is-opt-in"></a>

## É opt-in

A admissão só se aplica ao código que define um conjunto de confiança ou um perfil, e `verified` mantém o seu significado. Os verificadores também ganham um relógio opcional e informam as chaves que usaram, na mesma verificação. As mesmas mudanças também alteram a própria verificação, à parte da admissão: veja [Compatibilidade](#compatibility).

<a id="the-trust-set"></a>

## O conjunto de confiança

Quem o escreve é o operador; ele nunca vem de um bundle, de uma requisição, de um parâmetro de ferramenta nem de uma URL de um RPR. Esquema: [`schemas/v2/principal_trust_set.schema.json`](../../../schemas/v2/principal_trust_set.schema.json).

```json
{
  "trust_set_version": "2026-11-02.1",
  "principals": [
    {
      "human_id": "human:acme-ops",
      "keys": [
        { "kid": "…", "alg": "ed25519", "public_key_b64": "…", "status": "active" },
        { "kid": "…", "alg": "ml-dsa-65", "public_key_b64": "…", "status": "active", "expires_at": "2027-06-01T00:00:00Z" }
      ]
    }
  ]
}
```

Ele é recusado ao ser carregado se um kid não for derivado da sua chave, se uma chave estiver malformada, se um identificador estiver vazio ou se um `human_id` ou kid aparecer duas vezes. Os campos `status`, `not_before` e `expires_at` do conjunto de confiança são os que valem: um bundle que liste uma chave como `active` não pode restabelecer uma que o operador revogou.

**Rotação.** Adicione as chaves novas (com `not_before`, se quiser), mantenha as antigas `active` durante a sobreposição e depois aposente-as (`revoked`, `expired`, um `expires_at` ou removendo-as), cada vez com um `trust_set_version` novo. Um bundle não pode rotacionar as próprias chaves.

**As chaves do agente** não são listadas: a assinatura do principal sobre o manifesto cobre o hash do passaporte, e isso vincula o agente e suas chaves ao principal.

<a id="the-strict-v1-profile"></a>

## O perfil strict-v1

Esquema: [`schemas/v2/admission_profile.schema.json`](../../../schemas/v2/admission_profile.schema.json).

```json
{ "profile": "strict-v1", "verifier_id": "api.acme.example" }
```

| Requisito | Valor |
|---|---|
| Versão do bundle | Somente V2 |
| Assinaturas | Clássica e PQ, ambas válidas, em todos os níveis de risco (`hybrid_required`; `pq_only` não o satisfaz) |
| Principal | Confiável (acima), com os dois componentes da assinatura ancorados |
| Vinculação de sessão | Obrigatória |
| Janela de sessão | `session_issued_at` e `session_expires_at` assinados no manifesto; no máximo `max_session_duration_seconds` (padrão e máximo 300); iniciada dentro de 30 s de desvio de relógio; não expirada |
| Audiência | `intended_verifier` assinado igual a `verifier_id` |
| Revogação | Um snapshot do agente e de cada chave de assinatura verificada, com no máximo `max_revocation_age_seconds` de idade (padrão e máximo 300); nenhuma revogada ou desconhecida |

O perfil define requisitos, não padrões. `max_session_duration_seconds`, `max_revocation_age_seconds` e o `verifier_policy` opcional só podem endurecê-lo; um valor que o afrouxaria (`allow_v1_bundles: true`, `require_*: false`, um modo clássico ou `pq_only`, uma sessão mais longa, outro `verifier_id`) é um erro de configuração. Os adaptadores também recusam as próprias opções que o afrouxariam.

<a id="revocation-sources"></a>

## Fontes de revogação

A revogação é resolvida por uma fonte escolhida pelo operador; nenhum serviço central é necessário. Uma fonte recebe os sujeitos (`agent_ids` e `kids`) e retorna um snapshot:

```json
{ "checked_at": "2026-11-02T10:00:30Z", "agents": { "agent:acme-bot": "not_revoked" }, "keys": { "<kid>": "not_revoked" } }
```

`checked_at` é o momento em que a fonte estabeleceu os status. Uma fonte que excede o tempo, falha ou não retorna nada faz a requisição falhar com `REVOCATION_UNAVAILABLE`; nada é tratado, por padrão, como não revogado.

`denyListRevocationSource` (integrações TypeScript, o verificador de referência) e `deny_list_revocation_source` (Python) leem uma lista de bloqueio completa no formato de `/.well-known/dcp-revocations.json` do serviço de revogação de referência, com a URL e os cabeçalhos do operador, um tempo limite, sem redirecionamentos e com no máximo 16 MiB. A URL precisa ser `https` (`http` simples só para um host de loopback). Se faltar `revocations` ou `kid_revocations` (qualquer um dos dois campos), a lista é inválida, não vazia: ela pode ter sido truncada.

<a id="results"></a>

## Resultados

| Campo | Significado |
|---|---|
| `verified` | O veredito do verificador, inalterado |
| `principal_trust` | `trusted`, `untrusted` ou `not_evaluated` (sem conjunto de confiança, ou não verificado) |
| `profile` / `profile_compliance` | `strict-v1` ou null / `compliant`, `non_compliant`, `not_evaluated` |
| `admitted` | A decisão final com esta configuração |
| `action_authorized` | Sempre `false`: a admissão não autoriza nenhuma ação |
| `recorded_decision` | A decisão de política que o bundle registra (`approve`, `escalate`, `block`) |
| `trust_set_version` | O conjunto de confiança usado |
| `errors` | `{ code, message }`; os códigos estão listados na especificação, § 5.3 |

Um bundle que registra uma decisão `block` ou `escalate` pode ser admitido: ele é evidência dessa decisão, não uma permissão.

<a id="using-it"></a>

## Como usar

### TypeScript (`@dcp-ai/sdk`)

```ts
import { admitSignedBundleV2, createPrincipalTrustStore, resolveStrictV1Profile } from '@dcp-ai/sdk';

const trust = createPrincipalTrustStore(trustSetJson);           // throws AdmissionConfigError
const profile = resolveStrictV1Profile({ profile: 'strict-v1', verifier_id: 'api.acme.example' });
const result = await admitSignedBundleV2(signedBundle, registry, { profile, trust, revocation: snapshot });
if (!result.admitted) throw new Error(result.errors.map((e) => e.code).join(', '));
```

`evaluateAdmissionV2` recebe um resultado de verificação que você já tem (sem criptografia, sem E/S) e confia nele: passe apenas o resultado da verificação desse mesmo bundle, no mesmo `now`, sob a política do perfil. `revocationSubjects` diz a uma fonte pelo que ela precisa responder. Python, Go e Rust expõem as mesmas funções; veja a especificação, § 8.

### Express (`@dcp-ai/express`)

```ts
import { dcpVerify, denyListRevocationSource } from '@dcp-ai/express';

app.use('/api/agents', dcpVerify({
  trustedPrincipals: trustSetJson,                               // or ({ tenant }) => trust set
  profile: { profile: 'strict-v1', verifier_id: 'api.acme.example' },
  revocationSource: denyListRevocationSource({ url: 'https://revocation.acme.example/.well-known/dcp-revocations.json' }),
  tenant: (req) => req.auth.tenant,                              // from your own authentication
  cacheTtlSeconds: 60,
}));
```

Uma requisição só chega à rota quando o bundle é admitido; `req.dcpAgent.admission` traz o resultado. Uma função de confiança que lança uma exceção, ou que retorna `undefined`, `null` ou qualquer coisa que não seja um conjunto de confiança válido (por exemplo, um locatário para o qual não tem entrada), recusa a requisição com `503`: isso nunca significa «sem requisito de confiança». O cache guarda apenas a verificação criptográfica, indexada pelo bundle, pela política do verificador e pelo locatário; a confiança, as verificações do perfil e a revogação são avaliadas a cada requisição, então remover um principal ou revogar uma chave vale a partir da próxima. Executável: [`integrations/express/examples/strict-v1.mjs`](../../../integrations/express/examples/strict-v1.mjs).

### FastAPI (`dcp_ai.fastapi`)

`DCPVerifyMiddleware(app, require_bundle=True, trusted_principals=..., profile=..., revocation_source=deny_list_revocation_source(url), tenant=...)`, com as mesmas regras (`require_bundle` tem padrão `False` no FastAPI e precisa ser `True` com principais confiáveis); veja [`integrations/fastapi/README.md`](../../../integrations/fastapi/README.md).

### OpenClaw (`@dcp-ai/openclaw`)

```ts
configureVerifier({ trustedPrincipals, profile: { profile: 'strict-v1', verifier_id: 'agent-gateway' }, revocationSource });
```

`dcp_verify_bundle` passa então a informar `admitted` e só nomeia o agente para um bundle admitido. Sob o perfil, o parâmetro `verifier_policy` do modelo é recusado, e os parâmetros que a ferramenta não define são ignorados. Executável: [`integrations/openclaw/examples/strict-v1.mjs`](../../../integrations/openclaw/examples/strict-v1.mjs).

<a id="reference-server-and-cli"></a>

### Servidor de referência e CLI

O servidor de verificação (`npm run server`) expõe `POST /v2/admit` quando o operador define `DCP_TRUSTED_PRINCIPALS_FILE` (recarregado sempre que o conteúdo muda) e, para strict-v1, também `DCP_ADMISSION_PROFILE_FILE` e `DCP_REVOCATION_LIST_URL` (com um `DCP_REVOCATION_LIST_AUTHORIZATION` opcional). Ele se recusa a iniciar com uma configuração contraditória, ou com uma variável de admissão definida mas vazia. Offline:

```bash
# the reference CLI of a checkout; it reads only files in the current directory
node /path/to/dcp-ai/bin/dcp.js admit-bundle bundle.signed.json --trust trust.json --profile profile.json --revocation snapshot.json
```

<a id="compatibility"></a>

## Compatibilidade

- **API de verificação.** `verifySignedBundleV2` / `verify_signed_bundle_v2` / `VerifySignedBundleV2WithPolicy` / `verify_signed_bundle_v2_with_policy` mantêm as suas assinaturas. As chaves de assinatura são `details.signer_keys` em TypeScript e Python e o novo campo `SignerKeys` em Go. Em Rust, `V2VerificationResult` mantém seus dez campos, então o código que o constrói por inteiro ou o desestrutura sem `..` continua compilando; as chaves de assinatura vêm do novo `verify_signed_bundle_v2_at`, que retorna `V2VerificationDetails` (`result` e `signer_keys`) e é o que a admissão recebe. O código escrito contra a API de admissão antes da sua publicação lê `verification.result.verified` em vez de `verification.verified`.
- **Comportamento da verificação.** As mesmas mudanças alteram o comportamento da verificação, à parte da admissão. Assinaturas Ed25519 com S >= L agora são rejeitadas. Separadamente, os verificadores Go e Rust agora aplicam `accepted_classical_algs` e `accepted_pq_algs` de uma política, que antes recusavam por não serem aplicados: sob uma política assim, um bundle fora das listas falha, e um dentro delas agora pode ser verificado. O [CHANGELOG](../../../CHANGELOG.md) lista todas as mudanças.
- **Bundles.** Nenhuma mudança no formato de transmissão. strict-v1 precisa de bundles assinados com `session_issued_at`, `session_expires_at` e `intended_verifier` no manifesto, que todos os assinantes dos SDKs gravam quando recebem uma expiração e uma audiência.
- **Com um conjunto de confiança, bundles V1 são recusados**: eles não trazem nenhuma assinatura de principal para ancorar.
- **Opções das integrações.** Novas e opcionais. Com principais confiáveis, `requireBundle: false` (Express) e `require_bundle=False` (FastAPI) são erros de configuração: uma requisição sem bundle chegaria à rota. Sob o perfil, também o são `verifierPolicy`, `requireHybrid: false` e as opções `checkRevocation` (Express), `verifier_policy` (FastAPI) e `verifierPolicy` (OpenClaw).

<a id="limits"></a>

## Limites

- **Repetição.** O nonce de sessão, a audiência e a expiração limitam onde e por quanto tempo um bundle pode ser repetido; não o tornam de uso único. Um verificador que precise de uso único mantém o próprio registro de nonces ou hashes de bundles consumidos; a admissão não os consome.
- **Autorização.** `action_authorized` é sempre `false`. Vincular uma autorização externa a uma ferramenta, aos seus argumentos e à sua execução é uma fase posterior.
- **A identidade** é tão boa quanto o conjunto de confiança e o processo que o mantém.
- **A revogação** é tão recente quanto o snapshot: uma revogação posterior a `checked_at` é vista com o próximo snapshot.
