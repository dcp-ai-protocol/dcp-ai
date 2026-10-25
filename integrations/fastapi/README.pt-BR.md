<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · **Português**</sub>

<a id="dcp_aifastapi--fastapi-middleware"></a>
<a id="dcp_aifastapi-fastapi-middleware"></a>

# dcp_ai.fastapi — middleware para FastAPI

> Tradução informativa da [versão em inglês](README.md), atualizada em 25/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Middleware de verificação do DCP para FastAPI. Verifica automaticamente os Signed Bundles e fornece injeção de dependências para as rotas protegidas.

<a id="supported-dcp-specifications"></a>

## Especificações do DCP suportadas

Do DCP-01 ao DCP-09, de forma parcial: a verificação de bundles e a admissão como descritas abaixo, e alguns campos do DCP-05 e do DCP-09 (`lifecycle_state`, `mandate_id`); não é uma implementação completa dessas especificações.

<a id="installation"></a>

## Instalação

> **Estado de publicação (25/10/2026).** O PyPI tem `dcp-ai` 2.9.0. O seu middleware do FastAPI **não verifica as assinaturas dos bundles V2**: checa a estrutura deles e define `composite_sig_valid` a partir do campo `binding`, então um bundle V2 falsificado ou alterado passa (corrigido em `main`, veja a seção `[Unreleased]` do [CHANGELOG.md](../../CHANGELOG.md)). Não confie na 2.9.0 para bundles V2. Ele também não inclui a admissão (`trusted_principals`, `profile`, `revocation_source`), `verifier_policy`, `max_body_bytes`, a supervisão de fontes nem `cancel_on_disconnect`. Este README segue o código-fonte em `main`.

Para usar a versão que esta página descreve, instale o SDK Python a partir de um checkout:

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
pip install "/path/to/dcp-ai/sdks/python[fastapi]"
```

A versão publicada (2.9.0), sem as funcionalidades listadas acima:

```bash
pip install "dcp-ai[fastapi]"
```

<a id="quickstart"></a>

## Início rápido

```python
from fastapi import FastAPI, Depends
from dcp_ai.fastapi import DCPVerifyMiddleware, require_dcp, DCPAgentContext

app = FastAPI()

# Add verification middleware
app.add_middleware(DCPVerifyMiddleware, require_bundle=False)

# Public route (no bundle required)
@app.get("/health")
async def health():
    return {"ok": True}

# Protected route (requires a verified bundle)
@app.post("/api/action")
async def agent_action(agent: DCPAgentContext = Depends(require_dcp)):
    return {
        "agent_id": agent.agent_id,
        "human_id": agent.human_id,
        "capabilities": agent.capabilities,
        "risk_tier": agent.risk_tier,
    }
```

<a id="sending-a-bundle"></a>

### Enviar um bundle

Um bundle V2 híbrido tem cerca de 33 KB, mais do que os limites de cabeçalhos da maioria dos servidores e proxies: envie-o no corpo JSON. O cabeçalho é para os bundles que cabem em todos os limites do caminho. A requisição com corpo abaixo é um modelo: `{...}` representa um bundle assinado real.

```bash
# Via header
curl -X POST http://localhost:8000/api/action \
  -H "Content-Type: application/json" \
  -H "x-dcp-bundle: $(cat signed_bundle.json)" \
  -d '{}'

# Via JSON body
curl -X POST http://localhost:8000/api/action \
  -H "Content-Type: application/json" \
  -d '{"signed_bundle": {...}}'
