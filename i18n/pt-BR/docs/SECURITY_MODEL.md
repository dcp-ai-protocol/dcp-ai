<sub>[English](../../../docs/SECURITY_MODEL.md) · [中文](../../zh-CN/docs/SECURITY_MODEL.md) · [Español](../../es/docs/SECURITY_MODEL.md) · [日本語](../../ja/docs/SECURITY_MODEL.md) · **Português**</sub>

<a id="security-model"></a>

# Modelo de segurança

> Tradução informativa da [versão em inglês](../../../docs/SECURITY_MODEL.md), atualizada em 28/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Como o protocolo protege contra ataques, de bundles forjados a bifurcações do protocolo.

---

<a id="design-principle"></a>

## Princípio de projeto

A verificação é local. Isso não é uma fraqueza; é a propriedade de segurança central. A verificação local significa:

- **Nenhum ponto único de comprometimento.** Não há servidor central que, se invadido, invalide todos os agentes. Cada verificador executa o próprio código e confere a própria matemática.
- **As garantias criptográficas não dependem do lugar.** Assinaturas Ed25519 e hashes SHA-256 produzem o mesmo resultado em qualquer máquina. Não dá para «hackear a matemática».
- **O verificador não confia no agente.** O agente apresenta um bundle; o verificador o confere com as próprias ferramentas. Um agente comprometido não consegue fazer um verificador aceitar um bundle inválido.

A verificação diz que um bundle está intacto e assinado pelas chaves que ele nomeia. Confiar nessas chaves, e agir com base no bundle, é uma decisão à parte: a admissão diante dos principais confiáveis do operador ([ADMISSION.md](../../../docs/ADMISSION.md)), mais a autorização própria do operador.

A segurança vem de **camadas de proteção**, cada uma voltada a um vetor de ataque diferente.

---

<a id="attack-vectors-and-protections"></a>

## Vetores de ataque e proteções

<a id="1-forged-bundle-tampered-content"></a>

### 1. Bundle forjado (conteúdo adulterado)

**Ataque:** um atacante modifica um campo de um Signed Bundle (por exemplo, muda `agent_passport.status` de `"revoked"` para `"active"`).

**Proteção:** a assinatura Ed25519 cobre o JSON canônico do bundle inteiro (`dcp-jcs-v1`). Qualquer mudança no conteúdo assinado — um valor, uma chave, um elemento — invalida a assinatura. Mudanças que deixam a forma canônica igual, como espaços em branco ou a ordem das chaves, não são mudanças do conteúdo assinado e continuam sendo verificadas. O verificador recalcula `bundle_hash = SHA-256(canonical(bundle))` e o compara com o hash assinado. As duas verificações falham se o conteúdo foi modificado.

**Robustez:** criptográfica. Quebrar o Ed25519 exige resolver o problema do logaritmo discreto na Curve25519; não há ataque prático conhecido.

<a id="2-forged-identity-fake-rpr"></a>

### 2. Identidade forjada (RPR falso)

**Ataque:** um atacante cria um Responsible Principal Record dizendo ser «Google» ou «Governo dos EUA» e assina um bundle com a própria chave. A assinatura é válida, mas a identidade é falsa.

**Proteção:**

- **Jurisdiction Attestation** (veja [spec/DCP-01.md](../../../spec/DCP-01.md)): um governo ou uma autoridade credenciada assina o hash do RPR, certificando a identidade. Um verificador que exija atestação rejeitará bundles sem ela.
- **Vinculação da chave pública:** o verificador pode exigir que a chave pública do assinante seja conhecida (por exemplo, publicada pela entidade). Um bundle falso do «Google» não terá a chave pública real do Google.
- **Log de transparência:** se o `bundle_hash` da entidade real está no log e o falso não, a falsificação é detectável.

**Robustez:** depende de a atestação ser exigida ou não. Sem atestação, a identidade é autodeclarada (como um certificado autoassinado). Com atestação, a identidade é respaldada por uma autoridade.

<a id="3-stolen-signing-key"></a>

### 3. Chave de assinatura roubada

**Ataque:** um atacante rouba a chave secreta de um usuário e cria bundles válidos em nome dele.

**Proteção:**

- **Revogação:** o titular da chave (ou a jurisdição) publica um RevocationRecord assinado. Todos os verificadores que consultam a lista de revogações rejeitarão bundles assinados com a chave comprometida.
- **Lista de revogações jurisdicional:** o governo publica uma lista assinada de agentes revogados numa URL conhecida. Os verificadores a baixam e a guardam em cache.
- **Rotação de chaves:** gere um par de chaves novo (`dcp keygen`), assine de novo os bundles e revogue a chave antiga.

