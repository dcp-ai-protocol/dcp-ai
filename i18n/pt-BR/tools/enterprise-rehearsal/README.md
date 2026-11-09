<sub>[English](../../../../tools/enterprise-rehearsal/README.md) · [中文](../../../zh-CN/tools/enterprise-rehearsal/README.md) · [Español](../../../es/tools/enterprise-rehearsal/README.md) · [日本語](../../../ja/tools/enterprise-rehearsal/README.md) · **Português**</sub>

<a id="enterprise-integration-rehearsal"></a>

# Ensaio de integração empresarial

> Tradução informativa da [versão em inglês](../../../../tools/enterprise-rehearsal/README.md), atualizada em 08/11/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Esta aplicação opcional e sintética exercita o DCP com pacotes instalados e HTTP real por loopback. Ela fica fora do núcleo do protocolo, dos SDKs e dos adaptadores de produção. **Verificação, admissão, ativação da delegação e autorização da aplicação são decisões separadas.** Uma assinatura válida não autoriza uma ação nem garante uma execução única.

O ensaio usa TypeScript/Express e Python/FastAPI. A admissão direta usa os adaptadores instalados; a admissão e a ativação delegadas usam APIs públicas do SDK na aplicação. O ensaio não afirma que os adaptadores implementam a composição da delegação. A interoperabilidade de Go/Rust cabe ao [kit de conformidade](../conformance/README.md); o WASM não expõe cadeias de delegação compostas.

<a id="prerequisites"></a>

## Pré-requisitos

Testado em macOS arm64 com Node 22.15.0, npm 11.3.0 e CPython 3.12.2. São necessários Git, suporte a venv do Python, grupos de processos POSIX, `/bin/ps` e acesso aos registros públicos npm/PyPI. Outras plataformas precisam de validação. Não são necessárias credenciais de conta, dados reais de principais, serviços em execução nem pacotes de desenvolvimento publicados.

Use um checkout que contenha este kit e as APIs do SDK necessárias. O código-fonte dos pacotes não pode ter modificações rastreadas. O código-fonte de pacotes revisado foi o do commit `b3d41bd062ce035b537f8d3acd3e96e5b2ce310c`; o kit é uma entrega de código-fonte adicional. As versões, sozinhas, não identificam estes builds: registre o commit de origem e os hashes dos artefatos. Não presuma que versões já publicadas contêm as mudanças testadas aqui.

<a id="prepare-and-install"></a>

## Preparar e instalar

Execute os blocos a seguir no mesmo shell, a partir da raiz do repositório. Cada subdiretório de saída deve ser novo. O diretório temporário pai é resolvido fisicamente para evitar aliases da plataforma, como `/tmp`.

```sh
MP05_ROOT="$(pwd -P)"
MP05_TMP="$(mktemp -d)"
MP05_TMP="$(cd "$MP05_TMP" && pwd -P)"
python3 tools/enterprise-rehearsal/prepare.py \
  --source "$MP05_ROOT" --revision "$(git rev-parse HEAD)" \
  --work "$MP05_TMP/build"
python3 tools/enterprise-rehearsal/install.py \
  --manifest "$MP05_TMP/build/artifacts.json" \
  --work "$MP05_TMP/consumer"
```

`prepare.py` exporta do Git os três diretórios de pacotes, constrói os tarballs de TypeScript e Express, além de um wheel/sdist de Python, e registra código-fonte, ferramentas, comandos e hashes. Ele não modifica o código-fonte dos pacotes nem publica nada. O lock do Express primeiro baixa sua dependência publicada do SDK 2.2.0; o script a substitui pelo tarball local do SDK e verifica o conteúdo **antes da compilação**. Ao empacotar, ele preserva os manifestos e os locks originais dos pacotes.

