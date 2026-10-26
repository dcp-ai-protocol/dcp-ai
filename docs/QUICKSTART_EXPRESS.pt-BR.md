<sub>[English](QUICKSTART_EXPRESS.md) · [中文](QUICKSTART_EXPRESS.zh-CN.md) · [Español](QUICKSTART_EXPRESS.es.md) · [日本語](QUICKSTART_EXPRESS.ja.md) · **Português**</sub>

<a id="dcp-ai--express-quick-start"></a>
<a id="dcp-ai-express-quick-start"></a>

# DCP-AI + Express: início rápido

> Tradução informativa da [versão em inglês](QUICKSTART_EXPRESS.md), atualizada em 26/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Verifique bundles assinados DCP nas suas APIs Express.js com o middleware `@dcp-ai/express`.

---

<a id="installation"></a>

## Instalação

> **Versões (26/10/2026).** Use `@dcp-ai/express` 2.1.0 publicado com `@dcp-ai/sdk` 2.2.0. Eles incluem o verificador corrigido e a admissão com principais confiáveis e `strict-v1`; não é necessário compilar um checkout. Veja o [README do Express](../integrations/express/README.md).

```bash
npm install @dcp-ai/express@^2.1.0 @dcp-ai/sdk@^2.2.0 express
```

<a id="zero-config-scaffold-alternative"></a>

### Scaffold sem configuração (alternativa)

```bash
npm create @dcp-ai/express my-api
cd my-api
npm install
```

Gera um `index.js` executável com endpoints de descoberta e, numa rota de exemplo, um middleware que só verifica a
estrutura de um bundle: ele não verifica nenhuma assinatura, então um bundle forjado ou alterado passa (veja
[templates/express](../templates/express/README.md)). Para verificar bundles assinados, use o `@dcp-ai/express` como abaixo.

<a id="python-equivalent-fastapi"></a>

### Equivalente em Python (FastAPI)

Para serviços FastAPI, instale a ponte Python do PyPI 2.10.0. Ela inclui verificação de assinaturas V2 e os controles de admissão/recursos do [README do FastAPI](../integrations/fastapi/README.md). O middleware antigo 2.9.0 verifica a estrutura V2 sem verificar assinaturas; atualize antes de usá-lo para V2.

```bash
pip install "dcp-ai[fastapi]>=2.10.0,<3"
```

```python
from fastapi import FastAPI, Depends
from dcp_ai.fastapi import DCPVerifyMiddleware, require_dcp

app = FastAPI()
app.add_middleware(DCPVerifyMiddleware, require_bundle=True)

@app.post("/agent/action")
async def agent_action(agent=Depends(require_dcp)):
    # agent.passport / agent.intent / agent.session_nonce are populated
    return {"ok": True, "agent": agent.agent_id}
```

---

<a id="how-dcp-integrates-with-express"></a>

## Como o DCP se integra ao Express

O middleware DCP para Express extrai e verifica os bundles assinados das requisições recebidas. A identidade verificada do agente é anexada ao objeto da requisição para uso posterior.

```
Client (AI Agent)                    Express Server
  │                                      │
  │─── Request + DCP Bundle ────────────►│
  │    (body.signed_bundle, recommended; │
  │     or X-DCP-Bundle if it fits)      │
  │                                      ├─ dcpVerify() middleware
  │                                      │  ├─ Parse bundle (V1 or V2)
  │                                      │  ├─ Verify signatures
  │                                      │  ├─ Check session binding
  │                                      │  ├─ Optional revocation check
  │                                      │  └─ Attach req.dcpAgent
  │                                      │
  │◄── Response ────────────────────────│
```

---

<a id="complete-working-example"></a>

## Exemplo completo funcional

