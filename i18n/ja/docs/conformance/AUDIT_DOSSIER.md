<sub>[English](../../../../docs/conformance/AUDIT_DOSSIER.md) · [中文](../../../zh-CN/docs/conformance/AUDIT_DOSSIER.md) · [Español](../../../es/docs/conformance/AUDIT_DOSSIER.md) · **日本語** · [Português](../../../pt-BR/docs/conformance/AUDIT_DOSSIER.md)</sub>

<a id="audit-dossier"></a>

# 監査資料

> [英語版](../../../../docs/conformance/AUDIT_DOSSIER.md)の参考訳です（05/11/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

DCP-AI の独立したセキュリティレビューのための入口です。何をレビューするか、リポジトリの証拠をどう再現するか、その証拠が何を示し何を対象外とするかを示します。これは仕様でも認証でも監査報告書でもありません。リポジトリには独立した外部監査の報告書は含まれておらず、リポジトリ外で行われた作業を認証するものでもありません。

- 規範となる文書は [spec/](../../../../spec/README.md) にあります。
- [セキュリティカバレッジマップ](SECURITY_COVERAGE.md)は、各要件をそのテストに対応付けます。
- [実装者ガイド](IMPLEMENTER_GUIDE.md)は、結果の報告方法を説明します。

<a id="review-baseline"></a>

## レビューの基準

- **ソースの基準：** `main` のコミット `45ac32f07f004e858e11dcc23ff72c3e5c7762b8`（05/11/2026、#123）。[成果物](#artifacts)に挙げたすべての修正と、同日の [VERIFICATION.md](../../../../spec/VERIFICATION.md) 手順 V2-10 および [DCP-09](../../../../spec/DCP-09.md) §3.5.2 の明確化を含みます。
- **後のコミット：** 委任状チェーンの差分ハーネスと 5 SDK の bundle 比較（#124）は基準の後に追加され、この資料も同様です。文書は自分自身の最終コミットを示せません。レビューする正確なコミットを記録し、この資料はそのコミットへの案内として使い、それについての証拠としては使わないでください。
- **基準の対象外：** コンテナイメージ、デプロイ、運用者の設定。

<a id="reproduce"></a>

## 再現

レビュー対象のコミットのチェックアウトから、Node 22、Python 3.10+、Go（`sdks/go/go.mod` のバージョン）、安定版の Rust ツールチェーン（WASM には `wasm32-unknown-unknown` と wasm-pack）を使います。インストールは、コミット済みのロックファイルがある場合はそれを使います。Python SDK にはロックファイルがなく、`pip install -e ".[dev]"` はインストール時に利用できるバージョンを解決します。

基準のコミットで：

```bash
(cd sdks/typescript && npm ci && npm run build && npm test) && npm ci --ignore-scripts
npm run conformance
(cd sdks/python && pip install -e ".[dev]" && pytest)
(cd sdks/go && go test ./...)
(cd sdks/rust && cargo test --locked)
(cd sdks/wasm && npm ci && npm run build && npm test)
node tools/conformance/wrappers/build.mjs all
node tools/conformance-external.js --catalog evidence --assessment verdict --report /tmp/evidence-ts.json -- node tools/conformance/wrappers/ts-sdk.mjs --sdk sdks/typescript/dist/index.js
node tools/conformance-external.js --catalog delegation --report /tmp/delegation-ts.json -- node tools/conformance/wrappers/ts-sdk.mjs --sdk sdks/typescript/dist/index.js
```

コミット #124 以降のみ（これらのコマンドは基準には存在しません）：

```bash
node tools/difffuzz/run.mjs --sdks five --iterations 60 --report /tmp/difffuzz-five.json
node tools/difffuzz/run-mandates.mjs --iterations 120 --report /tmp/mandates.json
```

