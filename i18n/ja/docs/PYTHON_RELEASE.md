<a id="published-python-package"></a>

# 公開済み Python パッケージ

> [英語版](../../../docs/PYTHON_RELEASE.md)の参考訳。09/11/2026 更新。相違がある場合は英語版が優先されます。

09/11/2026 に確認：[`dcp-ai` 2.11.0](https://pypi.org/project/dcp-ai/2.11.0/) が PyPI で利用できます（[変更点](#what-changed-in-2110)）。この Python パッケージのバージョンは、DCP のワイヤー／仕様のバージョンとは独立しています。Python パッケージは Go、Rust、npm パッケージ、コンテナとは別に公開されます。以前のリリースである [2.10.2](https://pypi.org/project/dcp-ai/2.10.2/)（05/11/2026 に確認）、[2.10.1](https://pypi.org/project/dcp-ai/2.10.1/)（28/10/2026 に確認）、[2.10.0](https://pypi.org/project/dcp-ai/2.10.0/)（26/10/2026 に確認）の注記は下に残しています。

<a id="install"></a>

## インストール

Python 3.10 以降が必要です。環境またはロックファイルを更新してください。任意の統合 extras はプロトコルのコアから分離されています。

```bash
pip install --upgrade "dcp-ai>=2.11.0,<3"
pip install "dcp-ai[fastapi]>=2.11.0,<3"
pip install "dcp-ai[langchain]>=2.11.0,<3"
pip install "dcp-ai[openai]>=2.11.0,<3"
pip install "dcp-ai[crewai]>=2.11.0,<3"
pip install "dcp-ai[otlp]>=2.11.0,<3"
```

<a id="what-changed-in-2101"></a>

## 2.10.1 の変更点

[VERIFICATION.md の V2-11](../../../spec/VERIFICATION.md#step-v2-11-verify-dual-hash-audit-chain-if-present) の二次の SHA3-256 フィールドが存在する場合、それらを検証します：`audit_merkle_root_secondary`（一次と同じ方法で作る SHA3-256 の木。空の記録では `sha3-256:` に 64 個のゼロを続けた値）、各 `prev_hash_secondary`（最初のエントリーでは `"GENESIS"`、以降はバンドルに含まれているとおりの直前のエントリーの SHA3-256）、各 `intent_hash_secondary`（インテントのペイロードの SHA3-256）。存在しないフィールドは要求されないため、検証済みのバンドルが完全な二次チェーンを持たないこともあります。存在するフィールドが `null`、文字列でない、または不整合の場合は拒否されます。これは、これらのフィールドを持つ証拠について、2.10.0 が受け入れていたものに対する受け入れの変更です。API、結果のフィールド、`dcp-jcs-v1`、実験的でオプトインの `dcp-jcs-v2` API、`hash_alg` の扱いは変わりません。検証は引き続き、プリンシパルへの信頼、受け入れ、認可ではありません。

<a id="what-changed"></a>

## 変更点

2.10.1 も引き継ぐ、2.10.0（2026 年 10 月 26 日）の変更点：

V2 検証器の修正、プリンシパルの信頼と `strict-v1`、オプトインのソース期限・容量、FastAPI の本文予算と切断処理、ブリッジ検証の修正、実験的な正規化 API を含みます。また Python 3.10 の失効リスト worker 待機におけるキャンセル競合を修正します。リクエストをキャンセルしても worker が終了する前に枠を解放してはいけません。

2.9.0 の FastAPI は署名を検証せず構造が正しい V2 バンドルを受け入れます。V2 検証に使う前に 2.10.0 に更新してください。[SECURITY](../../../SECURITY.md)、[受け入れ判定](../../../docs/ADMISSION.md)、[Python SDK README](../../../sdks/python/README.md) を参照してください。

<a id="compatibility-and-verification"></a>

## 互換性と検証

2.10.2 では、リリースワークフローが `main`（`46b142bd`）から PyPI に公開した wheel とソース配布物は、公開前にテストした成果物とバイト単位で同じファイルを含みます。チェックアウトの外で PyPI から新しくインストールした wheel とソース配布物は、それぞれ外部適合性キット（7 カタログ、697 ケース）と、失効 ID の集合と検証時刻に関する 2.10.2 の確認に合格しました。ソース配布物からインストールしたパッケージのファイルは、テスト済みの wheel のファイルとバイト単位で同じです。

`dcp-jcs-v1` が唯一の規範的な既定値です。`dcp-jcs-v2` は引き続き実験的・非規範的で、明示的なオプトインが必要です。検証、信頼、受け入れ、認可は別であり、インストールだけで信頼ポリシーは設定されません。厳密化により 2.9.0 が受け入れた証拠を拒否する場合があります。過去の証拠は書き換えず保存してください。

2.10.1 では、リリースのワークフローが PyPI に公開した wheel とソース配布は、公開前にレビューした成果物とバイト単位で同一で、レジストリの checksum も確認されました。公開前、これらの成果物はチェックアウト外の新しい環境にインストールされ、共有の二次 SHA3-256 ベクター（各 103 件）と独立した利用側スイート（各 86 件）に合格しました。

公開後、PyPI から wheel とソース配布をそれぞれ新しい環境にインストールし、両方で独立した 86 件の確認に合格しました。レジストリの wheel は共有ベクターの 103 件にも合格しました。

2.10.0（2026 年 10 月 26 日）では、インストール済み wheel は Python 3.12 で 1,866 件、ソース配布は Python 3.10 で 1,863 件のテストに合格しました。後者の 3 件のスキップは Python 3.12 専用タスクファクトリーです。両配布はメタデータ検査に合格し、59 個すべての Python ソースモジュールが一致しました。CI は Python 3.10 と 3.12 を対象にします。

ML-DSA 依存関係は、回数制限のある署名試行を使い切ると `ValueError` を返す場合があります。CI fixture が署名生成時にこのエラーに遭遇しましたが、検証を迂回したわけではありません。呼び出し側は失敗をエラーとして扱い、署名済み証拠として扱ってはいけません。

<a id="what-changed-in-2102"></a>

## 2.10.2 の変更点

2.10.2 は 05/11/2026 にリリースワークフローによって `main`（`46b142bd`）から PyPI に公開されました。2.10.1 と比べて、2.10.2 は次のとおりです：

- **V2-2 のスキーマ検証を実行します（受け入れの変更）。** `verify_signed_bundle_v2` とその他の V2 検証関数は、したがって FastAPI ミドルウェアとブリッジも、ハッシュ、鍵、署名を確認する前に、署名済みバンドルのエンベロープと 4 つのペイロードを `schemas/v2` に照らして検証します。以前は受け入れられていたスキーマ上無効なバンドルは、`schema: <pointer> <keyword>` 診断で失敗するようになりました。
- **委任状の確認を揃えます。** `verify_mandate_validity` は一つの契約を適用し、例外を送出せずに結果を返します。`now=` はタイムゾーン付きの `datetime` でなければなりません。`set[str]` と注釈された失効 ID は、`collections.abc.Set`（`set`、`frozenset`、または dict のキービュー）として確認されるようになりました。以前は許容されていたリストや文字列は拒否されます。`verify_mandate_chain` はすべての時刻を同じ方法で読み取り、ドメインを繰り返すルート委任状を拒否します。

ワイヤーフォーマット、署名、プロファイル、規範的なデフォルトとしての `dcp-jcs-v1`、実験的なオプトイン `dcp-jcs-v2` API は変わらず、wheel と sdist に Apache-2.0 の `LICENSE` が含まれるようになりました。過去の証拠は書き換えずに保持してください。公開済みの wheel と sdist に含まれる README は公開前に準備したもので、「prepared, not published」と記載しています。公開済みのファイルは変更できません。[SDK README](../../../sdks/python/README.md)と[変更履歴](../../../CHANGELOG.md#unreleased)を参照してください。

<a id="what-changed-in-2110"></a>

## 2.11.0 の変更点

2.11.0 は 09/11/2026 に、リリースワークフローにより `main`（`cdb7099b`）から PyPI に公開されました。wheel とソース配布物は、公開前にテストした成果物と同じソースファイルを含み、異なるのはメタデータだけです（Metadata-Version 2.5 と hatchling 1.33.0。以前は 2.4 と 1.27.0 で、RECORD は再計算されています）。チェックアウトの外で PyPI から wheel とソース配布物を新たにインストールすると、テスト済みのパッケージファイルがインストールされ、テスト済みの成果物と同じ API の結果が得られました。2.10.2 との比較：

- **追加（オプトイン）。** `admit_delegated_bundle_v2`、`admit_signed_bundle_v2_from_bytes`、`create_mandate_acknowledgment`、`evaluate_delegation_activation_v2`（[変更履歴](../../../CHANGELOG.md#unreleased)）。
- **受理の変更。** V1 オブジェクトの検証とデフォルトの V2 Ed25519 プロバイダーにおける P-ED-1。公式の PyNaCl ビルドはすでにこれらの署名を拒否していました。
- ワイヤーフォーマット、署名、プロファイル、`dcp-jcs-v1` は変わりません。

<a id="related-releases"></a>

## 関連するリリース

各レジストリの現在のバージョンは[公開済みバージョン](../../../docs/README.md#published-versions)にあります。その他のリリースノート：[npm パッケージ](../../../docs/NPM_RELEASES.md)、[Go v2.14.0](../../../docs/GO_RELEASE.md)、[Rust 2.14.0](../../../docs/RUST_RELEASE.md)。
