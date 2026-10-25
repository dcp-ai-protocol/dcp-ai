<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · **Português**</sub>

<a id="dcp-aiexpress--express-middleware"></a>
<a id="dcp-aiexpress-express-middleware"></a>

# @dcp-ai/express — middleware para Express

> Tradução informativa da [versão em inglês](README.md), atualizada em 25/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Middleware de verificação do DCP para Express.js. Verifica automaticamente os Signed Bundles em cada requisição e injeta os dados do agente verificado.

<a id="supported-dcp-specifications"></a>

## Especificações do DCP suportadas

Do DCP-01 ao DCP-09, de forma parcial: a verificação de bundles e a admissão como descritas abaixo, e alguns campos do DCP-05 e do DCP-09 (`requireActiveLifecycle`, `lifecycleState`, `mandateId`); não é uma implementação completa dessas especificações.

<a id="installation"></a>

## Instalação

> **Estado de publicação (25/10/2026).** O npm só tem `@dcp-ai/express` 2.0.0. Ele foi publicado antes da maior parte desta página e **não verifica as assinaturas dos bundles V2**: só checa a estrutura deles, então um bundle V2 falsificado ou alterado passa (corrigido em `main`, veja a seção `[Unreleased]` do [CHANGELOG.md](../../CHANGELOG.md)). Não confie na 2.0.0 para bundles V2. Ele também não inclui a admissão (`trustedPrincipals`, `profile`, `revocationSource`), `revocationFailClosed`, a supervisão de fontes nem `cancelOnDisconnect`. Este README segue o código-fonte em `main`. Até que `@dcp-ai/sdk` 2.2.0 esteja no npm, este pacote depende do SDK do workspace (`"@dcp-ai/sdk": "file:../../sdks/typescript"`); para publicá-lo, é preciso subir a dependência para `^2.2.0`, e o fluxo de publicação recusa um pacote que dependa de um caminho local.

Para usar a versão que esta página descreve, compile-a a partir de um checkout e instale-a de lá:

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
cd dcp-ai/sdks/typescript && npm install && npm run build      # the SDK of main
cd ../../integrations/express && npm install && npm run build  # this package
cd /path/to/your-app && npm install /path/to/dcp-ai/integrations/express express
```

A versão publicada (2.0.0), sem as funcionalidades listadas acima:

```bash
npm install @dcp-ai/express @dcp-ai/sdk
```

**Dependência par:** Express 4.18+ ou 5.x

<a id="quickstart"></a>

## Início rápido

```typescript
import express from "express";
import { dcpVerify, type DCPAgent } from "@dcp-ai/express";

// The middleware sets req.dcpAgent; the package does not augment Express's Request type
type DCPRequest = express.Request & { dcpAgent?: DCPAgent };

const app = express();
// The bundle travels in the JSON body: give the parser a budget sized for your bundles.
app.use(express.json({ limit: "64kb" }));

// Verify DCP on all routes
app.use(dcpVerify());

app.post("/api/action", (req: DCPRequest, res) => {
  // The verified agent is available at req.dcpAgent
  const agent = req.dcpAgent!;
  console.log(`Agent ${agent.agentId} (human: ${agent.humanId})`);
  console.log(`Capabilities: ${agent.capabilities}`);
  console.log(`Risk tier: ${agent.riskTier}`);

  res.json({ ok: true, agent_id: agent.agentId });
});

app.listen(3000);
```

<a id="sending-a-bundle-from-the-client"></a>

### Enviar um bundle a partir do cliente

Envie o bundle em `signed_bundle` do corpo JSON. É a forma recomendada para os bundles V2 híbridos, e o middleware
também lê o cabeçalho `X-DCP-Bundle` (primeiro) para os bundles que cabem em um. A primeira requisição abaixo é um
modelo: `{...}` representa um bundle assinado real.

```bash
# Via body (recommended)
curl -X POST http://localhost:3000/api/action \
  -H "Content-Type: application/json" \
  -d '{"signed_bundle": {...}, "action": "test"}'

# Via header: only for bundles that fit the header limits of the server and every proxy
curl -X POST http://localhost:3000/api/action \
  -H "Content-Type: application/json" \
  -H "X-DCP-Bundle: $(cat signed_bundle.json)" \
  -d '{"action": "test"}'
