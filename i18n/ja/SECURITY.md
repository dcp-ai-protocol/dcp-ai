<sub>[English](../../SECURITY.md) · [中文](../zh-CN/SECURITY.md) · [Español](../es/SECURITY.md) · **日本語** · [Português](../pt-BR/SECURITY.md)</sub>

<a id="security-policy"></a>

# セキュリティポリシー

> [英語版](../../SECURITY.md)の参考訳です（09/11/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

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
- 不釣り合いなリソース消費やアルゴリズム上の枯渇：検証器、SDK、参照サービスに、入力の大きさに見合わない CPU、メモリ、時間を使わせる入力。上限のあるローカルでの再現で示すもの

<a id="out-of-scope"></a>

### 対象外

- 管轄当局の証明がない自己申告のアイデンティティ（設計上のものです。[docs/SECURITY_MODEL.md](../../docs/SECURITY_MODEL.md) を参照）
- 改変した検証コードを実行するオペレーター（各オペレーターが自身のデプロイに責任を負います）
- 稼働中のインフラへの負荷や大量送信、その他のデプロイ済みサービスを妨げるテスト：許可していません
- 鍵を保管する人に対するソーシャルエンジニアリング攻撃

<a id="supported-versions"></a>

## サポート対象のバージョン

公開済みのすべてのバージョンと `main` について報告を受け付けます。報告を受け付けることは、そのバージョンが修正を含む、または今後受け取ることを意味しません。修正は `main` で行われ、後のリリースでのみ利用者に届きます。バックポート、保守リリース、長期サポートは約束していません。パッケージは 1 つのバージョン番号を共有しておらず、npm の `@dcp-ai/*` パッケージは独自のバージョン系列に従います。

