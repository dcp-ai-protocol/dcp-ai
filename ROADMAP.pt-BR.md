<sub>[English](ROADMAP.md) · [中文](ROADMAP.zh-CN.md) · [Español](ROADMAP.es.md) · [日本語](ROADMAP.ja.md) · **Português**</sub>

<a id="dcp-ai-roadmap"></a>

# Roteiro do DCP-AI

> Tradução informativa da [versão em inglês](ROADMAP.md), atualizada em 25/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Este documento descreve a evolução planejada do projeto DCP-AI. O roteiro está organizado em fases que podem se sobrepor, mas devem respeitar a ordem de dependências.

---

<a id="phase-1--stabilize-core-semantics"></a>
<a id="phase-1-stabilize-core-semantics"></a>

## Fase 1 — Estabilizar a semântica do núcleo

**Status:** concluída

Definir e documentar a superfície mínima interoperável do protocolo: os artefatos, suas relações e o modelo de verificação que toda implementação do DCP deve suportar.

- ✅ `spec/core/dcp-core.md` publicado como especificação editorial do núcleo
- ✅ Artefatos do núcleo delimitados em relação aos de cada perfil
- ✅ Responsible Principal Record (RPR) estabelecido como terminologia definitiva
- ✅ Modelo de verificação documentado independentemente da escolha de algoritmos criptográficos
- ✅ Referências cruzadas entre a especificação do núcleo e DCP-01 a DCP-09, além do DCP-AI v2.0

<a id="deliverables"></a>

### Entregas

- `spec/core/dcp-core.md` — especificação editorial do núcleo
- `spec/core/README.md` — índice e justificativa do núcleo
- `README.md` apresentando a arquitetura DCP Core / Perfis / Serviços

---

<a id="phase-2--separate-profiles"></a>
<a id="phase-2-separate-profiles"></a>

## Fase 2 — Separar os perfis

**Status:** concluída quanto aos READMEs; os documentos normativos dos perfis continuam em andamento.

Extrair os detalhes específicos de algoritmos, transportes e governança para documentos de perfil que estendem o núcleo sem serem necessários para a interoperabilidade básica.

- **Perfil criptográfico** — registro de algoritmos, assinaturas híbridas/PQ, vinculação composta, agilidade criptográfica, política do verificador
- **Perfil A2A** — descoberta de agentes, protocolo de handshake, gestão de sessões, vínculos de transporte
- **Perfil de governança** — níveis de risco, atestação jurisdicional, política de revogação, recuperação de chaves, cerimônias de governança

<a id="deliverables-1"></a>
<a id="deliverables_1"></a>

### Entregas

- `spec/profiles/crypto/README.md`
- `spec/profiles/a2a/README.md`
- `spec/profiles/governance/README.md`
- Documentos normativos específicos de cada perfil (no futuro, além dos READMEs iniciais)

<a id="principles"></a>

### Princípios

- Os perfis NÃO DEVEM contradizer o núcleo
- Os perfis PODEM definir artefatos, campos ou etapas de verificação adicionais
- Uma implementação conforme do núcleo é válida sem nenhum perfil
- Os perfis são versionados independentemente do núcleo

---

<a id="phase-3--standards-positioning"></a>
<a id="phase-3-standards-positioning"></a>

## Fase 3 — Posicionamento em padrões

**Status:** adiada

A submissão formal a organismos de padronização (Internet-Draft do IETF, adoção por um grupo de trabalho do W3C ou contribuição à DIF) fica adiada até que o protocolo tenha retorno de adoção real de adotantes iniciais. O motivo: os organismos de padronização favorecem projetos com uso em produção, e os ~12 meses que um rascunho costuma levar são mais bem aproveitados depois que integrações reais tiverem exercitado a v2.0.x, e não antes.

Quando for retomada, os fóruns candidatos são:

- **IETF** — para o subconjunto de formato de transmissão, canonicalização e política de verificação
- **W3C** — para a camada de integração com Verifiable Credentials
- **DIF (Decentralized Identity Foundation)** — para o modelo de identidade dos agentes