`install.py` cria consumidores isolados. As dependências de terceiros do Node são fixadas pelo lock do kit; só mudam os valores de integridade dos tarballs locais. As dependências de terceiros e as ferramentas de build do Python têm locks de versão/hash; o DCP é instalado a partir do wheel local com `--no-deps`. Os locks incluem hashes de wheels do registro, mas a disponibilidade em outra plataforma ainda precisa de validação. Não se usa instalação editável nem import do SDK a partir do checkout.

<a id="run-the-rehearsal"></a>

## Executar o ensaio

```sh
node tools/enterprise-rehearsal/node/rehearse.mjs \
  --manifest "$MP05_TMP/build/artifacts.json" \
  --consumer "$MP05_TMP/consumer" --work "$MP05_TMP/run"
```

O lançador primeiro executa a guarda de instalação offline: hashes de artefatos/conteúdo, locks, resolução de imports, cópias aninhadas do SDK, caminhos/distribuições do Python e APIs necessárias. Depois copia o kit para o consumidor Node, com um inventário de hashes em `STAGED.json`. O Python usa o interpretador do consumidor com `-I`. Os servidores verificam esse inventário, a origem do SDK e o registro da guarda; não repetem uma auditoria completa da instalação a cada requisição. Essas verificações não são uma auditoria de todas as dependências de terceiros.

O lançador é dono do runner e dos servidores via IPC, de modo que um runner bloqueado não consegue impedir a limpeza gerenciada. Os servidores escutam apenas em `127.0.0.1`, em portas efêmeras. Há um prazo de 900 segundos para o runner, timeouts de 10 segundos por requisição e uma verificação de 60 segundos de tempo decorrido após cada grupo; a verificação do grupo **não** é um prazo de cancelamento rígido. Nenhum endpoint remoto de aplicação é contatado durante o ensaio.

A saída `0` exige o plano selecionado completo, os resultados esperados, uma varredura de segredos bem-sucedida e um encerramento limpo. Erros, observações ausentes, códigos inesperados, efeitos extras, processos retidos ou falhas na limpeza fazem o comando falhar. Cada invocação exige um diretório de trabalho novo; um relatório antigo bem-sucedido não pode satisfazer uma nova execução. `--lanes node` ou `--lanes python` seleciona um subconjunto de diagnóstico, não a execução de aceitação completa com as duas trilhas.

A amostra Express também limita cada par de rede a 600 requisições por janela de 60 segundos, antes da autenticação, da leitura do corpo ou do DCP. Isso inclui as leituras do operador e retorna `429 APP_RATE_LIMITED`; cabeçalhos encaminhados não selecionam o par. Esse orçamento local em memória pertence ao ensaio Express, não ao protocolo, e não afirma uma limitação de taxa equivalente na trilha FastAPI.

<a id="scenarios-and-expected-decisions"></a>

## Cenários e decisões esperadas

O plano completo tem 100 passos por trilha, 200 no total. As expectativas são escritas antes das requisições e incluem o status HTTP, os códigos do DCP/da aplicação, o tenant autenticado, os resultados reais do DCP, as chamadas às fontes, as reservas e os efeitos. Todo grupo inclui controles positivos e negativos.

| Grupo | O que é exercitado |
|---|---|
| G1 | Cadastro de um principal com uma impressão digital fornecida fora de banda; impressões digitais erradas e documentos de chave alterados são recusados |
| G2 | Admissão direta, expiração da sessão, audiência, ação da aplicação e argumentos assinados |
| G3 | Tenant derivado de um bearer sintético; outro tenant, confiança ausente, cabeçalhos forjados e campos extras no envelope |
| G4 | Retirada e restauração da confiança sem reiniciar |
| G5 | Agente/chave revogados, lista de negação indisponível ou realmente desatualizada, data malformada e restauração |
| G6 | Rotação de chaves do principal/agente, sobreposição e aposentadoria; mandatos e confirmações reemitidos |
| G7 | Composição e ativação da delegação, revogação/janelas de tempo dos mandatos, confirmações ausentes ou erradas, falha independente da lista de mandatos |
| G8 | Política da aplicação intersectada com cada mandato; ação, domínio, classes de dados, limites e argumentos assinados |
| G9 | Reserva local de uso único, repetição com outro ID de requisição/outra serialização e oito requisições HTTP concorrentes |
| G10 | Ingresso de bytes brutos nas duas rotas: chaves duplicadas em várias profundidades, formas numéricas, Unicode/UTF-8, orçamentos de corpo declarados e em streaming |