```

Um bundle híbrido (Ed25519 + ML-DSA-65) tem cerca de 33 KB: o bundle base dos vetores de admissão tem 32.996 bytes. O
limite padrão do Node para todos os cabeçalhos da requisição é de 16 KiB, então em `X-DCP-Bundle` ele recebe `431` antes
de o Express ser executado; não aumente o limite para que caiba. No corpo, o `limit` do analisador é o seu orçamento: um
corpo maior recebe `413` antes do middleware. O orçamento é uma escolha para a sua implantação, não um limite do
protocolo: meça o seu maior bundle (ele cresce com a trilha de auditoria e os checkpoints PQ), deixe margem e mantenha
os proxies na frente pelo menos tão permissivos. `examples/strict-v1-body.mjs` checa tudo isso com HTTP real (veja
`examples/README.md`).

<a id="api-reference"></a>

## Referência da API

### `dcpVerify(options?)`

Função fábrica que retorna um middleware do Express.

```typescript
import { dcpVerify } from "@dcp-ai/express";

app.use(dcpVerify({
  requireBundle: true,
  checkRevocation: false,
  cacheTtlSeconds: 300,
  headerName: "x-dcp-bundle",
  onFailure: (req, res, errors) => {
    res.status(403).json({ error: "DCP verification failed", details: errors });
  },
}));
```

<a id="options-dcpverifyoptions"></a>

### Opções (`DCPVerifyOptions`)

Uma opção desconhecida, um campo de `verifierPolicy` desconhecido ou um valor do tipo errado (por exemplo, `allow_v1_bundles: "false"`) lança uma exceção na criação do middleware: uma opção escrita errado não deve desligar uma checagem.

| Opção | Tipo | Padrão | Descrição |
|--------|------|---------|-------------|
| `requireBundle` | `boolean` | `true` | Exige um bundle em cada requisição. Se for `false`, as requisições sem bundle passam sem verificação. |
| `checkRevocation` | `boolean` | `false` | Em cada requisição, haja veredito em cache ou não, pergunta ao serviço de revogação se estão revogados o agente (`GET /check/<agent_id>`) ou, para a V2, alguma chave com a qual o bundle possa ser assinado (`GET /v2/check/kid/<kid>` para cada chave do passaporte, cada chave de vinculação do RPR e os kids clássico e PQ da assinatura do bundle). Uma resposta JSON com um `revoked` avaliado como verdadeiro recusa a requisição. |
| `revocationFailClosed` | `boolean` | `false` | Com `checkRevocation`: o que acontece quando uma consulta não dá resposta, ou seja, quando `fetch` lança uma exceção (serviço inalcançável), a resposta não é 2xx, o corpo não é JSON ou o seu `revoked` falta ou nem é avaliado como verdadeiro nem é `false`. `false` (o padrão) deixa a requisição passar (falha aberta); `true` a recusa com `403`. |
| `revocationServiceUrl` | `string` | `"http://localhost:3003"` | URL base do serviço de revogação. |
| `cacheTtlSeconds` | `number` | `0` | Segundos durante os quais os resultados de verificação ficam em cache. `0` desativa o cache. |
| `cacheMaxEntries` | `number` | `1000` | Máximo de bundles verificados mantidos no cache; o usado menos recentemente é removido primeiro. |
| `headerName` | `string` | `"x-dcp-bundle"` | Nome do cabeçalho HTTP em que o bundle pode ser enviado; é lido antes de `req.body.signed_bundle`. Só para bundles dentro dos limites de cabeçalhos do servidor e de todos os proxies (o do Node, por padrão, é de 16 KiB para todos os cabeçalhos): envie os bundles híbridos no corpo. |
| `onFailure` | `function` | `undefined` | Tratador próprio para os erros de verificação. Recebe `(req, res, errors)` e, para uma admissão recusada, o resultado da admissão como quarto argumento. |
| `verifierPolicy` | `object` | `undefined` | Campos da política do verificador (`VerifierPolicy` de `@dcp-ai/sdk`), combinados sobre o `DEFAULT_VERIFIER_POLICY` do SDK. Um `default_mode` sem `risk_overrides` se aplica a todos os níveis de risco; as entradas de `risk_overrides` definem os seus níveis por cima dos demais. |
| `requireHybrid` | `boolean` | `false` | Todo modo abaixo de `hybrid_required` passa a ser `hybrid_required`, e os bundles V1 são recusados. |
| `requireActiveLifecycle` | `boolean` | `false` | Recusa um agente cujo `status` do passaporte é `decommissioned`. Lê o estado do passaporte, não um certificado de comissionamento nem um registro de ciclo de vida do DCP-05. Só V2. |
| `trustedPrincipals` | `object` ou `function` | `undefined` | Os principais em que você confia e as suas chaves: um conjunto de confiança (`schemas/v2/principal_trust_set.schema.json`), ou `({ tenant }) => trust set` chamada em cada requisição. Com ela, só os bundles V2 admitidos chegam à rota (veja abaixo). Uma função que lança uma exceção, ou que retorna `undefined`, `null` ou um conjunto de confiança inválido, recusa a requisição com `503`. |
| `profile` | `object` | `undefined` | O perfil strict-v1 (`schemas/v2/admission_profile.schema.json`). Precisa de `trustedPrincipals` e de `revocationSource`. |
| `revocationSource` | `function` | `undefined` | `(subjects, { tenant }) => snapshot`, a fonte de revogação do perfil, por exemplo `denyListRevocationSource({ url, headers })`. |
| `revocationTimeoutMs` | `number` | `5000` | Quanto a fonte de revogação pode demorar antes de a requisição ser recusada. Com `supervise.revocation`, o prazo supervisionado: um inteiro de 1 a 2147483647. |
| `sourceSupervisor` | `object` | `undefined` | Um supervisor de `createSourceSupervisor`, junto com `supervise` (veja [Supervisionar a fonte de confiança](#supervising-the-trust-source)). |
| `supervise` | `object` | `undefined` | `{ trustTimeoutMs?, revocation? }`, pelo menos um: `trustTimeoutMs`, um inteiro de 1 a 2147483647, o prazo de uma função `trustedPrincipals` com `sourceSupervisor`; `revocation: true` executa sob ele a `revocationSource` do perfil, com `revocationTimeoutMs` (veja [Supervisionar a fonte de revogação](#supervising-the-revocation-source)). |
| `cancelOnDisconnect` | `boolean` | `false` | Quando o cliente vai embora de verdade durante a admissão, cancela a sua invocação supervisionada da fonte (veja [Um cliente que vai embora](#a-client-that-leaves)). |
| `tenant` | `function` | um único inquilino | `(req) => string`, a partir do seu próprio contexto autenticado, nunca de um cabeçalho que o cliente define. Seleciona o conjunto de confiança e separa os vereditos em cache. |
| `clock` | `function` | `Date.now` | Para os testes. |

### `req.dcpAgent`

Depois de uma verificação bem-sucedida, `req.dcpAgent` contém:

```typescript
interface DCPAgent {
  agentId: string;      // Agent ID
  humanId: string;      // ID of the responsible human
  publicKey: string;    // Ed25519 public key
  capabilities: string[];  // Declared capabilities
  riskTier: string;     // Risk level (low/medium/high)
  status: string;       // Status (active/suspended/revoked)
  dcpVersion: "1.0" | "2.0";
  kids?: string[];          // V2: key identifiers of the passport keys
  sessionNonce?: string;    // V2: session nonce of the bundle
  lifecycleState?: string;  // DCP-05 lifecycle state
  mandateId?: string;       // DCP-09 delegation mandate ID
  warnings?: string[];      // V2: warnings of the SDK verifier (e.g. classical-only signature)
  verificationMode?: string; // V2: the mode the bundle was verified in
  securityTier?: string;     // V2: security tier of its intent and policy decision (spec §14.2)
  admission?: {              // with trustedPrincipals
    admitted: true;
    principalTrust: "trusted";
    profile: "strict-v1" | null;
    profileCompliance: "compliant" | "not_evaluated";
    recordedDecision: string | null; // approve, escalate, block: evidence, not a permission
    trustSetVersion: string | null;
    actionAuthorized: false;         // always: admission does not authorize an action
  };
}
```

<a id="behavior"></a>

### Comportamento

1. Extrai o bundle assinado do cabeçalho `X-DCP-Bundle` (JSON) ou de `req.body.signed_bundle`
2. Verifica-o:
   - **V2** (`bundle.dcp_bundle_version: "2.0"`): `verifySignedBundleV2()` de `@dcp-ai/sdk`, com um registro Ed25519 / ML-DSA-65 / SLH-DSA-192f e a política acima. Checa os hashes dos payloads dos artefatos e o manifesto; a vinculação de sessão, a expiração e o início de sessão assinado (`session_issued_at`); a assinatura do bundle sobre o manifesto, feita pelo principal com as `binding_keys` do RPR, e o bloco `signature` não assinado, que deve concordar com ela; a assinatura própria de cada artefato; o modo de verificação, o mais estrito entre o modo da política para o `risk_tier` do passaporte e o modo do nível de segurança da intenção e da decisão de política (§14.2 da especificação); os checkpoints PQ; a coerência entre artefatos (estado do passaporte, expiração do RPR, um único agente, principal e intenção nos artefatos e nas entradas de auditoria); a cadeia de hash de auditoria; e a validade das chaves, a derivação dos kids e as chaves em base64 canônico (`spec/VERIFICATION.md` de V2-1 a V2-14). A cadeia de auditoria e a raiz de Merkle que ele checa são as SHA-256: ele não recalcula a cadeia nem a raiz secundárias SHA3-256 do V2-11, então a referência ao VERIFICATION.md não significa que cada um dos seus passos seja checado. Um bundle malformado é recusado com `403`, nunca é aceito só pela estrutura.
   - **V1** (`bundle.responsible_principal_record.dcp_version: "1.0"`): `verifySignedBundle()`, só onde o VERIFICATION.md V2-10 aceitaria um bundle só clássico, porque um bundle V1 não tem assinatura pós-quântica: `allow_v1_bundles` é `true`, `requireHybrid` está desligado, e o mais estrito entre o modo da política para o `risk_tier` do passaporte V1 (`default_mode` quando não tem nenhum) e o modo do nível de segurança da intenção e da decisão de política V1 (o `risk_score` V1 vai de 0 a 1, escalado por 1000; se faltar, conta como `elevated`) é `classical_only` ou `hybrid_preferred`. Com a política padrão, uma intenção V1 routine ou standard passa, enquanto um pagamento, dados sensíveis, um impacto estimado alto ou uma pontuação de risco de 0,5 ou mais são recusados. A um bundle V1 só se aplicam `allow_v1_bundles`, o modo e o nível: a vinculação de audiência, os limites de expiração e de duração da sessão, um `accepted_classical_algs` sem Ed25519 e os avisos que rejeitam Ed25519 são checagens da V2, e um bundle V1 que passa na checagem de modo é aceito mesmo quando eles estão definidos. Se precisar desses controles, defina `allow_v1_bundles: false` ou `requireHybrid: true`, ou use `trustedPrincipals` com o perfil strict-v1.
   - Um bundle cuja versão não pode ser detectada é recusado com `403`.
3. Se for válido: injeta `req.dcpAgent` e chama `next()`
4. Se falhar: responde com `403`, os `errors` e `warnings` do verificador (ou usa `onFailure`, se configurado)
5. Se ocorrer um erro interno: responde com `500`

<a id="what-verified-means"></a>

### O que «verificado» significa

Um bundle verificado é internamente coerente e assinado pelas chaves que ele mesmo lista: as `binding_keys` do RPR para a assinatura do bundle, as chaves do passaporte para os artefatos do agente. Ele não prova quem é o principal: qualquer pessoa pode criar chaves e um RPR que nomeie qualquer `human_id`. Para isso, defina `trustedPrincipals` (próxima seção).

Quem tiver um bundle verificado pode reenviá-lo até que a sua sessão expire. Contra o reenvio de bundles V2 (essas checagens não se aplicam a bundles V1, veja Comportamento), defina `verifierPolicy.require_audience_binding: true` com o seu `verifier_id` (o `manifest.intended_verifier` do bundle deve nomear este verificador), e `require_session_expiry` / `max_session_duration_seconds` para limitar a sessão, ou use o perfil strict-v1. Nada disso torna um bundle de uso único: mantenha o seu próprio registro de nonces consumidos, se precisar disso.

<a id="trusted-principals-and-strict-v1"></a>

### Principais confiáveis e strict-v1

Com `trustedPrincipals`, uma requisição chega à rota só quando o seu bundle é **admitido** (`docs/ADMISSION.md`, `spec/profiles/admission`): um bundle V2 cujas assinaturas do principal (o RPR e o manifesto do bundle, clássica e pós-quântica) foram feitas com chaves que o seu conjunto de confiança lista para esse `human_id`, ativas e dentro da sua janela de validade. Com `profile`, também se aplicam os requisitos do strict-v1: assinaturas híbridas para todos os níveis de risco, um `intended_verifier` assinado igual ao seu `verifier_id`, uma sessão assinada de no máximo 300 s e um instantâneo de revogação recente.

```typescript
import { dcpVerify, denyListRevocationSource } from "@dcp-ai/express";