Enquanto isso, as especificações do projeto continuam citáveis pelo Zenodo (DOI do artigo [`10.5281/zenodo.19040913`](https://doi.org/10.5281/zenodo.19040913), DOI do software [`10.5281/zenodo.19656026`](https://doi.org/10.5281/zenodo.19656026)).

---

<a id="phase-4--align-schemas-and-implementations"></a>
<a id="phase-4-align-schemas-and-implementations"></a>

## Fase 4 — Alinhar esquemas e implementações

**Status:** substancialmente concluída com a v2.0.x publicada.

- ✅ Esquemas com a nomenclatura RPR validados nos cinco SDKs (TS, Python, Go, Rust, WASM)
- ✅ Testes de conformidade entre SDKs em cada push da CI (`tests/interop/v2/`)
- ✅ 39 esquemas JSON v2 + 9 esquemas v1 publicados em `schemas/`
- 🔄 Separação entre conformidade apenas do núcleo e conformidade completa (refinamento futuro; a suíte atual roda como uma única matriz)
- 🔄 Esquemas JSON específicos de perfil em `schemas/profiles/` (futuro; os perfis atuais são READMEs descritivos)

<a id="principles-1"></a>
<a id="principles_1"></a>

### Princípios

- A terminologia RPR é a nomenclatura canônica em todos os artefatos
- Os testes de conformidade do núcleo são um subconjunto estrito da conformidade completa

---

<a id="phase-5--adoption-and-operations"></a>
<a id="phase-5-adoption-and-operations"></a>

## Fase 5 — Adoção e operação

**Status:** em andamento

Com a pilha publicada, a próxima fase é a adoção:

- Atrair adotantes iniciais conforme o [Programa de adotantes iniciais](docs/EARLY_ADOPTERS.md)
- Coletar retorno de integrações reais para orientar as próximas versões menores
- Operar implantações de referência gerenciadas dos quatro serviços (verification, anchor, transparency-log, revocation) onde a demanda da comunidade justificar
- Ampliar a equipe de mantenedores além do mantenedor fundador (veja [GOVERNANCE.md](GOVERNANCE.md))
- Publicar estudos de caso e padrões de integração

<a id="delivered-since-v20-launch"></a>

### Entregue desde o lançamento da v2.0

Sete versões menores publicadas em 2026-04-22..23 (v2.1.0 a v2.7.0) fecharam a lacuna de paridade de comportamento entre SDKs identificada pela primeira comparação externa. Antes dessas versões, o comportamento de DCP-04..09 existia apenas no SDK TypeScript; depois delas, todos os SDKs principais falam a mesma superfície do protocolo. A v2.8.0 e a v2.8.1 (2026-04-26) fixaram depois uma canonicalização idêntica byte a byte nos quatro SDKs, a v2.9.0 (2026-10-21) fez o verificador de referência verificar bundles V2 normativos, e a v2.10.0 (2026-10-22) fez todos os verificadores dos SDKs aplicarem o procedimento V2 completo, incluindo o nível de segurança.

- **v2.1.0** — Exportador OTLP do OpenTelemetry para a paridade de telemetria entre TS e Python.
- **v2.2.0** — Ciclo de vida DCP-05 e sucessão DCP-06 portados para Python, Rust e Go.
- **v2.3.0** — Disputas DCP-07, direitos DCP-08 e delegação/limiares de alerta/espelho DCP-09 portados para Python, Rust e Go (21 funções × 3 SDKs).
- **v2.4.0** — Primitivas de endurecimento para produção em Python, Rust e Go (auxiliares de nonce de sessão, motor de níveis de segurança, revogação de emergência, checkpoints PQ preguiçosos com `PQCheckpointManager`).
- **v2.5.0** — DCP-04 entre agentes: camada de sessão AES-256-GCM completa em Python (via `cryptography`) e Go (`crypto/aes` da biblioteca padrão); estrutura de descoberta e handshake em Rust.
- **v2.6.0** — Auxiliares de Blinded RPR, autorização multipartes e avisos de algoritmos portados do Python para Rust e Go.
- **v2.7.0** — 38 valores canônicos de `DcpErrorCode` e o auxiliar `detect_wire_format` alinhados nos quatro SDKs principais, para que o tratamento de erros entre SDKs coincida numa única string estável.
- **v2.8.0** — O perfil de canonicalização `dcp-jcs-v1` ([`spec/CANONICALIZATION_PROFILE.md`](spec/CANONICALIZATION_PROFILE.md)) fixa os casos que a RFC 8785 deixa definidos pela implementação, fechando a divergência entre os quatro SDKs em `1.0`, `1e2` e `undefined`; 14 vetores de interoperabilidade compartilhados para casos-limite.
- **v2.8.1** — Campo de manifesto `canonicalization_profile` integrado nos quatro SDKs: os construtores emitem `"dcp-jcs-v1"`, e os verificadores tratam um campo ausente como `dcp-jcs-v1` e rejeitam valores desconhecidos.
- **v2.9.0** (2026-10-21) — O verificador de referência, a CLI e o servidor verificam bundles V2 normativos por meio do `@dcp-ai/sdk`; canonicalização de Go e TypeScript corrigida em relação a `dcp-jcs-v1`; todos os alertas de segurança abertos em dependências fechados (Go e Rust 2.9.0, Python 2.8.2, `@dcp-ai/sdk` 2.1.2).
- **v2.10.0** (2026-10-22) — Os verificadores dos quatro SDKs aplicam VERIFICATION.md V2-7/V2-8, o nível de segurança, a vinculação da trilha de auditoria e a validade das chaves; um contorno crítico da verificação do `@dcp-ai/sdk` é corrigido; o compromisso do Blinded RPR recebe sal; o Python ganha ML-KEM-768, FIPS 205 e bundles V2; os serviços ganham autenticação do operador, controles de registro e limites contra negação de serviço.

<a id="in-the-repository-not-released-yet"></a>

### No repositório, ainda não publicado

Estão em `main` depois da tag `v2.10.0` e não são publicados como parte deste trabalho: use-os a partir de uma cópia do repositório (veja a [seção `[Unreleased]` do changelog](CHANGELOG.md#unreleased)).

- **Admissão** — principais confiáveis e o perfil `strict-v1` ([`docs/ADMISSION.md`](docs/ADMISSION.md), [`spec/profiles/admission`](spec/profiles/admission/README.md)) nos quatro SDKs, nas integrações Express, FastAPI e OpenClaw, no verificador de referência, no servidor e na CLI. A verificação sozinha continua não concedendo confiança; a admissão nunca autoriza uma ação.
- **Candidato de canonicalização `dcp-jcs-v2`** — ingestão, roteador, verificador de bytes e produtores experimentais e opt-in em TypeScript, Python, Go, Rust e WASM, com uma matriz cruzada de cinco por cinco ([`docs/proposals/canonicalization-candidate`](docs/proposals/canonicalization-candidate/README.md)). Não é normativo nem está ativo: `dcp-jcs-v1` continua sendo o único perfil, e levar o candidato a uma fase posterior ou torná-lo padrão exige uma decisão própria.

<a id="out-of-scope-for-phase-5"></a>

### Fora do escopo da fase 5

- Um SaaS próprio dos serviços de referência (os operadores hospedam por conta própria)
- Obter um programa de certificação ou acreditação (prematuro)

---

<a id="proposal-direction-after-v210"></a>

## Proposta: direção depois da v2.10

**Status:** proposta para discussão entre os mantenedores. Nada nesta seção está planejado ou prometido; um item só passa a fazer parte do roteiro depois de aceito numa issue ou pull request próprio.

<a id="positioning"></a>

### Posicionamento

O DCP não compete com protocolos de acesso a ferramentas (MCP), protocolos entre agentes (A2A), protocolos de pagamento de agentes nem com os rascunhos sobre identidade de agentes de IA no IETF (no momento da redação, outubro de 2026, submissões individuais, até onde sabemos). Ele é a camada de prestação de contas e evidências sobre eles. Responde à pergunta que esses protocolos deixam em aberto: quem responde pelo que este agente fez, e como um terceiro pode verificar isso sem confiar no operador?

<a id="what-the-v210-round-showed"></a>

### O que a rodada da v2.10 mostrou

- A superfície é maior que a adoção: 9 especificações, 39 esquemas v2, 5 SDKs, 10 integrações e 4 serviços.
- A maioria dos defeitos de verificação encontrados foram divergências entre os quatro verificadores dos SDKs, não falhas de um único algoritmo: um contorno do modo de verificação em TypeScript, Ed25519 aceito na posição pós-quântica em Go e Rust, um artefato nulo ignorado em Go, carimbos de data/hora comparados como texto em Rust.
- A operação depende de uma pessoa (em outubro de 2026): as credenciais de publicação no npm bloquearam a publicação de uma correção de segurança, e criar um aviso de segurança exige permissões que a conta do mantenedor não tem.

<a id="proposed-priorities"></a>

### Prioridades propostas

1. **Segurança operacional (semanas).** Publicar sem tokens de longa duração (trusted publishing no npm e no crates.io, como o PyPI já faz). Transformar cada vulnerabilidade da rodada v2.10 num vetor negativo que os quatro SDKs devem rejeitar. Fuzzing diferencial: o mesmo bundle mutado vai para todos os verificadores, e qualquer divergência é um bug. Uma auditoria externa. Um segundo mantenedor com permissões de administração.
2. **Um núcleo pequeno e um único verificador.** Um DCP Core 3.0 limitado ao Responsible Principal Record, passaporte, intenção, decisão de política, evidência da ação e bundle, com DCP-05 a DCP-09 como perfis experimentais até terem usuários em produção. Um único verificador normativo (candidato: o crate Rust, que já compila para wasm) com bindings; os demais SDKs constroem bundles.
3. **Cadeias de delegação.** Humano, agente, subagente, ferramenta e pagamento: cada salto é assinado e só pode restringir permissões, nunca ampliá-las; a cadeia é verificada offline até o humano responsável; um subagente não pode rebaixar o nível de segurança de quem delegou a ele (a intenção já não pode rebaixar o próprio). Elas estendem o mandato de delegação do DCP-09, que passaria ao núcleo se a prioridade 2 for adotada.
4. **Integrar, não competir.** Um recibo assinado por chamada de ferramenta na integração MCP existente; o passaporte DCP dentro do Agent Card do A2A (a integração `google-a2a` já converte entre os dois); HTTP Message Signatures (RFC 9421); aceitar identidade de WIMSE/SPIFFE, OAuth ou DIDs e vinculá-la a um humano responsável.
5. **Evidência regulatória.** Um mapeamento da trilha de auditoria para os deveres de registro, supervisão humana e manutenção de registros do Regulamento de IA da UE (artigos 12, 14 e 26), no estilo de `docs/NIST_CONFORMITY.md`. O mapeamento e as datas de aplicação precisam ser conferidos com o texto em vigor antes de serem citados.

<a id="notes-from-the-agent-side"></a>

### Notas do lado do agente

- As ações rotineiras precisam continuar baratas. Se cada chamada de ferramenta custar uma assinatura pós-quântica e um bundle completo, ninguém vai adotar. Os recibos de uma sessão podem ser reunidos numa árvore de Merkle e assinados com o esquema híbrido quando a sessão fecha ou quando o nível de segurança é elevado.
- O principal risco para um agente não é uma chave roubada. É a injeção de prompt enquanto ele tem chaves legítimas. O que limita isso é a intenção assinada antes de agir, uma decisão de política independente, mandatos de curta duração e menor privilégio, e evidências que mostram se a ação saiu da intenção declarada.
- Poder provar que agiu dentro do mandato protege o agente e o humano que responde por ele.

<a id="not-proposed"></a>

### Não proposto

- Especificações novas sem pelo menos dois implementadores independentes.
- Um serviço central operado pelo projeto (veja «Fora do escopo da fase 5»).
- Uma submissão ao IETF antes de duas ou três integrações rodarem em produção (a fase 3 a adia à espera de retorno de adoção; isto torna o limiar concreto).

<a id="open-questions"></a>

### Questões em aberto

- Um corte para Core 3.0 é aceitável diante do princípio orientador «acrescentar antes de remover»? Levar DCP-05 a DCP-09 para perfis experimentais é uma mudança incompatível.
- Qual implementação se torna o verificador normativo, e qual é o caminho de migração para os SDKs que deixam de verificar?
- As cadeias de delegação devem reutilizar um formato de capacidades existente (UCAN, Biscuit) ou continuar nativas do DCP?
- Quem é o segundo mantenedor, e como o acesso de administração é compartilhado com segurança?

---

<a id="out-of-scope-general"></a>

## Fora do escopo (geral)

Os itens a seguir continuam explicitamente adiados:

- Renomear campos de esquema sem aliases compatíveis com versões anteriores
- Mudanças incompatíveis em pacotes publicados em registros sem uma transição limpa de versão maior
- Infraestrutura de execução centralizada de propriedade do próprio projeto

---

<a id="guiding-principles"></a>

## Princípios orientadores

1. **Migração não destrutiva** — toda mudança deve ser reversível e não pode quebrar importações, testes ou scripts existentes
2. **Primeiro o editorial** — a documentação e a clareza conceitual vêm antes das mudanças de código
3. **Acrescentar antes de remover** — preferir criar arquivos novos e referências cruzadas em vez de mover ou apagar os existentes
4. **Núcleo mínimo** — o núcleo deve definir a menor superfície útil do protocolo; todo o resto é um perfil ou um serviço
5. **Foco em interoperabilidade** — o núcleo deve poder ser implementado em qualquer linguagem sem dependências específicas de framework