Com evidência admitida/ativa, o resultado real do DCP continua com `action_authorized=false`. A aplicação retorna separadamente `application_authorized` e registra seu efeito. Uma confirmação ausente pode deixar a evidência admitida, mas a delegação inativa; nenhum efeito acontece. Uma lista antiga é servida com sua data original, nunca renovada silenciosamente no recebimento. O operador publica snapshots novos de forma explícita.

A aplicação autentica o tenant, seleciona seu conjunto de confiança fora de banda e aceita o bundle apenas no corpo JSON. Ela rejeita `X-DCP-Bundle` para impedir que se autorize um corpo diferente da evidência admitida por um cabeçalho. Esta é uma decisão do kit, não a remoção do suporte a cabeçalhos nos adaptadores. Campos desconhecidos do envelope são rejeitados antes das chamadas às fontes; essa rejeição não é, por si só, prova de uma falha de confiança no SDK.

<a id="evidence-and-retention"></a>

## Evidências e retenção

Guarde `build/artifacts.json`, `consumer/installed.json` e `run/verify.json`, `stage.json`, `supervision.json` e os `run-*/report.json`/`plan.json` novos. As evidências por trilha registram observações, consultas às fontes, reservas e efeitos. Os relatórios contêm caminhos do sistema de arquivos local. Preserve o código-fonte do kit ou os hashes dos seus arquivos junto com o commit dos pacotes; as versões dos artefatos podem coincidir com versões do registro e conter código-fonte diferente.

Os fixtures geram chaves privadas e tokens bearer **TEST ONLY** em diretórios restritos. O runner procura nas evidências as representações conhecidas em bytes/hex/base64 e, em seguida, apaga seus diretórios de segredos. O supervisor externo também procura e remove os segredos deixados por um runner encerrado à força, dentro do seu próprio diretório de trabalho novo. Ele preserva as evidências e se recusa a apagar através de links para fora desse diretório. O scanner não é um DLP de uso geral. Nunca os substitua por chaves, tokens ou dados pessoais reais.

Timeouts e interrupções gerenciados estão cobertos; um `SIGKILL` do próprio lançador, uma queda de energia ou a adulteração concorrente do sistema de arquivos não permitem garantir a limpeza. Após uma interrupção desse tipo, inspecione o diretório de trabalho e descarte os segredos sintéticos restantes conforme sua política de retenção. O ensaio HTTP remove seus diretórios de segredos. Os testes focados de fixtures abaixo retêm material TEST ONLY em `$MP05_TMP/helper-tests` até a execução do último comando de limpeza.

<a id="focused-tests"></a>

## Testes focados

Estes controles usam fixtures temporários e os consumidores instalados. Os dois primeiros comandos cobrem falhas de preparação e adulteração da instalação; a adulteração ocorre apenas em uma cópia descartável. Um SDK sintético sem as APIs é rejeitado pelo seu conteúdo antes da execução, não apenas por uma verificação de API.

```sh
python3 -B -m unittest discover -s tools/enterprise-rehearsal -p test_prepare.py -v
python3 tools/enterprise-rehearsal/negative_controls.py \
  --manifest "$MP05_TMP/build/artifacts.json" --work "$MP05_TMP/consumer"
node --test tools/enterprise-rehearsal/process.test.mjs tools/enterprise-rehearsal/secrets.test.mjs
REHEARSAL_PYTHON="$MP05_TMP/consumer/python/bin/python" \
REHEARSAL_VERIFY_REPORT="$MP05_TMP/run/verify.json" \
REHEARSAL_WORK="$MP05_TMP/helper-tests" \
  node --test "$MP05_TMP/consumer/node/rehearsal/node/test/"*.test.mjs
"$MP05_TMP/consumer/python/bin/python" -I -m unittest discover \
  -s "$MP05_TMP/consumer/node/rehearsal/python" -p 'test_*.py' -v
rm -rf -- "$MP05_TMP/helper-tests"
```

