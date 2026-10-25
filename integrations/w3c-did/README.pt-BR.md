<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · [日本語](README.ja.md) · **Português**</sub>

<a id="dcp-ai--w3c-didvc-bridge"></a>
<a id="dcp-ai-w3c-didvc-bridge"></a>

# Ponte DCP-AI ↔ W3C DID/VC

> Tradução informativa da [versão em inglês](README.md), atualizada em 25/10/2026. Em caso de divergência, prevalece a versão em inglês. Identificadores, comandos e blocos de código são mantidos sem tradução.

Converte entre artefatos do DCP e os identificadores descentralizados (DIDs) e credenciais verificáveis (VCs) do W3C.

<a id="installation"></a>

## Instalação

```bash
npm install @dcp-ai/w3c-did
```

A 2.0.0 do npm (25/10/2026) tem o mesmo `index.js` que o código-fonte em `main`. Ela roda no Node.js (usa `Buffer`) e não tem dependências.

<a id="limits-25102026"></a>

## Limites (25/10/2026)

Leia-os antes de confiar na saída; foram checados contra `index.js`:

- **Chaves.** `rprToDIDDocument` lê as chaves de `rpr.keys`. Um RPR V2 que segue o schema as traz em `binding_keys`, que ele não lê, então o seu DID Document não tem métodos de verificação.
- **Codificação.** `publicKeyMultibase` é `z` seguido de base64url. No [Multibase](https://www.w3.org/TR/cid-1.0/#multibase), `z` significa base58btc: isso rotula errado a codificação e pode produzir um erro de decodificação ou bytes de chave diferentes em outras ferramentas. O `didDocumentToRPR` deste pacote usa o decodificador base64url correspondente, não um decodificador multibase conforme.
- **Sem provas.** As credenciais e apresentações verificáveis que ele constrói não trazem `proof`: não são assinadas. `passportToVC` copia campos selecionados do passaporte e não preserva uma assinatura do DCP. `bundleToVP` preserva o bundle assinado recebido em `dcpBundle`, que precisa ser checado à parte com um verificador do DCP; essa checagem não autentica o `holder`, o `created` nem os campos copiados da credencial da VP ao redor.
- **URL de contexto.** Os DID Documents que ele produz listam `https://w3id.org/security/suites/ed2519-2020/v1` em `@context`, uma grafia errada da URL da suíte Ed25519-2020 (`index.js`). Até que isso seja corrigido em outra mudança, não trate a saída como JSON-LD de DID do W3C conforme.
- **Namespaces.** Este repositório usa `did:dcp:` e `PostQuantumVerificationKey2024` como identificadores próprios. Ele não fornece nenhum resolvedor de DID nem evidência de registro para eles; não suponha que ferramentas externas de DID/VC os reconheçam.

<a id="supported-dcp-specifications"></a>

## Especificações do DCP suportadas

Do DCP-01 ao DCP-09, como correspondências parciais dos campos listados abaixo e com os limites acima; não é uma implementação completa dessas especificações.

<a id="overview"></a>

## Visão geral

Esta ponte permite a interoperabilidade entre a camada de identidade do DCP-AI e o ecossistema de identidade descentralizada do W3C. Ela suporta a conversão nos dois sentidos de:

- **Responsible Principal Records ↔ DID Documents** — mapeia as identidades humanas do DCP para DIDs do método `did:dcp:` com métodos de verificação derivados das chaves do RPR.
- **Agent Passports ↔ Verifiable Credentials** — representa as certificações de agentes do DCP como VCs do W3C, incluindo capacidades, modo de responsabilidade e jurisdição.
- **Signed Bundles → Verifiable Presentations** — envolve Citizenship Bundles do DCP completos como VPs do W3C para apresentação a verificadores externos.

<a id="functions"></a>

## Funções

| Função | Sentido | Descrição |
|---|---|---|
| `rprToDIDDocument(rpr)` | DCP → W3C | Converte um Responsible Principal Record em um DID Document |
| `didDocumentToRPR(didDoc)` | W3C → DCP | Converte um DID Document de volta em um esqueleto de RPR |
| `passportToVC(passport, issuerDid)` | DCP → W3C | Converte um Agent Passport em uma Verifiable Credential |
| `vcToPassport(vc)` | W3C → DCP | Converte uma Verifiable Credential de volta em um esqueleto de passaporte |
| `bundleToVP(signedBundle, holderDid)` | DCP → W3C | Envolve um bundle assinado como Verifiable Presentation |
| `rightsToServiceEndpoints(rightsDeclaration)` | DCP → W3C | Converte uma declaração de direitos em endpoints de serviço do DID (DCP-08) |

<a id="did-method"></a>

## Método DID

Esta ponte usa o namespace do método `did:dcp:`. Os identificadores DID são derivados diretamente dos IDs humanos do RPR:

```
did:dcp:<human-id-uuid>
```

Os métodos de verificação suportam tanto Ed25519 (clássico) quanto tipos de chave pós-quânticos.

<a id="usage"></a>

## Uso

```javascript
// Fragment: myRpr, myPassport and signedBundle come from your application
import { rprToDIDDocument, passportToVC, bundleToVP } from '@dcp-ai/w3c-did';

// Convert an RPR to a DID Document
const didDoc = rprToDIDDocument(myRpr);

// Issue a Verifiable Credential for an agent
const vc = passportToVC(myPassport, 'did:dcp:issuer-id');

// Wrap a full bundle as a Verifiable Presentation
const vp = bundleToVP(signedBundle, 'did:dcp:holder-id');
```

<a id="notes"></a>

## Notas

- As conversões para esqueleto (W3C → DCP) produzem registros parciais que exigem processamento adicional (recálculo dos IDs de chave, assinatura etc.) antes de serem artefatos do DCP válidos.
- O valor de `publicKeyMultibase` rotula base64url como base58btc e não codifica corretamente a chave original para consumidores de multibase (veja os limites).