**Robustez:** depende da propagação da revogação e do que o verificador faz quando não consegue obter um status recente. Um TTL de cache sozinho não é um limite: uma chave roubada continua útil até o titular publicar a revogação e, depois, até cada verificador baixar uma lista que a inclua. Com uma lista em cache (por exemplo, TTL de 1 hora), a janela após a publicação é de cerca de uma hora apenas para um verificador que a atualiza a tempo e falha fechado quando não consegue baixar a lista. Um verificador que continua usando uma lista desatualizada, ou que ignora a revogação quando a fonte está indisponível, não tem limite. O perfil de admissão strict-v1 exige um snapshot de revogação com no máximo 300 segundos de idade e falha quando a fonte está indisponível ([ADMISSION.md](../../../docs/ADMISSION.md#revocation-sources)).

<a id="4-modified-verifier-compromised-verification-code"></a>

### 4. Verificador modificado (código de verificação comprometido)

**Ataque:** um atacante (ou um implementador descuidado) modifica o código de verificação para sempre retornar `verified: true`, ignorando todas as verificações.

**Proteção:**

- **Limite de confiança.** Um verificador comprometido afeta seu operador e os clientes que dependem de seus resultados. Verificadores executados de forma independente não herdam esses resultados; uma dependência compartilhada comprometida pode afetar vários operadores.
- **Verificação das impressões digitais dos esquemas:** `dcp integrity` compara os esquemas V1 locais com as impressões digitais do `protocol_fingerprints.json` local (veja abaixo). Ele detecta um esquema V1 alterado sem a impressão digital dele; não verifica o código de verificação.
- **Testes de conformidade:** `npm run conformance` valida a implementação contra fixtures sabidamente corretos. Uma implementação modificada que muda os resultados nesses fixtures não passa na conformidade; uma mudança fora do que os fixtures exercitam ainda pode passar.

**Robustez:** o impacto depende de como o código comprometido é distribuído e de quem depende de seus resultados. A verificação independente limita a dependência de outro verificador; não elimina o risco da cadeia de suprimentos.

<a id="5-protocol-fork-the-real-threat"></a>

### 5. Bifurcação do protocolo (a ameaça real)

**Ataque:** alguém bifurca o protocolo, enfraquece os esquemas (remove campos obrigatórios, afrouxa a validação) e alega compatibilidade com o DCP. Se for amplamente adotada, isso corrói a confiança no ecossistema.

**Proteção:**

- **Impressões digitais do protocolo:** o arquivo `protocol_fingerprints.json` na raiz do repositório contém o hash SHA-256 de cada arquivo de esquema V1. Qualquer implementação pode conferir os próprios esquemas V1 com elas. Se alguém modifica um esquema, o hash dele muda.
- **Comando `dcp integrity`:** compara os esquemas V1 de `schemas/v1/` com as impressões digitais do `protocol_fingerprints.json` local:

  ```bash
  dcp integrity
  # ✅ PROTOCOL INTEGRITY VERIFIED — all schemas match canonical fingerprints.
  ```

- **Evidência de conformidade:** passar em `npm run conformance` com esquemas obtidos de uma fonte confiável demonstra concordância nos casos que essa suíte cobre. Não prova que todos os requisitos do protocolo e todas as entradas são tratados corretamente; revise também a implementação e a cobertura da especificação aplicável.
- **Versão no nível do bundle:** cada artefato inclui `dcp_version: "1.0"`. Um verificador confere a versão e usa os esquemas correspondentes. Uma bifurcação com esquemas diferentes precisaria de outra versão, o que a tornaria distinguível.

**Robustez:** limitada. As impressões digitais detectam um esquema V1 que difere do arquivo de impressões digitais ao lado dele. Elas não autenticam esse arquivo (ele não é assinado, e uma bifurcação pode mudar os dois), não cobrem os esquemas V2 e não dizem nada sobre o código. Uma correspondência não é uma certificação da implementação. Compare com impressões digitais obtidas de uma fonte em que você confia, e execute a suíte de conformidade, para julgar uma implementação.

<a id="6-retroactive-modification-bundle-changed-after-anchoring"></a>

### 6. Modificação retroativa (bundle alterado depois da ancoragem)

**Ataque:** um atacante modifica um bundle depois que ele foi ancorado numa blockchain ou registrado num log de transparência.

**Proteção:**

- **Imutabilidade da âncora:** o `bundle_hash` no Bitcoin (OP_RETURN) ou no Ethereum (evento) é imutável. O atacante não consegue mudar o hash on-chain.
- **Verificação:** o verificador recalcula o `bundle_hash` a partir do bundle e o compara com a âncora. Se o bundle foi modificado, o hash não confere.
- **Prova do log de transparência:** o log registrou o `bundle_hash` original. Uma prova de inclusão de Merkle vincula o hash à raiz assinada. Se o bundle foi modificado, a prova falha.

**Robustez:** criptográfica + imutabilidade da blockchain. A modificação retroativa é detectável enquanto existir a âncora ou a entrada do log.

---

<a id="protection-layers-summary"></a>

## Camadas de proteção (resumo)

```
Layer 1: Cryptography (Ed25519 + SHA-256)
  Forged bundles are detected by signature and hash checks.

Layer 2: Attestation (jurisdiction signs RPR)
  Fake identities are detected if attestation is required.

Layer 3: Revocation (signed lists by jurisdiction)
  Fresh status and fail-closed handling bound acceptance after revocation;
  a cache TTL alone is not a propagation guarantee.

Layer 4: Protocol integrity (fingerprints + dcp integrity)
  A V1 schema changed without its fingerprint is detected.

Layer 5: Transparency log (append-only Merkle tree)
  Retroactive modifications are detected by log proof mismatch.

Layer 6: Blockchain anchor (Bitcoin / Ethereum)
  Provides immutable, public proof of bundle existence at a point in time.
```

As camadas 1–4 estão disponíveis hoje neste repositório. A camada 5 tem um serviço de referência (`services/transparency-log/`, em memória). A camada 6 está projetada ([docs/STORAGE_AND_ANCHORING.md](../../../docs/STORAGE_AND_ANCHORING.md)) e tem um contrato Ethereum (`contracts/ethereum/`), mas o serviço de ancoragem de referência ainda não envia a nenhuma cadeia; as implementações de produção são específicas de cada operador.

---

<a id="protocol-fingerprints"></a>

## Impressões digitais do protocolo

O arquivo `protocol_fingerprints.json` na raiz do repositório contém o hash SHA-256 dos bytes de cada arquivo de esquema em `schemas/v1/`. Formato:

```json
{
  "protocol": "DCP-AI",
  "version": "1.0",
  "schema_fingerprints": {
    "responsible_principal_record": "sha256:<hex>",
    "agent_passport": "sha256:<hex>",
    ...
  }
}
```

Qualquer implementação — em qualquer linguagem, em qualquer plataforma — pode calcular o SHA-256 dos próprios arquivos de esquema e compará-lo com essas impressões digitais. Uma correspondência significa que os arquivos de esquema V1 dela são idênticos byte a byte aos que têm impressão digital; isso não prova que o código dela verifica corretamente, e o arquivo de impressões digitais só é tão confiável quanto o lugar de onde você o obteve.

**Verificar localmente:**

```bash
dcp integrity
```

---

<a id="what-the-protocol-does-not-protect-against"></a>

## Contra o que o protocolo NÃO protege

- **Uma pessoa mal-intencionada por trás de um bundle válido.** O DCP pode transportar uma vinculação com um principal e evidências verificadas em relação à configuração de confiança do operador. Ele não estabelece automaticamente uma identidade do mundo real nem garante que o principal aja de forma ética. A aplicação da lei e a regulação permanecem fora da verificação criptográfica.
- **Um verificador comprometido que aceita bundles inválidos.** Cada entidade é responsável por executar código de verificação correto. O protocolo fornece impressões digitais e testes de conformidade; usá-los é responsabilidade do operador.
- **Negação de serviço.** A limitação de taxa é especificada por endpoint na API (veja `x-ratelimit` em [`api/openapi.yaml`](../../../api/openapi.yaml)). A mitigação de DDoS no nível da infraestrutura é responsabilidade do operador.
- **Repetição de um bundle válido.** Um bundle assinado pode ser apresentado de novo; veja [Repetição entre artefatos](#9-cross-artifact-replay) para o que a limita.

---

---

<a id="v20-security-enhancements"></a>

## Melhorias de segurança da V2.0

O DCP v2.0 reforça consideravelmente o modelo de segurança com criptografia pós-quântica, assinaturas compostas, níveis de segurança adaptativos e segurança entre agentes.

<a id="7-post-quantum-threat-model"></a>

### 7. Modelo de ameaças pós-quântico

**Ataque:** um adversário quântico com acesso a um computador quântico de grande escala (ou com uma estratégia de «colher agora, decifrar depois») ataca assinaturas Ed25519 e trocas de chaves.

**Proteção:**
- **Assinaturas compostas híbridas:** uma assinatura composta V2 combina Ed25519 (clássica) com ML-DSA-65 (pós-quântica, FIPS 204). A assinatura PQ cobre a assinatura clássica (vinculação `pq_over_classical`), então quebrar só uma delas não basta. Uma assinatura V2 também pode ser `classical_only`; se ela é aceita depende do modo de verificação (§8).
- **KEM híbrido:** a troca de chaves do DCP-04 usa X25519 + ML-KEM-768 (FIPS 203), então as chaves de sessão continuam seguras enquanto qualquer um dos dois algoritmos resistir. Os SDKs não executam essa troca: quem chama deriva a chave de sessão ([NIST_CONFORMITY.md](../../../docs/NIST_CONFORMITY.md) §2.1).
- **Cadeias de hash duplo:** o projeto usa SHA-256 e SHA3-256 em paralelo para dar continuidade se uma família de hash for comprometida, desde que ambas as cadeias sejam verificadas. Os verificadores de bundles V2 desde `@dcp-ai/sdk` 2.2.1, `@dcp-ai/wasm` 2.1.1, `dcp-ai` 2.10.1 (PyPI), Go v2.11.1 e Rust `dcp-ai` 2.11.1 verificam os elos secundários opcionais e a raiz de Merkle secundária que estejam presentes, mas não os exigem, e as versões anteriores não os verificam; portanto, um resultado bem-sucedido não comprova essa proteção adicional ([STORAGE_AND_ANCHORING.md](../../../docs/STORAGE_AND_ANCHORING.md#dual-hash-chains)).

**Robustez:** segurança pós-quântica de nível 3 do NIST para as assinaturas verificadas no modo `hybrid_required` (o modo dos níveis elevated e maximum): um atacante precisa quebrar tanto o algoritmo clássico quanto o pós-quântico.

<a id="8-stripping-attacks-composite-signature"></a>

### 8. Ataques de remoção (assinatura composta)

**Ataque:** um atacante intercepta um bundle assinado e remove o componente de assinatura pós-quântico, apresentando só a assinatura clássica.

**Proteção:** o protocolo de vinculação `pq_over_classical` garante:
1. `classical_sig = Ed25519.sign(context || 0x00 || payload)`
2. `pq_sig = ML-DSA-65.sign(context || 0x00 || payload || classical_sig)`

A assinatura PQ cobre a assinatura clássica, então uma assinatura clássica modificada, ou uma assinatura PQ movida para outro payload, falha na verificação. Remover totalmente a assinatura PQ deixa uma assinatura `classical_only`, sobre a qual só o modo efetivo decide: `hybrid_required` (e `pq_only`) a rejeita, enquanto `hybrid_preferred` a aceita com um aviso e `classical_only` a aceita.

**Robustez:** criptográfica no modo `hybrid_required`. Sob `hybrid_preferred` ou `classical_only`, a remoção é visível (o aviso, a vinculação `classical_only`), mas não é rejeitada.

<a id="9-cross-artifact-replay"></a>

### 9. Repetição entre artefatos

**Ataque:** um atacante pega uma intenção válida de uma sessão e a repete em outra sessão ou com outro bundle.

**Proteção:**
- **Separação de domínio:** cada assinatura inclui uma tag de contexto (por exemplo, `DCP-AI.v2.Intent`, `DCP-AI.v2.Bundle`). As assinaturas de um tipo de artefato não podem ser repetidas para outro.
- **Nonce de sessão:** cada bundle inclui um nonce de sessão aleatório de 256 bits. O manifesto vincula todos os artefatos a esse nonce. Repetir artefatos de uma sessão em outra quebra o hash do manifesto.

O nonce não impede que o mesmo bundle seja apresentado de novo: um bundle inteiro é repetido como está. Uma expiração de sessão assinada e um `intended_verifier` assinado (ambos exigidos pelo perfil de admissão strict-v1) limitam onde e por quanto tempo um bundle pode ser repetido; não o tornam de uso único. Um verificador que precise de uso único mantém o próprio registro de nonces ou hashes de bundles consumidos ([ADMISSION.md](../../../docs/ADMISSION.md#limits)).

**Robustez:** separação de domínio criptográfica + vinculação de sessão, contra a mistura de artefatos; não contra a repetição de um bundle inteiro.

<a id="10-security-tier-downgrade"></a>

### 10. Rebaixamento do nível de segurança

**Ataque:** um agente mal-intencionado declara um nível de segurança baixo (por exemplo, `routine`) para evitar os requisitos de assinatura PQ numa operação de alto risco.

**Proteção:**
- **Política decidida pelo verificador:** quem determina o nível mínimo é o verificador, não o agente. Ele verifica cada bundle pelo mais estrito entre o modo da política dele e o modo do nível (spec §14.3), então um passaporte que declara `risk_tier: "low"` não consegue `classical_only` para uma intenção de pagamento. Os verificadores podem elevar níveis, mas NÃO DEVEM rebaixá-los.
- **Cálculo automático do nível:** o SDK calcula os níveis a partir do `risk_score` da decisão de política e dos `data_classes`, `action_type` e `estimated_impact` da intenção (spec §14.2). Valores desconhecidos ou ausentes falham fechados para `elevated`, e o agente não consegue rebaixar o nível calculado.
- **Regra de não rebaixamento:** se a intenção resulta em `elevated` mas o agente declara `routine`, o verificador resolve para `elevated`.

**Robustez:** aplicação da política no nível do verificador.

<a id="11-a2a-session-security"></a>

### 11. Segurança das sessões A2A

**Ataque:** um atacante intercepta ou sequestra uma sessão de comunicação entre agentes.

**Proteção:**
- **Verificação mútua de bundles:** os dois agentes verificam o bundle um do outro antes de estabelecer uma sessão.
- **Troca de chaves com KEM híbrido:** as chaves efêmeras fornecem sigilo futuro (forward secrecy). Comprometer as chaves de longo prazo não revela as chaves de sessão passadas. Os SDKs deixam essa troca para quem chama.
- **Cifragem AES-256-GCM:** todas as mensagens da sessão são cifradas com cifragem autenticada.
- **Números de sequência monotônicos:** impedem a repetição e a reordenação dentro de uma sessão.
- **Troca periódica de chave:** a sessão informa quando é hora de trocar a chave (`needsRekeying`); quem chama deriva a chave nova.
- **Atenção à revogação:** a especificação encerra uma sessão quando qualquer um dos agentes é revogado. Os SDKs não acompanham a revogação durante uma sessão: a aplicação precisa verificá-la e encerrar a sessão.

**Robustez:** sigilo futuro pós-quântico + cifragem autenticada, quando quem chama executa a troca híbrida e a troca de chave.

<a id="12-lifecycle-state-manipulation-dcp-05"></a>

### 12. Manipulação do estado do ciclo de vida (DCP-05)

**Ataque:** um agente mal-intencionado tenta contornar as transições de estado do ciclo de vida — por exemplo, reativando um agente descomissionado ou pulando o estado «declining» para evitar os procedimentos de destinação dos dados.

**Proteção (especificação e SDK):**
- **Máquina de estados:** `commissioned → active → declining → decommissioned`; transições inválidas são recusadas.
- **Registros do ciclo de vida assinados:** cada transição de estado (certificado de comissionamento, relatório de vitalidade, registro de descomissionamento) leva uma assinatura composta, e os relatórios de vitalidade são encadeados por hash.
- **Descomissionamento definitivo:** quando um agente chega a `decommissioned`, nenhuma transição é mais possível. O registro de descomissionamento informa a destinação dos dados.

**No servidor de referência:** os endpoints do ciclo de vida recusam transições inválidas (409), mas não verificam as assinaturas dos registros e não exigem autenticação; um novo certificado de comissionamento para um agente descomissionado o redefine para `commissioned` ([OPERATOR_GUIDE.md](../../../docs/OPERATOR_GUIDE.md#dcp-0509-service-endpoints)).

**Robustez:** onde as assinaturas dos registros são verificadas (pelas funções do SDK ou por um serviço que as chame), a máquina de estados mais a trilha assinada. O servidor de referência sozinho não fornece nenhuma das duas.

<a id="13-unauthorized-succession-dcp-06"></a>

### 13. Sucessão não autorizada (DCP-06)

**Ataque:** uma parte não autorizada cria um testamento digital ou inicia a sucessão de um agente que não controla, transferindo a memória e a autoridade para um sucessor ilegítimo.

**Proteção:**
- **Assinatura do testamento:** os testamentos digitais levam uma assinatura composta que vincula o `agent_id` e as `successor_preferences`. O servidor de referência armazena os testamentos sem verificá-la.
- **Classificação da memória:** as transferências de memória usam níveis de acesso classificados. Só as entradas compatíveis com a habilitação do sucessor são transferidas.
- **Manifestos de hash duplo:** os manifestos de transferência de memória usam referências de hash duplo (SHA-256 + SHA3-256) para impedir a adulteração dos dados transferidos.

**Robustez:** vinculação criptográfica da autoridade de sucessão + controle de acesso à memória classificada, para um verificador que confira as assinaturas.

<a id="14-delegation-abuse--authority-escalation-dcp-09"></a>
<a id="14-delegation-abuse-authority-escalation-dcp-09"></a>

### 14. Abuso de delegação e escalonamento de autoridade (DCP-09)

**Ataque:** um agente com autoridade delegada tenta exceder o escopo da delegação, ou um mandato de delegação é forjado para conceder capacidades não autorizadas.

**Proteção:**
- **Mandatos de delegação com escopo:** cada mandato especifica um `authority_scope` com domínios e ações explícitos. Ações fora do escopo são rejeitadas.
- **Limiares de atenção:** limiares configuráveis disparam alertas ou exigem confirmação humana quando os parâmetros da delegação excedem os limites definidos (pontuação de risco, valor financeiro, sensibilidade dos dados).
- **Espelhos do principal:** o registro `PrincipalMirror` mantém um snapshot verificável das preferências do principal, evitando que a autoridade delegada se afaste da intenção do principal.
- **Registro de interações:** as interações podem ser registradas como entradas `InteractionRecord` assinadas; registrá-las cabe à aplicação.

**Robustez:** autorização com escopo + monitoramento por limiares + trilha de auditoria criptográfica, para um verificador que confira os mandatos e as assinaturas deles. O servidor de referência armazena os mandatos sem verificar as assinaturas e permite que qualquer pessoa revogue um revogável ([OPERATOR_GUIDE.md](../../../docs/OPERATOR_GUIDE.md#dcp-0509-service-endpoints)).

<a id="updated-protection-layers-v20"></a>

### Camadas de proteção atualizadas (V2.0)

```
Layer 1: Cryptography (Ed25519 + ML-DSA-65 composite, SHA-256 + SHA3-256 dual hash)
  Forged bundles detected. Post-quantum resistant.

Layer 2: Attestation (jurisdiction signs RPR)
  Fake identities detected if attestation is required.

Layer 3: Revocation (lists + emergency revocation via pre-image)
  Stolen keys are refused by verifiers that fetch fresh status and fail closed.
  Emergency revocation: revealing the pre-image revokes all keys without a signature,
  effective for each verifier once it learns of it.

Layer 4: Protocol integrity (fingerprints + dcp integrity)
  A V1 schema changed without its fingerprint is detected.

Layer 5: Transparency log (append-only Merkle tree)
  Retroactive modifications detected by log proof mismatch.

Layer 6: Blockchain anchor (Bitcoin / Ethereum L2)
  Immutable, public proof of bundle existence.

Layer 7: Security Tiers (V2.0)
  Risk-adaptive cryptographic requirements. High-risk = full PQ.

Layer 8: A2A Security (DCP-04)
  Mutual authentication + encrypted channels between agents.

Layer 9: Observability (V2.0)
  Telemetry, metrics, and alerting for anomalous behavior.

Layer 10: Lifecycle Governance (DCP-05)
  Signed lifecycle records and a state machine, where the signatures are verified.

Layer 11: Succession Security (DCP-06)
  Signed testaments and classified memory transfers protect succession integrity.

Layer 12: Dispute Resolution (DCP-07)
  Structured escalation prevents unresolved conflicts from compromising operations.

Layer 13: Rights Enforcement (DCP-08)
  Declared rights and obligations create verifiable compliance boundaries.

Layer 14: Delegation Control (DCP-09)
  Scoped mandates and awareness thresholds prevent authority escalation.
```

Para os detalhes de conformidade com a criptografia pós-quântica do NIST, veja [NIST_CONFORMITY.md](../../../docs/NIST_CONFORMITY.md).
Para migrar a partir do modelo de segurança da V1.0, veja [MIGRATION_V1_V2.md](../../../docs/MIGRATION_V1_V2.md).

---

<a id="operational-security-requirements"></a>

## Requisitos de segurança operacional

<a id="private-key-storage"></a>

### Armazenamento de chaves privadas

| Nível de segurança | Requisito |
|---|---|
| **Routine** | Arquivos de chaves com permissões 0600, cifrados em repouso (no nível do sistema operacional) |
| **Standard** | Repositório de chaves cifrado com frase secreta (PKCS#8 ou similar) |
| **Elevated** | Integração com HSM/TPM (DEVERIA). Integração com o chaveiro do sistema operacional |
| **Maximum** | Integração com HSM/TPM (DEVE). Cerimônia isolada (air-gapped) para a geração de chaves |

Este repositório não tem integração com HSM/TPM: o `HsmCryptoProvider` do código TypeScript é um padrão simulado que não deve ser usado para evidências reais ([NIST_CONFORMITY.md](../../../docs/NIST_CONFORMITY.md) §2.2). As linhas elevated e maximum precisam de uma integração própria.

A CLI de referência (`bin/dcp.js`) e a CLI do SDK Python gravam os arquivos de chaves secretas com modo `0600` (leitura e gravação para o proprietário, sem permissões para o grupo nem para outros). O `@dcp-ai/cli init` interativo não faz isso: ele os grava com as permissões padrão (`0644` com a umask habitual `022`), então execute `chmod 600 .dcp/keys/*_secret.key`. Os operadores NÃO DEVEM afrouxar essas permissões.

<a id="revocation-propagation-slas"></a>

### SLAs de propagação da revogação

| Nível de segurança | Latência máxima aceitável |
|---|---|
| **Routine** | 24 horas |
| **Standard** | 1 hora |
| **Elevated** | 15 minutos |
| **Maximum** | Imediata (notificação push + grampeamento no estilo OCSP) |

São metas para os operadores. O repositório não tem notificação push nem grampeamento; o mais próximo é o perfil de admissão strict-v1, que exige um snapshot de revogação com no máximo 300 segundos de idade. Os operadores DEVERIAM configurar o TTL do cache da lista de revogações conforme o nível mais alto que atendem, e falhar fechados quando não conseguirem baixar a lista.

<a id="api-security"></a>

### Segurança da API

Todas as implantações em produção DEVEM:
- Impor TLS 1.3 (no mínimo TLS 1.2)
- Exigir autenticação em todos os endpoints que alteram dados (token Bearer ou chave de API)
- Configurar a limitação de taxa conforme as especificações `x-ratelimit` de `openapi.yaml`
- Definir os cabeçalhos de segurança: `Strict-Transport-Security`, `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`
- Restringir o CORS a origens confiáveis
- Usar `Cache-Control: no-store` nas respostas de verificação

<a id="v1-to-v2-downgrade-prevention"></a>

### Prevenção do rebaixamento de V2 para V1

Quando um agente tem chaves V2 registradas, os verificadores DEVERIAM rejeitar os bundles V1 desse agente (fixação de capacidades). O indicador de política `allow_v1_bundles` tem padrão `true` durante a migração, mas DEVERIA ser definido como `false` quando a migração terminar.

<a id="supply-chain-security"></a>

### Segurança da cadeia de suprimentos

Os operadores que implantam o DCP DEVEM:
- Fixar todas as versões das bibliotecas criptográficas nos arquivos de lock
- Verificar a integridade das dependências com hashes SRI
- Monitorar comprometimentos nas bibliotecas de origem (`@noble/post-quantum`, `tweetnacl` etc.)
- Usar builds reproduzíveis para os componentes criptográficos

---

<a id="known-limitations-and-mitigations"></a>

## Limitações conhecidas e mitigações

| Limitação | Mitigação |
|---|---|
| Identidade autodeclarada no nível `routine` | Exigir atestação, ou admissão diante de um conjunto de confiança, para os níveis `standard` e superiores; os verificadores não impõem isso por conta própria |
| O cache de verificação pode servir resultados desatualizados | O cache DEVE ser invalidado quando a lista de revogações é atualizada. O `@dcp-ai/sdk` 2.2.1 publicado e as versões anteriores indexam o `VerificationCache` do TypeScript apenas pelo hash do bundle, e o `invalidateByAgent` deles não faz nada. O código-fonte de `main` (não publicado) adiciona a invalidação por agente (que também remove todas as entradas armazenadas sem `agentIds`) e um `context` opcional escolhido por quem chama, mas não invalida nada automaticamente: chame `invalidateByKid`, `invalidateByAgent` ou `clear()`, ou passe a um novo contexto, quando a confiança ou a revogação mudarem ([API_REFERENCE.md](../../../docs/API_REFERENCE.md#verificationcache)) |
| Os verificadores V2 publicados antes de 28/10/2026 não verificam a cadeia de auditoria secundária opcional nem a raiz de Merkle secundária; desde `@dcp-ai/sdk` 2.2.1, `@dcp-ai/wasm` 2.1.1, `dcp-ai` 2.10.1 (PyPI), Go v2.11.1 e Rust `dcp-ai` 2.11.1, os campos presentes são verificados e os ausentes não são exigidos | Com as versões anteriores, confie apenas nas verificações realmente feitas: os compromissos SHA-256 primários e as assinaturas, e não atribua a um resultado bem-sucedido a proteção adicional especificada em V2-11. A partir dessas versões, um resultado bem-sucedido cobre os campos secundários presentes, não uma cadeia secundária completa; o candidato experimental reutiliza essas verificações ([STORAGE_AND_ANCHORING.md](../../../docs/STORAGE_AND_ANCHORING.md#dual-hash-chains)) |
| A persistência do `agent_id` permite rastreamento | Considerar a rotação de pseudônimos em cenários de alta privacidade |
| O BlindedRPR expõe `entity_type` e `jurisdiction` | Futuro: apresentação de credenciais baseada em ZKP |
| Nenhum SDK executa a troca X25519 + ML-KEM-768 do DCP-04 | Quem chama deriva a chave de sessão A2A. Python, Go, Rust e WASM expõem o ML-KEM-768 como primitiva; os provedores KEM do TypeScript são internos |
| O ML-DSA-87 não está implementado | O identificador está reservado no esquema de chaves; nenhum SDK consegue usá-lo, e o padrão HSM simulado que o lista não é uma implementação |
| Os endpoints do DCP-05–09 do servidor de referência não têm autenticação e não verificam assinaturas | Não os exponha a clientes não confiáveis ([OPERATOR_GUIDE.md](../../../docs/OPERATOR_GUIDE.md#dcp-0509-service-endpoints)) |

As seguintes limitações, que apareciam em rascunhos anteriores, foram **encerradas**:

- *A criptografia PQ da CLI era simulada (marcador HMAC)*: resolvido; a CLI de referência (`bin/dcp.js`) agora usa ML-DSA-65 real via `@noble/post-quantum` para gerar chaves e assinar.
- *O Shamir SSS da CLI era um marcador (partes aleatórias)*: resolvido; a CLI usa `secrets.js-grempe`, uma biblioteca real de compartilhamento de segredos de Shamir, nas operações de recuperação de chaves.
- *O comportamento do DCP-04..09 só existia em TypeScript*: resolvido em 2.2.0..2.7.0; ciclo de vida, sucessão, resolução de disputas, arbitragem, direitos e obrigações, delegação, limiar de atenção e espelho do principal estão disponíveis em Python, Rust e Go com a mesma semântica da referência TypeScript. As mensagens de handshake A2A e a camada de sessão AES-256-GCM estão em Python e Go; o Rust cobre a descoberta, as mensagens de handshake e os IDs de sessão. Veja [CHANGELOG.md](../../../CHANGELOG.md#210---2026-04-22) para o detalhamento versão a versão.
- *A taxonomia canônica de erros só existia em TypeScript*: resolvido na 2.7.0; 38 valores de `DcpErrorCode` com identificadores estáveis `DCP-E###` estão agora alinhados entre TypeScript, Python, Rust e Go, de modo que o tratamento de erros entre SDKs coincide numa única string.
- *O `keygen` da CLI Python gravava a chave secreta com o modo de arquivo padrão*: resolvido; `sdks/python/dcp_ai/cli.py` agora cria `secret_key.txt` de forma atômica com modo 0600 a partir da própria chamada `os.open` (sem janela de corrida de chmod) e define o diretório que o contém com modo 0700.

---

<a id="reference"></a>

## Referências

- Checklist de verificação: [spec/VERIFICATION.md](../../../spec/VERIFICATION.md)
- Impressões digitais do protocolo: [protocol_fingerprints.json](../../../protocol_fingerprints.json)
- DCP-01 (atestação): [spec/DCP-01.md](../../../spec/DCP-01.md)
- Armazenamento, ancoragem, revogação: [STORAGE_AND_ANCHORING.md](../../../docs/STORAGE_AND_ANCHORING.md)
- Arquitetura técnica: [TECHNICAL_ARCHITECTURE.md](../../../docs/TECHNICAL_ARCHITECTURE.md)
