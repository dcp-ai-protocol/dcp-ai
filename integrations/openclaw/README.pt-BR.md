<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · **Português**</sub>

<a id="dcp-aiopenclaw--dcp-integration-for-openclaw"></a>
<a id="dcp-aiopenclaw-dcp-integration-for-openclaw"></a>

# @dcp-ai/openclaw — integração do DCP para o OpenClaw

> Tradução informativa da [versão em inglês](README.md), atualizada em 25/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Plugin do [OpenClaw](https://github.com/openclaw/openclaw) que adiciona ferramentas do **Digital Citizenship Protocol (DCP)** aos agentes de IA. Uma ação é declarada, pontuada por risco e
registrada em uma trilha de auditoria encadeada por hash e vinculada a um proprietário humano quando o agente chama essas ferramentas: o plugin não
intercepta as demais ferramentas do agente. Para controlar cada ação sensível, o host deve interceptar ele mesmo essas chamadas de ferramentas
e chamar `dcp_declare_intent` / `dcp_log_action` em torno delas. O estado da sessão fica em um `Map` em memória e se perde
quando o processo é reiniciado.

<a id="supported-dcp-specifications"></a>

## Especificações do DCP suportadas

Do DCP-01 ao DCP-09, de forma parcial: as ferramentas abaixo criam registros nos formatos dessas especificações, e
`dcp_verify_bundle` verifica bundles. Não as implementa por completo.

<a id="features"></a>

## Funcionalidades

- **Identidade (DCP-01)** — geração de pares de chaves Ed25519, Responsible Principal Record, Agent Passport
- **Declaração de intenção (DCP-02)** — pontuação de risco e uma decisão de política antes das ações sensíveis, que o host aplica
- **Trilha de auditoria (DCP-03)** — registro de ações encadeado por hash com referências a evidências: permite detectar adulterações (uma entrada alterada quebra a cadeia), não é imutável e fica em memória
- **Ciclo de vida (DCP-05)** — colocação em serviço, relatórios de vitalidade e desativação de agentes
- **Sucessão (DCP-06)** — testamento digital com preferências de sucessor e classificação da memória
- **Delegação (DCP-09)** — criação de mandatos de delegação para transferir autoridade de humano para agente
- **Verificação de bundles** — os Signed Bundles V2 são verificados por `verifySignedBundleV2` do SDK (assinaturas, hashes, vinculação de sessão, cadeia de auditoria, validade das chaves) sob a política de verificador do operador
- **Assinatura de bundles** — constrói e assina um CitizenshipBundle no fim da sessão: uma intenção e a sua decisão de política, com as entradas de auditoria da sessão (veja a nota em [Pontuação de risco](#risk-scoring))
- **Registros do DCP-05 ao DCP-09** — os registros de colocação em serviço, vitalidade, desativação, testamento e mandato ficam no estado da sessão; `dcp_sign_bundle` não os adiciona ao bundle e o plugin não os envia a lugar nenhum
- **SKILL.md** — skill complementar que ensina o agente a usar as ferramentas do DCP

<a id="installation"></a>

## Instalação

**Publicado no npm (26/10/2026).** `@dcp-ai/openclaw` 2.1.0 é `latest` e depende de `@dcp-ai/sdk` `^2.2.0`. As funcionalidades descritas abaixo estão disponíveis no npm.

**Atualize da 2.0.0:** essa versão verifica a estrutura V2 sem verificar assinaturas. Use 2.1.0 para o verificador corrigido, a admissão e a supervisão de fontes. Veja [SECURITY.md](../../SECURITY.md).

```bash
npm install @dcp-ai/openclaw@^2.1.0
```

Veja o [inventário de publicações npm](../../docs/NPM_RELEASES.md) para todas as versões.

Para desenvolver a partir de uma cópia do repositório, compile e instale o pacote local:

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
cd dcp-ai/integrations/openclaw
npm ci && npm run build
# then, in your project (or OpenClaw plugins directory):
npm install /path/to/dcp-ai/integrations/openclaw
```

Adicione à configuração do OpenClaw:

```yaml
plugins:
  - "@dcp-ai/openclaw"
```

<a id="tools-registered"></a>

## Ferramentas registradas

| Ferramenta | Descrição | Especificação do DCP |
|------|-------------|----------|
| `dcp_identity_setup` | Gera o par de chaves + RPR + AgentPassport | DCP-01 |
| `dcp_declare_intent` | Declara a intenção e obtém a decisão de política (approve/escalate/block) | DCP-02 |
| `dcp_verify_bundle` | Verifica um Signed Bundle com o verificador do SDK (assinatura + hashes + vinculação de sessão) | VERIFICATION |
| `dcp_log_action` | Registra a ação como AuditEntry com encadeamento por hash | DCP-03 |
| `dcp_get_audit_trail` | Recupera a trilha de auditoria da sessão | DCP-03 |
| `dcp_commission_agent` | Coloca um agente em serviço (ciclo de vida → commissioned) | DCP-05 |
| `dcp_report_vitality` | Informa métricas de vitalidade e obtém a pontuação calculada | DCP-05 |
| `dcp_decommission_agent` | Desativa um agente (graceful/immediate/emergency) | DCP-05 |
| `dcp_create_testament` | Cria um testamento digital com preferências de sucessor | DCP-06 |
| `dcp_create_mandate` | Cria um mandato de delegação de humano para agente | DCP-09 |
| `dcp_sign_bundle` | Constrói e assina o CitizenshipBundle a partir do estado da sessão | BUNDLE |

<a id="usage-flow"></a>

## Fluxo de uso

```
┌─────────────────────────────────────────────────────┐
│                  Session Start                       │
│  dcp_identity_setup(owner, jurisdiction, caps)       │
└──────────────────────┬──────────────────────────────┘
                       │
          ┌────────────▼─────────────┐
          │   For each sensitive      │
          │   action:                 │
          │                           │
          │  1. dcp_declare_intent()  │
          │     → approve/escalate/   │
          │       block               │
          │                           │
          │  2. [perform action]      │
          │                           │
          │  3. dcp_log_action()      │
          └────────────┬─────────────┘
                       │ (repeat)
          ┌────────────▼─────────────┐
          │     Session End           │
          │  dcp_sign_bundle()        │
          │  → SignedBundle           │
          └───────────────────────────┘
```

<a id="architecture"></a>

## Arquitetura

```
integrations/openclaw/
├── package.json               # Dependencies: @dcp-ai/sdk, @sinclair/typebox
├── tsconfig.json
├── SKILL.md                   # Companion skill with agent instructions
├── README.md                  # This file
└── src/
    ├── index.ts               # Plugin entry — registerTool() calls
    ├── tools/
    │   ├── identity.ts        # dcp_identity_setup
    │   ├── intent.ts          # dcp_declare_intent
    │   ├── verify.ts          # dcp_verify_bundle
    │   ├── audit.ts           # dcp_log_action + dcp_get_audit_trail
    │   ├── lifecycle.ts       # dcp_commission_agent + dcp_report_vitality + dcp_decommission_agent
    │   ├── succession.ts      # dcp_create_testament
    │   └── delegation.ts      # dcp_create_mandate
    └── state/
        └── agent-state.ts     # Per-session DCP state management
```

<a id="bundle-verification"></a>

## Verificação de bundles

<a id="policy-set-by-the-operator-tightened-by-the-model"></a>

### Política: definida pelo operador, endurecida pelo modelo

A política de verificador de `dcp_verify_bundle` é a do operador: a `DEFAULT_VERIFIER_POLICY` do SDK, a menos que o host defina outra, com `register(api, { verifierPolicy })` ou `configureVerifier({ verifierPolicy })` (campos sobre a política padrão; um `default_mode` sem `risk_overrides` se aplica a todos os níveis de risco; um campo desconhecido ou um tipo errado lança uma exceção).

```typescript
import register, { configureVerifier } from '@dcp-ai/openclaw';

configureVerifier({ verifierPolicy: { default_mode: 'hybrid_required', require_audience_binding: true, verifier_id: 'my-service' } });
```

O parâmetro `verifier_policy` da ferramenta é definido pelo modelo que chama, então só pode tornar essa política mais estrita: `default_mode` eleva cada nível de risco pelo menos a esse modo (`classical_only` < `hybrid_preferred` < `hybrid_required`; `pq_only` combinado com qualquer outro modo dá `hybrid_required`, porque `pq_only` dispensa a assinatura clássica que os outros modos exigem), `require_session_binding` e `require_composite_binding` só podem ser ativados, e `allow_v1_bundles` só pode ser desativado. Qualquer outro campo é um erro.

<a id="what-is-checked"></a>

### O que é verificado

- **V2**: `verifySignedBundleV2` de `@dcp-ai/sdk`, com um registro Ed25519 / ML-DSA-65 / SLH-DSA-192f e a política acima. Verifica os hashes das cargas úteis dos artefatos e o manifesto; a vinculação de sessão, a expiração e o início de sessão assinado (`session_issued_at`); a assinatura do bundle sobre o manifesto, feita pelo principal com as `binding_keys` do RPR, e o bloco `signature` não assinado que deve concordar com ela; a assinatura própria de cada artefato; o modo de verificação, o mais estrito entre o modo da política para o `risk_tier` do passaporte e o modo do nível de segurança da intenção e da decisão de política (spec §14.2); os checkpoints PQ; a coerência entre artefatos (estado do passaporte, expiração do RPR, um único agente, principal e intenção nos artefatos e nas entradas de auditoria); a cadeia de hash de auditoria (SHA-256: a cadeia e a raiz secundárias SHA3-256 do V2-11 não são recalculadas); e a validade das chaves, a derivação dos kid e as chaves em base64 canônico (`spec/VERIFICATION.md` V2-1 a V2-14).
- **V1** (uma assinatura Ed25519): verificado com `verifySignedBundle` apenas onde o VERIFICATION.md V2-10 aceitaria um bundle apenas clássico: `allow_v1_bundles` é true e o mais estrito entre o modo da política para o `risk_tier` do passaporte V1 e o modo do nível de segurança da intenção e da decisão de política V1 (o `risk_score` V1 vai de 0 a 1 e é multiplicado por 1000; se faltar, conta como `elevated`) é `classical_only` ou `hybrid_preferred`. Com a política padrão, uma intenção V1 routine ou standard passa; um pagamento, dados sensíveis, um impacto estimado alto ou uma pontuação de risco de 0,5 ou mais são recusados.
- Um bundle cuja versão não pode ser detectada é rejeitado.

A um bundle V1 só se aplicam `allow_v1_bundles`, o modo e o nível: a vinculação de audiência, a expiração e os limites de
duração da sessão, um `accepted_classical_algs` sem Ed25519 e os avisos que rejeitam Ed25519 são verificações do V2, e um
bundle V1 que passa na verificação do modo é aceito mesmo quando eles estão definidos. Se você precisa desses controles, defina
`allow_v1_bundles: false`, ou use principais confiáveis com o perfil strict-v1.

O resultado traz os `errors` e `warnings` do verificador, `resolved_tier` (o nível de segurança) e, para V2, `verification_mode`. `agent_id`, `human_id` e `session_nonce` só são devolvidos para um bundle verificado.

<a id="what-verified-means"></a>

### O que significa “verificado”

Um bundle verificado é internamente coerente e assinado pelas chaves que ele mesmo lista: as `binding_keys` do RPR para a assinatura do bundle e as chaves do passaporte para os artefatos do agente. Não prova quem é o principal: qualquer pessoa pode criar chaves e um RPR que nomeie qualquer `human_id`. Para isso, configure principais confiáveis (próxima seção). Um bundle verificado também pode ser reenviado até a sua sessão expirar; `require_audience_binding` da política do operador com um `verifier_id` (o `manifest.intended_verifier` do bundle deve nomeá-lo) e `require_session_expiry` / `max_session_duration_seconds` limitam isso, sem torná-lo de uso único.

<a id="trusted-principals-and-strict-v1"></a>

### Principais confiáveis e strict-v1

```typescript
import { configureVerifier, denyListRevocationSource } from '@dcp-ai/openclaw';

configureVerifier({
  trustedPrincipals: trustSet,                     // or () => trust set, read on every call
  profile: { profile: 'strict-v1', verifier_id: 'agent-gateway' },
  revocationSource: denyListRevocationSource({ url: 'https://revocation.acme.example/.well-known/dcp-revocations.json' }),
});
```

Com `trustedPrincipals`, o resultado acrescenta `admitted`, `principal_trust`, `profile`, `profile_compliance`, `codes`, `recorded_decision`, `trust_set_version` e `action_authorized` (sempre `false`), e nomeia o agente e o principal apenas para um bundle admitido (`docs/ADMISSION.md`, `spec/profiles/admission`). `verified` mantém o seu significado, o veredito do verificador. Sob o perfil, o parâmetro `verifier_policy` do modelo é recusado, mesmo um mais estrito, e os parâmetros que a ferramenta não define (um conjunto de confiança, uma audiência, um snapshot de revogação) são ignorados. `configureVerifier` lança `AdmissionConfigError` diante de uma contradição (um perfil com `verifierPolicy`, ou sem principais confiáveis ou sem fonte de revogação) e mantém a configuração anterior. Uma função `trustedPrincipals` que lança uma exceção, ou devolve `undefined`, `null` ou um conjunto de confiança inválido, dá `admitted: false` com o motivo em `errors`; a ferramenta não lança. Executável: `examples/strict-v1.mjs`.

Os testes executam todos os casos de `tests/interop/v2/bundle_vectors.json`, cada um sob a política do operador com os seus `verifier_policy_overrides`.

<a id="supervising-the-trust-source"></a>

### Supervisionar a fonte de confiança

```typescript
import { configureVerifier, createSourceSupervisor } from '@dcp-ai/openclaw';

const supervisor = createSourceSupervisor({ maxInFlight: 16 });
configureVerifier({
  trustedPrincipals: ({ tenant, signal }) => loadTrustSet(tenant, { signal }),
  sourceSupervisor: supervisor,
  supervise: { trustTimeoutMs: 2000 },
});
```

**Prazo, capacidade e alcance.**

- A função recebe `{ tenant, signal }`. Um conjunto de confiança que chega depois de `trustTimeoutMs` (um inteiro de 1 a 2147483647), medido com um relógio monotônico quando chega, não é usado. A chamada dá então o mesmo `admitted: false` que uma fonte que falha (`The trusted principals are unavailable (TRUST_SOURCE_FAILED)`).
- São executadas no máximo `maxInFlight` chamadas ao mesmo tempo, sem fila. **Uma vaga só é liberada quando a função realmente se resolve**: uma fonte que nunca se resolve mantém a sua vaga até o processo ser reiniciado.
- A capacidade é por objeto supervisor, e um supervisor criado por `@dcp-ai/express`, ESM ou CJS, pode ser compartilhado.
- Um processo do Node sem mais nada pendente continua vivo até que o prazo responda.
- Com o perfil strict-v1, `supervise: { revocation: true }` executa a `revocationSource` sob o mesmo supervisor, com `revocationTimeoutMs` como prazo (então um inteiro de 1 a 2147483647). `supervise` aceita `trustTimeoutMs`, `revocation: true` ou ambos, e `revocation: true` funciona com um conjunto de confiança estático.
  - A fonte recebe `(subjects, { tenant, signal })`, e cada resposta dá o resultado que dá sem supervisão.
  - `null`, uma falha, um tempo esgotado, a falta de vaga livre e um supervisor fechado dão `admitted: false` com `codes: ["REVOCATION_UNAVAILABLE"]`. `REVOCATION_INVALID` só conta antes do prazo.
  - As chamadas de confiança e de revogação compartilham as vagas do supervisor.
  - `denyListRevocationSource` também aborta o seu fetch quando a `signal` do supervisor é abortada.
  - Sem isso, a revogação mantém `revocationTimeoutMs` como antes.

**Reconfiguração.**

- `configureVerifier` pode manter o mesmo supervisor com um conjunto de confiança, um perfil, um prazo ou uma escolha de fontes novos: os seus contadores permanecem, e uma chamada mantém o prazo com que começou.
- Lança `AdmissionConfigError` (`CONFIG_PROFILE_CONTRADICTION`), mantendo a configuração anterior, quando substituiria ou removeria um supervisor que ainda tem chamadas em andamento, qualquer que seja a fonte que ele supervisiona. Uma chamada conta a partir do momento em que `executeVerifyBundle` começa, portanto também enquanto ainda verifica o bundle e ainda não chamou a sua fonte, e a sua vaga conta até que a sua fonte se resolva. Isso vale mesmo depois que `supervisor.close({ drainMs })` retornou com chamadas ainda em andamento: fechar recusa chamadas novas, mas não libera nenhuma vaga. Substitua-o quando `supervisor.stats().inFlight` for 0, ou reinicie o processo.
- Os parâmetros do modelo não podem definir nada disso.

**Cancelamento.**

- Os supervisores desta versão também oferecem uma capacidade de cancelamento, usada pelo `cancelOnDisconnect` de `@dcp-ai/express`.
- `dcp_verify_bundle` não tem essa opção: o seu host não dá nenhum sinal de que quem chamou foi embora, e `configureVerifier({ cancelOnDisconnect })` lança uma exceção como opção desconhecida.
- `stats().cancelled` é opcional no tipo, por causa dos supervisores de pacotes anteriores: leia-o como `?? 0`.

**O que ele não faz.** Os mesmos limites que em `@dcp-ai/express`:

- não interrompe o trabalho de uma função, não limita o trabalho que ela inicia por conta própria e não isola a CPU de um observador ou de uma fonte;
- `onSourceEvent` deve ser rápido; uma chamada de cada vez, e o resto é descartado e contado. Uma promise ou um thenable que ele devolva é assimilado como faz `Promise.resolve`, então um thenable resolvido com uma promise pendente o mantém ocupado. As promises que um thenable inicia e não devolve ficam fora de alcance.
- Os contadores param em `Number.MAX_SAFE_INTEGER`.

<a id="concept-mapping-openclaw--dcp"></a>
<a id="concept-mapping-openclaw-dcp"></a>

## Correspondência de conceitos: OpenClaw → DCP

| Conceito do OpenClaw | Equivalente no DCP |
|---|---|
| Proprietário (humano) | `ResponsiblePrincipalRecord` |
| Sessão do agente | `AgentPassport` (capacidades a partir das ferramentas permitidas) |
| Chamada de ferramenta | `Intent` (action_type derivado do nome da ferramenta) |
| Lista de ferramentas permitidas/negadas | `PolicyDecision` |
| Pareamento por DM | `HumanConfirmation` |
| Ações do agente | `AuditEntry` com encadeamento por hash |

<a id="openclaw-tool--dcp-action-type-mapping"></a>
<a id="openclaw-tool-dcp-action-type-mapping"></a>

## Correspondência de ferramentas do OpenClaw → tipo de ação do DCP

| Ferramenta do OpenClaw | `action_type` do DCP | `channel` do DCP |
|---|---|---|
| `browser.*` | `browse` | `web` |
| `exec`, `bash` | `execute_code` | `runtime` |
| `web.fetch`, `web.search` | `api_call` | `api` |
| `write`, `edit`, `apply_patch` | `write_file` | `filesystem` |
| `sessions_send` | `api_call` | `api` |
| `cron`, `webhook` | `api_call` | `api` |

<a id="risk-scoring"></a>

## Pontuação de risco

A ferramenta de declaração de intenção calcula uma pontuação de risco a partir de:

- **Tipo de ação** — pagamentos e execução de código pontuam mais alto que navegação
- **Impacto estimado** — baixo / médio / alto
- **Classes de dados** — dados pessoais, credenciais e dados financeiros aumentam a pontuação

Decisões de política:

- **approve** (risco < 500) — seguir normalmente
- **escalate** (500 ≤ risco < 800) — pedir confirmação a uma pessoa
- **block** (risco ≥ 800) — ação negada, exige uma anulação explícita

A pontuação é um inteiro em milirrisco, de 0 a 1000 (`risk: 650/1000` na resposta da ferramenta). A decisão é um conselho para o agente: nada no plugin interrompe uma ação que foi escalada ou bloqueada, nem
uma que nunca foi declarada.

`dcp_sign_bundle` pega uma intenção (o seu `intent_id`, ou a mais recente) e **todas** as entradas de auditoria da sessão.
O verificador exige que cada entrada de auditoria traga o `intent_id` do bundle, então uma sessão que registrou ações sob
mais de uma intenção produz um bundle que `verifySignedBundleV2` recusa; a ferramenta não separa um bundle por intenção.

<a id="programmatic-usage"></a>

## Uso programático

As ferramentas também podem ser usadas diretamente, sem o sistema de plugins do OpenClaw:

```typescript
import {
  executeIdentitySetup,
  executeDeclareIntent,
  executeLogAction,
  executeGetAuditTrail,
} from '@dcp-ai/openclaw';

// Set up identity
const identity = await executeIdentitySetup({
  session_id: 'my-session',
  owner_name: 'Alice',
  jurisdiction: 'US',
});

// Declare intent
const intent = await executeDeclareIntent({
  session_id: 'my-session',
  action_type: 'api_call',
  target_channel: 'api',
  estimated_impact: 'low',
});

// Log action
await executeLogAction({
  session_id: 'my-session',
  intent_id: intent.intent_id,
  outcome: 'API call succeeded',
  evidence_tool: 'web.fetch',
});

// Get audit trail
const trail = await executeGetAuditTrail({ session_id: 'my-session' });
console.log(trail.entries);
```

<a id="dependencies"></a>

## Dependências

- [`@dcp-ai/sdk`](../../sdks/typescript/README.md) — SDK TypeScript do DCP (tipos, criptografia, construtor, assinador, verificador)
- [`@sinclair/typebox`](https://github.com/sinclairzx81/typebox) — construtor de tipos de JSON Schema (usado pelo OpenClaw para os parâmetros das ferramentas)

<a id="license"></a>

## Licença

Apache-2.0
