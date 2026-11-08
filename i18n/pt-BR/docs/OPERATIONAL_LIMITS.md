<sub>[English](../../../docs/OPERATIONAL_LIMITS.md) · [中文](../../zh-CN/docs/OPERATIONAL_LIMITS.md) · [Español](../../es/docs/OPERATIONAL_LIMITS.md) · [日本語](../../ja/docs/OPERATIONAL_LIMITS.md) · **Português**</sub>

<a id="operational-limits"></a>

# Limites operacionais

> Tradução informativa da [versão em inglês](../../../docs/OPERATIONAL_LIMITS.md), atualizada em 08/11/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

O que limita as entradas, as fontes de confiança e de revogação, a concorrência, a desconexão do cliente e o cache de veredictos dos SDKs de TypeScript, Python, Go e Rust e dos adaptadores Express e FastAPI, e o que você, como operador, precisa definir. Descreve o código-fonte deste repositório; um pacote publicado tem o que a sua própria versão inclui (veja [Versões publicadas](../../../docs/README.md#published-versions)).

Nada nesta página altera o formato de wire, `dcp-jcs-v1`, um perfil ou uma assinatura. Quatro camadas definem limites, e elas são mantidas separadas:

- **O protocolo** fixa comprimentos por campo e as janelas de atualidade do strict-v1.
- **Os SDKs** verificam, admitem e compõem. Essas APIs não recebem prazo nem sinal de cancelamento; o helper de lista de negação do Python tem um prazo de download próprio, separado da criptografia.
- **Os adaptadores** acrescentam orçamentos, prazos, capacidade e cancelamento, todos opcionais (opt-in).
- **Você** escolhe os seus valores, o inquilino, o limite de taxa e a infraestrutura à frente deles.

A [configuração de exemplo](#a-sample-configuration) no final é um ponto de partida, não um padrão nem uma regra.

<a id="who-sets-what"></a>

## Quem define o quê

| Limite | De onde vem |
|---|---|
| Duração da sessão e idade do snapshot de revogação no strict-v1: no máximo 300 s | O [perfil de admissão](../../../docs/ADMISSION.md#the-strict-v1-profile) (normativo) |
| `sig_b64` com no máximo 66 476 caracteres, uma chave pública com no máximo 3456, `intended_verifier` com no máximo 256 | Os esquemas V2 (normativo, por campo) |
| Número de entradas de auditoria, checkpoints PQ, chaves, principais confiáveis, entradas da lista de negação, mandatos de uma cadeia, bundles de delegadores | Nenhum limite de esquema nem de SDK: só o que você deixa entrar os limita. O custo de verificação cresce com eles |
| Profundidade de aninhamento | Nenhum orçamento comum. O parser e a pilha de cada runtime recusam no seu próprio nível; a API opcional `admitSignedBundleV2FromBytes` recusa mais de 64 níveis |
| Corpo da requisição | Express: o `limit` do seu parser de corpo. FastAPI: `max_body_bytes`, opcional e sem valor padrão. Servidor de referência: 1 MiB |
| Bundle em um cabeçalho | Os limites de cabeçalho do seu servidor e de cada proxy (o padrão do Node é 16 KiB); `max_body_bytes` não cobre cabeçalhos |
| Download da lista de negação | Os helpers de lista de negação: no máximo 16 MiB, sem redirecionamentos, com um prazo que você define |
| Prazos e capacidade das fontes | O supervisor de fontes, opcional e sem capacidade padrão |
| Cache de veredictos do Express | Desativado por padrão (`cacheTtlSeconds` 0); no máximo `cacheMaxEntries` (1000 por padrão) quando ativado |
| Inquilino | A sua própria autenticação, nunca um cabeçalho escolhido pelo cliente |
| Taxa de requisições | Você (o exemplo do Express usa `express-rate-limit`) |

<a id="inputs"></a>

## Entradas

- **Envie o bundle no corpo**, com um orçamento de corpo verificado antes do parsing. Um bundle V2 típico com assinaturas híbridas é maior que o limite de cabeçalho padrão do Node.
- **O orçamento de corpo é um orçamento de entrada que você define.** Cada assinatura, entrada de auditoria e checkpoint PQ acrescenta trabalho, e os esquemas não limitam quantos existem. Junto com as cardinalidades que você aceita, a sua política de verificação e a CPU e a concorrência que você permite fora do adaptador, ele limita quanto trabalho uma requisição pode trazer. Não é um prazo de CPU e não limita as APIs que o seu código chama com objetos construídos fora do HTTP. Dimensione-o para os bundles que você espera, não para o maior possível.
- **Profundidade.** No código atual e nas amostras locais dos mantenedores, um corpo mais aninhado do que o runtime suporta foi recusado, não admitido, em um ponto diferente em cada adaptador: o Express relatou uma falha de verificação (`Malformed signed bundle: Maximum call stack size exceeded`); o FastAPI respondeu 403 `Missing DCP signed bundle`, porque não conseguiu ler o corpo como JSON. Os limites de profundidade variam entre runtimes e não fazem parte do protocolo.

<a id="trust-and-revocation-sources"></a>

## Fontes de confiança e de revogação

Quando uma fonte é lenta ou nunca responde, há quatro ações distintas. Um adaptador pode fazer as três primeiras; só a própria fonte pode fazer a quarta.

1. **Parar de esperar.** A requisição recebe uma resposta de falha.
2. **Recusar o resultado tardio.** Um valor que chega depois do prazo nunca é usado.
3. **Pedir o cancelamento.** Um `AbortSignal` é abortado (Express) ou a tarefa é cancelada (FastAPI).
4. **Parar o trabalho.** Só uma fonte que coopera faz isso.

**Com um supervisor de fontes** (`sourceSupervisor` e `supervise`, ou `source_supervisor` e `supervise`):

- Uma fonte de confiança que não responde a tempo resulta em 503, e uma fonte de revogação, em 403 `REVOCATION_UNAVAILABLE`.
- O resultado tardio nunca é usado.
- O prazo é medido com um relógio monotônico, mas só vence quando o event loop está livre: uma CPU ocupada ou uma fonte que bloqueia o loop atrasa a resposta.
- O supervisor conta a invocação que ele possui até que essa invocação termine de fato. Uma fonte que ignora o cancelamento mantém a sua vaga depois da resposta, até terminar.
- O trabalho que uma fonte inicia por conta própria (threads, processos, tarefas que ela não retorna) não é contado nem limitado pelo adaptador.

**Sem supervisor:**

| Fonte | Express | FastAPI |
|---|---|---|
| Confiança | Sem prazo: a requisição espera a fonte | Sem prazo. Uma fonte síncrona roda no event loop e o bloqueia |
| Revogação | `revocationTimeoutMs`: a resposta é enviada, a fonte continua rodando e não é contada | `revocation_timeout` usa `asyncio.wait_for`, que espera a fonte terminar de se cancelar. Uma fonte que suprime o cancelamento atrasa a resposta, e o seu snapshot tardio é usado. Uma fonte síncrona continua rodando na sua thread |

Em produção, use um supervisor. A opção antiga `checkRevocation` do Express não tem prazo nem limite de tamanho, é recusada pelo strict-v1 e fica fora desta orientação.

**Listas de negação:**

- **TypeScript.** O helper do Express `denyListRevocationSource` aborta o seu download quando vence o prazo ou com o sinal do supervisor, inclusive enquanto o corpo está sendo lido.
- **Python.** O helper `deny_list_revocation_source` verifica o seu prazo entre leituras, por isso não limita a resolução DNS nem uma linha de status e cabeçalhos enviados devagar. Dê a ele um orçamento `DenyListWorkers`: ele limita as threads de download, que são uma reserva separada da vaga do supervisor. `DenyListWorkers` conta um download até que o seu fetch retorne; a sua thread ainda pode estar terminando por um instante depois disso.
- **Go e Rust** não têm fonte de lista de negação: você constrói o snapshot de revogação e o passa para a admissão.

Cada invocação de um helper de lista de negação baixa a lista de novo (uma requisição recusada antes da etapa de revogação não baixa). Uma lista grande baixada por muitas requisições ao mesmo tempo usa buffers e objetos para cada uma delas: mantenha as listas pequenas. Se você servir snapshots a partir de um cache próprio, mantenha-o por inquilino e dentro da janela de atualidade do perfil: as regras de admissão não mudam.

<a id="concurrency-and-tenants"></a>

## Concorrência e inquilinos

- **A capacidade pertence ao objeto supervisor, não ao processo.** Compartilhe um supervisor para compartilhar uma capacidade. As fontes de confiança e de revogação de uma requisição ocupam vagas do mesmo supervisor.
- **A etapa que recusa primeiro depende do que é supervisionado.** Com uma função `trustedPrincipals` supervisionada (como na configuração de exemplo, que supervisiona as duas fontes), uma requisição precisa primeiro de uma vaga de confiança: enquanto as vagas estão ocupadas, por chamadas de confiança ou de revogação, uma requisição nova é recusada na etapa de confiança com 503, antes de qualquer fonte ser chamada. Com um conjunto de confiança estático e só a fonte de revogação supervisionada, não há vaga de confiança a ocupar, e uma requisição sem vaga livre é recusada na etapa de revogação com 403 `REVOCATION_UNAVAILABLE`.
- **Sem `maxInFlightPerTenant` / `max_in_flight_per_tenant`, não há isolamento entre inquilinos:** um inquilino pode ocupar todas as vagas.
- **O inquilino precisa vir da sua autenticação.** Nunca o tome de um cabeçalho definido pelo cliente.
- **A verificação usa a CPU.** Em TypeScript e Python ela roda no event loop; em Go e Rust, na thread de quem chama. Com concorrência, as requisições fazem fila para ela. A capacidade limita as fontes, não a CPU nem a concorrência HTTP: limite essas com o seu controle de taxa, os seus workers e a sua infraestrutura.

<a id="client-disconnection"></a>

## Desconexão do cliente

Com `cancelOnDisconnect` (Express) ou `cancel_on_disconnect` (FastAPI, que também precisa de `max_body_bytes`):

- **O que conta como ir embora.** O cliente vai embora de fato quando a resposta é fechada antes de ser enviada, ou quando o upload é interrompido. O Express não toma como abandono o próprio `close` de uma requisição depois do seu corpo.
- **O que acontece.** Só a invocação supervisionada da fonte dessa requisição é cancelada. Nada mais é feito pela requisição: nem handler, nem escrita no cache, nem `onFailure`, nem resposta.
- **O que não faz.** Uma verificação que já está rodando não é interrompida. Uma fonte que ignora o cancelamento mantém a sua vaga até terminar.

<a id="no-cancellation-in-the-sdks"></a>

## Sem cancelamento nos SDKs

Nenhuma API de verificação, admissão ou composição dos SDKs (admissão delegada e ativação incluídas) recebe um prazo, um `AbortSignal` ou um `context.Context`. O prazo de download do helper de lista de negação do Python é separado e não se aplica à criptografia:

- TypeScript e Python verificam no event loop.
- Go e Rust são síncronos.
- WASM é síncrono.

Uma verificação iniciada roda até o fim. Limite o seu custo com o orçamento de entrada, e a sua concorrência fora do SDK.

<a id="the-verdict-cache-express"></a>

## O cache de veredictos (Express)

- **Desativado por padrão.** Mantenha-o desativado, a menos que as suas próprias medições o justifiquem.
- **O que ele guarda no caminho de admissão** (`trustedPrincipals`, com ou sem strict-v1): só o resultado da verificação criptográfica, sob uma chave hash; não o bundle, um snapshot nem qualquer autorização. A confiança do principal é avaliada em cada requisição, em cache ou não, e também as verificações do perfil e a revogação quando estão configuradas. Um conjunto de confiança sem perfil não ganha as verificações de revogação do strict-v1.
- **No caminho só de verificação** (sem `trustedPrincipals`) ele também guarda o agente extraído e os identificadores das suas chaves. As verificações de confiança e de perfil precisam do caminho de admissão, que então deixa de ser só de verificação; `checkRevocation`, se ativada, é avaliada em cada requisição.
- **A chave.** Cobre o bundle canônico, a política de verificação e o inquilino.
- **Expiração e despejo.** Uma entrada expira com o seu TTL, com a sessão do bundle ou com as suas chaves. Quando o cache está cheio, a entrada usada há mais tempo é despejada.
- **Memória.** A memória do processo não é só o cache, e o tamanho do bundle não se traduz no tamanho de uma entrada.
- **Outros adaptadores e o SDK.** O FastAPI não tem cache. O `VerificationCache` do SDK de TypeScript é um utilitário separado que os adaptadores não usam.

<a id="delegation-in-the-adapters"></a>

## Delegação nos adaptadores

- **Onde está a admissão delegada.** Os SDKs de TypeScript, Python, Go e Rust oferecem a admissão delegada (`admitDelegatedBundleV2` e equivalentes), a ativação (`evaluateDelegationActivationV2`) e a admissão a partir de bytes (`admitSignedBundleV2FromBytes`).
- **Onde não está.** O WASM não as expõe, e nenhum dos adaptadores as chama.
- **`mandateId` e `require_dcp_mandated`.** `req.dcpAgent.mandateId` do Express é copiado do manifesto do bundle e não verifica nenhuma cadeia de mandatos. `require_dcp_mandated` do FastAPI só verifica um `mandate_id` que o middleware nunca preenche para bundles V2, e também não verifica nenhuma cadeia.
- **O que a sua aplicação faz.** Ela mesma chama a API do SDK, limita a evidência que aceita (comprimento da cadeia, número de bundles de delegadores, bytes) e decide a autorização e a repetição.

<a id="other-surfaces"></a>

## Outras superfícies

| Superfície | Limites |
|---|---|
| OpenClaw (`@dcp-ai/openclaw`) | O mesmo prazo, a mesma capacidade e o mesmo helper de lista de negação que o Express. A sua entrada é o objeto que o host já fez parsing, sem orçamento próprio, e ele não tem `cancelOnDisconnect` |
| Servidor de referência (`/v2/admit`) | Corpos de no máximo 1 MiB. Um timeout de inatividade do socket de 30 s que responde 408 sem cancelar o trabalho. Revogação em 5000 ms por padrão, abortando o download. O arquivo de confiança é lido em cada admissão. Estado em memória, uma única instância. Para reprodução, não para produção |
| CLI (`dcp-ai`) | Uma invocação por processo, sem prazo nem orçamento próprios: quem a chama precisa impô-los |

<a id="a-sample-configuration"></a>

## Uma configuração de exemplo

Um ponto de partida para um piloto, usado para exercitar os adaptadores. **Não é um padrão, nem uma recomendação para qualquer implantação, nem parte do protocolo.** Dimensione cada valor para os seus bundles, as suas fontes e o seu hardware.

| Ajuste | Valor de exemplo |
|---|---|
| Orçamento de corpo | 64 KiB (`limit` do parser no Express; `max_body_bytes=65536` no FastAPI) |
| Transporte | Corpo, não cabeçalho |
| Supervisor | 32 invocações ao mesmo tempo, 8 por inquilino |
| Prazo de confiança | Express: `supervise.trustTimeoutMs: 2000` (milissegundos). FastAPI: `supervise={"trust_timeout": 2.0}` (segundos) |
| Prazo de revogação, supervisionado | Express: `revocationTimeoutMs: 2000` com `supervise.revocation: true`. FastAPI: `revocation_timeout=2.0` com `supervise={"revocation": True}` |
| Download da lista de negação | Helper do Express: `timeoutMs: 1500`. Helper do Python: `timeout=1.5`. Dentro do prazo de revogação: pede que o download termine antes, não garante que o seu trabalho termine |
| Downloads do Python ao mesmo tempo | `DenyListWorkers(max_workers=8, max_workers_per_tenant=2)`: conta downloads ativos, não o número exato de threads |
| Desconexão do cliente | Ativada |
| Cache de veredictos do Express | Desativado |
| Evidência delegada (a sua aplicação) | No máximo 4 mandatos em uma cadeia, cada bundle dentro do orçamento de corpo |

**O que esta página não afirma:**

- Números de capacidade, latência ou memória para a sua implantação.
- A ausência de vazamentos.
- A aceitação de evidência além do que cada API documenta.

Meça no seu próprio ambiente.
