<a id="published-go-module"></a>

# 公開済み Go モジュール

> [英語版](GO_RELEASE.md)の参考訳。27/10/2026 更新。相違がある場合は英語版が優先されます。

26/10/2026 確認：Go SDK `v2.11.0` は[タグ `sdks/go/v2.11.0`](https://github.com/dcp-ai-protocol/dcp-ai/tree/sdks/go/v2.11.0/sdks/go)で公開済みです。モジュールとインポートパスは `/v2` を維持します。SDK バージョンは DCP のワイヤー形式・仕様バージョンと独立しています。別のレジストリトークンは不要で、利用側は Go モジュールシステムでリポジトリのタグを解決します。

<a id="install"></a>

## インストール

Go 1.25 以降が必要です。アプリケーションのモジュールで実行し、その `go.mod` と `go.sum` を更新して保存してください。

```bash
go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@v2.11.0
go mod verify
```

<a id="upgrade-and-compatibility"></a>

## 更新と互換性

V1 の不正な鍵長に対するエラー処理、V2 の責任主体・鍵・成果物・チェックポイント検証の修正、責任主体への明示的信頼と `strict-v1`、委任チェーン、リプレイ保護付き並行 A2A セッションを含みます。SDK テレメトリーは `2.11.0` を報告します。[SDK README](../sdks/go/README.md)、[受け入れガイド](ADMISSION.md)、[セキュリティポリシー](../SECURITY.md) を参照してください。

v2.10.0 より検証が厳密で、以前受け入れられた不正形式や不整合の証拠を拒否する場合があります。過去の証拠は書き換えず保存してください。`dcp-jcs-v1` は規範的な既定値で、`dcp-jcs-v2` API は実験的・非規範的かつ明示的なオプトインです。検証は責任主体への信頼、受け入れ、認可とは異なります。任意の副次 SHA3-256 監査チェーンは引き続き検証器の検査対象外です。

<a id="validation"></a>

## 検証

既定スイートと `-race -tags otlp` スイートは各 1,154 件のテスト・サブテストに合格しました。1 件は独立した producer/consumer 相互運用テスト用に意図的に留保されています。`go mod tidy -diff`、ビルド、vet に合格しました。外部利用側の 137 件が合格し、負の対照は期待どおり失敗しました。公開モジュールを公開 proxy と checksum 検証で新しいキャッシュに取得し、ソースがレビュー済みコミットと一致しました。その後ローカル `replace` 指定なしで外部利用側が合格しました。Rust の個別公開は [Rust 2.11.0](RUST_RELEASE.md) を参照してください。

<a id="related-releases"></a>

## 関連するリリース

各レジストリの現在のバージョンは[公開済みバージョン](README.md#published-versions)にあります。その他のリリースノート：[npm パッケージ](NPM_RELEASES.md)、[Python 2.10.0](PYTHON_RELEASE.md)、[Rust 2.11.0](RUST_RELEASE.md)。