```

<a id="api-reference"></a>

## Referência da API

### `DCPVerifyMiddleware`

Middleware do Starlette/FastAPI que intercepta as requisições e verifica os bundles do DCP.

```python
app.add_middleware(
    DCPVerifyMiddleware,
    require_bundle=False,       # If True, rejects requests without a bundle
    header_name="x-dcp-bundle", # Header where the bundle is sent
    verifier_policy={"default_mode": "hybrid_required"},  # Optional, over DEFAULT_VERIFIER_POLICY
)
```

<a id="constructor-parameters"></a>

#### Parâmetros do construtor

| Parâmetro | Tipo | Padrão | Descrição |
|-----------|------|---------|-------------|
| `app` | `Any` | (obrigatório) | Aplicação ASGI |
| `require_bundle` | `bool` | `False` | Recusa com 403 as requisições sem bundle |
| `header_name` | `str` | `"x-dcp-bundle"` | Nome do cabeçalho HTTP |
| `verifier_policy` | `dict \| VerifierPolicy \| None` | `None` | Política do verificador. Um dict define campos de `VerifierPolicy` sobre `DEFAULT_VERIFIER_POLICY`: um `default_mode` sem `risk_overrides` se aplica a todos os níveis de risco, um dict `risk_overrides` define os seus níveis por cima dos demais e `risk_overrides=None` mantém os níveis padrão. Um `VerifierPolicy` é validado de novo, e um nível de risco que o seu `risk_overrides` deixa de fora (todos, quando é `None`) recebe o seu `default_mode`, como o verificador V2 o resolve. Campos, níveis de risco ou modos desconhecidos lançam uma exceção na construção do middleware. |
| `dcp_version` | `str` | `"2.0"` | É guardado, mas não imposto. Se os bundles V1 são aceitos depende de `verifier_policy` (veja abaixo); `require_dcp_v2` restringe uma rota à V2. |
| `trusted_principals` | `dict \| callable \| None` | `None` | Só por nome. Os principais em que você confia e as suas chaves: um conjunto de confiança (`schemas/v2/principal_trust_set.schema.json`, validado na construção do middleware), ou `(tenant) -> trust set` (síncrona ou assíncrona) chamada em cada requisição. Com ele, só os bundles V2 admitidos chegam à rota, e `require_bundle=True` é exigido (veja [Principais confiáveis e strict-v1](#trusted-principals-and-strict-v1)). |
| `profile` | `dict \| None` | `None` | Só por nome. O perfil strict-v1 (`schemas/v2/admission_profile.schema.json`), carregado na construção do middleware. Precisa de `trusted_principals` e de `revocation_source`; ele mesmo define a política do verificador. |
| `revocation_source` | `callable \| None` | `None` | Só por nome, com `profile`. `(subjects, tenant) -> revocation snapshot \| None`, síncrona (executada em uma thread de trabalho) ou assíncrona, chamada em cada admissão de um bundle verificado. `deny_list_revocation_source(url)` constrói uma. |
| `revocation_timeout` | `float` | `5.0` | Só por nome. Segundos que a fonte de revogação tem para responder. Com `{"revocation": True}`, o prazo supervisionado: mais de 0 e até 2147483.647. |
| `tenant` | `callable \| None` | `None` | Só por nome. `(request) -> str`, síncrona ou assíncrona, do seu próprio código (por exemplo, o inquilino do chamador que a sua autenticação colocou em `request.state`). É passada às funções de confiança e de revogação. Padrão: sempre `""`. |
| `clock` | `callable \| None` | `None` | Só por nome, para testes: a hora em milissegundos desde a época. Padrão: o relógio do sistema. |
| `source_supervisor` | `SourceSupervisor \| None` | `None` | Só por nome, com `supervise`. Veja [Supervisionar a fonte de confiança](#supervising-the-trust-source). |
| `supervise` | `dict \| None` | `None` | Só por nome: `{"trust_timeout": seconds}`, mais de 0 e até 2147483.647, para um `trusted_principals` assíncrono; `{"revocation": True}` para uma `revocation_source` assíncrona, com `revocation_timeout`; ou os dois. Veja [Supervisionar a fonte de revogação](#supervising-the-revocation-source). |
| `cancel_on_disconnect` | `bool` | `False` | Só por nome. Quando o cliente vai embora de verdade durante a admissão, cancela a sua invocação supervisionada da fonte; a sua resposta termina com um 499 vazio que o servidor não entrega. Precisa de `max_body_bytes`; veja [Um cliente que vai embora](#a-client-that-leaves). |
| `max_body_bytes` | `int \| None` | `None` | Só por nome. Um inteiro positivo (não um `bool`, um `float`, uma string, `0` nem um negativo): os bytes do corpo da requisição que o middleware aceita. Precisa do Starlette 0.28.0 ou posterior. Padrão: sem orçamento, como antes. Veja [Orçamento do corpo](#body-budget). |

<a id="behavior"></a>

#### Comportamento

0. Com `max_body_bytes`, o corpo é lido primeiro, dentro do orçamento (veja [Orçamento do corpo](#body-budget)).
1. Extrai o bundle assinado do cabeçalho ou do corpo JSON (`signed_bundle`). Um cabeçalho que não é JSON, que contém um inteiro acima do limite de 4300 dígitos do Python ou que tem um aninhamento profundo demais conta como ausência de bundle (`403` com `require_bundle=True`), nunca como um `500`.
2. Verifica-o com o SDK Python:
   - **V2** (`bundle.dcp_bundle_version: "2.0"`): `await verify_signed_bundle_v2(signed_bundle, registry, policy)` de `dcp_ai.v2`, com um registro Ed25519 / ML-DSA-65 / SLH-DSA-192f e a política acima. Checa os hashes dos payloads e o manifesto, a vinculação e a expiração da sessão, a assinatura composta do bundle e de cada artefato, o modo de verificação (o mais estrito entre o modo da política para o nível de risco do passaporte e o nível de segurança da intenção), a cadeia de hash de auditoria (a SHA-256: não recalcula a cadeia nem a raiz secundárias SHA3-256 do V2-11) e a validade das chaves. `composite_sig_valid` é o resultado do verificador para a assinatura do bundle.
   - **V1** (`bundle.responsible_principal_record.dcp_version: "1.0"`): `verify_signed_bundle()`, só onde o VERIFICATION.md V2-10 aceitaria um bundle só clássico, porque um bundle V1 não tem assinatura pós-quântica: `allow_v1_bundles` é verdadeiro, a política aceita ed25519 (em `accepted_classical_algs`, não em `advisory_rejected_algs`) e não exige vinculação de audiência, expiração da sessão nem duração máxima da sessão (um bundle V1 não tem `intended_verifier` nem janela de sessão), os `responsible_principal_record`, `agent_passport`, `intent` e `policy_decision` do bundle são objetos e as suas `audit_entries` uma lista de objetos, o `agent_id` do passaporte e o `human_id` do RPR são strings (e a `public_key` e o `status` do passaporte, quando presentes, strings, e as suas `capabilities` uma lista de strings), porque vão para o contexto do agente, e o mais estrito entre o modo da política para o `risk_tier` do passaporte V1 (`default_mode` quando não tem nenhum) e o modo do nível de segurança da intenção e da decisão de política V1 (o `risk_score` V1 vai de 0 a 1, escalado por 1000; se faltar, conta como `elevated`) é `classical_only` ou `hybrid_preferred`. Com `DEFAULT_VERIFIER_POLICY`, uma intenção V1 routine ou standard passa; um pagamento, dados sensíveis, um impacto estimado alto ou uma pontuação de risco de 0,5 ou mais são recusados.
   - Um bundle cuja versão não pode ser detectada é recusado.
3. Se for válido: guarda `DCPAgentContext` em `request.state.dcp_agent`, com os `warnings` do verificador
4. Se falhar: responde com `403` e os `errors` do verificador (e, para a V2, os `warnings`): no máximo 20 de cada, de no máximo 500 caracteres, com os caracteres de controle e de formatação do texto fornecido pelo bundle escapados. Os `warnings` do contexto são limitados da mesma forma.
5. Se não houver bundle e `require_bundle=False`: continua sem verificação

<a id="body-budget"></a>

#### Orçamento do corpo

`max_body_bytes` é opcional; sem ele, o middleware lê o corpo como antes, sem limite próprio. Com ele, o middleware lê o corpo inteiro da requisição antes de qualquer outra coisa (o cabeçalho do bundle, a análise do JSON, o inquilino e o conjunto de confiança, a verificação, a revogação, a rota), também quando o bundle vem no cabeçalho e com `require_bundle=False`:

- Um `Content-Length` acima do orçamento recebe `413` `{"verified": false, "errors": ["Request body exceeds max_body_bytes"]}` antes de receber qualquer byte do corpo.
- Os bytes realmente recebidos também são contados, então uma requisição sem `Content-Length`, com um corpo em partes ou com um `Content-Length` pequeno demais recebe o mesmo `413` na primeira mensagem ASGI que os leva acima do orçamento (essa mensagem já foi entregue), e nada depois dela é recebido.
- Um `Content-Length` que não é uma única sequência de dígitos ASCII (um sinal, um ponto decimal, espaços, uma lista) ou que aparece duas vezes recebe `400` `["Invalid Content-Length"]`, e um cliente que se desconecta enquanto envia o corpo recebe `400` `["Request body could not be read"]`. Nenhum dos dois chega à rota.
- Um corpo dentro do orçamento, incluindo os vazios ou malformados, é tratado exatamente como sem a opção, e a rota o lê como sempre (`request.body()`, `request.json()`, `request.stream()`): o `BaseHTTPMiddleware` do Starlette repassa um corpo lido no middleware a partir do Starlette 0.28.0.
- Portanto, a opção precisa do Starlette 0.28.0 ou posterior: com um Starlette mais antigo, ou um cuja versão não pode ser lida, `max_body_bytes` lança `AdmissionConfigError` (`CONFIG_INVALID_VALUE`) na construção do middleware. Atualize o FastAPI/Starlette ou deixe-a sem definir. Sem a opção nada é checado, e as versões mínimas do próprio pacote não mudam.

É um limite dos bytes do corpo recebidos, definido pela sua implantação, não parte do protocolo DCP: não limita a descompressão (conta os bytes que o servidor ASGI entrega), a profundidade do JSON, o tempo nem uma desconexão depois da leitura. Defina-o junto com os limites próprios do seu servidor.

<a id="supervising-the-trust-source"></a>

#### Supervisionar a fonte de confiança

Sem essas opções, um `trusted_principals` assíncrono ou síncrono é executado como antes, sem prazo. Com elas, um **assíncrono** recebe um prazo e uma vaga de uma capacidade:

```python
from dcp_ai.fastapi import DCPVerifyMiddleware, SourceSupervisor

