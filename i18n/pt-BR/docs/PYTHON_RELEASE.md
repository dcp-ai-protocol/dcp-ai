<a id="published-python-package"></a>

# Pacote Python publicado

> Tradução informativa da [versão em inglês](../../../docs/PYTHON_RELEASE.md), atualizada em 09/11/2026. Em caso de divergência, prevalece a versão em inglês.

Verificado em 05/11/2026: [`dcp-ai` 2.10.2](https://pypi.org/project/dcp-ai/2.10.2/) está disponível no PyPI ([o que mudou](#what-changed-in-2102)). A versão deste pacote Python é independente da versão do formato/especificação DCP. O pacote Python é publicado de forma independente de Go, Rust, pacotes npm e contêineres. As publicações anteriores, [2.10.1](https://pypi.org/project/dcp-ai/2.10.1/), verificada em 28/10/2026, e [2.10.0](https://pypi.org/project/dcp-ai/2.10.0/), verificada em 26/10/2026, mantêm suas notas abaixo.

<a id="install"></a>

## Instalar

Requer Python 3.10 ou posterior. Atualize seu ambiente ou arquivo de lock. Os extras opcionais de integração continuam separados do núcleo do protocolo:

```bash
pip install --upgrade "dcp-ai>=2.10.2,<3"
pip install "dcp-ai[fastapi]>=2.10.2,<3"
pip install "dcp-ai[langchain]>=2.10.2,<3"
pip install "dcp-ai[openai]>=2.10.2,<3"
pip install "dcp-ai[crewai]>=2.10.2,<3"
pip install "dcp-ai[otlp]>=2.10.2,<3"
```

<a id="what-changed-in-2101"></a>

## O que mudou na 2.10.1

Verifica os campos secundários SHA3-256 do [VERIFICATION.md V2-11](../../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) quando estão presentes: `audit_merkle_root_secondary` (a árvore SHA3-256 construída como a primária; `sha3-256:` seguido de 64 zeros para uma trilha vazia), cada `prev_hash_secondary` (`"GENESIS"` na primeira entrada e, depois, o SHA3-256 da entrada anterior tal como consta) e cada `intent_hash_secondary` (o SHA3-256 do payload da intenção). Os campos ausentes não são exigidos, então um bundle verificado pode não ter uma cadeia secundária completa. Um campo presente que seja `null`, não seja uma string ou seja inconsistente é rejeitado: é uma mudança de aceitação para evidências que trazem esses campos, que a 2.10.0 aceitava. Não mudam as APIs, os campos de resultado, `dcp-jcs-v1`, as APIs experimentais opt-in de `dcp-jcs-v2` nem o tratamento de `hash_alg`. A verificação continua não sendo confiança no principal, admissão nem autorização.

<a id="what-changed"></a>

## O que mudou

O que mudou na 2.10.0 (26/10/2026), que a 2.10.1 mantém:

Inclui as correções do verificador V2, confiança no principal e `strict-v1`, prazos/capacidade opt-in para fontes, orçamentos de corpo e desconexão no FastAPI, correções de verificação nas pontes e APIs experimentais de canonicalização. Também corrige uma corrida de cancelamento do Python 3.10 na espera do worker da lista de revogação: cancelar uma requisição não deve liberar a vaga antes de seu worker terminar.

O FastAPI na 2.9.0 aceita bundles V2 com estrutura válida sem verificar suas assinaturas. Atualize para 2.10.0 antes de usá-lo para verificar V2. Veja [SECURITY](../../../SECURITY.md), [admissão](../../../docs/ADMISSION.md) e o [README do SDK Python](../../../sdks/python/README.md).

<a id="compatibility-and-verification"></a>

## Compatibilidade e verificação

Para a 2.10.2, o wheel e a distribuição de código-fonte que o workflow de publicação publicou no PyPI a partir da `main` (`46b142bd`) contêm os mesmos arquivos, byte a byte, que os artefatos testados antes da publicação. Instalações novas pelo PyPI do wheel e da distribuição de código-fonte, fora do checkout, passaram cada uma no kit de conformidade externo (697 casos em sete catálogos) e nas verificações da 2.10.2 do conjunto de IDs revogados e do instante de verificação; os arquivos do pacote instalados a partir da distribuição de código-fonte são, byte a byte, os do wheel testado.

`dcp-jcs-v1` continua sendo o único padrão normativo. `dcp-jcs-v2` continua experimental, não normativo e opt-in explícito. Verificação, confiança, admissão e autorização são distintas; instalar esta versão não configura sua política de confiança. A verificação mais rigorosa pode rejeitar evidências aceitas pela 2.9.0. Preserve as evidências históricas sem reescrevê-las.

Para a 2.10.1, o wheel e a distribuição fonte publicados no PyPI pelo fluxo de publicação são idênticos byte a byte aos artefatos revisados antes da publicação, e seus checksums no registro foram confirmados. Antes da publicação, esses artefatos, instalados em ambientes novos fora do checkout, passaram nos vetores secundários SHA3-256 compartilhados (103 testes cada) e numa suíte de consumidor independente (86 testes cada).

Após a publicação, instalações novas pelo PyPI do wheel e da distribuição fonte passaram nas 86 verificações independentes cada uma; o wheel do registro também passou nos 103 testes de vetores compartilhados.

Para a 2.10.0 (26/10/2026), o wheel instalado passou em 1.866 testes no Python 3.12; a distribuição fonte instalada passou em 1.863 testes no Python 3.10 com três omissões esperadas de fábricas de tarefas exclusivas do Python 3.12. Ambas passaram nas verificações de metadados e coincidiram nos 59 módulos-fonte Python. A CI cobre Python 3.10 e 3.12.

A dependência ML-DSA pode lançar `ValueError` se esgotar suas tentativas limitadas de assinatura. Uma fixture de CI encontrou essa falha ao criar uma assinatura; a verificação não foi contornada. Chamadores devem tratar a falha como erro, nunca como evidência assinada.

<a id="what-changed-in-2102"></a>

## O que mudou na 2.10.2

A 2.10.2 foi publicada no PyPI em 05/11/2026 pelo workflow de publicação, a partir da `main` (`46b142bd`). Em comparação com a 2.10.1, a 2.10.2:

- **Executa a validação de esquemas V2-2 (mudança de aceitação).** `verify_signed_bundle_v2` e as demais funções de verificação V2, e portanto o middleware do FastAPI e as pontes, validam o envelope do bundle assinado e os quatro payloads contra `schemas/v2` antes de qualquer verificação de hash, chave ou assinatura. Bundles inválidos pelo esquema que antes eram aceitos agora falham com diagnósticos `schema: <pointer> <keyword>`.
- **Alinha as verificações de mandatos.** `verify_mandate_validity` aplica um único contrato e retorna um resultado em vez de lançar uma exceção; `now=` deve ser um `datetime` com fuso horário. Os IDs revogados, anotados como `set[str]`, agora são verificados como `collections.abc.Set` (um `set`, um `frozenset` ou uma visão de chaves de um dict): uma lista ou uma string, toleradas antes, são recusadas. `verify_mandate_chain` lê todos os instantes da mesma forma e rejeita um mandato raiz que repete um domínio.

Não mudam o formato de transmissão, as assinaturas, os perfis, `dcp-jcs-v1` como padrão normativo nem as APIs experimentais de adesão explícita `dcp-jcs-v2`, e o wheel e o sdist agora incluem o `LICENSE` Apache-2.0. Preserve a evidência histórica em vez de reescrevê-la. O README do wheel e do sdist publicados é o que foi preparado antes da publicação e diz "prepared, not published"; arquivos publicados não podem mudar. Veja o [README do SDK](../../../sdks/python/README.md) e o [changelog](../../../CHANGELOG.md#unreleased).

<a id="prepared-not-published-2110"></a>

## Preparada, não publicada: 2.11.0

Preparada em 08/11/2026 e não publicada; os comandos de instalação acima continuam na 2.10.2 até que a 2.11.0 seja publicada e verificada.

- **Adicionado (adesão explícita).** `admit_delegated_bundle_v2`, `admit_signed_bundle_v2_from_bytes`, `create_mandate_acknowledgment` e `evaluate_delegation_activation_v2` ([changelog](../../../CHANGELOG.md#unreleased)).
- **Mudança de aceitação.** P-ED-1 na verificação de objetos V1 e no provedor Ed25519 V2 padrão; a build oficial do PyNaCl já rejeitava essas assinaturas.
- Não mudam o formato de transmissão, as assinaturas, os perfis nem `dcp-jcs-v1`.

<a id="related-releases"></a>

## Publicações relacionadas

As versões atuais em cada registro estão em [Versões publicadas](../../../docs/README.md#published-versions). Outras notas de publicação: [pacotes npm](../../../docs/NPM_RELEASES.md), [Go v2.13.0](../../../docs/GO_RELEASE.md) e [Rust 2.13.0](../../../docs/RUST_RELEASE.md).