```typescript
import express from 'express';
import { dcpVerify, type DCPAgent } from '@dcp-ai/express';

const app = express();
// Bundles travel in the JSON body: a budget sized for them (see "Sending DCP Bundles").
app.use(express.json({ limit: '64kb' }));

// 1. Basic DCP verification — require a valid bundle on /api and every route under it
//    (a path prefix: works on Express 4 and 5, unlike a '/api/*' pattern, which Express 5 rejects)
app.use('/api', dcpVerify({ requireBundle: true }));

// 2. Access verified agent identity in your handlers (POST: the bundle comes in the body)
app.post('/api/data', (req: express.Request & { dcpAgent?: DCPAgent }, res) => {
  const agent = req.dcpAgent!;
  
  res.json({
    message: `Hello, agent ${agent.agentId}`,
    humanPrincipal: agent.humanId,
    capabilities: agent.capabilities,
    riskTier: agent.riskTier,
    dcpVersion: agent.dcpVersion,
  });
});

// 3. Capability-based access control
app.post('/api/payments', (req: express.Request & { dcpAgent?: DCPAgent }, res) => {
  const agent = req.dcpAgent!;

  if (!agent.capabilities.includes('payments')) {
    return res.status(403).json({
      error: 'Agent lacks payments capability',
      agentId: agent.agentId,
    });
  }

  // Process payment...
  res.json({ status: 'ok' });
});

app.listen(3000, () => console.log('DCP-protected API on :3000'));
```

---

<a id="configuration-options"></a>

## Opções de configuração

```typescript
// Fragment: `app` as in the Complete Working Example
import { dcpVerify } from '@dcp-ai/express';

app.use(dcpVerify({
  // Require a DCP bundle (403 if missing). Default: true
  requireBundle: true,

  // Header the bundle may be sent in, read before body.signed_bundle. Default: 'x-dcp-bundle'.
  // Only for bundles within the header limits (Node: 16 KiB for all headers); hybrid ones go in the body.
  headerName: 'x-dcp-bundle',

  // Check agent revocation status against a service. Default: false
  checkRevocation: true,
  revocationServiceUrl: 'http://localhost:3003',
  // Refuse the request (403) when the status cannot be read. Default: false, which lets it through (fail open)
  revocationFailClosed: true,

  // Cache verification results (seconds). Default: 0 (no cache)
  cacheTtlSeconds: 60,

  // V2: Require hybrid composite signatures
  requireHybrid: true,

  // V2: Fine-grained verifier policy
  verifierPolicy: {
    default_mode: 'hybrid_required',
    require_session_binding: true,
    require_composite_binding: true,
  },

  // Custom failure handler
  onFailure: (req, res, errors) => {
    res.status(403).json({ verified: false, errors, hint: 'Send the bundle in body.signed_bundle' });
  },
}));
```

Em `main`, `trustedPrincipals`, `profile`, `revocationSource` e `tenant` acrescentam a admissão: só chegam à rota os bundles
assinados para um principal em que você confia, com as chaves confiáveis dele. Veja [ADMISSION.md](ADMISSION.md) e o
[README do Express](../integrations/express/README.md) para todas as opções, inclusive as de cache, supervisão e
desconexão.

---

<a id="sending-dcp-bundles-from-a-client"></a>

## Enviar bundles DCP a partir de um cliente

```typescript
// Fragment: `signed` is a signed V1 or V2 bundle, built as in the TypeScript SDK's Quick Start
// (../sdks/typescript/README.md).

// Send via body (recommended, and the way for hybrid V2 bundles)
const response = await fetch('http://localhost:3000/api/data', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    signed_bundle: signed,
    // ... other body fields
  }),
});

// Or via header, only for a bundle that fits the header limits of the server and every proxy
const response2 = await fetch('http://localhost:3000/api/data', {
  method: 'POST',
  headers: {
    'X-DCP-Bundle': JSON.stringify(signed),
    'Content-Type': 'application/json',
  },
});
```

Um bundle V2 híbrido (Ed25519 + ML-DSA-65) tem cerca de 33 KB, enquanto o Node aceita por padrão 16 KiB de cabeçalhos
de requisição: em `X-DCP-Bundle` ele é recusado com `431` antes de o Express rodar. Não aumente
o limite de cabeçalhos para isso; envie-o no corpo. O `limit` do parser do corpo é o seu orçamento, uma escolha
da sua implantação e não um limite do protocolo: meça o seu maior bundle, deixe margem e mantenha
qualquer proxy à frente pelo menos tão permissivo. Um corpo maior recebe `413` antes do middleware.
`integrations/express/examples/strict-v1-body.mjs` percorre todo o caminho sobre HTTP real com
admissão `strict-v1`.

---

<a id="v2-bundle-verification"></a>