supervisor = SourceSupervisor(max_in_flight=64, max_in_flight_per_tenant=8)  # one per event loop / worker

async def trust_set_for(tenant):
    return await load_trust_set(tenant)

app.add_middleware(DCPVerifyMiddleware, require_bundle=True, trusted_principals=trust_set_for,
                   source_supervisor=supervisor, supervise={"trust_timeout": 2.0})
```

- **Prazo.** A fonte é executada como uma Task pertencente ao supervisor. Um conjunto de confiança que chega depois de `trust_timeout`, medido com `loop.time()` quando chega e de novo quando é usado, não é usado. A requisição recebe o mesmo `503` de uma fonte que falha, e o cancelamento da Task é solicitado; nada espera que ela coopere.
- **Capacidade.** No máximo `max_in_flight` chamadas a fontes são executadas ao mesmo tempo, sem fila. `max_in_flight_per_tenant` limita um inquilino; sem ele, um único inquilino pode ocupar toda a capacidade. Uma chamada que não encontra vaga livre recebe o `503` na hora, sem chamar a fonte. **Uma vaga só é liberada quando a Task da fonte termina de verdade**, não quando a requisição é respondida: uma fonte que ignora o cancelamento mantém a sua vaga. Quando todas as vagas estão ocupadas dessa forma, todas as requisições recebem `503` até que essas fontes terminem ou o processo seja reiniciado.
- **Falhas.** Uma fonte que cancela a si mesma, um chamador cancelado (cuja fonte mantém a sua vaga até terminar) e um conjunto de confiança inválido falham fechados. Um `trusted_principals` estático ou síncrono com essas opções lança `AdmissionConfigError`: um síncrono seria executado no loop de eventos, onde nenhum prazo vale.
- **Escopo.** A capacidade é por objeto `SourceSupervisor`, compartilhada pelos middlewares aos quais você o passa. Ele se vincula ao primeiro loop de eventos que o usa, então dê a cada processo de trabalho ou loop o seu. Chamadas de outro loop ou thread falham fechadas, e um `close()` de outro loop lança `RuntimeError` sem mudar nada.
- **`await supervisor.close(drain_timeout=0)`** recusa as chamadas novas, responde às pendentes com `503`, solicita o cancelamento de todas as Tasks das fontes e espera no máximo `drain_timeout` segundos. Retorna `{"in_flight": n}`; essas vagas continuam ocupadas, e não há reabertura.
- **`supervisor.stats()`** retorna contadores, sem inquilino: `open`, `in_flight`, `tenants`, `timeouts`, `saturated`, `closed`, `wrong_loop`, `late_results`, `late_errors`. Eles param em 2**53 - 1.
- **O que ele não faz.** Não interrompe o trabalho que ignora o cancelamento, não limita o trabalho que uma fonte inicia por conta própria nem isola a CPU. Um `async def` que bloqueia o loop de eventos atrasa todos os prazos. Um servidor ou um `asyncio.run` que está encerrando ainda pode esperar por uma Task de uma fonte que ignora o cancelamento. Sem `{"revocation": True}`, a revogação mantém `revocation_timeout` como antes. A fonte de confiança continua sendo consultada antes de o bundle ser verificado, como antes.

<a id="supervising-the-revocation-source"></a>

#### Supervisionar a fonte de revogação

Com o perfil strict-v1, `supervise={"revocation": True}` executa uma `revocation_source` **assíncrona** como uma Task do mesmo tipo de supervisor, com `revocation_timeout` como prazo:

```python
app.add_middleware(DCPVerifyMiddleware, require_bundle=True, trusted_principals=TRUST_SET,  # static, or async with trust_timeout
                   profile={"profile": "strict-v1", "verifier_id": "verifier:acme-api"},
                   revocation_source=deny_list_revocation_source("https://revocations.example.com/.well-known/dcp-revocations.json"),
                   revocation_timeout=2.0, source_supervisor=supervisor,
                   supervise={"revocation": True})  # or {"trust_timeout": 2.0, "revocation": True}