app.use("/api/agents", dcpVerify({
  trustedPrincipals: trustSet,
  profile: { profile: "strict-v1", verifier_id: "api.acme.example" },
  revocationSource: denyListRevocationSource({ url: "https://revocation.acme.example/.well-known/dcp-revocations.json" }),
  tenant: (req) => req.auth.tenant,
  cacheTtlSeconds: 60,
}));
```

Uma requisição recusada recebe `403` com `{ verified, admitted: false, principal_trust, profile, profile_compliance, codes, errors }` e nunca chega à rota. `denyListRevocationSource` precisa de uma URL `https` (`http` simples só para um host de loopback), não segue redirecionamentos e lê no máximo 16 MiB. Uma fonte de revogação que falha, estoura o tempo ou não retorna nada recusa a requisição (`REVOCATION_UNAVAILABLE`). Com principais confiáveis, `requireBundle: false` lança `AdmissionConfigError` na criação do middleware: caso contrário, uma requisição sem bundle chegaria à rota. Com o perfil, `verifierPolicy`, `requireHybrid: false` e as opções de `checkRevocation` também lançam uma exceção. Com principais confiáveis, os bundles V1 são recusados: eles não trazem nenhuma assinatura do principal para ancorar. Executáveis: `examples/strict-v1.mjs` e, com HTTP real, o bundle no corpo e um orçamento do corpo, `examples/strict-v1-body.mjs`.

Os testes executam todos os casos de `tests/interop/v2/bundle_vectors.json`, cada um com os seus `verifier_policy_overrides`.

<a id="supervising-the-trust-source"></a>

### Supervisionar a fonte de confiança

Sem essas opções, uma função `trustedPrincipals` não tem prazo, como antes. Com elas, ela tem um, e uma parte de uma capacidade:

```typescript
import { createSourceSupervisor, dcpVerify } from "@dcp-ai/express";

