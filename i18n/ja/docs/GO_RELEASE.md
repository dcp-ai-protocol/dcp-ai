<a id="published-go-module"></a>

# 公開済み Go モジュール

> [英語版](../../../docs/GO_RELEASE.md)の参考訳。28/10/2026 更新。相違がある場合は英語版が優先されます。

28/10/2026 確認：Go SDK `v2.11.1` は[タグ `sdks/go/v2.11.1`](https://github.com/dcp-ai-protocol/dcp-ai/tree/sdks/go/v2.11.1/sdks/go)で公開済みで、公開モジュール proxy と checksum データベースから提供されています。前のリリース `v2.11.0`（[`sdks/go/v2.11.0`](https://github.com/dcp-ai-protocol/dcp-ai/tree/sdks/go/v2.11.0/sdks/go)）は 26/10/2026 に確認されており、その記述は以下に残しています。モジュールとインポートパスは `/v2` を維持します。SDK バージョンは DCP のワイヤー形式・仕様バージョンと独立しています。別のレジストリトークンは不要で、利用側は Go モジュールシステムでリポジトリのタグを解決します。

<a id="install"></a>

## インストール

Go 1.25 以降が必要です。アプリケーションのモジュールで実行し、その `go.mod` と `go.sum` を更新して保存してください。

```bash
go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@v2.11.1
go mod verify
```

<a id="what-changed-in-v2111"></a>

## v2.11.1 の変更点

[VERIFICATION.md の V2-11](../../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) の二次の SHA3-256 フィールドが存在する場合、それらを検証します：`audit_merkle_root_secondary`（一次と同じ方法で作る SHA3-256 の木。空の記録では `sha3-256:` に 64 個のゼロを続けた値）、各 `prev_hash_secondary`（最初のエントリーでは `"GENESIS"`、以降はバンドルに含まれているとおりの直前のエントリーの SHA3-256）、各 `intent_hash_secondary`（インテントのペイロードの SHA3-256）。存在しないフィールドは要求されないため、検証済みのバンドルが完全な二次チェーンを持たないこともあります。存在するフィールドが `null`、文字列でない、または不整合の場合は拒否されます。これは、これらのフィールドを持つ証拠について、v2.11.0 が受け入れていたものに対する受け入れの変更です。API、結果のフィールド、`dcp-jcs-v1`、実験的でオプトインの `dcp-jcs-v2` API、`hash_alg` の扱いは変わりません。検証は引き続き、プリンシパルへの信頼、受け入れ、認可ではありません。 SDK のテレメトリーは `2.11.1` を報告します。

<a id="upgrade-and-compatibility"></a>

## 更新と互換性

v2.11.0（2026 年 10 月 26 日）に含まれ、v2.11.1 も引き継ぐもの：V1 の不正な鍵長に対するエラー処理、V2 の責任主体・鍵・成果物・チェックポイント検証の修正、責任主体への明示的信頼と `strict-v1`、委任チェーン、リプレイ保護付き並行 A2A セッションを含みます。v2.11.0 では SDK テレメトリーは `2.11.0` を報告していました。[SDK README](../../../sdks/go/README.md)、[受け入れガイド](../../../docs/ADMISSION.md)、[セキュリティポリシー](../../../SECURITY.md) を参照してください。

v2.10.0 より検証が厳密で、以前受け入れられた不正形式や不整合の証拠を拒否する場合があります。過去の証拠は書き換えず保存してください。`dcp-jcs-v1` は規範的な既定値で、`dcp-jcs-v2` API は実験的・非規範的かつ明示的なオプトインです。検証は責任主体への信頼、受け入れ、認可とは異なります。v2.11.0 では任意の副次 SHA3-256 フィールドは検証器の検査対象外でした。v2.11.1 は存在する場合にそれらを確認します。

<a id="validation"></a>

## 検証

v2.11.1 では、proxy が提供するモジュール zip の 84 ファイルが `main` と同一で（Go は zip にリポジトリのルートの `LICENSE` を追加します）、proxy と checksum データベースがこのバージョンを確認しました。ローカルの `replace` なしで proxy から `v2.11.1` を解決する外部利用側は 189 件のテストに合格しました。

v2.11.0（2026 年 10 月 26 日）では、既定スイートと `-race -tags otlp` スイートは各 1,154 件のテスト・サブテストに合格しました。1 件は独立した producer/consumer 相互運用テスト用に意図的に留保されています。`go mod tidy -diff`、ビルド、vet に合格しました。外部利用側の 137 件が合格し、負の対照は期待どおり失敗しました。公開モジュールを公開 proxy と checksum 検証で新しいキャッシュに取得し、ソースがレビュー済みコミットと一致しました。その後ローカル `replace` 指定なしで外部利用側が合格しました。Rust の個別公開は [Rust](../../../docs/RUST_RELEASE.md) を参照してください。

<a id="related-releases"></a>

## 関連するリリース

各レジストリの現在のバージョンは[公開済みバージョン](../../../docs/README.md#published-versions)にあります。その他のリリースノート：[npm パッケージ](../../../docs/NPM_RELEASES.md)、[Python 2.10.1](../../../docs/PYTHON_RELEASE.md)、[Rust 2.11.1](../../../docs/RUST_RELEASE.md)。