- **合格が示すこと。** 実行は、実行した argv でこれらのケースが合格することを示すだけです。
- **WASM。** `sdks/wasm` の `npm test` は TypeScript 層だけをコンパイルし、`npm run build` が生成する `pkg/dcp_ai_bg.wasm` を必要とします。
- **その他のコマンド。** [適合性キット](../../../../tools/conformance/README.md)にはすべてのカタログとラッパーが、[差分ハーネス](../../../../tools/difffuzz/README.md)にはその上限が記載されています。
- **参照実行。** CI は `.github/workflows/ci.yml` と `difffuzz.yml` で同じスイートを実行します。

<a id="record-what-you-ran"></a>

## 実行内容の記録

- **ソース。** 正確なコミット（`git rev-parse HEAD`）と、作業ツリーがそれと異なるかどうか（`git status --porcelain`、異なる場合は `git diff`）。
- **ツールチェーンと成果物。** ツールチェーンのバージョンと、実行した成果物のバージョンとハッシュ。TypeScript の `dist`、ビルドしたバイナリ、WASM パッケージ、解決された Python パッケージ（`python -m pip freeze`）です。キットと差分ハーネスは、その大半をレポートに記録します。
- **レポート。** レポートファイルをハッシュとともに保管してください。
- **由来。** ラッパーがレポートで宣言する `implementation` の名前とバージョンはラッパー自身の申告であり、認証された由来ではありません。証拠となるのは、ビルドして実行したもののハッシュです。

<a id="what-to-review"></a>

## レビューの対象