```

- **Opcional.** `supervise` aceita `trust_timeout`, `"revocation": True` ou os dois. `"revocation": True` precisa de uma `revocation_source` assíncrona (um `async def`, um objeto com um `__call__` assíncrono, ou qualquer um dos dois dentro de `functools.partial`) e funciona com um conjunto de confiança estático. Uma síncrona lança `AdmissionConfigError`, porque seria executada em uma thread de trabalho que o supervisor não controla. Sem a opção nada muda: uma fonte síncrona continua sendo executada em uma thread de trabalho, com `asyncio.wait_for`.
- **As mesmas respostas.** Cada resposta dá o mesmo resultado que sem supervisão. Um instantâneo é avaliado como antes. `None`, uma exceção, um tempo estourado, uma fonte que cancela a si mesma, a falta de vaga livre, um supervisor fechado e um supervisor vinculado a outro loop dão `403` com `codes: ["REVOCATION_UNAVAILABLE"]`, nunca não revogado. Uma exceção cujo `code` é `REVOCATION_INVALID` dá `REVOCATION_INVALID` só quando chega antes do prazo.
- **Um caso que muda.** Sem a opção, `asyncio.wait_for` espera por uma fonte que suprime o seu cancelamento e usa o instantâneo que ela retorna então. Com a opção, a requisição recebe `REVOCATION_UNAVAILABLE` no prazo, e esse instantâneo atrasado nunca é usado.
- **Uma única capacidade.** As chamadas de confiança e de revogação ocupam vagas do mesmo supervisor, cada uma mantida até que a sua Task termine de verdade.
- **Um limite de `deny_list_revocation_source`.** Por padrão, ela baixa em `asyncio.to_thread`. Cancelar a sua Task encerra a Task e libera a sua vaga, mas não a thread de trabalho: essa thread mantém a sua conexão até que o urllib retorne. O supervisor não limita essas threads nem cancela a E/S delas. Para limitá-las, dê à fonte um orçamento `DenyListWorkers` (veja [Limitar os downloads da lista de negação](#bounding-deny-list-downloads)).

<a id="a-client-that-leaves"></a>

#### Um cliente que vai embora

Com `cancel_on_disconnect=True`, um cliente que vai embora enquanto a sua requisição é admitida interrompe o trabalho dessa requisição.

- **Como isso é detectado.** O middleware lê primeiro o corpo inteiro: a opção precisa de `max_body_bytes` e, portanto, do Starlette 0.28 ou posterior. Depois, mantém um `receive()` pendente enquanto a requisição é admitida: depois de lido o corpo, o servidor só pode enviar ali `http.disconnect`.
- **Quando o cliente vai embora:**
  - A admissão é cancelada. A sua invocação supervisionada também: `SourceSupervisor` cancela a sua Task sem esperá-la, e a vaga continua ocupada até que ela termine de verdade. Uma thread de `DenyListWorkers` mantém a sua vaga da mesma forma.
  - Nenhuma rota é executada, e nada dessa admissão é publicado em `request.state`: o seu `dcp_agent` só é definido quando se sabe que o cliente ainda está lá, e um valor que o seu próprio código definiu não é tocado.
  - A resposta ASGI dessa requisição termina com um `499` vazio (o «client closed request» do nginx; não registrado e não é um status do DCP), com `Content-Length: 0` e `Cache-Control: no-store`. São duas mensagens ASGI que a resposta do DCP envia à camada externa, não uma resposta ao cliente: só são enviadas depois de recebido `http.disconnect`, nunca a um cliente que continua lá, e permitem que um `BaseHTTPMiddleware` externo ao DCP, que espera uma resposta, termine normalmente. Assim, o DCP funciona em **qualquer ordem** de middlewares.
  - O que chega à rede depende do servidor. O uvicorn não escreve nada, não registra nada e não envia nenhum `500` para uma conexão que já não existe (medido com uvicorn 0.54 e h11). Pela especificação ASGI, outro servidor pode, em vez disso, lançar uma subclasse de `OSError` quando uma resposta é enviada por uma conexão fechada.
  - As camadas externas ao DCP veem esse 499: uma camada de registro anota um cliente que fechou a sua requisição, nunca um sucesso. Uma camada que transforma as respostas, ou que viola o ASGI, pode alterá-lo; isso fica fora desta garantia. Os erros reais de qualquer camada continuam sendo propagados.
  - Um cliente que vai embora no meio do seu corpo recebe o mesmo final com 499, em vez do 400 enviado sem a opção.
- **Nada é tirado da rota.** Ela lê o mesmo corpo, e esse `receive()` pendente é entregue a quem ler em seguida (a rota, `request.is_disconnected()`, o Starlette), nunca é lido duas vezes nem perdido. Só são interpretadas as leituras que ocorrem durante a admissão: o `http.disconnect` que um servidor envia depois de uma resposta completa não é tomado como um cliente que foi embora.
- **Requisitos.** Checados na construção do middleware:
  - `max_body_bytes`;
  - toda função de fonte supervisionada (`trust_timeout` para um `trusted_principals` invocável, `{"revocation": True}` para `revocation_source`);
  - uma função `tenant` síncrona, porque uma assíncrona poderia deixar esperando uma requisição que já foi embora.

  Caso contrário, `AdmissionConfigError` (`CONFIG_PROFILE_CONTRADICTION`). Com a opção, uma função `tenant` que retorna um awaitable recebe o `503` de um inquilino que não pode ser resolvido, sem ser aguardada. Sem a opção nada muda.
- **O que ele não faz.** Não interrompe a verificação do bundle nem a função do tenant, e não interrompe uma fonte que ignora o cancelamento. Só pula as etapas que começam depois de ter visto a desconexão: atrás de camadas externas, a desconexão chega a ele algumas voltas do loop depois, então uma fonte pode já ter começado (ela é então cancelada e mantém a sua vaga até terminar). Só funciona com asyncio. Precisa de um servidor que envie `http.disconnect` quando a conexão é perdida: o uvicorn envia; o transporte httpx em processo só o envia quando a resposta está completa.

<a id="what-verified-means"></a>

#### O que «verificado» significa

Um bundle verificado é internamente coerente e assinado pelas chaves que ele mesmo lista (as chaves do passaporte e as chaves de vinculação do RPR). Ele não prova quem é o principal: qualquer pessoa pode criar chaves e um RPR que nomeie qualquer `human_id`. Para isso, defina `trusted_principals` (próxima seção). Um bundle verificado também pode ser reenviado até que a sua sessão expire; `verifier_policy={"require_audience_binding": True, "verifier_id": "my-service"}` (o `manifest.intended_verifier` do bundle deve nomear este verificador), `require_session_expiry` e `max_session_duration_seconds` limitam isso, assim como o perfil strict-v1. Nada disso torna um bundle de uso único: mantenha o seu próprio registro de nonces consumidos, se precisar disso.

<a id="trusted-principals-and-strict-v1"></a>

### Principais confiáveis e strict-v1

Com `trusted_principals`, uma requisição chega à rota só quando o seu bundle é **admitido** (`docs/ADMISSION.md`, `spec/profiles/admission`): um bundle V2 cujas assinaturas do principal (o RPR e o manifesto do bundle, clássica e pós-quântica) foram feitas com chaves que o seu conjunto de confiança lista para esse `human_id`, ativas e dentro da sua janela de validade. Com `profile`, também se aplicam os requisitos do strict-v1: assinaturas híbridas para todos os níveis de risco, um `intended_verifier` assinado igual ao seu `verifier_id`, uma sessão assinada de no máximo 300 s e um instantâneo de revogação de no máximo 300 s que informe que o agente e todas as chaves signatárias não estão revogados.

```python
import os

