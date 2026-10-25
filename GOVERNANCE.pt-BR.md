<sub>[English](GOVERNANCE.md) · [中文](GOVERNANCE.zh-CN.md) · [Español](GOVERNANCE.es.md) · [日本語](GOVERNANCE.ja.md) · **Português**</sub>

<a id="dcp-ai-governance"></a>

# Governança do DCP-AI

> Tradução informativa da [versão em inglês](GOVERNANCE.md), atualizada em 25/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Este documento descreve o modelo de governança do projeto DCP-AI (Digital Citizenship Protocol for AI Agents).

<a id="governance-model"></a>

## Modelo de governança

O DCP-AI usa um modelo de **governança aberta**. O projeto é desenvolvido abertamente, e contribuições de qualquer pessoa são bem-vindas. As decisões importantes são tomadas por consenso entre os mantenedores, com base nas contribuições da comunidade.

**Estado atual (abril de 2026):** o projeto está na sua fase inicial, com um único mantenedor fundador. Os papéis, o processo de decisão e as regras de votação descritos abaixo definem como o projeto funcionará à medida que mais mantenedores forem incorporados. Enquanto o projeto tiver um único mantenedor, “consenso entre os mantenedores” significa a decisão desse mantenedor; este documento se aplica a esse caso por construção.

<a id="roles"></a>

## Papéis

<a id="contributors"></a>

### Contribuidores

Qualquer pessoa que envia um pull request, abre uma issue, participa de discussões ou contribui de outra forma com o projeto. Espera-se que os contribuidores sigam o [Guia de contribuição](CONTRIBUTING.md).

<a id="reviewers"></a>

### Revisores

Contribuidores de confiança que demonstraram contribuições contínuas e de alta qualidade e um bom entendimento do protocolo. Os revisores podem:

- Aprovar pull requests
- Fazer a triagem e rotular issues
- Participar das discussões de design com peso maior

Os revisores são indicados pelos mantenedores e confirmados por consenso.

<a id="maintainers"></a>

### Mantenedores

Os mantenedores têm acesso completo de escrita ao repositório e são responsáveis pela direção geral do projeto. Os mantenedores podem:

- Fazer merge de pull requests
- Criar versões
- Gerenciar a CI/CD e a infraestrutura
- Indicar e aprovar novos revisores e mantenedores
- Tomar as decisões finais quando não se chega a um consenso

Novos mantenedores são incorporados por consentimento unânime dos mantenedores existentes.

<a id="decision-making-process"></a>

## Processo de decisão

1. **Propostas**: mudanças significativas (novas versões do protocolo, mudanças incompatíveis, novos SDKs, mudanças de governança) devem ser propostas como issues ou discussões do GitHub antes da implementação.

2. **Discussão**: todas as partes interessadas são incentivadas a dar a sua opinião. Deve-se reservar um mínimo de 7 dias de discussão para propostas significativas.

3. **Consenso**: as decisões são tomadas por consenso entre os mantenedores. Consenso significa que nenhum mantenedor mantém uma objeção após a discussão.

4. **Votação**: se não se chegar a um consenso, uma votação por maioria simples entre os mantenedores decide o resultado. Cada mantenedor tem um voto. A votação deve ficar aberta por pelo menos 72 horas.

5. **Documentação**: todas as decisões significativas são documentadas na issue, no PR ou no tópico de discussão correspondente.

<a id="protocol-changes"></a>

## Mudanças no protocolo

Mudanças nas especificações normativas do protocolo (`spec/`) exigem um nível mais alto:

- Uma proposta escrita descrevendo a mudança, a motivação e as implicações de compatibilidade com versões anteriores
- Revisão de pelo menos dois mantenedores
- Um período mínimo de discussão de 14 dias para mudanças incompatíveis
- Testes de conformidade atualizados que validem o novo comportamento
- Schemas atualizados em `schemas/v1/` ou `schemas/v2/` (ou um novo diretório de versão)

<a id="release-process"></a>

## Processo de publicação

1. **Versionamento**: o projeto segue o [Semantic Versioning](https://semver.org/). As versões do protocolo (por exemplo, DCP v1.0) são separadas das versões das implementações.

2. **Cadência de publicação**: as versões são publicadas conforme a necessidade. Não há um calendário fixo.

3. **Etapas da publicação**:
   - Todas as verificações de CI devem passar em `main`
   - Um mantenedor cria uma branch de versão (se aplicável) ou cria a tag a partir de `main`
   - O `CHANGELOG.md` é atualizado com todas as mudanças notáveis
   - As notas da versão são publicadas no GitHub
   - Os pacotes dos SDKs são publicados nos seus respectivos registros (npm, PyPI, crates.io). O SDK de Go não é publicado em um registro central: os módulos Go são descobertos por tag em `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2`; o pkg.go.dev os indexa automaticamente a partir de lá.
   - A publicação é automatizada pelos workflows `publish.yml`, `publish-pypi.yml`, `publish-integrations.yml`, `publish-templates.yml` e `publish-docker.yml`, disparados por uma GitHub Release ou executados manualmente. Os workflows de pacotes verificam se a versão já existe no registro; o workflow de Docker constrói e envia imagens sem essa verificação de existência de versão. O `publish-docker.yml` também roda a cada push em `main` que toque `server/`, `services/`, `lib/`, `tools/`, `schemas/`, `docker/Dockerfile` ou o próprio workflow, e envia as tags de imagem `:latest`, `:main` e `:sha-…`.
   - Quando aplicável, um DOI de software do Zenodo é criado ou vinculado para que a versão possa ser citada em trabalhos acadêmicos (veja [CITATION.cff](CITATION.cff)).

4. **Correções urgentes**: correções críticas de segurança ou de exatidão podem pular o período normal de discussão a critério dos mantenedores.

<a id="security-disclosure-policy"></a>

## Política de divulgação de segurança

Se você descobrir uma vulnerabilidade de segurança no DCP-AI:

1. **Não** abra uma issue pública.
2. Comunique-a em privado por um destes meios:
   - E-mail: **security@dcp-ai.org**
   - Comunicação privada de vulnerabilidades do GitHub: [security/advisories/new](https://github.com/dcp-ai-protocol/dcp-ai/security/advisories/new)
3. Inclua uma descrição da vulnerabilidade, os passos para reproduzi-la, o componente afetado (o protocolo, um SDK específico, um serviço ou o contrato inteligente) e uma avaliação do impacto possível.
4. Os mantenedores confirmam o recebimento em até 48 horas e compartilham um prazo estimado para a correção.
5. Um aviso de segurança é publicado depois que a correção é lançada.

Para todos os detalhes, veja o [SECURITY.md](SECURITY.md), incluindo o escopo, o SLA e o tratamento da gravidade. As recompensas financeiras são tratadas caso a caso, e não como um nível fixo de recompensa.

> **Nota (25/10/2026): os documentos não coincidem.** O [SECURITY.md](SECURITY.md) lista faixas de recompensa fixas por gravidade, enquanto este documento e o [docs/EARLY_ADOPTERS.md](docs/EARLY_ADOPTERS.md) dizem que as recompensas são decididas caso a caso. Os dois textos são mantidos até que um mantenedor confirme qual se aplica.

<a id="amendments"></a>

## Alterações

Este documento de governança pode ser alterado por consenso entre os mantenedores, seguindo o processo de decisão padrão com um período mínimo de discussão de 14 dias.