| バージョン | 状態 |
|---------|--------|
| 最新の公開版（09/11/2026）：`@dcp-ai/sdk` 2.4.0、`@dcp-ai/wasm` 2.2.0、`@dcp-ai/cli` 2.2.0、`dcp-ai` 2.11.0（PyPI）、Go `v2.14.0`、Rust `dcp-ai` 2.14.0 | 現行。26/10/2026 の検証器の修正、28/10/2026 の副 SHA3-256 の検査、[監査資料](../../docs/conformance/AUDIT_DOSSIER.md#artifacts)に挙げた修正、Ed25519 の受け入れの変更 P-ED-1（下の注記を参照）を含みます |
| SDK に依存するアダプター（`@dcp-ai/express`、`@dcp-ai/openclaw`、`@dcp-ai/anthropic-mcp`、`@dcp-ai/google-a2a` 2.1.0） | 現行、再公開なし。インストールが `@dcp-ai/sdk` 2.4.0 を解決したときにだけ 09/11/2026 の検査を得ます。以前の SDK を保つ lockfile は、更新するまで得ません |
| 以前のリリース（05/11/2026 時点の現行）：`@dcp-ai/sdk` 2.3.0、`@dcp-ai/wasm` 2.1.3、`dcp-ai` 2.10.2（PyPI）、Go `v2.13.0`、Rust `dcp-ai` 2.13.0（05/11/2026 公開）と `@dcp-ai/cli` 2.1.1（28/10/2026 公開） | 置き換え済み：P-ED-1 を適用しないため、TypeScript、Go、Rust、WASM、CLI での検証は、最新のバージョンが拒否する Ed25519 署名を受け入れます（Python SDK が使う公式の PyNaCl ビルドはすでに拒否していました）。更新してください |
| 28/10/2026 の公開版：`@dcp-ai/sdk` 2.2.1、`@dcp-ai/wasm` 2.1.1、`dcp-ai` 2.10.1（PyPI）、Go `v2.11.1`、Rust `dcp-ai` 2.11.1 | 置き換え済み。V2-2 のスキーマ検証を実行しないため、最新バージョンが拒否するスキーマ上無効なバンドルを受け入れます。更新してください |
| 26/10/2026 の検証器の修正を含む最小の公開版：`@dcp-ai/sdk` 2.2.0、`@dcp-ai/wasm` と `@dcp-ai/cli` 2.1.0、`dcp-ai` 2.10.0（PyPI）、Go `v2.11.0`、Rust `dcp-ai` 2.11.0 | 置き換え済み。最新版が確認する二次 SHA3-256 のフィールドを確認しません。更新してください |
| `@dcp-ai/sdk` 2.1.x | 影響あり：`verifySignedBundleV2` を回避できます。2.2.0 で修正済み（次の注記を参照） |
| `@dcp-ai/express` と `@dcp-ai/openclaw` 2.0.0 | 影響あり：構造が正しい V2 bundle を署名を検証せずに受け入れます。V2 bundle の検証には使わないでください。2.1.0 で修正済み |
| `dcp-ai` 2.9.0（PyPI）の FastAPI 連携 | V2 について影響あり。2.10.0 で修正済み |
| それ以前のその他の公開版 | これらの修正に照らした評価はしておらず、カバレッジは主張しません。報告は受け付けます |
| その他の npm アダプターとプロジェクト生成ツール：`@dcp-ai/anthropic-mcp` と `@dcp-ai/google-a2a` 2.1.0、`@dcp-ai/autogen`、`@dcp-ai/w3c-did`、`create-*` 生成ツール 2.0.1 | 任意で、プロトコルのコアの外にあります。限界は各 README と [npm の一覧](../../docs/NPM_RELEASES.md)にあります |
| 1.0.x | 以前の系列：報告は受け付けますが、保守リリースの予定も約束もありません |
| < 1.0 | サポート対象外 |

`@dcp-ai/sdk` 2.2.0 は、検証器の修正を含めて 2026 年 10 月 26 日に `latest` として npm に公開されました。問題のある旧バージョンに修正が自動適用されるわけではありません。

**Ed25519 P-ED-1（09/11/2026）。** `@dcp-ai/sdk` 2.4.0、`@dcp-ai/wasm` 2.2.0、`@dcp-ai/cli` 2.2.0、`dcp-ai` 2.11.0（PyPI）、Go v2.14.0、Rust `dcp-ai` 2.14.0 は、公開鍵や R が正準なエンコーディングでない、または位数が 8 を割り切る点である Ed25519 署名を、S ≥ L の署名とともに拒否します。これは受け入れる署名を変える変更です。失敗する証拠はそのまま保管し、鍵が P-ED-1 を満たす場合は同じ鍵で署名し直し、正準でない公開鍵はローテーションし、小さい位数の鍵は置き換えてください。`npm install @dcp-ai/sdk@^2.4.0` またはお使いのエコシステムの同等の手順で更新し、lockfile を更新してください。アダプター 2.1.0 は、lockfile が `@dcp-ai/sdk` 2.4.0 を解決すると P-ED-1 を得ます。Rust 2.14.0 の `otlp` feature は `anyhow` 1.0.103 以上と `tokio` 1.53.3 以上を必要とします（RUSTSEC-2026-0190、RUSTSEC-2026-0386）。デフォルトと `wasm` のビルドはどちらも選ばず、`otlp` を有効にした lock は `cargo update -p anyhow -p tokio` を実行するまでそのバージョンを保ちます。

**二次 SHA3-256 フィールド（2026 年 10 月 28 日）。** `@dcp-ai/sdk` 2.2.1、`@dcp-ai/wasm` 2.1.1、`dcp-ai` 2.10.1（PyPI）、Go v2.11.1、Rust `dcp-ai` 2.11.1 は、[V2-11](../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) の任意の二次 SHA3-256 フィールドが存在する場合にそれらを検証します。2.2.0、2.1.0、2.10.0、2.11.0 を含む以前のバージョンは検証しません。`npm install @dcp-ai/sdk@^2.2.1` または各環境の同等の方法で更新し、lockfile も更新してください。公開済みのアダプター `@dcp-ai/express`、`@dcp-ai/openclaw`、`@dcp-ai/anthropic-mcp`、`@dcp-ai/google-a2a` 2.1.0 は再公開していません。これらは `@dcp-ai/sdk` `^2.2.0` に依存しており、ロックファイルが `@dcp-ai/sdk` 2.2.1 以降を解決すると二次の確認が行われます。[公開済み npm パッケージの一覧](../../docs/NPM_RELEASES.md)と[公開済みバージョン](../../docs/README.md#published-versions)を参照してください。

**問題のある統合と修正済みリリース（2026 年 10 月 26 日）。** `@dcp-ai/express` 2.0.0 と `@dcp-ai/openclaw` 2.0.0 は、署名を検証せず構造が正しい V2 バンドルを受け入れます。両方とも `@dcp-ai/sdk` `^2.2.0` を使う npm バージョン 2.1.0 で修正済みです。V2 バンドルの検証に 2.0.0 を使わないでください。`dcp-ai` 2.9.0 の FastAPI 統合には問題が残りますが、修正版は PyPI の 2.10.0 で公開済みです。[Python 更新ノート](../../docs/PYTHON_RELEASE.md)を参照してください。[Express](../../integrations/express/README.md)、[OpenClaw](../../integrations/openclaw/README.md)、[FastAPI](../../integrations/fastapi/README.md) を参照してください。パッケージのサポートは、すべての旧ビルドに修正が含まれることを意味しません。

<a id="disclosure-policy"></a>

## 開示ポリシー

- 協調的な開示に従います。修正は非公開で開発し、一般への開示の前にリリースします。
- 報告者はアドバイザリーにクレジットされます（匿名を希望する場合を除く）。
- このポリシーに従う研究者に対して法的措置はとりません。

<a id="rewards"></a>

## 報酬

固定の報酬額を定めたバグバウンティはなく、どの報酬も保証されていません。メンテナーは報告ごとにケースバイケースで報酬を提示することがありますが、報酬を約束するのはメンテナーとの明示的な合意だけです。勧告でのクレジットは「開示ポリシー」に記載しています。

> **注記（05/11/2026）。** この日まで、このセクションは深刻度ごとの固定の報酬範囲を挙げていましたが、[GOVERNANCE.md](../../GOVERNANCE.md) と [docs/EARLY_ADOPTERS.md](../../docs/EARLY_ADOPTERS.md) がケースバイケースの報酬を記載していたため、未確認であることを明示していました。このページは現在、これら 2 つの文書と同じくケースバイケースの報酬を記載しています。

セキュリティの開示がアーリーアダプター・プログラムとどう関わるかは [docs/EARLY_ADOPTERS.md](../../docs/EARLY_ADOPTERS.md#security-disclosure) を参照してください。

<a id="security-model"></a>

## セキュリティモデル

プロトコルのセキュリティアーキテクチャ、攻撃ベクトル、防御層の詳しい分析は、[docs/SECURITY_MODEL.md](../../docs/SECURITY_MODEL.md) と [docs/NIST_CONFORMITY.md](../../docs/NIST_CONFORMITY.md) を参照してください。独立したレビューは[監査資料](../../docs/conformance/AUDIT_DOSSIER.md)から始めてください。基準、再現のコマンド、成果物、既知の限界を示しています。

<a id="protocol-integrity"></a>

## プロトコルの完全性

ローカルの V1 スキーマファイルを、ローカルのフィンガープリントマニフェストと比較します。

```bash
dcp integrity
```

これは V1 スキーマのバイト列を `protocol_fingerprints.json` と比較するものです。V2 スキーマ、実装の動作、適合性は確認せず、ローカルのマニフェストは認証済みの信頼の起点ではありません。詳しくは [docs/SECURITY_MODEL.md](../../docs/SECURITY_MODEL.md#protocol-fingerprints) を参照してください。