## Verificação de bundles V2

O middleware detecta automaticamente bundles V1 e V2. Um bundle V2 só é aceito se `verifySignedBundleV2` do `@dcp-ai/sdk` o aceitar sob a política de verificador do middleware (`verifierPolicy` sobre o `DEFAULT_VERIFIER_POLICY` do SDK e, depois, `requireHybrid`). Ele verifica:

- **Assinaturas compostas** — a assinatura Ed25519 + ML-DSA-65 do principal sobre o manifesto, com as `binding_keys` do RPR, e a assinatura própria de cada artefato, no mais estrito entre o modo da política para o nível de risco do passaporte e o modo do nível de segurança da intenção; uma assinatura PQ presente precisa ser verificada
- **Integridade do manifesto** — Todos os hashes dos artefatos e a raiz de Merkle da auditoria conferem
- **Vinculação de sessão** — Consistência do nonce de sessão em todos os artefatos, e expiração da sessão
- **Cadeia de hashes da auditoria** e validade das chaves (chaves revogadas ou expiradas)

Um bundle V1 não tem assinatura pós-quântica, então só é aceito onde um bundle apenas clássico seria (VERIFICATION.md V2-10): sob a política padrão, um bundle V1 com uma intenção routine ou standard passa, e um com pagamento, dados sensíveis, impacto estimado alto ou pontuação de risco de 0.5 ou mais é recusado. `requireHybrid` e `allow_v1_bundles: false` recusam todos os bundles V1.

Um bundle verificado é internamente consistente e assinado pelas chaves que ele mesmo lista; isso não prova quem é o principal. Para aceitar bundles apenas de principais em que você confia, configure a admissão (`trustedPrincipals`; veja [ADMISSION.md](ADMISSION.md)). Veja o README do pacote para a vinculação de audiência contra repetição.

```typescript
// Fragment: continues the Complete Working Example (`app`, `express`, `DCPAgent`)
// V2-specific agent properties
app.get('/api/secure', (req: express.Request & { dcpAgent?: DCPAgent }, res) => {
  const agent = req.dcpAgent!;

  if (agent.dcpVersion === '2.0') {
    console.log('Key IDs:', agent.kids);
    console.log('Session:', agent.sessionNonce);
  }

  res.json({ verified: true, version: agent.dcpVersion });
});
```

---

<a id="dcpagent-interface"></a>

## Interface DCPAgent

A identidade verificada do agente anexada a `req.dcpAgent`:

```typescript
interface DCPAgent {
  agentId: string;
  humanId: string;
  publicKey: string;
  capabilities: string[];
  riskTier: string;
  status: string;
  dcpVersion: '1.0' | '2.0';
  /** V2: Key identifiers of the passport keys. */
  kids?: string[];
  /** V2: Session nonce for the bundle. */
  sessionNonce?: string;
  /** DCP-05: Agent lifecycle state. */
  lifecycleState?: string;
  /** DCP-09: Active delegation mandate ID. */
  mandateId?: string;
  /** V2: Warnings of the SDK verifier for an accepted bundle (e.g. a classical-only signature). */
  warnings?: string[];
  /** V2: The verification mode the bundle was verified in. */
  verificationMode?: VerificationMode;
  /** V2: The security tier of the bundle's intent and policy decision (spec §14.2). */
  securityTier?: SecurityTier;
  /** With trustedPrincipals: the admission of the bundle (spec/profiles/admission § 5.2). */
  admission?: {
    admitted: true;
    principalTrust: PrincipalTrust;
    profile: 'strict-v1' | null;
    profileCompliance: ProfileCompliance;
    /** The decision the bundle records (approve, escalate, block): evidence, not a permission. */
    recordedDecision: string | null;
    trustSetVersion: string | null;
    /** Always false: admitting the evidence does not authorize an action. */
    actionAuthorized: false;
  };
}
```

---

<a id="next-steps"></a>

## Próximos passos

- **[Início rápido principal](./QUICKSTART.md)** — Uso básico do SDK
- **[Integração com LangChain](./QUICKSTART_LANGCHAIN.md)** — Envolva ferramentas do LangChain
- **[Referência da API](./API_REFERENCE.md)** — Documentação completa do SDK