// One object per process, shared by every middleware (and by @dcp-ai/openclaw) that should share one capacity.
const supervisor = createSourceSupervisor({ maxInFlight: 64, maxInFlightPerTenant: 8 });

app.use("/api/agents", dcpVerify({
  trustedPrincipals: ({ tenant, signal }) => loadTrustSet(tenant, { signal }),
  sourceSupervisor: supervisor,
  supervise: { trustTimeoutMs: 2000 },
  tenant: (req) => req.auth.tenant,
}));
```

- **Prazo.** A função recebe `{ tenant, signal }`. Um conjunto de confiança que chega depois de `trustTimeoutMs` não é usado, também quando o loop de eventos estava ocupado demais para executar o temporizador: o prazo é medido em um relógio monotônico quando o resultado chega. A requisição recebe então o mesmo `503` de uma fonte que falha (`TRUST_SOURCE_FAILED`), e `signal` é abortado.
- **Capacidade.** `maxInFlight` conta as chamadas que o middleware iniciou e que ainda não se resolveram, em todos os inquilinos; `maxInFlightPerTenant` limita um inquilino, e sem ele um único inquilino pode ocupar toda a capacidade. Uma chamada que não encontra vaga livre recebe o mesmo `503` na hora; não há fila. **Uma vaga só é liberada quando a função se resolve de verdade**, não quando a requisição estoura o tempo: uma fonte que nunca se resolve mantém a sua vaga, e quando todas as vagas estão ocupadas o middleware recusa todas as requisições até você reiniciar o processo ou criar outro supervisor.
- **Escopo.** A capacidade é por objeto supervisor. Dois supervisores são duas capacidades, então o limite de um processo é a soma dos supervisores que ele cria. Um supervisor criado por `@dcp-ai/openclaw`, a partir do seu build ESM ou CJS, funciona aqui também, e vice-versa.
- **`supervisor.close({ drainMs })`** recusa as chamadas novas, responde às pendentes com `503`, aborta todos os `signal` e espera no máximo `drainMs` (padrão 0) pelas chamadas em andamento. Ele se resolve com quantas ainda estão em andamento; as vagas delas continuam ocupadas.
- **`supervisor.stats()`** retorna contadores: `open`, `inFlight`, `tenants`, `timeouts`, `saturated`, `closed`, `lateResults`, `lateErrors`, `droppedEvents`. `onSourceEvent` em `createSourceSupervisor` recebe `{ source, reason, inFlight }`, nunca um inquilino. Ele precisa ser rápido, porque é executado no mesmo loop de eventos: uma chamada por vez, e os eventos que chegam enquanto há uma na fila ou com a promessa pendente são descartados e contados. Uma promessa ou um thenable retornados são assimilados como faz `Promise.resolve`: um thenable resolvido com uma promessa pendente o mantém ocupado, e um resolvedor chamado de novo mais tarde não libera nada. Os seus erros e rejeições são ignorados. Os contadores param em `Number.MAX_SAFE_INTEGER`.
- **O que ele não faz.** Não interrompe o trabalho de uma fonte: uma função que ignora `signal` é executada até o fim. Não limita o trabalho que uma função inicia por conta própria e não retorna. Não ajuda uma função que bloqueia o loop de eventos, o que atrasa todos os prazos. A verificação de um bundle continua sendo executada antes da fonte de confiança. Sem `supervise.revocation`, a revogação mantém `revocationTimeoutMs` como antes.

<a id="supervising-the-revocation-source"></a>

#### Supervisionar a fonte de revogação

Com o perfil strict-v1, `supervise: { revocation: true }` executa a `revocationSource` sob o mesmo tipo de supervisor, com `revocationTimeoutMs` como prazo (então, um inteiro de 1 a 2147483647):

```typescript
app.use("/api/agents", dcpVerify({
  trustedPrincipals: trustSet, // a static trust set, or a function supervised with trustTimeoutMs
  profile: { profile: "strict-v1", verifier_id: "verifier:acme-api" },
  revocationSource: denyListRevocationSource({ url: "https://revocations.example.com/.well-known/dcp-revocations.json" }),
  revocationTimeoutMs: 2000,
  sourceSupervisor: supervisor,
  supervise: { revocation: true }, // or { trustTimeoutMs: 2000, revocation: true }
}));
```

- **Opcional.** `supervise` aceita `trustTimeoutMs`, `revocation: true` ou os dois. `revocation: true` precisa de uma `revocationSource` e funciona com um conjunto de confiança estático. Sem ela, a revogação mantém `revocationTimeoutMs` como antes.
- **As mesmas respostas.** A fonte recebe `(subjects, { tenant, signal })`, e cada resposta dá o mesmo resultado que sem supervisão. Um instantâneo é avaliado como antes. `null`, uma falha, um tempo estourado, uma chamada sem vaga livre e um supervisor fechado dão `403` com `codes: ["REVOCATION_UNAVAILABLE"]`, nunca não revogado. Um erro cujo `code` é `REVOCATION_INVALID` dá `REVOCATION_INVALID` só quando chega antes do prazo; depois dele, é um tempo estourado.
- **Uma única capacidade.** As chamadas de confiança e de revogação ocupam vagas do mesmo supervisor, cada uma mantida até que a sua fonte se resolva de verdade. Um instantâneo atrasado nunca é usado, nem para a sua requisição nem para nenhuma outra, e o cache de vereditos nunca guarda um.
- **`denyListRevocationSource`** aborta o seu fetch, e a leitura do seu corpo, quando o `signal` do supervisor é abortado, além de no seu próprio `timeoutMs`.
- **Telemetria.** Os seus eventos trazem `source: 'revocation'`.
- **Limites.** Os mesmos da fonte de confiança. O caminho legado `checkRevocation` / `revocationServiceUrl` não é supervisionado.

<a id="a-client-that-leaves"></a>

#### Um cliente que vai embora

Com `cancelOnDisconnect: true`, um cliente que vai embora de verdade enquanto a sua requisição é admitida interrompe o trabalho dessa requisição:

```typescript
app.use("/api/agents", dcpVerify({
  trustedPrincipals: ({ tenant, signal }) => loadTrustSet(tenant, { signal }),
  sourceSupervisor: supervisor,
  supervise: { trustTimeoutMs: 2000 },
  cancelOnDisconnect: true,
}));
```

- **O que conta como ir embora.** A resposta se fecha antes de ser enviada, ou a requisição se fecha antes de o seu corpo estar completo. O próprio `close` de uma requisição depois de lido o seu corpo, que também acontece em requisições saudáveis, não conta.
- **O que ele cancela.**
  - Só a invocação supervisionada da fonte dessa requisição: o seu `signal` é abortado e a invocação é contada em `stats().cancelled`, com o motivo `'cancelled'` em `onSourceEvent`.
  - Nem o supervisor nem qualquer outra requisição.
  - A sua vaga continua ocupada até que a fonte se resolva de verdade, como depois de um prazo: uma fonte que ignora `signal` continua sendo executada.
- **O que acontece com a requisição.** Nada mais:
  - nem tratador nem `next()`;
  - nem escrita no cache nem `onFailure`;
  - nenhuma resposta é escrita.
  - A verificação do bundle não é interrompida; o middleware checa depois dela.
- **Requisitos.** Checados na criação do middleware:
  - Toda função de fonte deve ser supervisionada: `trustTimeoutMs` para uma função `trustedPrincipals`, e `revocation: true` para `revocationSource`. Não são permitidos nem `checkRevocation` nem um `cancelOnDisconnect` sem uma fonte supervisionada (`AdmissionConfigError`, `CONFIG_PROFILE_CONTRADICTION`).
  - O supervisor deve suportar o cancelamento (caso contrário, `CONFIG_INVALID_VALUE`). Os supervisores desta versão de `@dcp-ai/express` ou `@dcp-ai/openclaw`, ESM ou CJS, suportam; um de um pacote mais antigo não, e sem a opção ele continua funcionando como antes.
- **Ler `cancelled`.** `stats().cancelled` é opcional no tipo, para que um supervisor de um pacote mais antigo continue passando na checagem de tipos: leia-o como `stats().cancelled ?? 0`.

### Cache

Quando `cacheTtlSeconds > 0`, cada middleware mantém o seu próprio cache de bundles verificados, com a chave formada pelo SHA-256 da forma canônica do bundle assinado (`canonicalizeV2`), a impressão digital da política do verificador e o inquilino: um veredito em cache só é reutilizado para o mesmo bundle, com a mesma política e para o mesmo inquilino, e um bundle sem forma canônica (um número não inteiro como `1e999`, ou um aninhamento profundo demais) é verificado, mas não vai para o cache. Uma entrada expira depois de `cacheTtlSeconds`, ou antes, quando expiram a sessão do bundle (`manifest.session_expires_at`), o RPR, uma chave do passaporte ou uma chave de vinculação do RPR; um bundle com um carimbo de data/hora de expiração que não é RFC 3339 não vai para o cache. O cache mantém no máximo `cacheMaxEntries` bundles, removendo primeiro as entradas expiradas e depois as usadas menos recentemente. Com `checkRevocation`, a revogação é checada de novo a cada acerto do cache. Com `trustedPrincipals`, o cache só guarda a verificação criptográfica: a confiança no principal, as checagens do perfil e a revogação são avaliadas a cada requisição, então um principal removido do conjunto de confiança ou uma chave revogada são recusados na requisição seguinte.

<a id="advanced-example--selectively-protected-routes"></a>
<a id="advanced-example-selectively-protected-routes"></a>

## Exemplo avançado — rotas protegidas de forma seletiva

```typescript
import express from "express";
import { dcpVerify, type DCPAgent } from "@dcp-ai/express";

type DCPRequest = express.Request & { dcpAgent?: DCPAgent };

const app = express();
app.use(express.json());

// Public routes (no verification)
app.get("/health", (req, res) => res.json({ ok: true }));

// Protected routes (require DCP)
const protectedRoutes = express.Router();
protectedRoutes.use(dcpVerify({ cacheTtlSeconds: 60 }));

protectedRoutes.post("/agent/action", (req: DCPRequest, res) => {
  res.json({ agent: req.dcpAgent!.agentId });
});

protectedRoutes.get("/agent/profile", (req: DCPRequest, res) => {
  res.json(req.dcpAgent);
});

app.use("/api", protectedRoutes);
app.listen(3000);
```

<a id="development"></a>

## Desenvolvimento

```bash
# Build the workspace SDK first (see Installation), then:
npm install

# Build (ESM + CJS + types)
npm run build

# Tests
npm test
```

<a id="dependencies"></a>

### Dependências

- `@dcp-ai/sdk` — SDK de verificação do DCP
- `express` (par) — framework HTTP

<a id="license"></a>

## Licença

Apache-2.0
