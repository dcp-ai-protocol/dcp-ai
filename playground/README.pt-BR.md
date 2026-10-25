<sub>[English](README.md) · [Español](README.es.md) · **Português** · [日本語](README.ja.md) · [中文](README.zh-CN.md)</sub>

<a id="dcp-ai-playground"></a>

# Playground do DCP-AI

> Tradução informativa da [versão em inglês](README.md), atualizada em 25/10/2026. Em caso de diferença, prevalece o original em inglês. Identificadores e blocos de código, incluindo comentários, são mantidos sem tradução.

Demonstração interativa no navegador do Digital Citizenship Protocol (DCP-01 a DCP-09), hospedada em [docs.dcp-ai.org/playground/](https://docs.dcp-ai.org/playground/).

É uma demonstração: suas assinaturas pós-quânticas são simuladas, e sua forma canônica e raiz Merkle são simplificadas; portanto, o que ela constrói não constitui evidência e pode não passar nos verificadores dos SDKs (veja [Limitações](#limitations)).

<a id="quick-start"></a>

## Início rápido

```bash
cd playground
python3 -m http.server 8080
# Open http://localhost:8080
```

Módulos ES exigem um servidor HTTP; `file://` não funciona.

<a id="architecture"></a>

## Arquitetura

O playground é uma aplicação modular, sem etapa de build, que usa módulos ES (`<script type="module">`).

```
playground/
  index.html                    # Shell: CDN scripts, CSS, navigation, containers
  js/
    core/
      crypto.js                 # Ed25519 keygen, signing, verification, kid
      hash.js                   # SHA-256 (Web Crypto), canonicalize (JCS), Merkle root
      state.js                  # Central state (keypairs, agents, session)
      signature.js              # Composite signature builder (classical + PQ simulated)
      utils.js                  # uuid, sessionNonce (64-char hex), isoNow, hex/b64 encode/decode
    ui/
      tabs.js                   # Two-level tab navigation (group bar + tab bar)
      json-render.js            # Syntax highlighting, JSON display, copy
      forms.js                  # Form helpers, cards, notifications
      visualizations.js         # State machine, escalation flow, delegation chain, rights matrix (SVG)
    tabs/
      identity.js               # Tab 1: Identity Generator (DCP-01)
      builder.js                # Tab 2: Bundle Builder (DCP-01/02/03)
      verifier.js               # Tab 3: Bundle Verifier
      tiers.js                  # Tab 4: Tier Comparison
      explorer.js               # Tab 5: Protocol Explorer (DCP-01 through DCP-09)
      lifecycle.js              # Tab 6: Lifecycle Management (DCP-05)
      succession.js             # Tab 7: Succession & Inheritance (DCP-06)
      disputes.js               # Tab 8: Dispute Resolution (DCP-07)
      rights.js                 # Tab 9: Rights & Obligations (DCP-08)
      delegation.js             # Tab 10: Delegation & Representation (DCP-09)
      workflows.js              # Tab 11: Cross-Spec Workflows
```

20 módulos JS (cerca de 2700 linhas em 25/10/2026).

<a id="navigation"></a>

## Navegação

Navegação em dois níveis:

| Grupo | Abas |
|-------|------|
| **Protocolo central** | Identidade, construtor de bundles, verificador, níveis, explorador |
| **Ciclo de vida** | Ciclo de vida do agente (DCP-05), sucessão (DCP-06) |
| **Governança** | Disputas (DCP-07), direitos (DCP-08), delegação (DCP-09) |
| **Fluxos de trabalho** | Fluxos entre especificações |

<a id="spec-coverage"></a>

## Cobertura das especificações

| Especificação | Funcionalidades demonstradas |
|------|----------------------|
| DCP-01 | RPR, passaporte do agente, geração de pares de chaves Ed25519 |
| DCP-02 | Declarações de intenção, pontuação de risco, seleção do nível de segurança |
| DCP-03 | Decisões de política, entradas de auditoria, trilha de auditoria encadeada por hashes, manifesto do bundle, raiz Merkle |
| DCP-05 | Máquina de estados (commissioned/active/declining/decommissioned), relatórios de vitalidade, certificados de comissionamento, registros de descomissionamento |
| DCP-06 | Testamentos digitais, classificação de memória, manifestos de transferência de memória, cerimônias de sucessão |
| DCP-07 | Registros de disputas, escalonamento em três níveis, resoluções de arbitragem, bundles de jurisprudência, registros de objeções |
| DCP-08 | Declarações de direitos, registros de obrigações, relatórios de violações, matriz de direitos, abertura automática de disputas |
| DCP-09 | Mandatos de delegação, limiares de consciência, declarações consultivas, espelhos do principal, visualização de cadeias de delegação |

<a id="cross-spec-workflows"></a>

## Fluxos entre especificações

Quatro fluxos guiados:

1. **Ciclo de vida completo do agente** (DCP-01 + 05 + 06): da criação de identidade à sucessão
2. **Ação delegada com disputa** (DCP-01 + 09 + 02 + 07): da delegação à resolução da disputa
3. **Escalonamento de violações de direitos** (DCP-08 + 07 + 05): da detecção da violação ao impacto no ciclo de vida
4. **Supervisão do principal** (DCP-09 + 02 + 03): da configuração de limiares aos relatórios de supervisão

<a id="how-it-works"></a>

## Como funciona

Todas as operações criptográficas rodam **inteiramente no navegador**:

- **Assinaturas Ed25519** via [tweetnacl](https://github.com/dchest/tweetnacl-js), carregado de uma CDN
- **Hash SHA-256** via API Web Crypto (`crypto.subtle.digest`)
- **Identificadores de chave (kid)** derivados conforme a especificação: `hex(SHA-256(UTF8(alg) || 0x00 || pubkey_bytes))[0:32]`
- **Separação de domínios** aplicada a todas as assinaturas: `UTF8(context_tag) || 0x00 || canonical_payload`
- **Canonicalização** com chaves ordenadas para hashing determinístico (uma forma simplificada, não o perfil completo `dcp-jcs-v1`)
- **Assinaturas compostas**: formato `{ classical, pq, binding }` conforme `composite_signature.schema.json`
- **Nonces de sessão**: hexadecimal de 64 caracteres (`crypto.getRandomValues(32)`)

<a id="key-corrections-from-previous-playground"></a>

## Principais correções em relação ao playground anterior

- `session_nonce`: passou de UUID para hexadecimal de 64 caracteres (conforme o esquema `^[0-9a-f]{64}$`)
- `composite_sig`: passou de `{ entries[] }` para `{ classical, pq, binding }` (formato do esquema v2)
- Todos os artefatos gerados incluem `_spec_ref` com a referência à seção da especificação
- O explorador do protocolo foi ampliado para cobrir DCP-01 a DCP-09

<a id="limitations"></a>

## Limitações

- **As assinaturas pós-quânticas são simuladas**: ML-DSA-65 usa um substituto baseado em HMAC. Ed25519 é real. Para assinaturas PQ reais, use um SDK (no navegador, o SDK WASM em `sdks/wasm/`).
- O cálculo da raiz Merkle usa concatenação simplificada
- Não há formato de transmissão CBOR (apenas JSON)
- A verificação de assinaturas se limita às chaves Ed25519 no passaporte do bundle
- A vinculação de sessão entre abas usa estado compartilhado (sem persistência no armazenamento)

<a id="dependencies"></a>

## Dependências

- `tweetnacl@1.0.3` + `tweetnacl-util@0.15.1` (CDN)
- API Web Crypto (nativa)
- Sem framework nem etapa de build
