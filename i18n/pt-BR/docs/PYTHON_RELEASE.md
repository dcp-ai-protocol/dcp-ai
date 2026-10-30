<a id="published-python-package"></a>

# Pacote Python publicado

> Tradução informativa da [versão em inglês](../../../docs/PYTHON_RELEASE.md), atualizada em 28/10/2026. Em caso de divergência, prevalece a versão em inglês.

Verificado em 28/10/2026: [`dcp-ai` 2.10.1](https://pypi.org/project/dcp-ai/2.10.1/) está disponível no PyPI. A versão deste pacote Python é independente da versão do formato/especificação DCP. O pacote Python é publicado de forma independente de Go, Rust, pacotes npm e contêineres. A publicação anterior, [2.10.0](https://pypi.org/project/dcp-ai/2.10.0/), foi verificada em 26/10/2026; suas notas são mantidas abaixo.

<a id="install"></a>

## Instalar

Requer Python 3.10 ou posterior. Atualize seu ambiente ou arquivo de lock. Os extras opcionais de integração continuam separados do núcleo do protocolo:

```bash
pip install --upgrade "dcp-ai>=2.10.1,<3"
pip install "dcp-ai[fastapi]>=2.10.1,<3"
pip install "dcp-ai[langchain]>=2.10.1,<3"
pip install "dcp-ai[openai]>=2.10.1,<3"
pip install "dcp-ai[crewai]>=2.10.1,<3"
pip install "dcp-ai[otlp]>=2.10.1,<3"
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

`dcp-jcs-v1` continua sendo o único padrão normativo. `dcp-jcs-v2` continua experimental, não normativo e opt-in explícito. Verificação, confiança, admissão e autorização são distintas; instalar esta versão não configura sua política de confiança. A verificação mais rigorosa pode rejeitar evidências aceitas pela 2.9.0. Preserve as evidências históricas sem reescrevê-las.

Para a 2.10.1, o wheel e a distribuição fonte publicados no PyPI pelo fluxo de publicação são idênticos byte a byte aos artefatos revisados antes da publicação, e seus checksums no registro foram confirmados. Antes da publicação, esses artefatos, instalados em ambientes novos fora do checkout, passaram nos vetores secundários SHA3-256 compartilhados (103 testes cada) e numa suíte de consumidor independente (86 testes cada).

Após a publicação, instalações novas pelo PyPI do wheel e da distribuição fonte passaram nas 86 verificações independentes cada uma; o wheel do registro também passou nos 103 testes de vetores compartilhados.

Para a 2.10.0 (26/10/2026), o wheel instalado passou em 1.866 testes no Python 3.12; a distribuição fonte instalada passou em 1.863 testes no Python 3.10 com três omissões esperadas de fábricas de tarefas exclusivas do Python 3.12. Ambas passaram nas verificações de metadados e coincidiram nos 59 módulos-fonte Python. A CI cobre Python 3.10 e 3.12.

A dependência ML-DSA pode lançar `ValueError` se esgotar suas tentativas limitadas de assinatura. Uma fixture de CI encontrou essa falha ao criar uma assinatura; a verificação não foi contornada. Chamadores devem tratar a falha como erro, nunca como evidência assinada.

<a id="related-releases"></a>

## Publicações relacionadas

As versões atuais em cada registro estão em [Versões publicadas](../../../docs/README.md#published-versions). Outras notas de publicação: [pacotes npm](../../../docs/NPM_RELEASES.md), [Go v2.11.1](../../../docs/GO_RELEASE.md) e [Rust 2.11.1](../../../docs/RUST_RELEASE.md).