| 層 | パス | 合格が立証しないこと |
|---|---|---|
| プロトコルのコアとプロファイル | `spec/`、`schemas/`；正規化 `dcp-jcs-v1` | 規範テキスト。`dcp-jcs-v2` は実験的でオプトインであり、既定にはなりません |
| SDK の検証器 | `sdks/typescript`、`sdks/python`、`sdks/go`、`sdks/rust`、`sdks/wasm` | 検証済みの bundle は、プリンシパルへの信頼、受け入れ判定、承認ではありません。それぞれ別の API です（[ADMISSION.md](../../../../docs/ADMISSION.md)） |
| 適合性と差分のツール | `tools/conformance`、`tools/difffuzz`、`tests/` | テスト基盤であり、プロトコルの一部ではありません |
| 参照サービス | `server/`、`services/`（アンカー、透明性ログ、失効） | デプロイ上の選択であり規範ではありません。検証器はそれらなしで動作します |
| アダプターとプロジェクト生成ツール | `integrations/`、`packages/`、Python SDK の FastAPI 連携 | 任意です。一部の公開バージョンは影響を受けます（[SECURITY.md](../../../../SECURITY.md#supported-versions)） |
| 運用者 | 鍵、信頼アンカー、受け入れ判定の設定、サービストークン、デプロイ | リポジトリはこれらについて何も保証しません |

<a id="requirements-to-tests"></a>

## 要件とテスト

| 領域 | 対応付けの場所 |
|---|---|
| V2 の検証、V2-1〜V2-14 | [V2 検証マップ](SECURITY_COVERAGE.md#v2-verification-map)と、その[スキーマの境界](SECURITY_COVERAGE.md#schema-and-cryptographic-api-boundary) |
| 検証者のポリシー（V2-10 の明確化を含む） | [検証者ポリシーのサンプル](SECURITY_COVERAGE.md#verifier-policy-samples) |
| 構造上の規則 | [構造サンプル](SECURITY_COVERAGE.md#structural-samples) |
| 受け入れ判定と `strict-v1` | [受け入れ判定マップ](SECURITY_COVERAGE.md#admission-map) |
| DCP-09 の委任状チェーン | [委任マップ](SECURITY_COVERAGE.md#delegation-map) |
| SDK 間の一致 | [差分サンプル](SECURITY_COVERAGE.md#differential-samples) |
| アルゴリズム | [tests/nist-kat](../../../../tests/nist-kat/README.md)：Ed25519 は RFC 8032 のベクトル、ML-DSA-65 はサイズ、往復、誤った鍵、SDK 間のテスト、ML-KEM-768 と SLH-DSA-192f は取得元ファイルの SHA-256 付きの NIST ACVP ベクトル。合格しても暗号モジュールの NIST 検証にはなりません |

<a id="artifacts"></a>

## 成果物

次の 3 つは別物です。一方を他方として読まないでください。

| 成果物 | バージョン | 含まれるもの |
|---|---|---|
| レビュー対象のソース | 基準時点の `main` | 以下のすべての修正 |
| 準備済み・未公開（05/11/2026） | `@dcp-ai/sdk` 2.3.0、`dcp-ai` 2.10.2（PyPI）、Go v2.13.0、Rust `dcp-ai` 2.13.0、`@dcp-ai/wasm` 2.1.3 | 以下の SDK の変更すべて |
| 30/10/2026 に準備（#114）、公開されずに置き換え | Go v2.12.0、Rust `dcp-ai` 2.12.0、`@dcp-ai/wasm` 2.1.2 | #106（WASM）、#107、#112。#103 と #116〜#119 は含みません |
| 公開済み | `@dcp-ai/sdk` 2.2.1、`@dcp-ai/wasm` 2.1.1、`@dcp-ai/cli` 2.1.1、`dcp-ai` 2.10.1（PyPI）、Go v2.11.1、Rust `dcp-ai` 2.11.1 | 26/10/2026 の検証器の修正と 28/10/2026 の二次 SHA3-256 の確認。以下の修正はどれも含みません |

バージョン番号だけでは成果物を特定できません。`main` のマニフェストには、どのレジストリにもない 05/11/2026 の候補の番号が記載されています。30/10/2026 の候補は、より少ない変更に対して Go と Rust の 2.12.0 と `@dcp-ai/wasm` 2.1.2 を使っており、これらの番号は再利用されません。以下のレジストリの識別子か、ビルドしたもののハッシュを使ってください。公開ではパッケージが再ビルドされるため、公開されるものはレビュー済みの候補と比較するか、改めてテストする必要があります。公開レジストリは 05/11/2026 に通常の TLS で読み取り、何も公開していません。最新バージョンは上記のとおりでした。

| レジストリ | バージョン | 識別子 |
|---|---|---|
| npm `@dcp-ai/sdk` | 2.2.1 | `sha512-HsT/4BMomZ2QVDfxLWhejoZDzSo8OH8cLT6i6fBTAejt078SyTJRKoLVeIgZp0G29I5JIyoeOPfhebfa7+W9Lw==` |
| npm `@dcp-ai/wasm` | 2.1.1 | `sha512-YUFEAMBnT0J0hZvg1MUS1yvXV0HPotijoj32kIhGDoMVaBhqZKTZvE8iV5h90WRv4duRzJav+PtlQ4fl3NcyQQ==` |
| npm `@dcp-ai/cli` | 2.1.1 | `sha512-Qmuq5FiT+TUW3nZ4HCp/DUXdF6JVYB6vaCmNZL/qK8EWiSpP5gzgesSwK0zzlOQL20SJJditRR0h5YIQ7gxIMw==` |
| PyPI `dcp-ai` | 2.10.1 | wheel `30a1e35bc275b20118ec3e786f3c58336fd72bd21849995bc44ac2e702400a9c`, sdist `e254091491867f122deaff6d6ccc6db6f021d721ff30b1182a4944902b8f2fc5` (SHA-256) |
| crates.io `dcp-ai` | 2.11.1 | `dfb8440a50351491fd7aa81cb5585d8d4f7c130986e504210175b62251f1bc73` (checksum) |
| Go module `sdks/go/v2` | v2.11.1 | tag `sdks/go/v2.11.1`, commit `6f9b453fbaaeb53ead225f77390bf683472be5fa` (28/10/2026) |

公開バージョンの後の `main` における SDK の変更：

| 変更 | コミット | SDK | 公開 |
|---|---|---|---|
| `VerificationCache` のキーと分離（#103） | `e711179a` | TypeScript | 未公開、05/11 に準備済み |
| WASM の `dualMerkleRoot` が V2-11 に従う（#106） | `cac0a5f6` | Rust（`wasm` フィーチャー）、WASM | 未公開、30/10 と 05/11 に準備済み |
| `VerifyPayloadHash` が規範どおりの接頭辞付きハッシュを確認（#107） | `24e70d56` | Go | 未公開、30/10 と 05/11 に準備済み |
| `RawAuditEventV2` が受け取った監査エントリーを保持（#112） | `6dc97d59` | Go、Rust | 未公開、30/10 と 05/11 に準備済み |
| すべての V2 検証器内での V2-2 スキーマ検証（#116） | `0ebd2849` | TypeScript、Python、Go、Rust、WASM | 未公開、05/11 に準備済み |
| 委任状の有効性ヘルパーの統一（#117） | `614b1c56` | TypeScript、Python、Go、Rust | 未公開、05/11 に準備済み |
| 委任状チェーンの時刻確認の統一（#118） | `7619ff95` | TypeScript、Python、Go、Rust | 未公開、05/11 に準備済み |
| 単独のルート委任状で繰り返されるドメインの拒否（#119） | `c154192f` | TypeScript、Python、Go、Rust | 未公開、05/11 に準備済み |

公開バージョンの後のその他の変更：

- **参照用の透明性ログ。** #120（`c59ce5ba`）はゴシップの警告を目撃したログの識別に結び付け、#122（`d45c5a7b`）は実行中に追加されたピアをポーリングします。このサービスはパッケージとして配布されていません。
- **仕様と適合性キット。** #121（`0dcbd8dc`）は委任カタログを追加します。#123（`45ac32f0`）は V2-10 と DCP-09 §3.5.2 の明確化、ポリシーカタログ 2.0、委任カタログ 2.0.0 を追加します。SDK の変更はありません。
- **レジストリの利用者。** これらの変更を含むリリースが公開されるまで、どの変更も受け取りません。

<a id="known-limits-and-exclusions"></a>

## 既知の限界と除外

- **監査の記録。** [AUDIT-v2.0-FINAL.md](../../../../spec/AUDIT-v2.0-FINAL.md) は 26/02/2026 付の内部の過去の記録で、現在の文脈注記が付いています。外部監査ではありません。
- **模擬の HSM プロバイダー。** `HsmCryptoProvider` は模擬のパターンであり、実際の証拠に使ってはなりません（[NIST_CONFORMITY.md](../../../../docs/NIST_CONFORMITY.md)）。
- **鍵の回復。** シェアはハイブリッド KEM で暗号化されません。
- **参照サーバー。** 勧告の署名の構造を確認しますが、署名そのものは確認しません（[server/README.md](../../../../server/README.md)）。
- **WASM。** 委任状チェーンの検証を公開していません。
- **Rust。** A2A の AES-256-GCM セッション暗号化とそのリプレイウィンドウがありません（[RUST_RELEASE.md](../../../../docs/RUST_RELEASE.md)）。
- **公開バージョン。** [成果物](#artifacts)に挙げた変更を含みません。
- **差分とファジングのキャンペーン。** 有限であり、網羅的ではありません。契約 `/4` がすべての SDK に運べない入力は別に測定します（[差分ハーネス](../../../../tools/difffuzz/README.md#mandate-chains)）。
- **性能。** 速度の要件は確認していません。[性能の基準値](../../../../tools/conformance/README.md#performance-baseline)と[上限のあるワークロードの規模変化](../../../../tools/conformance/README.md#bounded-workload-scaling)は、基準のコミットの後に追加した、方法についてのローカルでの測定です。どちらも監査の結果ではありません。
- **対象外。** コンテナイメージ、デプロイ、サービストークン、運用者の設定。

<a id="reporting"></a>

## 報告

セキュリティ上の問題は [SECURITY.md](../../../../SECURITY.md) の説明に従って報告してください。連絡先、対象範囲（上限のあるローカルでのリソース枯渇の再現を含む）、報酬の方針を示しています。報酬はケースごとに判断され、保証された金額や固定の金額はありません。
