<a id="published-python-package"></a>

# Pacote Python publicado

> Tradução informativa da [versão em inglês](PYTHON_RELEASE.md), atualizada em 26/10/2026. Em caso de divergência, prevalece a versão em inglês.

Verificado em 26/10/2026: [`dcp-ai` 2.10.0](https://pypi.org/project/dcp-ai/2.10.0/) está disponível no PyPI. A versão deste pacote Python é independente da versão do formato/especificação DCP. Esta publicação não publica Go, Rust, pacotes npm ou contêineres.

<a id="install"></a>

## Instalar

Requer Python 3.10 ou posterior. Atualize seu ambiente ou arquivo de lock. Os extras opcionais de integração continuam separados do núcleo do protocolo:

```bash
pip install --upgrade "dcp-ai>=2.10.0,<3"
pip install "dcp-ai[fastapi]>=2.10.0,<3"
pip install "dcp-ai[langchain]>=2.10.0,<3"
pip install "dcp-ai[openai]>=2.10.0,<3"
pip install "dcp-ai[crewai]>=2.10.0,<3"
pip install "dcp-ai[otlp]>=2.10.0,<3"
```

<a id="what-changed"></a>

## O que mudou

Inclui as correções do verificador V2, confiança no principal e `strict-v1`, prazos/capacidade opt-in para fontes, orçamentos de corpo e desconexão no FastAPI, correções de verificação nas pontes e APIs experimentais de canonicalização. Também corrige uma corrida de cancelamento do Python 3.10 na espera do worker da lista de revogação: cancelar uma requisição não deve liberar a vaga antes de seu worker terminar.

O FastAPI na 2.9.0 aceita bundles V2 com estrutura válida sem verificar suas assinaturas. Atualize para 2.10.0 antes de usá-lo para verificar V2. Veja [SECURITY](../SECURITY.md), [admissão](ADMISSION.md) e o [README do SDK Python](../sdks/python/README.md).

<a id="compatibility-and-verification"></a>

## Compatibilidade e verificação

`dcp-jcs-v1` continua sendo o único padrão normativo. `dcp-jcs-v2` continua experimental, não normativo e opt-in explícito. Verificação, confiança, admissão e autorização são distintas; instalar esta versão não configura sua política de confiança. A verificação mais rigorosa pode rejeitar evidências aceitas pela 2.9.0. Preserve as evidências históricas sem reescrevê-las.

O wheel instalado passou em 1.866 testes no Python 3.12; a distribuição fonte instalada passou em 1.863 testes no Python 3.10 com três omissões esperadas de fábricas de tarefas exclusivas do Python 3.12. Ambas passaram nas verificações de metadados e coincidiram nos 59 módulos-fonte Python. A CI cobre Python 3.10 e 3.12.

A dependência ML-DSA pode lançar `ValueError` se esgotar suas tentativas limitadas de assinatura. Uma fixture de CI encontrou essa falha ao criar uma assinatura; a verificação não foi contornada. Chamadores devem tratar a falha como erro, nunca como evidência assinada.