from dcp_ai.fastapi import DCPVerifyMiddleware, deny_list_revocation_source

app.add_middleware(
    DCPVerifyMiddleware,
    require_bundle=True,
    trusted_principals=trust_set,  # or a callable: lambda tenant: trust_sets[tenant]
    profile={"profile": "strict-v1", "verifier_id": "api.acme.example"},
    revocation_source=deny_list_revocation_source(
        "https://revocation.acme.example/.well-known/dcp-revocations.json",
        headers={"Authorization": f"Bearer {os.environ['REVOCATION_TOKEN']}"},
    ),
    tenant=lambda request: request.state.tenant,  # set by your own authentication
)
```

- **As requisições recusadas** recebem `403` com `{"verified", "admitted": false, "principal_trust", "profile", "profile_compliance", "codes", "errors"}` (`codes` ordenados, `errors` como `"CODE: message"`, limitados e escapados) e nunca chegam à rota. Os bundles V1 são recusados: eles não trazem nenhuma assinatura do principal para ancorar. Se a função do inquilino ou a fonte do conjunto de confiança falharem, ou retornarem algo inválido, a requisição recebe `503` e também não chega à rota.
- **As requisições admitidas** recebem `request.state.dcp_agent` como acima, com `admitted=True`, `principal_trust`, `profile`, `profile_compliance`, `recorded_decision` (o `approve`, `escalate` ou `block` do bundle) e `trust_set_version`. `action_authorized` é sempre `False`: a admissão diz que a evidência é autêntica e vem de um principal confiável, não que uma ação pode ser executada.
- **Cada requisição é avaliada de novo**: a função de confiança e a fonte de revogação são chamadas a cada admissão, então um principal removido do conjunto de confiança, uma chave marcada como `revoked` ali ou uma revogação listada pela fonte recusam o mesmo bundle na requisição seguinte.
- **A revogação falha fechada.** Uma fonte que lança uma exceção, estoura o tempo (`revocation_timeout`) ou retorna `None` dá `REVOCATION_UNAVAILABLE`; uma exceção cujo `code` é `REVOCATION_INVALID`, ou um instantâneo fora de `schemas/v2/revocation_snapshot.schema.json`, dá `REVOCATION_INVALID`. Nenhum deles é tomado como não revogado.
- **`deny_list_revocation_source(url, *, headers=None, timeout=5.0, workers=None)`** lê uma lista de negação completa no formato do `/.well-known/dcp-revocations.json` do serviço de revogação de referência (`updated_at`, `revocations[].agent_id`, `kid_revocations[].revoked_kid`) com a biblioteca padrão: o `checked_at` do instantâneo é `updated_at`, um agente ou uma chave listados estão revogados e todos os demais sujeitos não estão. Um erro de rede, um tempo estourado ou uma resposta que não é 2xx é `REVOCATION_UNAVAILABLE`, e um corpo com outro formato, `REVOCATION_INVALID`. Não segue redirecionamentos (os seus cabeçalhos só vão para a sua URL), e o HTTPS precisa de TLS 1.2 ou posterior. Use `https` e guarde as credenciais em variáveis de ambiente ou em um vault. `timeout` limita cada operação de socket, a leitura do corpo e quanto uma chamada espera; não limita a resolução de DNS, nem uma linha de status e cabeçalhos que chegam aos poucos. `workers` é descrito abaixo.
- **A configuração só vem do seu código.** O conjunto de confiança, o perfil, a política, a fonte de revogação e o inquilino nunca são lidos de um cabeçalho, de uma consulta ou de um corpo da requisição: uma requisição que nomeia outro inquilino não muda nada.
- **Os erros de configuração** lançam `AdmissionConfigError` (com um `code`) na construção do middleware: `trusted_principals` ou `profile` sem `require_bundle=True`, um perfil sem `trusted_principals` ou sem `revocation_source`, ou com `verifier_policy` (`CONFIG_PROFILE_CONTRADICTION`); um conjunto de confiança ou um perfil inválidos (o seu próprio código); um argumento de tipo errado, ou `revocation_source` sem `profile` (`CONFIG_INVALID_VALUE`). O Starlette constrói a pilha de middlewares na primeira requisição, não em `add_middleware`, então um erro desses aparece primeiro como um `500` em todas as requisições (a rota nunca é alcançada). Para falhar na inicialização, carregue você mesmo o conjunto de confiança e o perfil (`create_principal_trust_store`, `resolve_strict_v1_profile`) e passe os objetos carregados.
- **Uma fonte de revogação síncrona** é executada em uma thread de trabalho; quando ela estoura o tempo, a requisição é recusada na hora, mas a thread continua até que a fonte retorne. Prefira uma fonte assíncrona, ou uma com o seu próprio tempo limite, como `deny_list_revocation_source(url, timeout=...)`: ela não usa nenhum proxy do ambiente, não segue redirecionamentos e recusa uma lista de mais de 16 MiB. O seu `timeout` limita cada operação de socket e a leitura do corpo, não a resolução de DNS nem uma linha de status que chega aos poucos.

Executável, offline, com os vetores de admissão compartilhados: `python integrations/fastapi/examples/strict_v1.py`.

<a id="bounding-deny-list-downloads"></a>

#### Limitar os downloads da lista de negação

Por padrão, cada chamada de `deny_list_revocation_source` baixa em `asyncio.to_thread`, e nada conta essas threads depois que a sua chamada deixou de esperar. Com um orçamento `DenyListWorkers`, ele as conta:

```python
from dcp_ai.v2 import DenyListWorkers, deny_list_revocation_source

