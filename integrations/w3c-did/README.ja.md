<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · **日本語** · [Português](README.pt-BR.md)</sub>

<a id="dcp-ai--w3c-didvc-bridge"></a>
<a id="dcp-ai-w3c-didvc-bridge"></a>

# DCP-AI ↔ W3C DID/VC のブリッジ

> [英語版](README.md)の参考訳です（26/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

DCP のアーティファクトと、W3C の分散型識別子（DID）および検証可能なクレデンシャル（VC）との間で変換します。

<a id="installation"></a>

## インストール

```bash
npm install @dcp-ai/w3c-did
```

npm の 2.0.1（2026 年 10 月 26 日）は、`main` のソースと同じ `index.js` を持っています。Node.js で動作し（`Buffer` を使います）、依存関係はありません。

<a id="limits-25102026"></a>

## 制限（2026 年 10 月 25 日）

出力を当てにする前に読んでください。`index.js` に照らして確認しています。

- **鍵。** `rprToDIDDocument` は `rpr.keys` から鍵を読みます。スキーマに従う V2 の RPR は鍵を `binding_keys` に持ちますが、これは読まないため、その DID Document には検証方法がありません。
- **エンコーディング。** `publicKeyMultibase` は `z` の後に base64url が続くものです。[Multibase](https://www.w3.org/TR/cid-1.0/#multibase) では `z` は base58btc を意味するため、エンコーディングの表示が誤っており、ほかのツールではデコードのエラーや異なる鍵のバイト列になることがあります。このパッケージの `didDocumentToRPR` は、準拠した multibase のデコーダーではなく、対応する base64url のデコーダーを使います。
- **証明なし。** 作られる検証可能なクレデンシャルとプレゼンテーションは `proof` を持たず、署名されていません。`passportToVC` はパスポートの選んだフィールドをコピーし、DCP の署名は保持しません。`bundleToVP` は、渡された署名付きバンドルを `dcpBundle` に保持し、それは DCP の検証器で別に確認しなければなりません。その確認は、周りの VP の `holder`、`created`、コピーされたクレデンシャルのフィールドを認証しません。
- **コンテキストの URL。** 生成される DID Document は、`@context` に `https://w3id.org/security/suites/ed2519-2020/v1` を挙げますが、これは Ed25519-2020 のスイートの URL の誤記です（`index.js`）。別の変更で修正されるまで、出力を W3C の DID に準拠した JSON-LD として扱わないでください。
- **名前空間。** このリポジトリは、`did:dcp:` と `PostQuantumVerificationKey2024` を独自の識別子として使います。それらの DID リゾルバーも登録の証拠も提供していないため、外部の DID/VC のツールがそれらを認識すると仮定しないでください。

<a id="supported-dcp-specifications"></a>

## サポートする DCP の仕様

DCP-01 から DCP-09。以下に挙げるフィールドの部分的な対応付けで、上記の制限があります。これらの仕様の完全な実装ではありません。

<a id="overview"></a>

## 概要

このブリッジは、DCP-AI の身元のレイヤーと W3C の分散型アイデンティティのエコシステムとの相互運用性を実現します。次の双方向の変換をサポートします。

- **Responsible Principal Record ↔ DID Document** — DCP の人間の身元を、RPR の鍵から導出した検証方法を持つ `did:dcp:` メソッドの DID に対応付けます。
- **Agent Passport ↔ Verifiable Credential** — DCP のエージェントの証明を、能力、責任のモード、管轄を含む W3C の VC として表します。
- **Signed Bundle → Verifiable Presentation** — 外部の検証者に提示するため、DCP の Citizenship Bundle 全体を W3C の VP として包みます。

<a id="functions"></a>

## 関数

| 関数 | 方向 | 説明 |
|---|---|---|
| `rprToDIDDocument(rpr)` | DCP → W3C | Responsible Principal Record を DID Document に変換する |
| `didDocumentToRPR(didDoc)` | W3C → DCP | DID Document を RPR の骨組みに戻す |
| `passportToVC(passport, issuerDid)` | DCP → W3C | Agent Passport を Verifiable Credential に変換する |
| `vcToPassport(vc)` | W3C → DCP | Verifiable Credential をパスポートの骨組みに戻す |
| `bundleToVP(signedBundle, holderDid)` | DCP → W3C | 署名付きバンドルを Verifiable Presentation として包む |
| `rightsToServiceEndpoints(rightsDeclaration)` | DCP → W3C | 権利の宣言を DID のサービスエンドポイントに変換する（DCP-08） |

<a id="did-method"></a>

## DID メソッド

このブリッジは `did:dcp:` メソッドの名前空間を使います。DID の識別子は、RPR の人間の ID から直接導出されます。

```
did:dcp:<human-id-uuid>
```

検証方法は、Ed25519（クラシカル）とポスト量子の鍵の種類の両方をサポートします。

<a id="usage"></a>

## 使い方

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

## 注記

- 骨組みへの変換（W3C → DCP）は部分的な記録を生成し、有効な DCP のアーティファクトになる前に追加の処理（鍵 ID の再計算、署名など）が必要です。
- `publicKeyMultibase` の値は base64url を base58btc と表示しており、multibase の利用者に対して元の鍵を正しくエンコードしていません（制限を参照）。
