<sub>[English](README.md) · **中文** · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="dcp-ai--w3c-didvc-bridge"></a>
<a id="dcp-ai-w3c-didvc-bridge"></a>

# DCP-AI ↔ W3C DID/VC 桥接

> 本文是[英文版](README.md)的参考译文，更新于 25/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

在 DCP 构件与 W3C 的去中心化标识符（DID）和可验证凭证（VC）之间进行转换。

<a id="installation"></a>

## 安装

```bash
npm install @dcp-ai/w3c-did
```

npm 上的 2.0.1（2026 年 10 月 26 日）与 `main` 上源码中的 `index.js` 相同。它运行在 Node.js 上（使用 `Buffer`），没有依赖。

<a id="limits-25102026"></a>

## 限制（2026 年 10 月 25 日）

在依赖其输出之前请先阅读；这些内容已对照 `index.js` 核实：

- **密钥。** `rprToDIDDocument` 从 `rpr.keys` 读取密钥。遵循 schema 的 V2 RPR 把密钥放在 `binding_keys` 中，而它不读取该字段，因此其 DID Document 没有验证方法。
- **编码。** `publicKeyMultibase` 是 `z` 后跟 base64url。在 [Multibase](https://www.w3.org/TR/cid-1.0/#multibase) 中，`z` 表示 base58btc：这错误地标注了编码，在其他工具中可能导致解码错误或得到不同的密钥字节。本包的 `didDocumentToRPR` 使用的是与之匹配的 base64url 解码器，而不是符合规范的 multibase 解码器。
- **没有证明。** 它构建的可验证凭证和可验证表述不带 `proof`：它们未签名。`passportToVC` 复制护照的部分字段，不保留 DCP 签名。`bundleToVP` 把传入的已签名 bundle 保存在 `dcpBundle` 中，必须用 DCP 验证器另行检查；这项检查并不能认证外层 VP 的 `holder`、`created` 或复制过来的凭证字段。
- **上下文 URL。** 它生成的 DID Document 在 `@context` 中列出 `https://w3id.org/security/suites/ed2519-2020/v1`，这是 Ed25519-2020 套件 URL 的拼写错误（`index.js`）。在另一项变更修复它之前，不要把输出当作符合规范的 W3C DID JSON-LD。
- **命名空间。** 本仓库把 `did:dcp:` 和 `PostQuantumVerificationKey2024` 用作自定义标识符。它没有为它们提供 DID 解析器或注册证据；不要假定外部的 DID/VC 工具能识别它们。

<a id="supported-dcp-specifications"></a>

## 支持的 DCP 规范

DCP-01 至 DCP-09，属于对下面所列字段的部分对应，并受上述限制约束；并非这些规范的完整实现。

<a id="overview"></a>

## 概述

该桥接实现了 DCP-AI 身份层与 W3C 去中心化身份生态系统之间的互操作。它支持以下双向转换：

- **Responsible Principal Record ↔ DID Document** — 把 DCP 的人类身份映射为 `did:dcp:` 方法的 DID，其验证方法由 RPR 的密钥派生。
- **Agent Passport ↔ Verifiable Credential** — 把 DCP 的智能体认证表示为 W3C VC，包括能力、责任模式和司法辖区。
- **Signed Bundle → Verifiable Presentation** — 把完整的 DCP Citizenship Bundle 包装为 W3C VP，以便向外部验证者出示。

<a id="functions"></a>

## 函数

| 函数 | 方向 | 说明 |
|---|---|---|
| `rprToDIDDocument(rpr)` | DCP → W3C | 把 Responsible Principal Record 转换为 DID Document |
| `didDocumentToRPR(didDoc)` | W3C → DCP | 把 DID Document 转回 RPR 骨架 |
| `passportToVC(passport, issuerDid)` | DCP → W3C | 把 Agent Passport 转换为 Verifiable Credential |
| `vcToPassport(vc)` | W3C → DCP | 把 Verifiable Credential 转回护照骨架 |
| `bundleToVP(signedBundle, holderDid)` | DCP → W3C | 把已签名的 bundle 包装为 Verifiable Presentation |
| `rightsToServiceEndpoints(rightsDeclaration)` | DCP → W3C | 把权利声明转换为 DID 服务端点（DCP-08） |

<a id="did-method"></a>

## DID 方法

该桥接使用 `did:dcp:` 方法命名空间。DID 标识符直接由 RPR 的人类 ID 派生：

```
did:dcp:<human-id-uuid>
```

验证方法同时支持 Ed25519（经典）和后量子密钥类型。

<a id="usage"></a>

## 用法

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

## 说明

- 骨架转换（W3C → DCP）产生的是部分记录，在成为有效的 DCP 构件之前还需要额外处理（重新计算密钥 ID、签名等）。
- `publicKeyMultibase` 的值把 base64url 标注为 base58btc，并没有为 multibase 使用方正确编码原始密钥（参见限制）。