O corpus de ingresso bruto também roda independentemente do HTTP. Copie estes auxiliares de teste para junto dos pacotes Node instalados; não os execute contra um SDK do checkout.

```sh
mkdir "$MP05_TMP/consumer/node/ingress-controls"
for name in ingress-node.mjs ingress_python.py ingress-cases.json test-ingress.mjs test_ingress.py; do
  cp "$MP05_ROOT/tools/enterprise-rehearsal/$name" "$MP05_TMP/consumer/node/ingress-controls/$name"
done
node "$MP05_TMP/consumer/node/ingress-controls/test-ingress.mjs" \
  "$MP05_TMP/consumer/node/ingress-controls/ingress-cases.json"
"$MP05_TMP/consumer/python/bin/python" -I \
  "$MP05_TMP/consumer/node/ingress-controls/test_ingress.py" \
  "$MP05_TMP/consumer/node/ingress-controls/ingress-cases.json"
```

Os controles do runner rejeitam expectativas invertidas, observações/grupos ausentes, duplicatas, erros de infraestrutura e a reutilização de relatórios antigos. Os controles do supervisor cobrem runners bloqueados/encerrados abruptamente, servidores não cooperativos, requisições malformadas, falhas de inicialização, falhas da tabela de processos e segredos remanescentes, além de uma execução positiva limpa.

<a id="boundaries-for-a-real-integration"></a>

## Fronteiras para uma integração real

- **Protocolo:** evidência de identidade, verificação, admissão e ativação opt-in. `dcp-jcs-v1` não muda. A aplicação reutiliza o scanner experimental para sua política de ingresso de bytes; ela não ativa um novo perfil de canonicalização.
- **Adaptadores:** admissão direta strict-v1 com orçamentos opt-in de corpo/fontes, cancelamento e supervisão por tenant. As rotas delegadas usam fontes HTTP limitadas e separadas na aplicação; elas não demonstram as cotas de fontes dos adaptadores para cadeias compostas.
- **Aplicação:** autenticação do tenant, administração da confiança, política de ação/argumentos e o ledger local. A semântica de SKU, moeda e `max_amount` é regra da aplicação; a atenuação entre mandatos continua sendo uma regra do protocolo.
- **Operador:** onboarding real, autenticação, TLS, custódia de chaves/HSM/KMS, publicação de revogações, retenção e controles de implantação. Bearers/impressões digitais sintéticos não são OIDC, uma PKI humana nem prova de que um agente está online. Loopback não é um teste de TLS de produção.
- **Ledger:** a reserva local atômica significa no máximo uma tentativa. Ela não garante execução exatamente uma vez, uma transação com um serviço externo, coordenação distribuída nem durabilidade física após um crash. As mudanças administrativas são serializadas. Oito requisições HTTP concorrentes não implicam oito verificações criptográficas em paralelo; os timeouts das fontes não cancelam a criptografia síncrona.

O ensaio revisado passou em 200/200 passos em uma cópia independente apenas com conteúdo público, com quatro saídas limpas de servidores e os segredos sintéticos removidos. Seus quatro artefatos de pacotes, construídos de forma independente, foram idênticos byte a byte aos da primeira preparação. Isto é evidência de integração reproduzível, não uma certificação de prontidão para produção nem uma auditoria de segurança externa. Veja [admissão](../../docs/ADMISSION.md) e [limites operacionais](../../docs/OPERATIONAL_LIMITS.md) para as fronteiras suportadas. Publicar pacotes e validar uma implantação piloto são etapas separadas.
