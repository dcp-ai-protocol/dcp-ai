<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · **Português**</sub>

<a id="a2a-profile-agent-to-agent-communication"></a>

# Perfil A2A (comunicação entre agentes)

> Tradução informativa da [especificação em inglês](README.md), atualizada em 25/10/2026. **A versão normativa é a inglesa**: esta tradução não tem valor normativo e, em caso de divergência, prevalece o inglês. Identificadores e blocos de código são mantidos sem tradução.

**Estado:** Publicado — v2.0  
**Escopo:** Descoberta de agentes, estabelecimento de sessões, vinculações de transporte e troca de mensagens  

---

<a id="purpose"></a>

## Finalidade

O núcleo do DCP define como um agente individual prova a sua identidade e a sua responsabilidade perante um verificador. O perfil A2A estende isso à interação direta entre agentes: como dois agentes certificados pelo DCP se descobrem, estabelecem uma sessão com autenticação mútua e trocam mensagens com integração completa à trilha de auditoria.

Isso fica explicitamente fora do núcleo porque:

- Muitas implantações do DCP envolvem apenas interação entre agente e verificador (verificação passiva)
- O A2A exige vinculações específicas de transporte (WebSocket, gRPC, HTTP/2) que o núcleo não deveria impor
- Os mecanismos de descoberta dependem do contexto de implantação (URLs well-known, registros, troca direta)
- A gestão de sessões introduz estado, que não faz parte do modelo de verificação sem estado do núcleo

<a id="what-lives-here-not-in-core"></a>

## O que fica aqui (não no núcleo)

<a id="agent-discovery"></a>

### Descoberta de agentes

Publicação e resolução de diretórios de agentes por meio de `.well-known/dcp-agent-directory.json`, incluindo os metadados, as capacidades, os endpoints e os algoritmos suportados de cada agente.

Veja o [DCP-04](../../DCP-04.md), seção 2.

<a id="handshake-protocol"></a>

### Protocolo de handshake

O handshake de quatro mensagens (A2A_HELLO, A2A_WELCOME, A2A_CONFIRM, A2A_ESTABLISHED) que estabelece uma sessão com autenticação mútua e protegida de forma pós-quântica por meio de um KEM híbrido (X25519 + ML-KEM-768).

Veja o [DCP-04](../../DCP-04.md), seção 3.

<a id="session-management"></a>

### Gestão de sessões

Estado da sessão (chaves, contadores, renovação de chaves), formato das mensagens cifradas (AES-256-GCM), protocolo de renovação de chaves, encerramento de sessão e retomada de sessão.

Veja o [DCP-04](../../DCP-04.md), seção 4.

<a id="transport-bindings"></a>

### Vinculações de transporte

Opções de transporte WebSocket, gRPC e HTTP/2 SSE, com codificação CBOR para as mensagens de sessão.

Veja o [DCP-04](../../DCP-04.md), seção 7.

<a id="trust-model"></a>

### Modelo de confiança

Estabelecimento de confiança por sessão por meio de verificação mútua de bundles, confiança organizacional e confiança transitiva opcional com limites de profundidade configuráveis.

Veja o [DCP-04](../../DCP-04.md), seção 5.

<a id="a2a-audit-events"></a>

### Eventos de auditoria A2A

Tipos de entrada de auditoria específicos das interações A2A: `a2a_hello_sent`, `a2a_session_established`, `a2a_message_sent`, `a2a_rekey`, `a2a_session_closed` etc.

Veja o [DCP-04](../../DCP-04.md), seção 6.

<a id="what-stays-in-core"></a>

## O que permanece no núcleo

- O Signed Bundle que os agentes apresentam durante o handshake A2A: a sua estrutura e a sua verificação são do núcleo
- As entradas de auditoria encadeadas por hash que os eventos A2A produzem: o seu formato é do núcleo, mas os tipos de evento específicos do A2A são do perfil
- O Agent Passport que identifica cada agente: a sua estrutura é do núcleo

<a id="normative-references"></a>

## Referências normativas

- [DCP-04](../../DCP-04.md) — Comunicação entre agentes (especificação normativa completa)
- [DCP-AI v2.0](../../DCP-AI-v2.0.md) — Vinculação de sessão (seção 8), derivação de chaves

<a id="implementation-notes-informative"></a>

## Notas de implementação (informativas)

> **Acrescentadas em 25/10/2026. Não normativas.** Estas notas não acrescentam nenhum requisito nem mudam nada do que está acima: descrevem como
> o código de referência em `main` se relaciona com este texto. Onde divergem, prevalece o texto normativo acima.

- “Publicado” se refere à especificação. Em `main`, todos os SDKs constroem `A2A_HELLO` e `A2A_WELCOME`, mas nenhum
  implementa `A2A_CONFIRM` / `A2A_ESTABLISHED` nem a derivação da chave de sessão do [DCP-04](../../DCP-04.md) §3.4; apenas
  o SDK de TypeScript tem o KEM híbrido X25519 + ML-KEM-768 que as mensagens anunciam, e o SDK de Rust não tem camada de
  sessão ([tools/interop-matrix](../../../tools/interop-matrix/README.md#roadmap)).
- Os auxiliares dos SDKs constroem mensagens, diretórios e objetos de sessão para os quais quem chama fornece as chaves. Eles não executam
  por conta própria o handshake, a troca KEM, a verificação de bundles, a admissão, a rede nem o registro de auditoria: isso
  cabe a quem chama, e o servidor de referência não implementa nenhuma vinculação de transporte.