workers = DenyListWorkers(max_workers=8, max_workers_per_tenant=2)  # one per process
source = deny_list_revocation_source(
    "https://revocations.example.com/.well-known/dcp-revocations.json",
    timeout=5.0,
    workers=workers,
)
```

- **Capacidade.** No máximo `max_workers` downloads são executados ao mesmo tempo (um inteiro de 1 a 64), e no máximo `max_workers_per_tenant` para um inquilino; sem ele, um único inquilino pode ocupar todos.
  - Cada download é executado em uma thread própria, iniciada só depois de a sua vaga ser reservada.
  - Uma chamada que não encontra vaga livre recebe `REVOCATION_UNAVAILABLE` na hora, sem se conectar. Não há fila.
  - A capacidade é por objeto: dê o mesmo a todas as fontes que devem compartilhá-la.
- **A vaga é mantida até que o download termine de verdade,** não quando a sua chamada deixa de esperar: um tempo estourado, uma requisição cancelada, o prazo do supervisor do C3 e um loop de eventos fechado não a liberam.
  - O orçamento conta os downloads em andamento. A thread que acabou de terminar um ainda existe por um momento enquanto entrega o seu resultado e sai.
- **As mesmas respostas.**
  - O download é o mesmo GET, com as mesmas regras de TLS, proxy, redirecionamento e tamanho.
  - O corpo continua sendo checado e analisado no loop de eventos.
  - Os erros são os mesmos de sem a opção.
  - Um resultado que chega, ou é usado, depois de `timeout` é `REVOCATION_UNAVAILABLE`, mesmo quando o loop estava ocupado demais para executar o temporizador.
- **`workers.close()`** recusa os downloads novos e retorna `{"in_flight": n}`. Não espera nem interrompe os que estão em andamento, cujas vagas continuam ocupadas até que terminem; não há reabertura.
- **`workers.stats()`** retorna contadores sem URL, inquilino nem cabeçalho: `open`, `in_flight`, `tenants`, `saturated`, `closed`, `start_failed`, `late_results`, `dropped`.
- **A saída do processo espera.** As threads não são threads daemon, então o interpretador espera, quando o processo sai, por um download que ainda esteja em andamento. É o que já acontece com `asyncio.to_thread`, e pode demorar: nada aqui interrompe DNS, TLS ou urllib, e cancelar uma chamada só deixa de esperá-la. Para encerrar um processo que espera, conte com o encerramento forçado do seu gerenciador de processos após um período de tolerância.
- **Um por processo.** Em um processo bifurcado depois de criá-lo, `stats()` e `close()` lançam `RuntimeError` e a fonte dá `REVOCATION_UNAVAILABLE`, sem tocar no bloqueio nem nos contadores do pai: crie um em cada processo de trabalho.
- **O que ele não faz.** Limita quantos downloads são executados, não quanto tempo um leva. O prazo do corpo é checado entre leituras bloqueantes; uma leitura já em andamento pode ultrapassá-lo.

### `require_dcp(request)`

Dependência do FastAPI que exige um agente do DCP verificado.

```python
from fastapi import Depends
from dcp_ai.fastapi import require_dcp, DCPAgentContext

