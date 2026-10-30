<sub>[English](../../../playground/README.md) · [Español](../../es/playground/README.md) · [Português](../../pt-BR/playground/README.md) · **日本語** · [中文](../../zh-CN/playground/README.md)</sub>

<a id="dcp-ai-playground"></a>

# DCP-AI プレイグラウンド

> [英語版](../../../playground/README.md)の参考訳です。更新日：2026年10月25日。相違がある場合は英語の原文が優先されます。識別子とコードブロック（コメントを含む）は原文のままです。

Digital Citizenship Protocol（DCP-01 から DCP-09）のブラウザー上の対話型デモです。[docs.dcp-ai.org/playground/](https://docs.dcp-ai.org/playground/) で公開しています。

これはデモです。ポスト量子署名はシミュレーションで、正規形と Merkle ルートも簡略化されています。そのため、生成物は証拠にはならず、SDK の検証器で検証に成功するとは限りません（[制限](#limitations)を参照）。

<a id="quick-start"></a>

## クイックスタート

```bash
cd playground
python3 -m http.server 8080
# Open http://localhost:8080
```

ES モジュールには HTTP サーバーが必要です。`file://` では動作しません。

<a id="architecture"></a>

## アーキテクチャ

プレイグラウンドは ES モジュール（`<script type="module">`）を使うモジュール構成のアプリケーションで、ビルド手順はありません。

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

JS モジュールは20個（2026年10月25日時点で約2700行）です。

<a id="navigation"></a>

## ナビゲーション

2階層のナビゲーション：

| グループ | タブ |
|-------|------|
| **プロトコルの中核** | アイデンティティ、バンドルビルダー、検証器、ティア、エクスプローラー |
| **ライフサイクル** | エージェントのライフサイクル（DCP-05）、継承（DCP-06） |
| **ガバナンス** | 紛争（DCP-07）、権利（DCP-08）、委任（DCP-09） |
| **ワークフロー** | 仕様をまたぐフロー |

<a id="spec-coverage"></a>

## 対象仕様

| 仕様 | デモで示す機能 |
|------|----------------------|
| DCP-01 | RPR、エージェントパスポート、Ed25519 鍵ペアの生成 |
| DCP-02 | 意図の宣言、リスクスコアリング、セキュリティティアの選択 |
| DCP-03 | ポリシー判断、監査エントリ、ハッシュチェーンによる監査証跡、バンドルマニフェスト、Merkle ルート |
| DCP-05 | 状態機械（commissioned/active/declining/decommissioned）、活力レポート、運用開始証明書、運用終了記録 |
| DCP-06 | デジタル遺言、記憶の分類、記憶転送マニフェスト、継承手続き |
| DCP-07 | 紛争記録、3段階のエスカレーション、仲裁判断、判例バンドル、異議記録 |
| DCP-08 | 権利宣言、義務記録、違反レポート、権利マトリクス、自動紛争申立て |
| DCP-09 | 委任状、認識閾値、助言宣言、プリンシパルミラー、委任チェーンの可視化 |

<a id="cross-spec-workflows"></a>

## 仕様をまたぐワークフロー

4つのガイド付きワークフロー：

1. **エージェントの全ライフサイクル**（DCP-01 + 05 + 06）：アイデンティティの作成から継承まで
2. **紛争を伴う委任アクション**（DCP-01 + 09 + 02 + 07）：委任から紛争解決まで
3. **権利侵害のエスカレーション**（DCP-08 + 07 + 05）：違反検出からライフサイクルへの影響まで
4. **プリンシパルによる監督**（DCP-09 + 02 + 03）：閾値の設定から監督レポートまで

<a id="how-it-works"></a>

## 仕組み

暗号処理はすべて**ブラウザー内だけで**実行します。

- **Ed25519 署名**：CDN から読み込む [tweetnacl](https://github.com/dchest/tweetnacl-js) を使用
- **SHA-256 ハッシュ**：Web Crypto API（`crypto.subtle.digest`）を使用
- **鍵 ID（kid）**：仕様に従って導出：`hex(SHA-256(UTF8(alg) || 0x00 || pubkey_bytes))[0:32]`
- **ドメイン分離**：すべての署名に適用：`UTF8(context_tag) || 0x00 || canonical_payload`
- **正規化**：鍵をソートして決定的にハッシュ化（簡略化した形式であり、完全な `dcp-jcs-v1` プロファイルではない）
- **複合署名**：`composite_signature.schema.json` に従う `{ classical, pq, binding }` 形式
- **セッション nonce**：64文字の16進数（`crypto.getRandomValues(32)`）

<a id="key-corrections-from-previous-playground"></a>

## 以前のプレイグラウンドからの主な修正

- `session_nonce`：UUID から64文字の16進数へ変更（スキーマ `^[0-9a-f]{64}$` に準拠）
- `composite_sig`：`{ entries[] }` から `{ classical, pq, binding }` へ変更（v2 スキーマの形式）
- 生成するすべてのアーティファクトに、仕様の節を示す `_spec_ref` を追加
- プロトコルエクスプローラーを DCP-01 から DCP-09 まで拡張

<a id="limitations"></a>

## 制限

- **ポスト量子署名はシミュレーションです**。ML-DSA-65 は HMAC ベースの代替処理です。Ed25519 は実際の暗号処理です。実際の PQ 署名には SDK を使用してください（ブラウザーでは `sdks/wasm/` の WASM SDK）。
- Merkle ルートの計算は簡略化した連結を使用
- CBOR ワイヤ形式には非対応（JSON のみ）
- 署名検証はバンドルのパスポートに含まれる Ed25519 鍵に限定
- タブ間のセッションバインディングは共有状態を使用（ストレージには永続化しない）

<a id="dependencies"></a>

## 依存関係

- `tweetnacl@1.0.3` + `tweetnacl-util@0.15.1`（CDN）
- Web Crypto API（ネイティブ）
- フレームワークもビルド手順も不要
