<sub>[English](SECURITY.md) · [中文](SECURITY.zh-CN.md) · [Español](SECURITY.es.md) · **日本語** · [Português](SECURITY.pt-BR.md)</sub>

<a id="security-policy"></a>

# セキュリティポリシー

> [英語版](SECURITY.md)の参考訳です（25/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

<a id="reporting-a-vulnerability"></a>

## 脆弱性の報告

**セキュリティ上の脆弱性を GitHub の公開 issue で報告しないでください。**

DCP-AI のプロトコル、SDK、サービス、スマートコントラクトにセキュリティ上の脆弱性を見つけた場合は、責任ある方法で報告してください。

- **メール:** security@dcp-ai.org
- **GitHub:** [Private Vulnerability Reporting](https://github.com/dcp-ai-protocol/dcp-ai/security/advisories/new) を使用してください

できるだけ詳しい情報を含めてください。
- 脆弱性の説明
- 再現手順
- 影響を受けるコンポーネント（プロトコル、SDK、サービス、コントラクト）
- 想定される影響の評価

<a id="response-timeline"></a>

## 対応の目安

| 段階 | 期間 |
|-------|-----------|
| 受領の連絡 | 48 時間以内 |
| 初期評価 | 7 日以内 |
| 修正（重大・高） | 30 日以内 |
| 修正（中・低） | 90 日以内 |

<a id="scope"></a>

## 対象範囲

<a id="in-scope"></a>

### 対象

- 暗号上の欠陥（Ed25519 署名、SHA-256 ハッシュ、Merkle ツリー）
- バンドル検証の回避（署名、bundle_hash、merkle_root、ハッシュチェーン）
- SDK の脆弱性（TypeScript、Python、Go、Rust、WASM）
- スマートコントラクトの不具合（DCPAnchor.sol）
- HTTP サービスの脆弱性（anchor、transparency-log、revocation）
- ミドルウェアの回避（Express、FastAPI の統合）
- プロトコルレベルの攻撃（スキーマの改ざん、ハッシュチェーンの破壊）
- ポスト量子暗号の欠陥（ML-DSA-65/87 署名、ML-KEM-768 KEM、SLH-DSA-192f）
- 複合署名のバインディングの脆弱性（pq_over_classical を剥がす攻撃）
- ハイブリッド KEM の鍵導出の弱点（X25519 + ML-KEM-768）
- A2A ハンドシェイクプロトコルの脆弱性（セッションの乗っ取り、リプレイ）
- セキュリティティアの引き下げ攻撃
- 二重ハッシュチェーン（SHA-256 + SHA3-256）の不整合
- PQ チェックポイントチェーンの完全性
- ドメイン分離タグの回避
- セッション nonce のリプレイや継ぎ合わせ

<a id="out-of-scope"></a>

### 対象外

- 管轄当局の証明がない自己申告のアイデンティティ（設計上のものです。[docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) を参照）
- 改変した検証コードを実行するオペレーター（各オペレーターが自身のデプロイに責任を負います）
- サービス拒否（プロトコルではなくインフラの問題）
- 鍵を保管する人に対するソーシャルエンジニアリング攻撃

<a id="supported-versions"></a>

## サポート対象のバージョン

パッケージは共通のバージョン番号を持たず、npm の `@dcp-ai/*` パッケージはそれぞれ独自のバージョン系列に従います。

| バージョン | サポート |
|---------|-----------|
| 2.10.x（crates.io の `dcp-ai`、Go モジュール `sdks/go/v2`） | あり |
| 2.9.x（PyPI と crates.io の `dcp-ai`、Go モジュール `sdks/go/v2`） | あり |
| 2.8.x（PyPI と crates.io の `dcp-ai`、Go モジュール `sdks/go/v2`） | あり |
| 2.2.x（`@dcp-ai/sdk`） | あり |
| 2.1.x（`@dcp-ai/sdk`） | なし：`verifySignedBundleV2` が回避されうるため。修正は 2.2.x にあります（下記の注記を参照） |
| 2.1.x（`@dcp-ai/wasm`、`@dcp-ai/openclaw`） | あり |
| 2.0.x（`@dcp-ai/wasm`、`@dcp-ai/cli`、その他の npm `@dcp-ai/*` パッケージ） | あり |
| 1.0.x   | あり（保守のみ） |
| < 1.0   | なし        |

`@dcp-ai/sdk` 2.2.0 は `v2.10.0` でタグ付けされていますが、npm にはありません。2026 年 10 月 25 日時点の npm レジストリには 2.0.0、2.1.0、2.1.1 があり、`latest` は 2.1.1 でした。2.2.0 が公開されるまでは、このリポジトリのチェックアウトから SDK をビルドする方法（`cd sdks/typescript && npm install && npm run build`）でしか修正を入手できず、npm からインストールしたバージョンは影響を受けたままです。

**影響を受けることが判明している統合のリリース（2026 年 10 月 25 日時点）：** サポート表は、公開済みのビルドに `main` のすべての修正が含まれることを意味しません。npm の `@dcp-ai/express` 2.0.0 と `@dcp-ai/openclaw` 2.0.0、および PyPI の `dcp-ai` 2.9.0 に含まれる FastAPI 統合は、構造的に正しい V2 バンドルを、その署名を暗号的に検証せずに受け入れます。これらの経路は `main` で修正済みですが、修正済みのパッケージはまだ公開されていません。V2 バンドルの検証にこれらのリリースを使わないでください。チェックアウトから使う手順とリリースに関する注意は、[Express](integrations/express/README.md)、[OpenClaw](integrations/openclaw/README.md)、[FastAPI](integrations/fastapi/README.md) の README を参照してください。この注意は上記のサポート方針を変更するものではありません。

<a id="disclosure-policy"></a>

## 開示ポリシー

- 協調的な開示に従います。修正は非公開で開発し、一般への開示の前にリリースします。
- 報告者はアドバイザリーにクレジットされます（匿名を希望する場合を除く）。
- このポリシーに従う研究者に対して法的措置はとりません。

<a id="bug-bounty"></a>

## バグバウンティ

DCP-AI はセキュリティ上の脆弱性を対象とするバグバウンティプログラムを運営しています。

| 深刻度 | 報奨 |
|----------|--------|
| 重大（PQ 暗号の破綻、署名の回避） | $5,000 - $15,000 |
| 高（検証の回避、鍵の漏洩） | $1,000 - $5,000 |
| 中（ティアの引き下げ、チェーンの改ざん） | $500 - $1,000 |
| 低（情報の開示、DoS） | $100 - $500 |

> **注記（2026 年 10 月 25 日）：文書間で記述が一致していません。** この表は固定の報奨額の範囲を示していますが、[GOVERNANCE.md](GOVERNANCE.md) と [docs/EARLY_ADOPTERS.md](docs/EARLY_ADOPTERS.md) は、報奨は固定の区分なしにケースごとに決めるとしています。どちらが適用されるかをメンテナーが確認するまで、各文書の記述はそのまま残します。それまでは、どの報奨も確定していないものとして扱い、メンテナーに問い合わせてください。

プログラムの詳細は [docs/EARLY_ADOPTERS.md](docs/EARLY_ADOPTERS.md) を参照してください。

<a id="security-model"></a>

## セキュリティモデル

プロトコルのセキュリティアーキテクチャ、攻撃ベクトル、防御層の詳しい分析は、[docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) と [docs/NIST_CONFORMITY.md](docs/NIST_CONFORMITY.md) を参照してください。

<a id="protocol-integrity"></a>

## プロトコルの完全性

ローカルの V1 スキーマファイルを、ローカルのフィンガープリントマニフェストと比較します。

```bash
dcp integrity
```

これは V1 スキーマのバイト列を `protocol_fingerprints.json` と比較するものです。V2 スキーマ、実装の動作、適合性は確認せず、ローカルのマニフェストは認証済みの信頼の起点ではありません。詳しくは [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md#protocol-fingerprints) を参照してください。