@app.post("/protected")
async def protected_route(agent: DCPAgentContext = Depends(require_dcp)):
    return {"agent_id": agent.agent_id}
```

- **Retorna:** `DCPAgentContext`
- **Lança:** `HTTPException(403)` se não houver nenhum agente verificado

### `DCPAgentContext`

Dataclass com os dados do agente verificado:

```python
@dataclass
class DCPAgentContext:
    dcp_version: str = "1.0"
    agent_id: str = ""
    human_id: str = ""
    session_nonce: str = ""                # V2: verified session nonce
    public_key: str = ""
    capabilities: list[str] = field(default_factory=list)
    risk_tier: str = "medium"
    status: str = "active"
    passport: dict[str, Any] = field(default_factory=dict)
    rpr: dict[str, Any] = field(default_factory=dict)
    intent: dict[str, Any] = field(default_factory=dict)
    policy_decision: dict[str, Any] = field(default_factory=dict)
    composite_sig_valid: bool = False      # V2: the bundle signature verified
    session_binding_valid: bool = False    # V2: session binding verified
    blinded_rpr: bool = False
    lifecycle_state: str = "active"        # DCP-05
    mandate_id: str = ""                   # DCP-09
    mandate_valid: bool = False            # DCP-09
    warnings: list[str] = field(default_factory=list)  # V2: verifier warnings
    # Admission: set only with trusted_principals (admitted stays False otherwise)
    admitted: bool = False
    principal_trust: str = "not_evaluated" # "trusted" when admitted with trusted_principals
    profile: str | None = None             # "strict-v1" under the profile
    profile_compliance: str = "not_evaluated"
    recorded_decision: str | None = None   # approve, escalate or block
    trust_set_version: str | None = None
    action_authorized: bool = False        # always False
```

### `require_dcp_commissioned(request)`

Dependência do FastAPI que recusa um agente cujo `lifecycle_state` é `decommissioned`. O middleware preenche `lifecycle_state` a partir do `status` do passaporte; ele não lê um certificado de comissionamento nem um registro de ciclo de vida do DCP-05.

```python
@app.post("/active-only")
async def active_only(agent: DCPAgentContext = Depends(require_dcp_commissioned)):
    return {"agent_id": agent.agent_id}
```

### `require_dcp_mandated(request)`

Dependência do FastAPI que exige um mandato de delegação (DCP-09 §3.1), mas só checa se `mandate_id` não está vazio: não obtém o mandato, não verifica a sua assinatura nem checa `mandate_valid`. O middleware não preenche `mandate_id` por conta própria, então todas as requisições recebem `403`, a menos que o seu próprio código o defina (e então cabe a você checar o mandato).

```python
@app.post("/delegated")
async def delegated(agent: DCPAgentContext = Depends(require_dcp_mandated)):
    return {"agent_id": agent.agent_id, "mandate_id": agent.mandate_id}
```

<a id="advanced-example--global-middleware--selective-routes"></a>
<a id="advanced-example-global-middleware-selective-routes"></a>

## Exemplo avançado — middleware global + rotas seletivas

```python
from fastapi import FastAPI, Depends, HTTPException, Request
from dcp_ai.fastapi import DCPVerifyMiddleware, require_dcp, DCPAgentContext

app = FastAPI()

# Global middleware (non-blocking, only verifies if a bundle is present)
app.add_middleware(DCPVerifyMiddleware, require_bundle=False)

# Public route
@app.get("/health")
async def health():
    return {"ok": True}

# Route that REQUIRES a verified agent
@app.post("/agent/execute")
async def execute(agent: DCPAgentContext = Depends(require_dcp)):
    if "api_call" not in agent.capabilities:
        raise HTTPException(403, "Capability 'api_call' required")
    return {"executed_by": agent.agent_id, "risk": agent.risk_tier}

# Route that uses the agent if available
@app.get("/info")
async def info(request: Request):
    agent = getattr(request.state, "dcp_agent", None)
    if agent:
        return {"mode": "verified", "agent": agent.agent_id}
    return {"mode": "anonymous"}
```

<a id="development"></a>

## Desenvolvimento

A partir de um checkout:

```bash
cd sdks/python
pip install -e ".[fastapi,dev]"
pytest tests/test_fastapi_*.py -v
```

<a id="dependencies"></a>

### Dependências

- `dcp-ai` — SDK de verificação do DCP
- `fastapi` — framework web
- `starlette` — conjunto de ferramentas ASGI (incluído com o FastAPI)

<a id="license"></a>

## Licença

Apache-2.0
