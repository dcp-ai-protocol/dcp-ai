<sub>[English](CHANGELOG.md) · [中文](CHANGELOG.zh-CN.md) · [Español](CHANGELOG.es.md) · **日本語** · [Português](CHANGELOG.pt-BR.md)</sub>

<a id="changelog"></a>

# 変更履歴

> [英語版](CHANGELOG.md)の参考訳です（28/10/2026 更新）。各エントリーは、`[Unreleased]` のものも含め、その時点での変更を記述したもので、現在の動作を保証するものではありません。公開済みの各バージョンは**日付のある過去の記録**です。内容が異なる場合は英語版が優先されます。

**公開済みバージョン（2026 年 10 月 26 日）。** npm（`@dcp-ai/sdk` 2.2.0 を含む 13 パッケージ）、Python `dcp-ai` 2.10.0、Go `v2.11.0`、Rust `dcp-ai` 2.11.0 が、検証器の修正、受け入れ判定、実験的なオプトイン API を含めて公開済みです。`dcp-jcs-v1` は引き続き規範的なデフォルトです。[公開済みバージョン](docs/README.md#published-versions)を参照してください。以下の項目は開発履歴として保持しています。`[Unreleased]` はこれらの機能が未公開であることを意味しません。2026 年 10 月 28 日の 6 つの修正リリースは[専用のセクション](#2026-10-28-sha3-patch-releases)にあります。

このプロジェクトの重要な変更はすべてこのファイルに記録します。

形式は [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) に基づいています。

> **参考の注記（2026 年 10 月 25 日）。** 各エントリーは、`[Unreleased]` の後続のエントリーも含め、変更をそれが行われた
> 時点のとおりに記述しています。そこでは、後のエントリーが前のエントリーを補足したり置き換えたりすることが
> あります。エントリーは現在の動作も、パッケージのバージョンがレジストリで入手できることも保証しません。現在の動作に
> ついては、[README](README.md)、[ドキュメント](docs/README.md)、[仕様](spec/README.md)、
> [API リファレンス](docs/API_REFERENCE.md)を参照してください。

<a id="2026-10-28-sha3-patch-releases"></a>

## [2026-10-28] SHA3 の修正リリース

2026 年 10 月 28 日に公開：npm の `@dcp-ai/sdk` 2.2.1、`@dcp-ai/wasm` 2.1.1、`@dcp-ai/cli` 2.1.1、PyPI の `dcp-ai` 2.10.1、Go モジュール `v2.11.1`（タグ `sdks/go/v2.11.1`）、crates.io の Rust `dcp-ai` 2.11.1。その他の 10 の npm パッケージは変わりません。[公開済みバージョン](docs/README.md#published-versions)と、[npm](docs/NPM_RELEASES.md)、[Python](docs/PYTHON_RELEASE.md)、[Go](docs/GO_RELEASE.md)、[Rust](docs/RUST_RELEASE.md) のリリースノートを参照してください。

<a id="secondary-sha3-256-verification"></a>

### 二次 SHA3-256 の検証

- **受け入れの変更：二次の SHA3-256 フィールドは、存在する場合に検証されます**（2026 年 10 月 27 日に開発）。
  TypeScript、Python、Go、Rust の V2 検証器と、Rust SDK からの WASM ビルドは、`spec/VERIFICATION.md` の V2-11 と
  2026 年 10 月 27 日の正誤のとおり、`audit_merkle_root_secondary`（一次と同じ方法で作る SHA3-256 の木。空の記録では
  `sha3-256:` に 64 個のゼロを続けた値）、各 `prev_hash_secondary`（最初のエントリーでは `"GENESIS"`、以降はバンドルに
  含まれているとおりの直前のエントリーの SHA3-256）、各 `intent_hash_secondary`（インテントのペイロードの SHA3-256）を
  確認するようになりました。存在しないフィールドは要求されないため、検証済みのバンドルが完全な二次チェーンを持たない
  こともあります。存在するフィールドが `null`、文字列でない、または誤っている場合は拒否されます。受け入れと実験的な
  候補の経路もこれらの確認を再利用します。API、結果のフィールド、正規化、`hash_alg` の扱いは変わりません。
  `prev_hash_secondary` のスキーマのパターンは、OpenClaw が最初のエントリーに書く `"GENESIS"` も受け入れます。共有
  ベクター：`tests/interop/v2/secondary_sha3_vectors.json`。以前のバージョンはこれらのフィールドを確認しません。 公開済みのアダプター `@dcp-ai/express`、`@dcp-ai/openclaw`、`@dcp-ai/anthropic-mcp`、`@dcp-ai/google-a2a` 2.1.0 は再公開していません。これらは `@dcp-ai/sdk` `^2.2.0` に依存しており、ロックファイルが `@dcp-ai/sdk` 2.2.1 以降を解決すると二次の確認が行われます。

<a id="package-metadata"></a>

### パッケージのメタデータ

- `@dcp-ai/cli` 2.1.1 は `@dcp-ai/sdk` `^2.2.1` を必要とし、`dcp-ai --version` は古い `1.0.0` ではなく `2.1.1` を表示します。
- テレメトリーは新しいバージョンを報告します：Go の `SDKVersion` は `2.11.1`。TypeScript、Python、Rust の SDK は自身のパッケージのバージョンを読み取ります。

## [Unreleased]

<a id="security"></a>

### セキュリティ

- **TypeScript の `VerificationCache`（`main` のソースコード、未公開。
  `@dcp-ai/sdk` 2.2.1 は以前の動作のまま）。**
  既存の呼び出しではキャッシュのキーは引き続きバンドルのハッシュで、呼び出し側が選ぶオプトインの `context` は、レガシーのハッシュと衝突しないタグ付きの内部キーで結果を分けます。
  何も削除しなかった `invalidateByAgent` は、新しい `agentIds` オプションでそのエージェントを付けて保存したエントリと、それなしで保存したすべてのエントリを削除するようになりました。
  エントリを置き換えても、古い kid が索引に残ること（既定の上限では索引が際限なく増えていました）や、別のエントリを追い出すことはなくなりました。
  `result.details.signer_keys` の kid も索引付けされます。
  ハッシュ `''` が `maxEntries` を無効にすることもなくなりました。
  **受け入れの変更：** 不正なオプション（`NaN`、`Infinity`、負または数値でない TTL、`Number.MAX_SAFE_INTEGER` を超える TTL、1 から `Number.MAX_SAFE_INTEGER` までの安全な整数でない `maxEntries`）は、期限や上限を無効にする代わりにエラーを投げます。
  `set` は結果をコピーし、`get` はヒットのたびに新しいコピーを返します。
  エントリは TTL ちょうどで期限切れになり、壁時計に加えて単調時計でも測るため、時計の巻き戻しで延びることはなくなりました。
  TTL が 0 のエントリは保存されません。
  `set` は引数を検証し（`signerKids` や `agentIds` の穴は `undefined` として扱います）、エラーを投げたときは何も変えません。
  ヒットは引き続き証拠や信頼を再検証せず、アドミッションではありません。自動的に無効化されるものもありません。
  [API_REFERENCE.md](docs/API_REFERENCE.md#verificationcache) を参照してください。
- **受け入れの変更: S >= L の Ed25519 署名を拒否するようになりました。** 対象は TypeScript SDK
  （`Ed25519Provider.verify`、したがってすべての V2 署名と複合署名、`@dcp-ai/express` と
  `@dcp-ai/openclaw`。さらに `verifyObject`、したがって `verifySignedBundle` V1）と、リファレンスの検証者
  （`tools/crypto.js`、したがって `lib/verify.js` V1、`bin/dcp.js`、適合性テスト、透明性ログの
  ゴシップ）です。RFC 8032 §5.1.7 は 0 <= S < L を求めていますが、TweetNaCl はこれを確認しないため、
  有効な署名の別のエンコーディングである S + k·L を受け入れていました（§8.4、展性）。Python、Go、Rust は
  すでに拒否していました。検証者は引き続き TweetNaCl です。範囲は TweetNaCl が受け入れた入力に対してだけ
  確認するため、型、サイズ、base64 の誤りに対するエラーは変わらず、鍵と R のデコードや弱い鍵の受け入れも
  変わりません。署名者は S < L を生成するため、新たに生成された署名の判定は変わりません。以前のバージョンが
  受け入れた S >= L の保存済み署名は、もう検証に成功しません。リポジトリの棚卸しでこうした署名が見つかったのは、
  意図的に作った否定的なレビュー用コーパスの中だけでした。外部に保存された証拠は対象外です。この変更より前に
  検証された証拠は自動的に再署名されません。ハッシュとそれを検証したバージョンとともに履歴として保管するか、
  署名し直してください。
- **同じ受け入れの変更を `dcp-ai verify`（`@dcp-ai/cli`）とプレイグラウンドにも適用しました。** どちらも
  TweetNaCl を直接呼び出していました。`dcp-ai verify` は `signature.sig_b64` に対する独自の V1 チェックで
  S < L を確認し、V2 の bundle については、今は検証者として使っている `@dcp-ai/sdk` から確認を受け継ぎます
  （「変更」を参照）。履歴上の `signature.classical.value` の経路も、追加された時点ではこの確認を持っていました。
  その経路はその後削除され、その形式は拒否されます。プレイグラウンドは `verifyDetached` で確認します。確認は
  SDK のもので、TweetNaCl が受け入れた入力に対してだけ行うため、エラーは変わりません。
- 4 つの V2 検証者は、有効な署名の正規でないエンコーディングに対して判定が分かれていました。パディングの後の
  余計なデータ、余分なパディング、途中の改行、末尾ビットが立っているもの、パディングなしについて、TypeScript は
  すべての変種を、Python と Go は一部を受け入れ、Rust はどれも受け入れませんでした。今はすべての `sig_b64` が
  正規の base64 でなければなりません（`spec/VERIFICATION.md` V2-5）。これにより署名のエンコーディングは 1 つに
  なり、すべての SDK が同じバイト列をデコードします。新しい 13 個の `must_reject` ベクターでこれを確認します。
- 4 つの SDK の V2 検証者は、署名だけを見れば通るがプロトコル上は認められない bundle を受け入れていました。
  外部レビューで報告され、私たち自身のレビューでも確認しました。リファレンスの検証者 `lib/verify.js` は、
  2.2.0 が npm に公開されるまで、ワークスペースの SDK を通じて修正済みの検証者を実行します（「変更」を参照）。
  - **どのエージェントでも任意のプリンシパルを名乗れました。** bundle の署名は RPR の `binding_keys` に加えて
    パスポートの鍵でも検証されており、エージェントは自らのパスポートに署名します。公開済みで署名付きの RPR を
    新しいパスポートと鍵と組み合わせると、プリンシパルの秘密鍵なしで検証済みの bundle が得られました。
    bundle の署名は今では RPR の `binding_keys` でだけ検証されます（`spec/VERIFICATION.md` V2-6）。そのため、
    エージェントを結び付けるのは、`passport_hash` にコミットするマニフェストへのプリンシパルの署名です。
  - **kid が鍵と照合されていませんでした。** 鍵のリストは、自分の鍵について他者の kid を名乗ることができました。
    今は、署名を検証するすべての kid がその鍵から導出されていなければならず、すべての SDK が同じバイト列を
    デコードするよう、鍵は正規の base64 でなければなりません（V2-13）。
  - **署名はあるが一貫しない bundle が検証に成功していました。** 失効または運用終了したパスポート、期限切れの
    RPR、別の意図に対するポリシー決定、別の意図、エージェント、プリンシパルの監査エントリー、別の
    `intent_hash` を持つ、またはポリシー決定を記録していない監査エントリーです。V1 のチェックは今では V2-14 に
    なりました。パスポートは `active` または `declining`、RPR は期限切れでなく、すべての成果物が同じ
    プリンシパル、エージェント、意図を示していることです。エスカレートまたはブロックされた行動も、有効な証拠で
    あることに変わりはありません。
  - **セッション継続時間の上限が署名されていないフィールドを読んでいました。** `max_session_duration_seconds` は、
    署名済みマニフェストの外にある `signature.created_at` から測られていました。マニフェストには新しい
    `session_issued_at` があり、`signBundleV2` と `sign_bundle_v2` が `session_expires_at` とともに書き込みます。
    上限はそこから測られ、上限がある場合、それを持たない bundle は拒否されます（V2-4）。
    それが検証者の時計より 30 秒を超えて先行していてはならず、上限がある場合は `session_expires_at` のない
    bundle も拒否されます。タイムスタンプはすべての SDK でミリ秒の精度で比較されます。この変更の前に署名された
    bundle は、セッションの最大継続時間のないポリシーのもとでは以前と同じように検証されます。
  - **署名されていない署名ブロックが署名と矛盾することがありました。** 今は `signature.signer.id` が RPR の
    `human_id`、`signature.signer.kids` が複合署名の kid、`manifest_hash` がマニフェストのハッシュ、
    `hash_alg` がスキーマの許す 2 つのいずれかでなければなりません。
    `signBundleV2` と `sign_bundle_v2` は RPR の `human_id` 以外の署名者 id を拒否します。Go の `SignBundleV2` と
    Rust の `sign_bundle_v2` は、すでに RPR からそれを取得しています。
  - **PQ チェックポイントが検証されていませんでした。** Merkle ルートや PQ 署名を変えたチェックポイントや、
    マニフェストが列挙しているのに存在しないチェックポイントでも検証に成功していました。今は bundle が列挙
    されたチェックポイントを過不足なく持ち、それぞれが自らの監査エントリーを対象とし、エージェントが両方の
    アルゴリズムで署名していなければなりません（V2-12）。
  - Go と Rust の検証者は `session_nonce` のない成果物や監査エントリーを受け入れていました。今は TypeScript と
    Python と同じく、すべてがマニフェストの nonce を持たなければなりません。
  - `tests/interop/v2/bundle_vectors.json` に新しいベクターを追加しました。それぞれ 1 つの欠陥について署名した
    もので、`must_reject_bundles` が 35 件、署名されていない署名ブロックの `must_reject` の変異が 4 件、
    `must_accept_bundles` の対照が 8 件です。ケースは `verifier_policy_overrides` を持つことがあります。
  - `lib/verify.js` は `dcp verify-bundle` の鍵を RPR の `binding_keys` の中で固定し、署名に使った kid のすべての
    エントリーが固定された鍵を持つことを求めます。これにより、署名者をまずパスポートの中で探す公開済みの
    SDK 2.1.1 でも固定が有効です。
- `@dcp-ai/express`（`dcpVerify`）、`@dcp-ai/openclaw`（`dcp_verify_bundle`）、Python の FastAPI
  ミドルウェア（`dcp_ai.fastapi.DCPVerifyMiddleware`）は、どの署名も検証せずに V2 の署名済み bundle を
  受け入れていました。確認していたのは bundle の構造とセッション nonce だけで（FastAPI のミドルウェアは
  `binding` フィールドから `composite_sig_valid` も設定していました）、署名のない bundle や偽造された bundle、
  署名後に意図が変更された bundle も検証済みと報告されていました。今は 3 つとも、すべての V2 bundle を
  SDK の検証者（`@dcp-ai/sdk` の `verifySignedBundleV2`、`dcp_ai.v2` の `verify_signed_bundle_v2`）と
  Ed25519 / ML-DSA-65 / SLH-DSA-192f のレジストリで、`DEFAULT_VERIFIER_POLICY` に設定済みのポリシーを
  重ねて検証します（`verifierPolicy`、`DCPVerifyMiddleware` の新しい引数 `verifier_policy`、後述の OpenClaw の
  オペレーターのポリシー）。`requireHybrid` は `hybrid_required` より下のリスク階層をすべてそこまで引き上げ
  （オペレーターの `pq_only` は `pq_only` のまま）、`risk_overrides` のない `default_mode` はすべての階層に
  適用されます。検証者のエラーと警告が返され、`composite_sig_valid` はその結果から得られます。
  `@dcp-ai/sdk` 2.2.0 が npm に公開されるまで、2 つの TypeScript パッケージはワークスペースの SDK
  （`"@dcp-ai/sdk": "file:../../sdks/typescript"`）に依存します。その検証者には上記の修正が入っています。CI は
  テストの前にそれをビルドし、3 つとも `tests/interop/v2/bundle_vectors.json` のすべてのケースに、その
  `verifier_policy_overrides` のもとで合格します。公開するには先に依存関係を `^2.2.0` に上げる必要があります。
  `publish-integrations.yml` は、ローカルパスに依存するパッケージを拒否するようになりました。
- 同じ 3 つの検証者は、V2 と判定されなかった bundle をすべて、検証者のポリシーにかかわらず V1 の検証者に
  回していました。V1 の bundle（Ed25519 の署名が 1 つで、耐量子の署名はない）は `requireHybrid` や
  `hybrid_required` のポリシーを通り抜け、バージョンを判定できない bundle は V1 として試されていました。
  今は、VERIFICATION.md V2-10 が古典のみの bundle を受け入れる場合にだけ V1 の bundle を受け入れます。
  すなわち、`allow_v1_bundles` が真で、`requireHybrid` が無効で、V1 パスポートの `risk_tier` に対する
  ポリシーのモードと、V1 の意図とポリシー決定のセキュリティ階層のモード（V1 の `risk_score` は 0 から 1 で、
  1000 倍する。ない場合は `elevated` とみなす）のうち厳しい方が、`classical_only` または
  `hybrid_preferred` である場合です。`DEFAULT_VERIFIER_POLICY` のもとでは、V1 の適合性テストの bundle
  （standard 階層の `send_email`）は合格し、同じ bundle で意図を `initiate_payment` にしたものは拒否されます。
  バージョンを判定できない bundle は拒否されます。
- `@dcp-ai/openclaw`: `dcp_verify_bundle` は、呼び出す側のモデルが制御するツールパラメーター
  `verifier_policy` から検証ポリシーを取り、失敗した結果とともに、検証されていない bundle の `agent_id` と
  `human_id` を返していました。今はポリシーがオペレーターのもの（`register(api,
  { verifierPolicy })` または新しい `configureVerifier`、`DEFAULT_VERIFIER_POLICY` に重ねる）です。
  パラメーターはポリシーをより厳しくすることしかできません（階層ごとにより厳しいモードにする。`pq_only` と
  それ以外のモードを組み合わせると `hybrid_required` になり、モデルがオペレーターの求める古典署名を外すことはできない。
  `require_*` は有効にすることだけ、`allow_v1_bundles` は無効にすることだけができ、その他のフィールドは
  エラー）。結果は
  `verification_mode` を返し、エージェント、プリンシパル、セッションを示すのは bundle が検証に成功した場合だけです。
- `@dcp-ai/express`: 判定のキャッシュは `signature.composite_sig` をキーとし、すべてのミドルウェアで共有されて
  いました。そのため、キャッシュ済みの署名を持つ別の bundle や、より厳しいポリシーを持つミドルウェアが
  「検証済み」の判定を再利用していました。さらに、キャッシュは際限なく大きくなり、セッションや鍵が期限切れに
  なった後やエージェントが失効した後も、TTL の間ずっと判定を保持していました。今は各ミドルウェアが独自の
  キャッシュを持ち、キーは bundle の正規形の SHA-256（`canonicalizeV2`。`JSON.stringify` が `null` のように
  出力していた `1e999` を含むものなど、正規形のない bundle は検証されるがキャッシュされない）で、
  `cacheMaxEntries`（新規、既定値 1000）個までの bundle を保持し、最も長く使われていないものから追い出します。
  エントリーは、TTL、マニフェストの `session_expires_at`、RPR の `expires_at`、パスポートのすべての鍵と RPR の
  すべてのバインディング鍵の `expires_at` のうち、最も早いもので期限切れになります。深く入れ子になった bundle で
  500 が返ることはなくなりました。
- `@dcp-ai/express`: `checkRevocation` はエージェントとそのパスポートの鍵についてだけ問い合わせ、黙って
  フェイルオープンしていました。今は、キャッシュヒットを含むすべてのリクエストで、RPR のすべてのバインディング
  鍵と bundle の署名の古典と PQ の kid についても問い合わせます。答えの得られない問い合わせ（サービスに到達
  できない、2xx 以外の応答、JSON でない本文や `revoked` を持たない本文）では、既定では引き続きリクエストを
  通します。新しい `revocationFailClosed: true` を指定すると拒否します。
- `@dcp-ai/express`: 未知のオプションや `verifierPolicy` のフィールド（`defaultMode`）、誤った型の値
  （`allow_v1_bundles: "false"`）は無視され、既定値が有効のままになっていました。今はミドルウェアの作成時に
  例外を投げます。
- `dcp_ai.fastapi`: Python の 4300 桁の制限を超える整数を含む、または入れ子が深すぎる `X-DCP-Bundle`
  ヘッダーや、検証者にとって深すぎる bundle で 500 が返っていました。今は 403 を返します。
  リストでない `pq_checkpoints` は拒否されます（チェックポイントなしとして読まれていました）。
  `verifier_policy={"risk_overrides": None}` は、`default_mode` をすべての階層に適用する代わりに既定の階層を
  保つようになり、未知のリスク階層は例外を投げます。`dcp_version` は強制されないことを文書に記しました。
- 3 つの README に「検証済み」の意味を記しました。bundle が内部で一貫しており、bundle 自身が列挙する鍵で
  署名されているということであり、検証者がプリンシパルの鍵を固定しない限り（どのミドルウェアもまだできない）、
  プリンシパルが誰かを証明するものではありません。また、`verifier_id` を伴う `require_audience_binding` は、
  リプレイを想定された検証者に限定します。
- Go と Rust の検証者は、マニフェストがコミットしているにもかかわらず、マニフェストと異なる `session_nonce` を
  持つ監査エントリー（または PQ チェックポイント）を受け入れていました（`spec/VERIFICATION.md` V2-4: nonce を
  持つすべての成果物と監査エントリーはマニフェストの nonce を共有する）。今は両方とも TypeScript と Python と
  同じように証跡とチェックポイントを確認し、エラーは `Session nonce mismatch in
  audit_entries[i]` です。共有ベクターは `audit_entry_session_nonce_differs` です。
- Rust の検証者は `manifest.canonicalization_profile` をまったく確認せず、Go の検証者は文字列でない値を無視して
  いたため、bundle はどの検証者も実装していないプロファイルを名乗ることができました
  （`spec/CANONICALIZATION_PROFILE.md` § 4、V2-3）。今は両方とも、TypeScript と Python と同じく、
  `"dcp-jcs-v1"` 以外の値をすべて拒否します。共有ベクターは `canonicalization_profile_unknown` と
  `canonicalization_profile_not_a_string` です。

<a id="added"></a>

### 追加

- FastAPI の `cancel_on_disconnect` が、ミドルウェアの順序にかかわらず動作するようになりました。去った
  クライアントへの ASGI 応答は、何のメッセージもない状態ではなく、空の `499`（「client closed request」: 登録済みの
  ステータスではなく、DCP のステータスでもない）、`Content-Length: 0`、`Cache-Control: no-store` で終わります。
  - これらは DCP の応答による 2 つの ASGI メッセージで、`http.disconnect` を受け取った後にだけ送られ、接続を
    続けているクライアントには決して送られません。DCP の外側にある `BaseHTTPMiddleware` は
    `http.response.start` を必要とし、以前は「No response returned.」で失敗していましたが、今は正常に完了し
    499 を記録します。
  - ネットワークに何が届くかはサーバー次第です。uvicorn（計測済み、h11 で 0.54）は、なくなった接続に対しては
    何も書き込まず記録もしません。ASGI のもとでは、別のサーバーが `OSError` のサブクラスを送出することがあります。
  - アドミッションの `request.state.dcp_agent` は、クライアントがまだいることが分かってから公開されるように
    なりました。そのため、去ったクライアントはアドミットされたコンテキストを残しません。オペレーター自身の
    コードが設定した値には手を触れません。
  - 本文の途中で去ったクライアントにも、同じ終わり方になります（以前は何もありませんでした）。
  - どの層の本当のエラーも引き続き伝播します。その他は何も変わりません。オプション、既定値、本文の上限、
    スーパーバイザー、`DenyListWorkers` は同じです。
- クライアントの切断（オプトイン）: `@dcp-ai/express` の `cancelOnDisconnect`、
  `dcp_ai.fastapi.DCPVerifyMiddleware` の `cancel_on_disconnect=True`。
  - **何をするか。** アドミッション中にクライアントが本当に去ったとき、そのリクエストの、そしてそのリクエスト
    だけの、監督下にあるソースの呼び出しをキャンセルします。その枠は、ソースが本当に終わるまで占有されたままです。
    そのリクエストについてそれ以上は何も行わず、何も送りません。ハンドラー、`next`、キャッシュへの書き込み、
    `onFailure`、応答のいずれもありません。
  - **Express。** 去るとは、応答が送信前に閉じること、または本文が不完全なままリクエストが閉じることです。
    正常なリクエスト自身の `close` は該当しません。
    - すべてのソース関数が監督下にあり、`checkRevocation` がなく、キャンセルに対応するスーパーバイザーが
      必要です。すなわち、このバージョンのスーパーバイザーの新しい `runWithSignal` 機能です（ESM と CJS、
      両パッケージ）。
    - `run`、その 4 つの引数、`version: 1` は変わらず、古いパッケージのスーパーバイザーもオプションなしで
      引き続き動作します。
    - 監督下にある呼び出しの判断は、シグナルが中断される前に一度だけ行われるようになりました。`close()` に
      再入する中断のリスナーは何も変えません。
    - 新しい結果 `cancelled`、カウンター（`stats().cancelled`、型では省略可能）、テレメトリーの理由を追加しました。
  - **FastAPI。** `max_body_bytes`、監督下にあるすべてのソースの callable、同期の `tenant` callable が
    必要です。
    - ミドルウェアはアドミッション中に保留中の `receive()` を 1 つ監視し、次の読み手に引き渡します。何も 2 回
      読まれず、失われることもありません。また、完全な応答の後に送られる `http.disconnect` を、クライアントが
      去ったとはみなしません。
    - オプションありでは、本文の途中で去ったクライアントには 400 の代わりに何も返しません。
    - 最初の形では、ミドルウェアはアプリケーションの他の `BaseHTTPMiddleware` 層を包む必要がありましたが、
      その要件はなくなりました（上のエントリーを参照）。
    - `SourceSupervisor` と `DenyListWorkers` は変わりません。OpenClaw にはこのオプションはありません。
  - オプションなしでは何も変わりません。
- `dcp_ai.v2.DenyListWorkers` と `deny_list_revocation_source(..., workers=...)`（オプトイン）: Python の
  拒否リストのヘルパー向けの、実際のダウンロードスレッドの上限です（`max_workers` は 1〜64、
  `max_workers_per_tenant` は省略可能、オブジェクトごと）。各ダウンロードは専用の非デーモンスレッドで実行され、
  枠を確保した後に開始し、ダウンロードが本当に終わったとき（タイムアウト、キャンセルされた呼び出し、C3 の
  スーパーバイザーの期限、閉じたイベントループの後も含む）にだけ枠を解放します。空き枠のない呼び出しは、
  キューも接続もなしに、ただちに `REVOCATION_UNAVAILABLE` を受け取ります。ダウンロード、本文の確認、解析、
  エラーはオプションなしの場合と同じです。`timeout` の後に届いた、または使われた結果は
  `REVOCATION_UNAVAILABLE` です。`close()` は実行中のダウンロードを待つことも止めることもせずに新しい
  ダウンロードを拒否します。`stats()` は URL、テナント、ヘッダーを含みません。フォークしたプロセスでは、親の
  ロックに触れずに拒否します。プロセスの終了は、`asyncio.to_thread` と同様に、まだ実行中のダウンロードを
  待ちます。DNS、TLS、urllib を止めるものはありません。`workers` なしでは何も変わりません。`timeout` の
  ドキュメントを修正しました。それが制限するのは各ソケット操作と本文の読み取りであり、DNS の解決や
  少しずつ届くステータス行ではありません。
- ソースのスーパーバイザー（C3）のもとでの失効の確認（オプトイン）。対象は `@dcp-ai/express`、`@dcp-ai/openclaw`、
  `dcp_ai.fastapi.DCPVerifyMiddleware` です。これまで拒否されていた `supervise: { revocation: true }` /
  `supervise={"revocation": True}` は、strict-v1 の失効ソースをスーパーバイザーのもとで実行し、
  `revocationTimeoutMs` / `revocation_timeout` を期限とします。期限はタイマーの範囲（1〜2147483647 ms の整数、
  最大 2147483.647 s）に制限されます。`supervise` は信頼の期限、`revocation`、またはその両方を受け付けるため、
  静的な信頼セットでも失効の確認を監督できます。信頼と失効の呼び出しはスーパーバイザーの容量を共有し、枠は
  そのソースが本当に終わったときにだけ解放されます。応答は変わりません。タイムアウト、空き枠なし、閉じた
  スーパーバイザーは、失敗したソースと同じ `REVOCATION_UNAVAILABLE`（Express と FastAPI では 403）になり、
  `REVOCATION_INVALID` のエラーは期限の前にだけ有効です。TypeScript のソースは
  `(subjects, { tenant, signal })` を受け取り、`denyListRevocationSource` はそのシグナルで fetch も中断し、
  テレメトリーは `source: 'revocation'` を報告します。OpenClaw の `configureVerifier` は、どのソースを監督して
  いるかにかかわらず、呼び出しが進行中のスーパーバイザーの置き換えを拒否します。FastAPI には非同期の
  `revocation_source` が必要です。オプションありの場合だけの動作の変更: 自らのキャンセルを抑止する FastAPI の
  ソースは、遅れて届いたスナップショットではなく、期限の時点で `REVOCATION_UNAVAILABLE` になります。制限
  されないもの: ソースが独自に始める処理、たとえば `deny_list_revocation_source` の `asyncio.to_thread`
  ワーカーで、その I/O はキャンセルされません。オプションなしでは何も変わりません。
- `dcp_ai.fastapi.DCPVerifyMiddleware`: 非同期の `trusted_principals` に対する期限と容量（オプトイン）。
  `dcp_ai.fastapi` からだけエクスポートされる `SourceSupervisor(max_in_flight=..., max_in_flight_per_tenant=None)`
  と、`supervise={"trust_timeout": seconds}` を伴う `source_supervisor`（両方をあわせて使う）。ソースは
  スーパーバイザーが所有する Task として実行されます。期限の後に届いた信頼セット（`loop.time()` で、到着時と
  使用時に確認）、空き枠のない呼び出し（キューなし）、閉じたスーパーバイザー、別のイベントループに結び付いた
  スーパーバイザーは、失敗したソースと同じ 503 になります。枠は Task が本当に終わったときにだけ解放されます。
  `close(drain_timeout)` と `stats()` を提供します。これらのオプションとともに静的または同期の
  `trusted_principals` を使うと `AdmissionConfigError` を送出します。この最初の段階では
  `{"revocation": True}` も同様でしたが、今は受け付けます（上の失効のエントリーを参照）。スーパーバイザーは
  イベントループごとに 1 つです。キャンセルを無視するソースを止めたり、CPU を隔離したりはしません。これらの
  オプションなしでは何も変わりません。
- `@dcp-ai/express` と `@dcp-ai/openclaw`: `trustedPrincipals` 関数に対する期限と容量（オプトイン）。
  `createSourceSupervisor({ maxInFlight, maxInFlightPerTenant?, onSourceEvent? })` がスーパーバイザーを作り、
  `supervise: { trustTimeoutMs }` を伴う `sourceSupervisor` がそれを適用します（両方をあわせ、
  `trustedPrincipals` を関数として使う）。その場合、関数は `{ tenant, signal }` を受け取ります。
  到着時に単調時計で測って期限の後に届いた信頼セットは使われず、空き枠のない呼び出し（キューなし）や閉じた
  スーパーバイザーも同様です。結果は失敗したソースと同じです（`TRUST_SOURCE_FAILED`、Express では 503）。
  枠は関数が本当に終わったときにだけ解放されます。容量はスーパーバイザーのオブジェクトごとで、両パッケージと
  その ESM、CJS のビルドの間で共有できます。`close({ drainMs })` と `stats()` を提供し、カウンターは
  `Number.MAX_SAFE_INTEGER` で止まります。OpenClaw の `configureVerifier` は、そのスーパーバイザーのもとで
  始まった呼び出しが進行中である間（ソースを呼ぶ前も含む）や、そのソースがまだ実行中である間は、`close()` の
  後であっても、スーパーバイザーの置き換えや削除を拒否します。ソースの処理を止めたり、CPU を隔離したりは
  しません。これらのオプションなしでは何も変わりません。この最初の段階では
  `supervise.revocation: true` は拒否され、失効の確認は `revocationTimeoutMs` のままでしたが、今は受け付け
  ます（上の失効のエントリーを参照）。
- `dcp_ai.fastapi.DCPVerifyMiddleware(max_body_bytes=...)`: リクエスト本文に対するバイト単位の上限
  （オプトイン）。既定は `None` で、以前と同じく上限なしです。正の整数でなければ `AdmissionConfigError`
  `CONFIG_INVALID_VALUE` になります。この場合、ミドルウェアは、bundle がヘッダーにある場合や
  `require_bundle=False` の場合も含め、まず本文を読みます。上限を超える `Content-Length`、または上限を超えて
  受信したバイト（`Content-Length` なし、チャンク形式、または誤った値）は、残りを受信せず、解析、信頼の解決、
  検証、ルートへの到達もせずに `413` を受け取ります。不正または重複した `Content-Length`、送信中の切断は
  `400` を受け取ります。上限内の本文は以前と同じように処理され、引き続きルートに届きます。制限するのは
  受信したバイトであり、展開、JSON の深さ、時間ではありません。これはデプロイ上の制限であり、プロトコルの
  一部ではありません。このオプションには、ミドルウェアで読んだ本文をルートに引き渡す Starlette 0.28.0 以降が
  必要です。それより古い、または特定できない Starlette では、ミドルウェアの構築時に `AdmissionConfigError`
  `CONFIG_INVALID_VALUE` を送出します。パッケージの最小バージョンは変わらず、オプションなしでは何も確認しません。
- アドミッション: 信頼されたプリンシパルと `strict-v1` プロファイル（`spec/profiles/admission`、
  `docs/ADMISSION.md`）。検証済みの bundle が証明するのは、完全性と、bundle が列挙する鍵による署名です。
  オペレーターの信頼セット（`schemas/v2/principal_trust_set.schema.json`）により、検証者は、bundle の
  プリンシパルの署名（RPR とマニフェスト、古典と PQ）を検証した鍵が、その `human_id` の信頼された有効な鍵で
  ある場合にだけ bundle をアドミットできるようになりました。`strict-v1`
  （`schemas/v2/admission_profile.schema.json`）は、オペレーターが固定する要件を加えます。V2 のみ、すべての
  階層でハイブリッド署名、セッションバインディング、オペレーターの `verifier_id` と等しい署名済みの
  `intended_verifier`、最長 300 s の署名済みセッション、そしてエージェントと検証済みのすべての署名者の鍵を
  対象とする、作成から 300 s 以内の失効スナップショット（`schemas/v2/revocation_snapshot.schema.json`）です。
  その設定は要件を厳しくすることしかできず、弱める値は `CONFIG_PROFILE_CONTRADICTION` になります。結果は
  `verified` を保ち、`principal_trust`、`profile_compliance`、`admitted`、`recorded_decision`、
  `trust_set_version`、コード付きの `errors`、常に `false` の `action_authorized` を加えます。アドミッションは
  行動を認可しません。
  - SDK: TypeScript（`admitSignedBundleV2`、`evaluateAdmissionV2`、`createPrincipalTrustStore`、
    `resolveStrictV1Profile`、`revocationSubjects`、`revocationSnapshotFromDenyList`）、および Python、Go、
    Rust の同じ関数。4 つの検証者は省略可能な時計を受け取り、署名の各構成要素をどの鍵で検証したか
    （`signer_keys`）を報告します。Rust では、`V2VerificationResult` は 10 個のフィールドを保ち、
    `verify_signed_bundle_v2` / `verify_signed_bundle_v2_with_policy` は型を保つため、それらに対して
    ビルドしたコードは引き続きコンパイルできます。鍵は新しい `verify_signed_bundle_v2_at` から得られ、これは
    `V2VerificationDetails`（`#[non_exhaustive]`。同じ検証による結果を `result` として、および
    `signer_keys`）を返します。アドミッションはこれを受け取って返し、その JSON は結果のフィールドの後に
    `signer_keys` が続く形です。
  - インテグレーション: `@dcp-ai/express` の `dcpVerify`、`dcp_ai.fastapi` の `DCPVerifyMiddleware`、
    `@dcp-ai/openclaw` の `configureVerifier` は、`trustedPrincipals`、`profile`、`revocationSource`、
    およびミドルウェアではオペレーターの `tenant` 関数を受け取ります。リクエストがルートに届くのは
    アドミットされた場合だけです。例外を投げる、または有効な信頼セットを返さない（`undefined`、`null`、
    不正なセット）信頼関数はリクエストを拒否します。ミドルウェアでは `503`、OpenClaw では `admitted: false`
    です。Express のキャッシュは、bundle、ポリシー、テナントをキーとして暗号学的な検証だけを保持します。
    信頼、プロファイル、失効はリクエストごとに評価されます。`denyListRevocationSource` は完全な拒否リストを
    読みます。失敗した、またはタイムアウトしたソースはリクエストを拒否します。
  - リファレンスの検証者、サーバー、CLI: `lib/verify.js` の `admitSignedBundle`、
    `DCP_TRUSTED_PRINCIPALS_FILE`、`DCP_ADMISSION_PROFILE_FILE`、`DCP_REVOCATION_LIST_URL` で設定する
    `POST /v2/admit`、および `dcp admit-bundle`。
  - `tests/interop/v2/admission_vectors.json`: 手書きの期待結果と各ケースが確認する規則を持つ 65 ケースと、
    49 個の設定のケース。4 つの SDK と `npm run
    conformance` が実行します。
- Rust SDK: V2 の bundle のネイティブな構築と署名、`dcp_ai::v2::bundle`。`build_bundle_v2(&rpr,
  &passport, &intent, &policy, &audit_entries, session_nonce)` は各 `payload_hash` と、すべての成果物と
  監査エントリーの `session_nonce` を確認し、両方の監査 Merkle ルートを含むマニフェストを書き込みます（空の
  証跡では、Go と同じく 64 個のゼロのルートになります）。`sign_bundle_v2(bundle,
  &classical, &pq)` は、Go の `SignBundleV2` と同じく、`signer.id` を RPR の `human_id` としてマニフェストに
  複合署名します。Go のものと同様、このビルダーはまだ PQ チェックポイントを受け取りません。相互運用性
  マトリクスの Rust エージェントは、bundle を手作業で組み立てる代わりにこれらを使います。
- `tools/interop-matrix`: 4 つの SDK の間のライブの相互運用性。SDK ごとに 1 つのエージェントプロセス
  （TypeScript、Python、Go、Rust）がアイデンティティを作り、意図を宣言し、行動し、市民権の bundle に署名
  します（DCP-01 から DCP-03）。他のすべてのエージェントとリファレンスの検証者 `lib/verify.js` が、既定の
  ポリシーと `hybrid_required` のもとで、手を加えない状態と、転送中の 7 種類の改ざん（意図の変更、監査
  エントリーの並べ替えや削除、セッションのつなぎ合わせ、bundle の署名やパスポートの差し替え、PQ 署名の
  剥ぎ取り）の後で、それらを検証します。エージェントが共有するのは、オーケストレーターが中継するメッセージ
  だけです。`.github/workflows/interop-matrix.yml` が、すべてのプルリクエストと毎晩これを実行します。
- `@dcp-ai/google-a2a` 2.1.0: 署名済みの DCP Agent Passport が A2A の Agent Card の中で運ばれるように
  なりました。`passportToAgentCard(signedPassport, url)`（または `attachPassportToAgentCard(card, signedPassport)`）
  は、A2A 自身の拡張の仕組みである `capabilities.extensions` の
  `https://dcp-ai.org/a2a/extensions/passport/v2` の下に `SignedPayload<AgentPassportV2>` を置きます。
  `verifyAgentCardPassport(card)` はそれをオフラインで検証し（ペイロードのハッシュ、パスポートが列挙する
  有効で期限切れでない鍵による AgentPassport コンテキストの `pq_over_classical` 複合署名、`status: active`、
  同じエージェントを示す `metadata.dcp_agent_id`）、不正な形式のものがあればフェイルクローズします。
  カードがパスポートを持つ場合、`agentCardToPassport` はひな形ではなくそのパスポートを返します。パッケージは
  TypeScript になりました（`dist/` のビルド、CI での vitest のテストスイート）。
- `@dcp-ai/anthropic-mcp` 2.1.0: MCP のツール呼び出しに対する署名付きのレシート。`withDcpReceipt(name, handler,
  { identity })` は任意の MCP ツールのハンドラーを包みます。呼び出しは Intent（DCP-02）に分類され、ツールの実行前に
  複合署名され、ポリシーが判断します（approve ではツールを実行し、escalate と block では実行せずに `isError` の
  結果を返し、例外を投げるハンドラーは `outcome:
  "failed"` になります）。そして 1 つの監査エントリー（DCP-03）が引数と結果の SHA-256 を記録します。
  `_meta.dcp_receipt` のレシートは通常の DCP v2.0 の署名済み bundle なので、どの DCP の検証者でもオフラインで
  確認できます。`verifyDcpReceipt` はさらに、呼び出し側が見た引数と結果から証拠のハッシュを再計算し、ツール名を
  確認します。`createReceiptIdentity` は、テストや初回の実行のためにセッションのアイデンティティ（Ed25519 +
  ML-DSA-65 の鍵、署名済みの RPR とパスポート）を発行します。パッケージは TypeScript になり（`dist/` のビルド、
  CI での vitest のテストスイート）、`dcp_verify_bundle` は構造の確認ではなく本物の `verifySignedBundleV2` を
  実行します。使われていなかった入力 `security_tier` は削除しました。
- `tests/interop/v2/bundle_vectors.json`: 拒否のケースを 28 件追加しました（`must_reject` の変異 5 件、
  `must_reject_bundles` 23 件）。v2.10 のラウンドの脆弱性ごとに 1 件ずつで、4 つの SDK の検証者（Python を含む）が
  すべての検証モードで実行します。`composite_sig` をまったく持たない成果物（V2-8）、`dcp_bundle_version` が
  `1.0` と `3.0`（V2-1）、UTC でないオフセットで期限切れになった鍵、パスポートの鍵の不正な `expires_at`（存在しない
  日付、日付のみ、オフセットなし）と RPR の存在しない日付（V2-13）、意図が `security_tier: "routine"` または
  `estimated_impact: "high"` を宣言しているのに、意図やポリシー決定が `elevated` を意味する古典のみの bundle
  （V2-10）、パスポートの `risk_tier` にあるプロトタイプのキー（`constructor`、`__proto__`、`toString`、
  `hasOwnProperty`）と、`action_type`、`estimated_impact`、`security_tier` にある `constructor`（V2-9）、未知の、
  または文字列でない `canonicalization_profile`（V2-3）、別の `session_nonce` を持つ意図、監査エントリー、
  マニフェスト（V2-4）、一致しないマニフェストのハッシュ、監査ルート、チェーンのハッシュ（V2-3）です。
- `tools/difffuzz`: 変異させた同じ V2 の署名済み bundle を TypeScript、Python、Go、Rust の検証者（このチェック
  アウトからビルドした SDK ごとのシム）に通し、不一致、クラッシュ、タイムアウトがあれば失敗とし、各発見を
  `tools/difffuzz/findings/` に保存する差分ファザーです。シードは `tests/interop/v2/` の V2 の署名済み bundle です。
  ミューテーターは、削除や null にしたフィールド、型の入れ替え、兄弟要素の入れ替え、base64 の文字の反転、
  プロトタイプのキー、未知のキー、重複した成果物、数値と RFC 3339 の変種、大きすぎる文字列、深い入れ子、
  キーの並べ替え（判定を決して変えてはならない）を扱います。
- `.github/workflows/difffuzz.yml` が、すべてのプルリクエスト（300 回の反復）、`workflow_dispatch`、毎晩
  （3000 回の反復）でファザーを実行します。
- 4 つの SDK すべてで検証可能な委任チェーン（DCP-09 §3.5）。`schemas/v2/delegation_mandate.schema.json` に
  省略可能なフィールド `parent_mandate_id`、`delegation_depth`、`sub_delegation`（`{ permitted, max_depth }`）、
  `minimum_security_tier`、`delegator_composite_sig` を追加しました。ルートマンデートは `human_composite_sig` を
  保ち、1 バイトも変わりません。サブマンデートはその代わりに、委任するエージェントが新しいドメイン分離
  コンテキスト `DCP-AI.v2.SubMandate`（`domain-separation.{ts,py,go,rs}`、`interop_vectors.json`）のもとで署名した
  `delegator_composite_sig` を持ちます。`verifyMandateChain` / `verify_mandate_chain` / `VerifyMandateChain` は、
  順序付けられたチェーンを人間までオフラインで検証します。人間の鍵によるルートの署名、親エージェントの鍵による
  各段階の署名、親とのリンクと深さ、`sub_delegation.permitted` と祖先の `max_depth` の最小値、同じ `human_id`、
  RFC 3339 の時点として比較する入れ子になった有効期間、縮小（`actions_permitted` と `data_classes` が部分集合で
  あること、`limits` が決して緩くならないこと、親に `data_classes` がなければ子は追加できないこと、数値の
  `limits` は ±(2^53 − 1) の範囲の整数に限ること。その範囲を超えると、JSON の数値を倍精度で読む検証者とすべての
  桁を保持する検証者とでマンデートの内容の解釈が食い違うため、そうした制限はどの深さでも `not comparable` に
  なる）、親を決して下回らない `minimum_security_tier`、そして失効です。失効した祖先は、そのすべての子孫を無効に
  します。結果にはチェーンの実効的な階層（チェーン上の `minimum_security_tier` の最大値）が含まれます。未知の
  もの、深さに対して欠けているもの、比較できないものは、すべてフェイルクローズします。署名の鍵は検証時刻に
  `active` で期限切れでない必要があり、マンデートの署名は `pq_over_classical` でなければなりません。
- ルートのビルダーの隣にサブマンデートのビルダーを追加しました。`createSubMandate` / `create_sub_mandate` /
  `CreateSubMandate`、およびルートのビルダーの `sub_delegation` / `minimum_security_tier`（Rust では
  `create_delegation_mandate_with_options` と `MandateChainOptions`）です。
- `computeSecurityTier` / `compute_security_tier` / `SecurityTierInput.MandateChainTier` /
  `compute_security_tier_with_floor`、およびルートにあるコピー `lib/security-tier.js`（`computeSecurityTier(intent,
  policyDecision, mandateChainTier)`）は、検証済みのチェーンの実効的な階層を、階層を引き上げることしかできない
  省略可能な入力として受け取ります（仕様 §14.2）。Go では、空の `MandateChainTier` はチェーンなしを意味し、階層で
  ないその他の名前は `elevated` とみなされます。bundle の検証者はまだこれを読みません。bundle には、その
  マンデートチェーンを運ぶフィールドがないためです。
- `tests/interop/v2/mandate_chain_vectors.json`（
  `sdks/typescript/src/__tests__/generate-mandate-chain-vectors.ts` が生成）: すべての SDK がその深さと実効的な
  階層とともに受け入れなければならない深さ 1 と 2 のチェーン、すべての SDK が拒否しなければならないチェーン
  （行動の拡大、データクラスの追加、制限の緩和、倍精度では表せないワイヤー上の整数として書かれた 2^53 や
  2^53 + 1 の制限、親の範囲外の有効期間、`max_depth` を超える深さ、欠けている、または誤った
  `parent_mandate_id`、引き下げられた階層、失効したルートや中間のマンデート、誤ったエージェントが署名した
  サブマンデート、両方の署名がある場合、誤った `delegation_depth` など）、そして階層の下限のケースです。
  4 つの SDK のテストスイートすべてがこれを実行します。
- 正規化の候補 `dcp-jcs-v2` のための実験的なオプトインの API（`docs/proposals/canonicalization-candidate`、
  §15–§18）。候補は規範的でなく、有効でもありません。`dcp-jcs-v1` が唯一の規範的で既定の正規化プロファイルで
  あり続け、既定値、ビルダー、署名者、検証者のいずれも変わりません。これらの API に到達するのは、TypeScript、
  Python、Go、Rust、WASM でオプトインした呼び出し側だけです。
  - **取り込み:** 1 つの単位の元のバイト列を確認し（UTF-8、BOM、重複、±(2^53−1) の範囲の正確な整数、深さ 64）、
    その正規のバイト列、またはクラスとオフセットを返します。
  - **ルーター:** 単位をその転送形式から取り出し、プロファイルを読んで判断します。拒否する、名前付きの履歴用
    デコーダーを通じて `dcp-jcs-v1` に委ねる、または候補を選ぶ、のいずれかです。
  - **検証者:** 元のバイト列から、多くとも 1 つの検証者で検証します。`dcp-jcs-v1` には現行の検証者、候補には
    `dcp-jcs-v2` だけを受け入れる現行の検証者を使います。検証済みの bundle は信頼もアドミッションも与えません。
  - **生成者:** 元のバイト列、または厳密に確認したホストの値から、成果物（`experimentalCandidateSignPayload` と
    その同等物）と、マニフェストが `dcp-jcs-v2` を示す bundle（`experimentalCandidateSignBundle`）に署名します。
    入力の領域や形式による拒否は、どの署名者も呼ぶ前に発生します。鍵、レジストリ、プロバイダーのエラーは、
    署名が作られた後に起こることがあります。
  - **テスト:** 5 つの生成者 × 5 つの利用者の交差マトリクス（`tests/interop/candidate/phase4`、全か無かの判定を
    伴う 975 件の結果）とそのコストの測定で、新しいワークフロー `canonicalization-candidate-matrix` が実行し、
    何も公開しません。ベクターは `tests/interop/candidate/` にあります。

<a id="changed"></a>

### 変更

- `dcp-ai verify`（`@dcp-ai/cli`）は、V2 の bundle（`bundle.dcp_bundle_version` が "2.0"、または
  `bundle.manifest` がある）を規範的な検証者で検証します。エンベロープと 4 つの署名済みペイロードを、パッケージに
  コピーが同梱される `schemas/v2` で検証し、その後 `@dcp-ai/sdk` の `verifySignedBundleV2` を
  `DEFAULT_VERIFIER_POLICY` と Ed25519、ML-DSA-65、SLH-DSA-192f のプロバイダーで実行します。規範以前の
  エンベロープ（トップレベルの `dcp_version` "2.0" や `bundle_manifest`、または `signature.binding: "composite"`）
  は、それらの印が V1 や V2 の bundle にある場合も含め、他の何よりも先に拒否し、その
  `signature.classical.value` のチェックは古典署名へのフォールバックなしで削除しました。
  `.dcp/keys/ed25519_public.key` が存在する場合は、それが RPR の `binding_keys` の中でプリンシパルの署名鍵を
  固定します（空のファイルは拒否）。存在しない場合は bundle 自身の鍵を使い、署名は確認しますが、信頼や
  アドミッションは確認しません。V1 の検証は変わりません。`dcp-ai sign` も変わらず、`verify` が読まない形式である
  `signatures[]` に追記します。V2 の bundle には `signBundleV2` または `dcp sign-bundle --composite` で署名します。
  パッケージは `@dcp-ai/sdk` `^2.2.0` を必要とし、`ajv` と `ajv-formats` を宣言するようになりました。
- `dcp-ai verify`（`@dcp-ai/cli`）が 0 で終了するのは VALID を出力したときだけです。V1 のファイルでは、Ed25519 の
  署名が INVALID のとき、鍵がない、または使える署名がないとき（鍵があって署名がない、または空の場合も含め「No public key
  available」を出力）、ファイルが署名済みの bundle でないとき（真の `bundle` を持たないオブジェクト、配列、
  プリミティブ）、これまで 0 で終了していたところを 1 で終了するようになりました。それらのメッセージは変わらず、
  引数やファイルがない、不正な JSON、base64、誤ったサイズの場合も、引き続きそのエラーとともに 1 で終了します。
  終了コード 0 を「実行された」と解釈していたスクリプトは、これらの場合に 1 を想定する必要があります。V1 の
  ファイルで終了コード 0 が意味するのは、正規化した bundle に対する Ed25519 の署名が検証できたことだけです。V2 の
  bundle では、スキーマと規範的な検証者に合格したこと（上記）を意味します。どちらもアドミッションの判断では
  ありません。
- Go と Rust の V2 検証者: `accepted_classical_algs` や `accepted_pq_algs` を狭めるポリシーは、適用していない
  フィールドとして拒否され、そのもとではすべての bundle が失敗していました。今は TypeScript と Python と同じく
  両方のリストを適用し（古典のリストは `pq_only` の場合を除く）、それらに含まれないアルゴリズムの署名は、検証者の
  ポリシーで受け入れられないものとして失敗します。また、strict-v1 が設定する `allow_v1_bundles: false` も
  受け付けます。これらは V2 の bundle しか検証しないため、このフィールドは何も変えません。以前に検証できた
  ポリシーは同じように動作します。
- リファレンスの検証者（`lib/verify.js`、`dcp verify-bundle`、検証サーバーとその Docker イメージ）は、2.2.0 が
  npm に公開されるまで、ワークスペースの `@dcp-ai/sdk`（`file:sdks/typescript`、`.npmrc` の `install-links` で
  パック）に依存します。そのため、79 個の `must_reject_bundles` ベクターのうち 39 個を受け入れていた公開済みの
  2.1.1 ではなく、このリリースの検証者の修正を実行します。ルートで `npm install` する前に
  `sdks/typescript` をビルドしてください。CI と `docker/Dockerfile` はそうしています。公開するには、依存関係を
  `^2.2.0` に戻す必要があります。
- `lib/verify.js`: スキーマの検証は、`validateOne` の呼び出しごと（V2 の bundle につき 5 回）にすべてのスキーマを
  読み込んでコンパイルする代わりに、スキーマのルートごとに 1 つの Ajv を作り、各スキーマを初回の使用時に 1 度だけ
  コンパイルします。V2 の bundle のスキーマ検証は約 34 ms から 0.14 ms になりました（まだコンパイルを行う初回を
  除いた 20 回の実行の中央値）。

<a id="fixed"></a>

### 修正

- `denyListRevocationSource`（`@dcp-ai/express`、`@dcp-ai/openclaw`）が応答を開いたままにしていました。2xx 以外の
  応答や、16 MiB を超える `Content-Length` を宣言した応答は、本文を読みも閉じもせずに拒否されていました。応答は、
  呼び出しが終わって枠が解放された後も開いたままで、タイムアウトや呼び出し側のシグナルが届かない状態でした。
  さらに Node 22.15（undici 6.21.2）では、ヘッダーの後のガベージコレクションによって、fetch のシグナルが読み取り
  中の本文に届かなくなることがありました。自身のタイムアウトもスーパーバイザーの期限も、まだ届き続けている本文を
  止められなくなり、呼び出しは終わらずに枠を保持し続けました。今は、どの終了経路でも fetch を中断して本文を
  キャンセルし、自身のシグナルで読み取りを止め、リーダーを解放します。エラーコード、既定値、容量は変わりません。
  何も読み捨てず、リモート側のクローズも待ちません。
- リファレンスの CLI（`bin/dcp.js`）: パスは、指す先ではなく書かれたとおりの形で作業ディレクトリに制限されて
  おり、いくつかの読み書きはそのチェックを経ていませんでした。作業ディレクトリ内のシンボリックリンクや、別の
  ディレクトリへのパス（`keys rotate --key-dir`、`governance sign-advisory
  --key-dir`、`governance verify-advisory --sigs`）によって、コマンドが秘密鍵を含む外部のファイルを読むことが
  できました。出力パスにあるシンボリックリンクやハードリンク（`keygen`、`keys rotate`、`recovery-setup`、
  ガバナンスのコマンド、V1 の `sign-bundle` の出力）によって、外部に書き込むことがありました。既存の秘密鍵の
  ファイルは広い権限のままでした。さらに `dcp validate`、`conformance`、V1 の `sign-bundle` は作業ディレクトリ
  から `tools/*.js` を実行していたため、仕込まれたスクリプトが実行されていました。今はすべてのパスをシンボリック
  リンクを含めて解決し（リンク切れのものは拒否）チェックし、ユーザーのパスに対するすべての読み書きがそのチェックを
  通り、ファイルは新しいファイル（`O_EXCL`、正確な権限）に書いてから対象に名前を変えて置き換え、CLI は自身の
  ツールを実行します。CLI は、コマンドの実行中に他のものが作業ディレクトリを変更しないことを前提としています。
  `O_NOFOLLOW` のない Windows でも、名前の変更はリンクを通して書き込むのではなく、リンクを置き換えます。
- `@dcp-ai/anthropic-mcp` と `@dcp-ai/google-a2a`: エクスポート条件 `"types"` が先頭にあったため、CommonJS の
  利用者は ESM の宣言（`dist/index.d.ts`）を受け取り、TypeScript は `node16` のもとで `require()` を TS1471 で
  拒否していました。この条件を削除したため、`require` は `dist/index.d.cts` を、`import` は `dist/index.d.ts` を
  受け取ります。`@dcp-ai/sdk`、`@dcp-ai/express`、`@dcp-ai/openclaw` は、`"import"` と `"require"` の後にあって
  一度も一致せず、ビルドのたびに tsup に警告させていた同じ条件を削除します。エクスポートに `"require"` のない
  `@dcp-ai/wasm` では、Node が `ERR_PACKAGE_PATH_NOT_EXPORTED` で拒否する `require()` に対して、`nodenext` の
  もとで CommonJS の利用者に型を与えていました。今はそこでも TypeScript が TS2307 を報告します。
- Go SDK: `VerifySignedBundleV2WithPolicy` は、`require_session_expiry`、`require_audience_binding`、
  `verifier_id` を設定したポリシーのもとではすべての bundle を失敗にしていました。これらは
  `verifier_policy.schema.json` が列挙し、TypeScript と Python の検証者が適用するフィールドです。`VerifierPolicy`
  にそれら（`RequireSessionExpiry`、`RequireAudienceBinding`、`VerifierID`、ゼロ値で無効）を追加し、検証者は
  TypeScript と同じように適用します。`session_expires_at` のないマニフェスト、`intended_verifier` のない
  マニフェスト、`verifier_id` 以外の検証者を宛先とするマニフェストは拒否されます。
- Rust SDK と `@dcp-ai/wasm`: `VerifierPolicy` は、`schemas/v2/verifier_policy.schema.json` が列挙し、
  TypeScript と Python の検証者が適用する `require_session_expiry`、`require_audience_binding`、`verifier_id` を
  拒否していたため、そのいずれかを設定したポリシーではすべての検証が失敗していました。今は TypeScript と同じ
  ように適用します。`require_session_expiry` のもとでは `session_expires_at` のないマニフェストを拒否し、
  `require_audience_binding` のもとでは `intended_verifier` のないマニフェスト、または `verifier_id` が設定されて
  いる場合は別の値を持つマニフェストを拒否します。Rust の `BundleManifest` に `intended_verifier` を追加しました。
- Python SDK の `dcp_ai.langchain`（`DCPTool.run`、`DCPTool.arun`）と `dcp_ai.openai`
  （`handle_dcp_tool_call` の `dcp_verify_bundle`）: どちらもすべての bundle を V1 の検証者に送っていたため、
  V2 の bundle はすべて拒否され、V1 の bundle は検証ポリシーなしで受け入れられていました。今は V2 の bundle を、
  `verify_signed_bundle_v2` と 1 度だけ作る Ed25519 / ML-DSA-65 / SLH-DSA-192f のレジストリで、呼び出し側が設定する
  検証ポリシー（`DCPTool(verifier_policy=...)`、`handle_dcp_tool_call(..., verifier_policy=...)`、
  `DEFAULT_VERIFIER_POLICY` に重ねる）のもとで検証し、検証者のエラーを返します。返すのはそれぞれ 500 文字までの
  エラー 20 件と警告 20 件までで、bundle が提供するテキスト（`agent_id`、不正なタイムスタンプ）の制御文字と書式
  文字はエスケープします。これにより、bundle がモデルのコンテキストにメガバイト単位のデータや改行を入れることは
  できません。V1 の bundle が受け入れられるのは、FastAPI のミドルウェアの V2-10 の規則のもとでだけです。この規則は
  今では 3 つの入口すべて（`dcp_ai._verify_any`）で共有され、ポリシー全体に拡張されました。ポリシーが V1 の
  bundle を許可し、ed25519 を受け入れ（`accepted_classical_algs` にあり、`advisory_rejected_algs` にない）、
  オーディエンスのバインディング、セッションの有効期限、セッションの最大継続時間を求めず（V1 の bundle には
  `intended_verifier` もセッションの期間もない）、そのリスク階層とセキュリティ階層について古典のみの bundle を
  受け入れる場合です。FastAPI のミドルウェアも追加された条件を適用します。成果物がオブジェクトでない V1 の
  bundle、`audit_entries` がオブジェクトのリストでない V1 の bundle は 3 つとも拒否し（FastAPI のミドルウェアは
  オブジェクトでない `agent_passport` に 500 を返していましたが、今は 403）、`dcp_ai.verify.verify_signed_bundle`
  は不正な形式の署名ブロック、鍵、監査証跡に対して例外を投げる代わりにエラーを返します。パスポートの `agent_id`
  や RPR の `human_id` が文字列でない（またはパスポートの `public_key`、`status`、`capabilities` の型が誤っている）
  V1 の bundle も、FastAPI のエージェントのコンテキストに届く前に拒否します。FastAPI のミドルウェアの 403 応答と
  そのコンテキストの `warnings` は、ブリッジの出力と同じように制限しエスケープします。`VerifierPolicy` の
  インスタンスは dict と同じように検証されるため、`model_construct` で作られたものや代入で変更されたものが
  不正な値を持つことはありません。また、`risk_overrides` が省いているリスク階層には、V2 の検証者と TypeScript
  SDK の `resolveMode` が解決するのと同じように、その `default_mode` が適用されます（以前は、その階層の V1 の
  bundle は「is not low, medium or high」で拒否されていました）。同期の入口は、実行中のイベントループの中でも動作し
  （検証はワーカースレッドで実行）、プライベートなループで実行して、スレッドの現在のイベントループをそのまま
  残します。`DCPTool.arun` は検証を await し、新しい `averify_bundle_tool_call` は OpenAI のツール呼び出しの非同期
  版です。どちらも `tests/interop/v2/bundle_vectors.json` のすべてのケースに合格します。
- Go SDK: `BundleManifest` に `intended_verifier` がなかったため、そこにデコードして再びエンコードした
  マニフェストはこのフィールドを失い、署名が検証できなくなっていました。フィールドを追加しました
  （`IntendedVerifier`、空の場合は省略）。テストで、スキーマのすべてのフィールドを持つマニフェストを往復させます。
- Python SDK の `dcp_ai.crewai`: `DCPCrew` のエージェントがクルーのセッション nonce を共有していませんでした。
  `DCPCrewAgent` は常に独自の nonce を生成していたため、nonce のないエージェントに対するクルーのチェックは
  適用されず、各エージェントの監査エントリーはそれぞれ異なる `session_nonce` を持っていました。今はクルーが、
  自ら生成した nonce をまだ持っていて、まだ何も記録していないすべてのエージェントに自分の nonce を渡します。
  エージェントに与えられた nonce や、後から設定された nonce はそのままです。
- Rust の `wasm` 機能と `@dcp-ai/wasm`: `wasm_sign_bundle`（`signBundle`）は `created_at ""` を書き、
  `signer.id` を書かなかったため、リファレンスの検証者、CLI、サーバーは、それが署名したすべての bundle を拒否して
  いました（`created_at must match format "date-time"`、`signer must have required
  property 'id'`）。`wasm_build_bundle`（`buildBundle`）は、他のすべての SDK と違って SHA3-256 の監査の葉を
  SHA-256 で結合し、正規化できない監査エントリーを数えたまま飛ばしていました。今は両方とも `build_bundle_v2` と
  `sign_bundle_v2` を呼ぶため、`buildBundle` は、ペイロードと一致しない `payload_hash` や、別のセッションの
  成果物やエントリーも拒否します。`sessionNonce` がない場合、`buildBundle` はどの成果物も持たない nonce を生成して
  いたため、`verifyBundle` でさえ bundle を拒否していました。今は RPR の `session_nonce` を使います。デモの
  `example.html` は、`wasm_build_bundle` が一度も受け付けたことのない生のペイロードを渡していましたが、今は先に
  各成果物に署名します。`SignedBundleV2` 型は `signer.id` を宣言します。
- Rust SDK: `Ed25519Provider::sign` は 32 バイト未満の秘密鍵でパニックしていました（wasm では JSON のエラーでは
  なくトラップ）。今は `invalid secret key length` を返します。
- マンデートチェーン（4 つの SDK すべて）: 親のエントリーがデータクラスを持つのに `data_classes` を持たない
  サブマンデートのエントリーが縮小のチェックを通っていました。その場合、親のデータクラスにそれを縛るものは何も
  ありませんでした。今は、`limits` のキーが欠けている場合と同じく拒否されます（`data_classes for domain "<d>" missing`）。
  DCP-09 §3.5.2 の規則 5 がそう定めています。共有ベクターは `dropped_data_classes` です。
- Go SDK: 複数の goroutine から使われた `A2ASession` がプロセスをクラッシュさせていました（`DecryptMessage` での
  `fatal error:
  concurrent map writes`）。セッションはミューテックスを持つようになったため、`EncryptMessage`、`DecryptMessage`、
  `NeedsRekeying` を並行して実行できます。シーケンスは一意のままで、各メッセージは引き続き 1 度だけ受け入れられ
  ます。`IntentV2` に `SecurityTier` を、`PolicyDecisionV2` に `ResolvedTier` を追加しました（どちらもスキーマで
  省略可能で、空の場合は省略）。これにより、型付きのペイロードを使う Go の統合者がそれらを宣言できます。
- `tools/difffuzz`: `prototype_key_as_key` は `__proto__` を通常のプロパティとして代入していました。これはキーを
  追加するのではなくプロトタイプを設定するため、これらの変異体は名乗っているキーを一度も持たず（循環によって実行が
  クラッシュすることもありました）、今は自身のキーとして定義します。起動できないシムや判定の合間に終了したシムは、
  未処理のエラーではなくクラッシュとして報告します。`spec/VERIFICATION.md` は Rust の bundle ビルダーの名前を
  正しく記すようになりました（`wasm_build_bundle`、`wasm` 機能のみ）。
- Go SDK: `SignBundleV2` は `signed_bundle.schema.json` が禁じている空の `signature.signer.id` のままに
  していたため、4 つの SDK の検証者は受け入れるのに、リファレンスの検証者、CLI、サーバーはそれが署名したすべての
  bundle を拒否していました（`tools/interop-matrix` が発見）。署名者は今では bundle の責任を負うプリンシパル
  （`signer.id` = RPR の `human_id`）で、RPR に `human_id` のない bundle は署名前に拒否されます。
- A2A セッション（TypeScript、Python、Go）: `decryptMessage` / `decrypt_message` / `DecryptMessage` は、受信
  ウィンドウ内で受け入れたシーケンスを保持し、順序が入れ替わっていても各シーケンスを 1 度だけ受け入れます。
  負でない整数でないシーケンスは拒否し、シーケンスは認証タグを検証した後にだけ記録します。受信カウンターより
  ウィンドウ 1 つ分以上先にあるシーケンスは拒否します（DCP-04 §8.4）。新しいフィールドなしで復元された
  セッション（TypeScript の `undefined`、Go の `nil`、Python の `None`、コンストラクターの既定値）は、受信
  カウンターより下にあるウィンドウ内のすべてのシーケンスを受信済みとみなします。`verifyResumeProof`
  （TypeScript）は、Python と Go がすでにそうしていたように、定数時間で比較します。Go のセッションは並行利用に
  対して安全でないことを文書に記しました。

- Rust SDK: `serde_json` に `float_roundtrip` を有効にしました。その高速な浮動小数点のパーサーは長い 10 進
  リテラルで 1 ULP ずれるため、`9007199254740991.0`（`dcp-jcs-v1` は他のすべての SDK と同じく整数
  9007199254740991 として読む）が 9007199254740990 になり、`2251799813685247.0` が整数でなくなっていました。
  その結果、Rust の検証者は、TypeScript、Python、Go の検証者が受け入れる署名や制限を拒否していました。共有
  ベクターは `limits_written_in_decimal_form` です。
- `@dcp-ai/wasm`: npm パッケージに `pkg/`（`.wasm` バイナリとそのグルーコード）を含めるようにしました。
  wasm-pack は `pkg/.gitignore` = `*` を書き出し、npm は入れ子の `.gitignore` ファイルに従うため、
  `@dcp-ai/wasm@2.0.0` は `pkg/` なしで公開され、実行時の `../pkg/dcp_ai.js` のインポートが失敗していました。
  ビルドはそのファイルを削除し、テストスイートが tarball を確認します。
- `@dcp-ai/sdk`: 同梱するテレメトリーのバージョンを、ビルドスクリプト内のリテラルではなく、ビルド時に
  `package.json` から読む（`tsup.config.ts`）ようにしました。2.2.0 は自らを 2.1.2 と報告するところでした。
- Python の `verify_signed_bundle_v2` は、`composite_sig` のない成果物を
  `Malformed signed bundle: KeyError('composite_sig')` と報告していました。今は他の SDK と同じく、エラーが
  成果物を示します（`intent: Missing composite signature`）。
- TypeScript の `verifySignedBundleV2` は、構造的に不正な形式の署名済み bundle に対して、例外を投げる代わりに
  失敗の判定（`Malformed signed bundle: ...`）を返します。対象は、欠けている、`null`、またはオブジェクトでない
  `bundle`、`signature`、`manifest`、`audit_entries`、`null` の監査エントリー、正規化するオブジェクト内の整数で
  ない数値（`0.5`、`1e400`）です（`spec/VERIFICATION.md` V2-3、V2-5）。Python、Go、Rust の検証者はすでにこれらを
  拒否していました。`tools/difffuzz` が発見しました。
- Go の V1 の `VerifyObject` は、デコードして 32 バイトにならない公開鍵でパニックしていました（`ed25519.Verify`
  はそれ以外の長さでパニックする）。今はデコード後の長さを確認し、代わりにエラーを返します。
  `VerifySignedBundle` はその周りの動作を保ちます。公開鍵が空なら署名に埋め込まれた鍵を使い、両方ともなければ
  `missing public key` になり、`VerifyObject` のエラーは `SIGNATURE INVALID` として報告します。
- TypeScript の CBOR デコーダー（`sdks/typescript/src/wire/cbor.ts`、省略可能）は、重複したマップのキー、不正な
  UTF-8、安全な整数の範囲外の整数と長さを拒否します。U+FEFF はテキストのデータとして保持し、`__proto__` の
  キーはセッターを呼び出すのではなく自身のプロパティとして定義し、エンコーダーは孤立したサロゲートを置き換える
  のではなく拒否します。これはデコーダーの入力処理を強化するもので、完全な正規 CBOR デコーダーではなく、正規化
  プロファイルを追加するものでもありません。

<a id="documentation"></a>

### ドキュメント

- `docs/QUICKSTART_CREWAI.md`: どちらの例も動いていませんでした。V1 の例は Python SDK にない `build_bundle` を
  インポートし、`intent_hash` と `prev_hash` にハッシュを入れるべきところに署名を書いていました。V2 の例は一度も
  公開されていない API を使い、`dcp_ai.v2` が（2.9.0 から）同梱しているにもかかわらず、Python SDK には V2 の
  bundle のビルダー、署名者、検証者がないと書いていました。今は両方とも SDK を実際のとおりに使います。ツールの
  実行前にポリシーのゲートが判断し、検索クエリは記録に含めず、ツール呼び出しごとに専用の bundle を封印し、検証で
  オペレーターを固定します（V1 ではその公開鍵、V2 では `hybrid_required` のもとでその RPR のハッシュと kid、
  そして各 kid がその鍵から導出されていること。bundle 自身の鍵では bundle が自己整合していることしか分からない
  ため）。bundle は Python と `dcp verify-bundle` で、V2 のものはさらに TypeScript、Go、Rust の SDK でも検証
  できます。ガイドは CrewAI のドキュメントどおり `crewai.tools` から `tool` をインポートし、
  `npm create @dcp-ai/crewai` のひな形を、実際そうであるようにプレースホルダーを使った手順として説明します。
- `integrations/crewai/README.md`: 例は、スキーマが拒否する値（`liability_mode: "full"`、能力 `write_file`）を
  持つ V1 のペイロードを使い、監査エントリーにはない `action_type` フィールドを出力していました。今は動作します。
  README には、`DCPCrewAgent` と `DCPCrew` が署名のない記録を保持し、CrewAI を実行しないことを記し、
  `session_nonce` のパラメーターを列挙しました。
- 英語と、es、zh-CN、ja、pt-BR の翻訳のドキュメントを最新にしました。すべての SDK の README における委任
  チェーン、A2A の受信ウィンドウ、Testing & Assurance（相互運用性マトリクス、差分ファザー、共有ベクター）、
  訂正した事実（Go 1.25、Rust の FIPS クレート、スキーマ外のフィールドを使っていた TypeScript の DCP-09 の例）、
  翻訳に欠けていた README の行です。
- `docs/EU_AI_ACT_MAPPING.md`: 規則（EU）2026/1744 で改正された規則（EU）2024/1689（EU AI 法）のロギング、人間に
  よる監督、記録の保持、説明、インシデントの証拠に関する義務を、DCP-AI の成果物がどう支えるか。適用の
  スケジュール、実装者向けのチェックリスト、DCP が扱わない空白を含みます。条文は 2026 年 10 月 22 日に EUR-Lex で
  確認しました。
- `spec/DCP-09.md` §3.5 は、実際のワイヤー上のフィールドに基づいて再委任を規定し、チェーンの検証について規範的な
  規則を定めるようになりました。§2、§10.3、§10.6 は `DCP-AI.v2.SubMandate` コンテキストを列挙します。
  `spec/DCP-AI-v2.0.md` §4.1 はコンテキストタグ `DCP-AI.v2.Delegation` と `DCP-AI.v2.SubMandate` を列挙し、
  §14.2 は、委任チェーンの実効的な階層が階層を引き上げることしかできない入力であると述べています。


## [2.10.0] - 2026-10-22

<a id="package-versions"></a>

### パッケージのバージョン

- `dcp-ai`（PyPI）2.8.2 → 2.9.0: pqcrypto 1.x、FIPS 205 の SLH-DSA、ML-KEM-768、V2 の bundle と V2 の
  検証者。`blind_rpr`（`pii_salt` が必要）と `pqcrypto<1.0` のインストールについては互換性のない変更です。
- `@dcp-ai/sdk`（npm）2.1.2 → 2.2.0: `verifySignedBundleV2` のセキュリティ修正、セキュリティ階層の強制、
  ブラインド化された RPR のエクスポート。`blindRpr`（`pii_salt` が必要）については互換性のない変更です。
- `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` v2.9.0 → v2.10.0: V2 の検証者の強化と階層の強制。
  `BundleBuildInput`（署名済みの成果物）と `BlindRPR` については互換性のない変更です。
- `dcp-ai`（crates.io）2.9.0 → 2.10.0: ネイティブの V2 検証者、階層の強制、RFC 3339 による有効期限の解析。
  `blind_rpr` と `wasm` の bundle ビルダーについては互換性のない変更です。
- `@dcp-ai/wasm` 2.0.0 → 2.1.0: `buildBundle` は署名済みの成果物を受け取り、`verifyBundle` は完全な検証者
  ポリシーを受け取ります。
- `@dcp-ai/openclaw` 2.0.0 → 2.1.0: セキュリティ階層の下限と、署名済みの RPR の `pii_salt`。
- 変更なし: `@dcp-ai/cli` 2.0.0 とその他のインテグレーションのパッケージ。

<a id="security-1"></a>
<a id="security_1"></a>

### セキュリティ

- ブラインド化された RPR のコミットメントに、4 つの SDK すべてでソルトを付けました。`pii_hash` は
  `sha256(canonical({ contact, legal_name }))` だったため、プリンシパルの名前と連絡先を推測した者は誰でも、
  公開済みのブラインド化された RPR でその推測を確認でき、不変のログやアンカー上ではそれが永遠に変わりません
  でした。完全な RPR は今では `pii_salt`（CSPRNG による 32 バイト、小文字の 16 進）を持ち、これは RPR とともに
  署名され、決して公開されません。`pii_hash` は
  `sha256(canonical({ contact, legal_name, pii_salt }))` です。完全な RPR を、それとともにソルトを削除すると、
  公開されたコミットメントは開けなくなります（`spec/DCP-AI-v2.0.md` §12.1）。`contact` や `legal_name` がない
  場合は、すべての SDK で `null` としてハッシュされます。TypeScript は以前はキーを省いていました。
  `tests/interop/v2/interop_vectors.json` の新しいカテゴリー `blinded_rpr`（ソルト付きと従来の `pii_hash`、期待
  されるブラインド化された記録）は 4 つの SDK のテストスイートすべてで実行され、`generate-interop-vectors.ts`
  がこれを出力します。
- ブラインド化された RPR の検証（`verifyBlindedRpr`、`verify_blinded_rpr`、`VerifyBlindedRPR`）は、4 つの SDK
  すべてで `session_nonce` と `binding_keys` も比較するようになりました。以前は、バインディング鍵やセッション
  nonce が異なる完全な RPR でも、ブラインド化された記録と一致していました。Go では、JSON からデコードした
  リストのフィールドが、`[]string` として作った同じリストと一致しないことはなくなりました。
- 検証サーバー: `POST /v2/passport/register` はパスポートの複合自己署名を検証し、その署名者の鍵だけを
  登録します。`agent_id` を再登録するには、そのすべての有効な鍵で署名された、より新しいパスポートが必要です。
  以前は誰でも、自分の鍵でエージェントを再登録し、自分の緊急トークンを仕込んで、緊急失効させることができました。
  `POST /v2/keys/rotate` は所持証明と古い鍵による認可（`verifyKeyRotation`）を検証し、
  `POST /v2/multi-party/authorize` は各当事者の署名を登録済みの鍵で検証し、各当事者を 1 回だけ数えます。
- 検証サーバー: `/v2/policy/mode`、`/v2/governance/register`、`/v2/advisory/publish`、
  `/v2/advisory/auto-apply` は `Authorization: Bearer $OPERATOR_TOKEN` を必要とします（未設定の場合はロック）。
  勧告はスキーマで検証され、上限は 1000 件です。レート制限は、クライアントが提供する `X-Forwarded-For` ではなく
  ソケットのアドレスをキーとし（プロキシの背後では `TRUST_PROXY=true`）、`VERIFIER_MODE` /
  `ALLOW_V1_BUNDLES` は環境から読みます。`allow_v1_bundles` が適用されるようになりました。
- 失効サービス: エージェントは署名済みのパスポートで登録し（`POST /v2/register`）、kid の所有、鍵の有効期限、
  緊急トークンが記録されます。再登録には、エージェントの有効な古典と PQ の鍵で署名された、より新しい
  パスポートが必要で、`/revoke` と `/v2/revoke` はその有効な鍵で署名されていなければなりません。
  `GET /v2/check/kid/:kid` は、`?agent_id=` なしで、登録済みの kid の緊急失効を報告します。
- アンカーサービス: ランダムな `tx_hash` はなくなり（記録は `tx_hash: null`、`onchain: false` を持つ）、本文は
  1 MB に制限され、`POST /flush` にはオペレーターのトークンが必要で、不正な形式の入力はクラッシュではなく 400 に
  なります。透明性ログ: ツリーヘッドは、他の誰も検証できない HMAC ではなく Ed25519 で署名されます。
  `OPERATOR_KEY` は 16 進 64 文字のシードでなければならず（compose の公開されたプレースホルダーは削除）、
  Merkle 木は RFC 6962 の葉とノードのプレフィックスを使い、`POST /gossip/peers`（SSRF の経路）にはオペレーターの
  トークンが必要です。
- 検証サーバーと失効サービス: 期限切れの鍵は、パスポートの再登録、鍵のローテーションの認可、当事者や失効の
  ための署名ができなくなりました。また、再登録では登録済みの鍵のエントリーを保持するため、新しいパスポートで
  鍵の `expires_at` を延ばすことはできません。
- Fly の設定は、検証と失効のマシンをそれぞれ 1 台ずつ稼働させたままにします。ゼロまでスケールすると、マシンが
  アイドルになるたびにメモリー上のレジストリが消えていました。
- TypeScript SDK: `verifySignedBundleV2` は `spec/VERIFICATION.md` のステップ V2-7 と V2-8 を実装します。
  存在する PQ 署名（`pq_over_classical`）は、どのモードでも検証に成功しなければなりません。
  `hybrid_preferred`（中リスクの既定値）は不正な PQ 署名を警告付きで受け入れ、`classical_only` はそれを無視して
  いました。許容されるのは PQ 署名がない場合（`classical_only` のバインディング）だけで、`hybrid_required` と
  `pq_only` では許容されません。各成果物自身の `composite_sig` も、同じ規則とそのコンテキストタグで検証される
  ようになりました。RPR はその `binding_keys` で、パスポート、意図、ポリシー決定はパスポートの `keys` で検証
  します。以前は `payload_hash` しか確認しなかったため、意図に対するエージェントの偽造署名が `hybrid_required`
  のもとでも検証に成功していました。リファレンスの検証者、`dcp verify-bundle`、サーバーは、次の
  `@dcp-ai/sdk` のリリースでこれを受け取ります。
- TypeScript SDK: `verifySignedBundleV2` は認識できない検証モードに対してフェイルクローズし、モードが
  `classical_only`、`hybrid_preferred`、`hybrid_required`、`pq_only` のいずれでもない検証者ポリシーを拒否します。
- Go（`v2.VerifySignedBundleV2`）と Rust の SDK: 各成果物の `composite_sig` を同じように検証し（V2-8）、
  署名者の鍵を `kid` で探します（V2-6）。bundle の署名者はパスポートの `keys` と RPR の `binding_keys` から
  探します。以前はパスポートの Ed25519 と ML-DSA-65 の鍵をアルゴリズムで選んでいたため、プリンシパルの鍵で
  署名された bundle を拒否し、パスポートに Ed25519 の鍵が 1 つもない bundle を、署名を確認しないまま、警告付きで
  検証済みと報告していました。
- TypeScript、Go、Rust の SDK: すべての複合署名で、すべての検証モードにおいて、古典の枠には Ed25519、PQ の枠には
  ML-DSA-65 または SLH-DSA-192f が入り、その鍵の `alg` が同じでなければなりません。Go はさらに、RPR、
  パスポート、意図、ポリシー決定が null またはオブジェクトでない bundle を拒否します（以前はその成果物の確認を
  すべて飛ばしていました）。TypeScript は、そのような bundle に対して例外を投げる代わりに `verified: false` を
  返します。
- セキュリティ階層（仕様 §14.2）: Go SDK と `@dcp-ai/wasm` のバインディング（`wasm_compute_security_tier`）は、
  意図のスキーマが許さない `payment`/`transfer`、`financial`、`health`、`legal`、`biometric` で照合していたため、
  スキーマ上有効な `initiate_payment`、`financial_data`、`health_data` の意図が、そこでは `routine`、
  TypeScript、Python、Rust の SDK では `elevated` になっていました。今は 4 つの SDK とバインディングが同じ階層を
  計算し、`tests/interop/v2/interop_vectors.json` の新しい `security_tier` ベクターで確認します。
- 検証サーバー: `POST /verify` と `POST /v2/bundle/verify` の `resolved_tier`、および `/v2/bundle/verify` の
  階層の確認は、`intent.security_tier` をそのまま使っていたため、`routine` と宣言したエージェントは自らの階層を
  下げることができ、さらにスキーマが許さないのに意図から `risk_score` を読んでいました。今は §14.2 の規則
  （`lib/security-tier.js`）を使います。`risk_score` は bundle のポリシー決定から読み、`estimated_impact` を
  使い、未知の値は `elevated` とし、明示的な階層は結果を引き上げることしかできません。`/v2/intent/declare` も
  同じ方法で `resolved_tier` を計算します。
- OpenClaw のインテグレーション: `dcp_verify_bundle` と `dcp_log_action` は `intent.security_tier` をそのまま
  使っていたため（`security_tier ?? computeSecurityTier(intent)`）、宣言された階層が計算された階層を下げることが
  でき、ポリシー決定も渡していませんでした。今は明示的な階層は階層を引き上げることしかできません。ポリシー決定も
  渡すため、`@dcp-ai/sdk` がそれを読むようになれば（2.1.2 の次のリリース）`risk_score` が考慮されます。
- リファレンスのサービスに対するサービス拒否（その状態はメモリー上にあり、再起動を越えて残りません）:
  - 検証サーバー: 登録はクライアントごとにレート制限され（`REGISTRATIONS_PER_HOUR`、既定値は 1 時間あたり
    20）、ローテーションではエージェントの直近 4 つの退役した鍵だけを保持し、登録されたパスポートからは
    `created_at` だけを保存します。ローテーションを繰り返す 1 つのエージェントや大量の登録によって 10,000 個の
    鍵のレジストリが埋まり（再起動まで 507）、保存される署名済みパスポートはそれぞれ最大 1 MB を占めることが
    ありました。捨てられた鍵は墓標として失効したまま残り、二度と登録できません。エージェントが生涯に登録できる
    鍵は最大 `MAX_KEYS_PER_AGENT` 個（64）です。ローテーションは上限の確認の前に退役した鍵を捨てるため、満杯の
    レジストリにも収まります。再登録時の鍵ファミリーの確認で、レジストリを 2 乗のオーダーで走査し直すことは
    なくなりました。
  - 透明性ログ: `POST /gossip/exchange` は、固定されたピアが署名した正しい形式のツリーヘッドを、16 KB 以下の
    本文でだけ受け入れ、直近の 100 件の異なるアラートを保持します。そのため、リプレイされたツリーヘッドが古い
    アラートを押し出すことはできません。ポーリングで得たツリーヘッドはピアの固定された鍵で検証できなければ
    ならず、1 回のポーリングで読むのは最大 16 KB で、1 間隔でタイムアウトし、前のポーリングと重なることは
    ありません。以前は、誰でもアラートのリストを 1 MB の文字列で埋めることができ、ピアのツリーヘッドは一度も
    検証されず、応答しないピアに対してはポーリングが積み重なっていました。
  - 失効サービス: `POST /v2/register` はクライアントごとにレート制限され、上限は `MAX_AGENTS`（既定値 10,000）
    で、保存するフィールドも制限されます。そのため、大量の登録や大きすぎる記録によってメモリーを使い果たし、
    すべての失効を消してしまうことはなくなりました。
- 検証サーバーと失効サービス: 新しい `agent_id` の登録にはオペレーターのトークンが必要です。パスポートは
  自己署名されているだけなので、誰でも被害者の `agent_id` を先に自分の鍵とトークンで登録し、その後で緊急失効
  させたり、409 で本物のエージェントを締め出したりできました。再起動のたびに、すべての `agent_id` がこの状態に
  戻っていました。`GET /v2/check/kid/:kid` は、一度も登録していない kid に対して、呼び出し側が `?agent_id=` で
  指定したエージェントの判定ではなく、404（`registered: false`）を返します。
- 検証サーバーと失効サービス: 公開鍵と署名は、ちょうどそのアルゴリズムのサイズの正規の base64 でなければ
  ならず、V2 のスキーマは `public_key_b64` と `sig_b64` を base64 のアルファベットに限定し、長さを制限します。
  寛容なデコーダーは空白を読み飛ばしていたため、900 KB の空白を詰めた ML-DSA の鍵が登録されてそのまま返され、
  空白を詰めた署名が保存されて `/v2/list` で公開されていました。
- TypeScript SDK の `verifySignedBundleV2` はセキュリティ階層を強制します（仕様 §14.3）。ポリシーのモードと、
  署名済みの意図とポリシー決定から計算した階層のモードのうち厳しい方で検証し、それを `details.resolved_tier`
  で報告します。以前は、モードはエージェント自身の `passport.risk_tier` だけから決まっていたため、
  `DEFAULT_VERIFIER_POLICY` のもとでは、`risk_tier: "low"` と宣言したパスポートは、支払いの意図であっても
  `classical_only` になっていました。
- TypeScript SDK: `AdaptiveRateLimiter.check`、`generateSessionExpiry`、`VerificationCache.set` は、未知の
  階層名や `constructor` のようなプロトタイプのキーを `elevated` とみなします。以前は、レートリミッターは
  でっち上げの名前ごとに別のバケットを作り、`generateSessionExpiry` は `constructor` で例外を投げ、キャッシュは
  そうしたエントリーを期限切れにしませんでした。
- OpenClaw のインテグレーション: `dcp_declare_intent` は、意図とポリシー決定に署名して入れる階層を、意図の
  スコアを付ける前に計算していました。今はリスクスコアを渡し、`@dcp-ai/sdk` がそれを読むようになれば（2.1.2 の
  次のリリース）考慮されます。
- Go（`v2.VerifySignedBundleV2`）、Rust（`v2::verify_bundle::verify_signed_bundle_v2` と、`@dcp-ai/wasm` の
  `verifyBundle` の裏にあるバインディング `wasm_verify_signed_bundle_v2`）、Python（`verify_signed_bundle_v2`）
  の検証者は、TypeScript のものと同じくセキュリティ階層を強制します。モードはポリシーのモードと階層のモードの
  うち厳しい方で、bundle の署名と各成果物の署名に適用されます。未知のポリシーのモードはフェイルクローズし、結果は
  階層とモードを報告します。Go と Rust の検証者には検証者ポリシーがなく、どの意図に対しても `classical_only` の
  署名を受け入れていました。
- Python SDK の `verify_signed_bundle_v2`: TypeScript、Go、Rust の SDK と同じく、すべての複合署名で、すべての
  モードにおいて、古典の枠には Ed25519、PQ の枠には ML-DSA-65 または SLH-DSA-192f が入り、その鍵の `alg` が
  同じでなければなりません。以前は `pq_only` のもとで、古典の枠の ML-DSA-65 を受け入れていました。
- Go と Rust の SDK: 複合署名は `pq` メンバーを持たなければならず、`classical_only` の場合は `null` です
  （`schemas/v2/composite_signature.schema.json`）。以前は、`pq` がない場合を `null` と同じようにデコードし、
  TypeScript と Python の検証者が拒否するそのような `classical_only` の署名を検証に通していました。
  `bundle_vectors.json` が `classical_only_bundle_signature_without_pq` でこれを固定します。
- Go と Rust の V2 検証者は、TypeScript と Python のものと同じく、監査証跡を署名済みのマニフェストに結び付け
  ます。`audit_merkle_root` を再計算し、`audit_count` を確認し、チェーンが `GENESIS` から始まることを求めます。
  以前は、正しく署名された bundle の監査エントリーを、でっち上げた自己整合的なチェーンに置き換えても、両方とも
  検証済みと報告していました。
- Go と Rust の V2 検証者は、マニフェストの確認を実行できない場合にフェイルクローズします。`rpr_hash` のような
  成果物のハッシュがない場合や、ペイロードがない、または正規化できない場合は、確認を飛ばすのではなくエラーに
  なります。
- Go と Rust の V2 検証者は、TypeScript と Python のものと同じく、各成果物の `payload_hash` をそのペイロードと
  照合します。以前は無視していました。
- Go と Rust の V2 検証者は、`manifest.session_expires_at` を過ぎた bundle を拒否するため、期限切れの
  セッションをそれらに対してリプレイすることはできなくなりました。`SystemTime::now()` は
  `wasm32-unknown-unknown` でパニックするため、`@dcp-ai/wasm` の検証者は JavaScript から時計を読みます。
- Rust SDK: `is_session_expired` は RFC 3339 の文字列を UTC の時計と辞書順で比較していたため、オフセット付きの
  タイムスタンプを最大 14 時間誤って判断していました。`-05:00` で書かれた 1 時間後に終わるセッションは期限切れと
  され、`+05:00` で書かれた 1 時間前に終わったセッションはまだ有効とされていました。今はタイムスタンプを解析し
  （`parse_rfc3339_millis`）、時点を比較します。セッションと鍵の有効期限、勧告のヘルパーで適用します。
- 4 つの検証者すべてにおける有効期限のタイムスタンプ: 存在するのに `Z` または `±hh:mm` のオフセットを持つ
  RFC 3339 のタイムスタンプでない `session_expires_at` や鍵の `expires_at` は拒否されます。存在しない場合や
  `null` は、引き続き有効期限なしを意味します。TypeScript は、`Date` が解析できないもの（`"n/a"`）や寛容に解析
  するもの（`"2099-12-31"`）を何でも受け入れ、空の `session_expires_at` を飛ばしていました。Rust は `"n/a"` を
  受け入れ、Go は文字列でない鍵の `expires_at` を飛ばし、Python は例外を投げていました。`isSessionExpired` と
  `is_session_expired` は、不正な形式の値を期限切れとみなします。
- 鍵の有効性の確認は、署名できるすべての鍵を対象とします。4 つの検証者すべてが、RPR に署名し、bundle にも
  署名しうる、プリンシパルの RPR の `binding_keys` にある失効または期限切れの鍵を拒否します。TypeScript と
  Python はパスポートの鍵しか確認していませんでした。Go と Rust の検証者は鍵の状態をまったく確認しておらず、
  今はパスポートの失効または期限切れの鍵も拒否します。
- 4 つの検証者すべてが、`revoked` と同じく、`status` が `expired` の鍵を拒否します。鍵エントリーのスキーマは
  `expired` を許していますが、確認していたのは `revoked` だけだったため、`expires_at` のない期限切れと印を
  付けた鍵が署名を続けていました。
- 空の監査証跡は、`sha256:` の後に 64 個のゼロが続く Merkle ルートを持たなければなりません。Go と Rust の
  ビルダーはすでにそう書いていました。4 つの検証者すべてが、bundle に監査エントリーがないときに
  `audit_merkle_root` を飛ばしていたため、そこにはどんな値でも入れることができました。

<a id="changed-breaking"></a>

### 変更（互換性のない変更）

- 検証サーバー（`POST /v2/passport/register`）と失効サービス（`POST /v2/register`）: 新しい `agent_id` には
  `Authorization: Bearer $OPERATOR_TOKEN` が必要です（なければ 401）。再登録は引き続きセルフサービスです。
  失効サービスの `GET /v2/check/kid/:kid` は `?agent_id=` を無視し、登録されていない kid には 404 を返します。
- 検証サーバー: エージェントが生涯に登録できる鍵は最大 `MAX_KEYS_PER_AGENT` 個（既定値 64）です。それ以降の
  ローテーションは 409 になり、エージェントは新しい `agent_id` を登録する必要があります。
- スキーマ: `key_entry.public_key_b64` と `composite_signature` の `sig_b64` は `^[A-Za-z0-9+/]+={0,2}$` に
  一致しなければならず、長さはそれぞれ 3,456 文字と 66,476 文字までです。
- 透明性ログ: `GOSSIP_PEERS` の各エントリーは `<url>#<base64 Ed25519 public key>` です。鍵が固定されていない
  ピアのツリーヘッドは無視され、`/gossip/exchange` はそれらを拒否します（403）。Docker Compose のログは、鍵が
  設定されて初めてゴシップします（`docker/README.md` を参照）。
- Go SDK: `BundleBuildInput` は署名済みの成果物（`SignedPayload`、`v2.SignPayload` を参照）と
  `[]AuditEventV2` の監査エントリーを受け取ります。`BuildBundleV2` は署名のないペイロードを包んでおり（検証者は
  今ではこれを拒否します、V2-8）、bundle を空の監査エントリーで埋めていました。
- WASM（`wasm_build_bundle`、および `@dcp-ai/wasm` の `buildBundle`）: 各成果物は、生のペイロードではなく、
  `wasm_sign_payload` / `signPayload` による `SignedPayload` です。生のペイロードから作った bundle は成果物の
  署名を持たず、もう検証に成功しません。
- 失効サービス: `POST /v2/register-emergency-token` と `POST /v2/register-key-expiry` を削除し、
  `POST /v2/register` に一本化しました。V1 の `/revoke` にはそこに登録されたエージェントが必要で、登録には
  ハイブリッド（Ed25519 + ML-DSA-65 または SLH-DSA-192f）のパスポートの署名が必要なため、Ed25519 のみの（V1 の）
  エージェントは失効を公開できなくなりました。失効したエージェントを再び失効させることはできません（409）。
- 検証サーバーと失効サービス: `agent_id` の再登録（たとえば緊急失効トークンを置き換えるため）には、登録済みの
  ものより `created_at` が新しく、エージェントのすべての有効な鍵で署名されたパスポートが必要です。トークンのない
  パスポートは登録済みのトークンを保ちます。ある系統（古典または PQ）の有効な鍵をすべて失ったエージェントは
  再登録できません。回復は緊急失効トークンかオペレーターを通じて行います。
- 透明性ログ: RFC 6962 のプレフィックスにより、葉のハッシュ、ルート、包含証明が変わり、STH の `signature` /
  `public_key` は base64 の Ed25519 になりました。`/add` は `sha256:<64 hex>` のハッシュだけを、アンカーの
  `/anchor` は省略可能な `sha256:` プレフィックス付きの 16 進 64 文字だけを受け付けます。
- 検証サーバー: `/v2/keys/rotate` は `authorization_sig` と `timestamp` を必要とします（`KeyRotationRecord`）。
  `dcp rotate-key` と `dcp keys certify` はまだシミュレーションの所持証明を送っており、サーバーは今ではそれを
  拒否します。
- Python SDK: SLH-DSA-192f は、TypeScript、Go、Rust の SDK と同じく、FIPS 205（純粋な SLH-DSA、空の
  コンテキスト）を実装するようになりました。以前は PQClean の標準化前の SPHINCS+ に基づいており、
  `0x00 || 0x00 || message` ではなくメッセージそのものに署名していたため、SLH-DSA の署名はどちらの方向でも SDK 間で
  検証できませんでした。`dcp-ai` 2.8.2 以前の `SlhDsa192fProvider` が作った署名は、もう検証に成功しません。
- Python SDK: 2.8.2 の `<1.0` の上限ではなく `pqcrypto>=1.0,<2` を必要とし、それを ML-DSA-65、SLH-DSA-192f、
  ML-KEM-768 に使います（`pqcrypto` 1.0 は API を変更し、SPHINCS+ を削除しました）。`dcp_ai.providers` は
  `ImportError` を握りつぶさなくなり、PQ の相互運用性テストはプロバイダーがない場合でもスキップされなくなりました。
- Python SDK: `VerifierPolicy` は未知のフィールドを捨てるのではなく拒否し、欠けていたフィールド
  （`allow_classical_fallback_disable`、`warn_classical_only_deprecated`、`advisory_rejected_algs`、
  `require_session_expiry`、`max_session_duration_seconds`、`require_audience_binding`、`verifier_id`）を
  追加しました。以前は `VerifierPolicy(require_audience_binding=True,
  verifier_id=...)` が両方のフィールドを黙って失っていました。`verify_signed_bundle_v2` では、dict のポリシーは
  `VerifierPolicy` として検証され（未知のキーは例外を投げる）、省かれたフィールドには、既定のポリシーの `low` →
  `classical_only` ではなく、モデルの既定値（すべてのリスク階層で `hybrid_required`）が使われます。`default_mode`
  がすべての階層に適用されるのは `risk_overrides=None` の場合だけです。
- 4 つの SDK すべてで、ブラインド化には `pii_salt` が必要です。完全な RPR に `pii_salt` がない、またはそれが小文字の
  16 進 64 文字でない場合、`blindRpr`（TypeScript）と `blind_rpr`（Python、`ValueError`）は例外を投げ、
  `BlindRPR`（Go）と `blind_rpr`（Rust）はエラーを返します。RPR に署名する前に新しいヘルパーで設定してください。
  ソルトなしで署名された RPR は、ブラインド化する前に署名し直す必要があります。
- 4 つの SDK すべてで、ブラインド化された RPR の検証は、`pii_salt` があるのに小文字の 16 進 64 文字の文字列でない
  完全な RPR を拒否します。以前は、別の場所で空または短いソルトでブラインド化された記録が警告なしで検証に成功し、
  一方でソルトのない記録には印が付けられていました。
- ブラインド化された RPR の検証結果: `verify_blinded_rpr`（Python）は新しいキー `warnings` を返し、Go の
  `BlindedRprCheck` には新しいフィールド `Warnings` があります。そのため、結果全体を比較するコードや、
  フィールド名のないリテラルで `BlindedRprCheck` を作るコードは変更が必要です。
- `schemas/v2/responsible_principal_record.schema.json` は `pii_salt` を受け付けます。スキーマは
  `additionalProperties: false` なので、以前のスキーマで検証する検証者はソルトを持つ RPR を拒否します。生成側が
  それを設定し始める前に、検証者を更新してください。
- Rust SDK: `ResponsiblePrincipalRecordV2` に新しい公開フィールド `pii_salt: Option<String>` があるため、構造体
  リテラルではそれを設定する必要があります。
- セキュリティ階層の計算（仕様 §14.2）、すべての SDK: `risk_score` は bundle のポリシー決定から読み、意図からは
  決して読みません（意図のスキーマはそれを許さないため、有効な意図で階層が `standard` になることはありません
  でした）。`estimated_impact` が `medium` なら階層を `standard` に、`high` なら `elevated` に引き上げます。
  `action_type`、`estimated_impact`、`data_classes` の値が欠けている、型が誤っている、または未知の場合は、少なくとも
  `elevated` になります。明示的な `intent.security_tier` は結果を引き上げることしかできません。
  - TypeScript: `computeSecurityTier(intent, policyDecision?)`。
  - Python: `compute_security_tier(intent, policy_decision=None)`。`compute_security_tier({})` は今では
    `elevated` です。LangChain と CrewAI のインテグレーションは、独自のコピーの代わりにこれを使います。
  - Go: `SecurityTierInput` に `EstimatedImpact` と `SecurityTier` を追加し、そのゼロ値（または nil の
    `DataClasses`）は今では `elevated` です。`v2.SecurityTierInputFromPayloads(intent, policyDecision)` は、
    デコードしたペイロードから入力を作ります。
  - Rust: `compute_security_tier(intent, policy_decision: Option<&Value>)`。`wasm_compute_security_tier` と
    `@dcp-ai/wasm` の `computeSecurityTier` は省略可能なポリシー決定を受け取ります。
- セキュリティ階層の計算、すべての SDK とリファレンスサーバー: ポリシー決定の `risk_score` が欠けている、または
  0 から 1000 の整数でない場合は、意図の未知の値と同じく未知とみなされ、階層は少なくとも `elevated` になります。
  以前は、数値でない値は 0 とみなされ、それ以外の数値はそのまま比較されていたため、`-1` は `routine` に、`1e30` は
  `maximum` になっていました（今は `elevated` で、モードは同じ `hybrid_required`）。ポリシー決定がない場合、
  スコアは引き続き 0 です。Go では、`SecurityTierInputFromPayloads` はそのような値に対して `RiskScore` を -1 に
  設定し、`ComputeSecurityTier` は 0..1000 の範囲外の `RiskScore` をすべて未知として扱います。
- TypeScript SDK の `verifySignedBundleV2`: 今は `classical_only` の署名で合格している bundle も、意図が機微な
  場合は拒否されます。対象は、`initiate_payment`、`pii`、`financial_data`、`health_data`、`credentials`、
  `children_data`、`estimated_impact: "high"`、ポリシー決定の `risk_score` が 500 以上、または意図のスキーマ外の
  値です。それらにはハイブリッド（`pq_over_classical`）の署名をしてください。ルートの検証者
  （`lib/verify.js`、`dcp verify-bundle`、サーバー）は、次の `@dcp-ai/sdk` のリリースでこれを受け取ります。
- Go、Rust、Python の検証者は、同じ `classical_only` の bundle を拒否します。Go の `VerifySignedBundleV2` と
  Rust の `verify_signed_bundle_v2` は、ポリシーなしの代わりに TypeScript の `DEFAULT_VERIFIER_POLICY` を適用
  します。`wasm_verify_signed_bundle_v2` は省略可能なポリシーの JSON（`VerifierPolicy`）を受け取り、それがある
  場合は V1 の bundle を拒否します。そのポリシーが既定値と異なってよいのは、`default_mode`、`risk_overrides`、
  フェーズ 3 のフィールド（`advisory_rejected_algs`、`warn_classical_only_deprecated`、
  `allow_classical_fallback_disable`。TypeScript と同じく適用）だけです。それ以外の変更や、Rust の
  `VerifierPolicy` の JSON にある未知のフィールドは、無視されるのではなく検証を失敗させます。
- Python SDK の `verify_signed_bundle_v2`: TypeScript と同じく、bundle の署名に関するエラーと警告は `bundle: `
  で始まり、null またはオブジェクトでない成果物は `<name>: not a SignedPayload object` と報告され、未知の
  ポリシーのモードは、どの署名を確認するよりも前に `Unknown verification mode in verifier policy` で失敗します。

<a id="added-1"></a>
<a id="added_1"></a>

### 追加

- `generatePiiSalt`（TypeScript）、`generate_pii_salt`（Python、Rust）、`GeneratePIISalt`（Go）。4 つの SDK
  すべての RPR の型、`schemas/v2/responsible_principal_record.schema.json`、`api/proto/dcp.proto` が
  `pii_salt` を持ちます。スキーマに null がないため、Python の `ResponsiblePrincipalRecordV2` は、設定されて
  いない `pii_salt` をシリアライズ時に省きます。
- ソルトのない従来のブラインド化された RPR も、非推奨の警告付きで引き続き検証に成功します。
  `verifyBlindedRpr`（TypeScript）、`verify_blinded_rpr`（Python）、`VerifyBlindedRPR`（Go）の結果は
  `warnings` のリストを持ちます。新しい公開フィールドはそれを作ったり分解したりする呼び出し側を壊すため、Rust の
  `BlindedRprCheck` は 2 つのフィールドを保ちます。そこでは、完全な RPR に `pii_salt` がない、または null である
  ことで、従来の記録であることが分かります。
- `@dcp-ai/openclaw`: `dcp_identity_setup` は RPR に `pii_salt` を付けて署名するため、記録は後で署名し直さずに
  ブラインド化できます。
- 失効サービス: `REVOCATION_STATE_PATH` は登録と失効をファイルに保持します（既定はメモリーのみ）。書き込みは
  fsync した JSON の行として追記され、起動時にファイルを再生し、アトミックな名前の変更でコンパクションします。パスに書き込め
  ない場合やファイルが 512 MB を超える場合、サービスは起動を拒否します。Docker Compose のスタックはこれをボリューム
  上に設定します。
- 検証サーバー: `MAX_REGISTERED_KEYS` と `MAX_KEYS_PER_AGENT` が鍵のレジストリの大きさを決めます。
- `effectiveVerificationMode`（TS）、`effective_verification_mode`（Python、Rust）、
  `EffectiveVerificationMode`（Go）: ポリシーのモードと階層のモードのうち厳しい方で、`pq_only` は変わりません
  （仕様 §14.3）。共有ベクターは `security_tier.effective_mode` にあります。
- Go SDK: `v2.VerifySignedBundleV2WithPolicy(registry, json, policy)` と `v2.DefaultVerifierPolicy()`。
  Rust SDK: `verify_signed_bundle_v2_with_policy` と `impl Default for VerifierPolicy`（TypeScript の既定の
  ポリシー）。Go と Rust の `VerifierPolicy` に `schemas/v2/verifier_policy.schema.json` のフェーズ 3 の
  フィールドを追加したため、TypeScript の `DEFAULT_VERIFIER_POLICY` をそのままデコードできます。
  `@dcp-ai/wasm`: `verifyBundle(signedBundle, policy?)` と `VerifierPolicy` 型。Python の結果の `details` に
  `resolved_tier` を追加しました。
- `tests/interop/v2/bundle_vectors.json`: `must_reject_bundles`。低リスクのパスポートからの機微な意図を持つ
  古典のみの bundle で、すべての検証者がすべてのモードで拒否しなければならないものと、モードごとの期待される判定を
  持つ古典のみの routine の対照です。TS、Go、Rust、Python のテストがこれらを実行し、Python は今ではファイル全体を
  実行します。`default_verifier_policy` は TypeScript の `DEFAULT_VERIFIER_POLICY` を持ち、すべての SDK がこれを
  ポリシーとして受け入れなければなりません。
- `tests/interop/v2/bundle_vectors.json`: 誤った `payload_hash`、置き換えられた、または切り詰められた監査
  エントリー、`GENESIS` から始まらない監査チェーン、`rpr_hash` のないマニフェスト、期限切れのセッション、失効
  または期限切れのパスポートの鍵とバインディング鍵に対する拒否のケース。
- `@dcp-ai/wasm`: `npm test` は、ビルドしたパッケージの `verifyBundle` を Node で
  `tests/interop/v2/bundle_vectors.json` に対して実行し、CI がこれを実行します。以前は型チェックしか行わず、Rust の
  wasm32 のテストはコンパイルされるだけだったため、wasm の検証者は CI で一度も実行されていませんでした。
- `tests/interop/v2/interop_vectors.json` の `rfc3339`: オフセットや小数部を持つ RFC 3339 のタイムスタンプが
  表す時点と、すべての検証者が拒否する不正な形式の値です。`bundle_vectors.json` には、不正な形式やオフセット付きの
  有効期限を追加し、その署名済み bundle はオフセット付きで書いた遠い将来の有効期限を持ちます。TypeScript の
  `parseRfc3339`、Python の `parse_rfc3339`、Rust の `parse_rfc3339_millis` が検証者の使うパーサーです。
- TypeScript SDK: `blindRpr`、`verifyBlindedRpr`、`isBlindedRpr`、`computePiiHash` をパッケージのエントリー
  ポイントからエクスポートしました。実装されていたものの、`@dcp-ai/sdk` 2.1.2 以前からは到達できませんでした。
  Python、Go、Rust はすでにエクスポートしていました。
- `lib/verify.js` は `verifyCompositeSig`（導出した kid で署名者の鍵を探す、ペイロードに対する複合署名）とその
  `v2Registry` をエクスポートします。`lib/http.js` には、`server/` と `services/` が共有する本文の解析、
  クライアントの IP、オペレーターのトークンのヘルパーがあります。アンカーと透明性ログのサービスには
  `node:test` のテストスイートがあり、既存のものとともに CI で実行されます。
- Rust SDK: V2 の bundle の検証者を `wasm` 機能から `dcp_ai::v2::verify_bundle::verify_signed_bundle_v2` に
  移したため、ネイティブのビルドと `cargo test` がそれを実行します。`wasm_verify_signed_bundle_v2` はそれに委ねます。
- `tests/interop/v2/bundle_vectors.json`: すべての V2 検証者が受け入れなければならない署名済み bundle と、変異
  （偽造された bundle の PQ 署名、偽造された、または誤って帰属された成果物の署名、誤った枠のアルゴリズム、null や
  オブジェクトでない成果物）。変異の後は、bundle または成果物を示すエラーとともに拒否しなければならず、TypeScript、
  Go、Rust のテストスイートで確認します。`sdks/typescript/src/__tests__/generate-bundle-vectors.ts` で再生成します。
- Go SDK: `v2.SignPayload` は成果物に署名して `SignedPayload` にします。複合署名、または PQ の鍵が与えられない
  場合は古典のみの署名です。
- Python SDK: `MlKem768Provider`（FIPS 203）。他の SDK がすでに持っていた ML-KEM-768 のプリミティブです。
  Python の DCP-04 のハンドシェイクは、X25519 + ML-KEM-768 のハイブリッドの鍵交換をまだ実行しません。
- Python SDK: V2 の bundle。`BundleBuilderV2`、`sign_bundle_v2`、`sign_bundle_v2_classical_only`、
  `verify_signed_bundle_v2`、`DEFAULT_VERIFIER_POLICY`、`PQ_ONLY_VERIFIER_POLICY` は、TypeScript の
  `builder-v2.ts`、`signer-v2.ts`、`verify-v2.ts` を移植したものです。検証者は各成果物の複合署名も確認し
  （VERIFICATION.md V2-8）、存在するのに不正な PQ 署名をどのモードでも拒否し（V2-7）、未知の検証モードに対して
  フェイルクローズします。TypeScript の検証者と違い、bundle の PQ チェックポイントをマニフェストの
  `pq_checkpoints` の ID に結び付け、`max_session_duration_seconds` の確認では、署名されていない
  `signature.created_at` を検証時刻までに制限します。書き換えられた値でこの確認を短くできるのはセッションの残り
  時間までであり、ゼロまでではありません。これを塞ぐには署名されたセッション開始時刻が必要ですが、マニフェストは
  それを持ちません。チェックポイントの内容（V2-12）と `audit_merkle_root_secondary` は、まだ検証されません。
- `tests/nist-kat/ml-kem-768` と `tests/nist-kat/slh-dsa-192f`: NIST の ACVP ベクター（ML-KEM-768 の
  カプセル化解除と鍵の確認、SLH-DSA-SHA2-192f の署名検証）。
- `tests/interop/v2/cross_sdk_vectors.json`: TypeScript と Python の SDK が作成し、互いに相手のものを検証する、
  SLH-DSA-192f、ML-KEM-768、署名済みの V2 bundle のベクター。

<a id="fixed-1"></a>
<a id="fixed_1"></a>

### 修正

- V2 の適合性テストの例（`scripts/generate-v2-examples.js`）は、§12.1 が今では禁じている法的な名前から導出した
  ID ではなく不透明な `human_id` を使い、その RPR は `pii_salt` を持ちます。
- Python SDK: `BundleManifest.pq_checkpoints` は、`schemas/v2/bundle_manifest.schema.json` と同じく
  チェックポイントの ID を持ち、モデルに `session_expires_at` と `intended_verifier` を追加しました。

<a id="documentation-1"></a>
<a id="documentation_1"></a>

### ドキュメント

- `spec/DCP-AI-v2.0.md` §12.1 は、ソルト付きのコミットメント、完全な RPR と一緒にのみ開示される秘密のソルト、
  完全な RPR の削除による消去、個人情報を含んだり個人情報から導出したりしてはならない（MUST NOT）不透明な
  `human_id`、ソルトのないコミットメントの非推奨化を規定します。
- `spec/CANONICALIZATION_PROFILE.md`、`spec/DCP-AI-v2.0.md`、WASM SDK の README（すべての言語）、
  `docs/NIST_CONFORMITY.md`、TypeScript、Python、Rust の正規化処理のコメントは、`dcp-jcs-v1` を、その厳密な
  部分集合や RFC 8785 そのものではなく、RFC 8785 に基づくものとして記述します。規則 1 はキーをコードポイント順に
  並べ、RFC 8785 は UTF-16 のコード単位で並べます。プロファイルは変わりません。
- TypeScript SDK の README（すべての言語）と `docs/API_REFERENCE.md` は、複合署名、bundle、提示、PQ
  チェックポイント、A2A、エラー、緊急失効、鍵の回復、ハッシュ、CBOR の各関数の実際のシグネチャを列挙します。
- `docs/API_REFERENCE.md`: V2 の検証パイプラインに成果物ごとの署名の確認を列挙し、V2-7 と V2-8 に関する既知の
  制限の注記は、今では `@dcp-ai/sdk` 2.1.2 以前にだけ当てはまります。
- Go と WASM の SDK の README（すべての言語）と `docs/MIGRATION_V1_V2.md` は、bundle を作る前に各成果物に
  署名し、パスポートと RPR に署名の鍵を列挙します。
- `spec/DCP-AI-v2.0.md` §14.2 は上記の階層の計算を記述し、§14.3 と §14.4 は `resolved_tier` を情報提供のための
  ものとして記述し（§14.2 はそれを読まない）、`spec/VERIFICATION.md` は §14.2 と同じように階層を計算します。
  SDK の README（すべての言語）、`docs/API_REFERENCE.md`、クイックスタート、移行、エージェント作成のガイド、
  `sdks/wasm/example.html` は、階層の関数にポリシー決定を渡し、意図のスキーマの値を使います。
- `spec/VERIFICATION.md` V2-7 と `spec/DCP-AI-v2.0.md` §7.1 は、検証者がすでにそうしているとおり、存在する
  PQ 署名はどのモードでも検証に成功しなければならないと述べています。`docs/API_REFERENCE.md` は
  `details.resolved_tier` と、階層を考慮した `verifySignedBundleV2` のモードを文書化し、TypeScript SDK の
  README（すべての言語）がそれを説明します。
- `docs/MIGRATION_V1_V2.md` §6.3 は、CLI にない `dcp migrate-check` コマンドや意図の `risk_score` を示さなく
  なり、移行した bundle を `dcp verify-bundle --policy hybrid_required` で検証します。
- `spec/DCP-AI-v2.0.md` §14.3 は、V2 の検証者に対して階層の強制を MUST にします（§20.1）。モードはポリシーの
  モードと階層のモードのうち厳しい方です。`spec/VERIFICATION.md` は、ステップ V2-9 で階層と実効的なモードを
  計算し、ステップ V2-10 でそれを使ってポリシーを適用します。以前、階層の確認はそこで任意でした。
  `docs/OPERATOR_GUIDE.md` と `docs/SECURITY_MODEL.md` は階層を考慮したモードを記述し、Go、Python、Rust、
  WASM の SDK の README（すべての言語）は検証者ポリシーを記述します。
- 仕様の §18（検証パイプライン）、`docs/OPERATOR_GUIDE.md`、移行ガイドのステップ 8 は、検証者が実装している
  とおりに階層の強制を記述します。オペレーターガイドは、最上位の階層が PQ チェックポイントを検証するとは書かなく
  なりました（どの検証者もまだそれを行いません、V2-12）。また、`@dcp-ai/sdk` への依存関係が更新されるまで
  リファレンスサーバーが何を強制するかを記しています。
- `spec/VERIFICATION.md` V2-3、V2-4、V2-13 は、`payload_hash`、フェイルクローズするマニフェストのハッシュ、
  マニフェストに結び付いた監査証跡、セッションの有効期限、RPR の `binding_keys` の有効性という、これらの確認を
  明記しています。`docs/API_REFERENCE.md` は、鍵の有効性のステップにバインディング鍵を列挙します。

## [2.9.0] - 2026-10-21

<a id="package-versions-1"></a>
<a id="package-versions_1"></a>

### パッケージのバージョン

- `dcp-ai`（PyPI）2.8.1 → 2.8.2: 修正のみ。
- `@dcp-ai/sdk`（npm）2.1.1 → 2.1.2: 修正のみ。
- `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` v2.8.1 → v2.9.0: `v2.MarshalCanonical` を追加。
- `dcp-ai`（crates.io）2.8.1 → 2.9.0: OpenTelemetry 0.32。省略可能な `otlp` 機能については互換性のない変更です
  （「変更（互換性のない変更）」を参照）。
- 変更なし: `@dcp-ai/wasm` 2.0.0、`@dcp-ai/cli` 2.0.0、インテグレーションのパッケージ。

<a id="security-2"></a>
<a id="security_2"></a>

### セキュリティ

- リファレンスの検証者（`lib/verify.js`）、`dcp verify-bundle`、検証サーバーは、JSON Schema による検証の後、
  `@dcp-ai/sdk` の `verifySignedBundleV2` に委ねて、規範的な V2 の bundle
  （`schemas/v2/signed_bundle.schema.json`）を検証するようになりました。以前は、どの SDK が作った bundle も
  「Invalid signed bundle format」として拒否され、`dcp verify-bundle` は偽造された bundle に対して
  `V2 BUNDLE STRUCTURE VALID`（終了コード 0）を出力し、サーバーは構造しか確認していませんでした。規範以前の
  エンベロープ（トップレベルの `dcp_version` / `bundle_manifest`）は拒否されます。サーバーは自らが公開する
  `VERIFIER_POLICY`（モード、受け入れるアルゴリズムと勧告で拒否されたアルゴリズム）で検証し、古典の署名者を
  飛ばす `pq_only` モードでは公開鍵の固定を拒否します。
- `dcp sign-bundle --composite` は規範的な `SignedBundleV2` を出力します。ML-DSA-65 の kid は以前、秘密鍵の
  ハッシュから導出されていました。`tools/bundle_sign.js --v2` は削除しました。
- 失効サービス: 1 件の緊急失効で、すべてのエージェントのすべての kid が失効したと報告されることはなくなり
  （`GET /v2/check/kid/:kid` は `?agent_id=` を受け取るようになりました）、不正な形式のパーセントエンコーディングは
  プロセスをクラッシュさせる代わりに 400 を返します。
<a id="changed-breaking-1"></a>
<a id="changed-breaking_1"></a>

### 変更（互換性のない変更）

- `lib/verify.js`（ルートパッケージの `main`）: `verifySignedBundle` は `async` になり、4 番目の引数
  `options`（`{ policy, mode }`）を受け取ります。結果は常に `errors` 配列を持ちます。複合 GitHub Action の
  `verify-bundle`、`bin/dcp.js`、`server/`、`tools/bundle_verify.js` を更新しました。
  `tools/bundle_verify.js` は PQ の公開鍵の引数を受け取らなくなりました。
- Rust SDK の省略可能な `otlp` 機能: OpenTelemetry 0.24 → 0.32。
  - 上流の名前の変更に合わせて、`OtlpHandles.tracer_provider` は `SdkTracerProvider` に、`OtlpHandles.tracer`
    は `SdkTracer` になりました。
  - この機能は `tokio` を取り込まなくなりました。ブリッジは SDK のバックグラウンドスレッドから、ブロッキングの
    `reqwest` クライアントでエクスポートします。
  - `tracer install:` で始まっていたエラーは `trace exporter:` になりました。

<a id="added-2"></a>
<a id="added_2"></a>

### 追加

- Go SDK: `v2.MarshalCanonical(obj)`。整数のみの規則を除いた `dcp-jcs-v1` のエンコーダーです。V1 の
  `Canonicalize` と所持証明のエンコーダーは、今ではこれを使います。

<a id="fixed-2"></a>
<a id="fixed_2"></a>

### 修正

- Go SDK: V2、所持証明、V1 の経路で、正規化が `<`、`>`、`&`、U+2028/U+2029 をエスケープしなくなり、`-0` を
  `0` として出力します（`dcp-jcs-v1` の規則 3 と 4）。
- TypeScript SDK: オブジェクトのキーを、UTF-16 のコード単位ではなく Unicode のコードポイントで並べます（規則 1）。
- Python SDK: `pqcrypto` を 1.0 未満に制限しました。1.0 のリリースで `pqcrypto.sign.ml_dsa_*` モジュールが
  削除されたため、`dcp-ai` 2.8.1 を新たにインストールすると ML-DSA-65 のプロバイダーをインポートできません。
- `tests/interop/v2/interop_vectors.json`: 負のゼロ、HTML の文字、U+2028/U+2029、制御文字のエスケープ、
  Unicode の補助面の文字を含むキーの順序についての境界ケースのベクター。
- `tools/conformance.js`: `edge_cases` のエントリーが何も確認せずに合格することはなくなり、一度も実行されない
  ドメイン分離のブロックを削除し、V2 の署名済み bundle（有効、改ざん、偽造、PQ の剥ぎ取り、鍵の固定、従来形式）を
  リファレンスの検証者で確認します。

<a id="dependencies"></a>

### 依存関係

- Dependabot の未解決のアラート 95 件をすべて解消しました（重大 11 件、高 54 件）。#22 が Dependabot の 15 件の
  PR（#5–#21）に取って代わり、#24 が grpc を更新しました。
- TypeScript SDK、`@dcp-ai/express`、`@dcp-ai/openclaw`（開発用）:
  - vitest と `@vitest/coverage-v8` 4.1.12（同時に更新）。
  - vite 7.3.7（`overrides` で固定）。
  - postcss 8.5.31、nanoid 3.3.20、source-map-js 1.2.2、esbuild 0.28.2、fast-uri 3.1.9。
  - Express の実行時のロックファイル: proxy-addr 2.0.8、qs 6.16.1、body-parser 2.3.0。
- ルートのハーネス: fast-uri 3.1.9 と、新しい依存関係 `@dcp-ai/sdk`。
- Go SDK: `golang.org/x/crypto` v0.55.0、`golang.org/x/net` v0.58.0、`google.golang.org/grpc`
  v1.83.2、`go.opentelemetry.io/otel/*` v1.46.0。
- Rust SDK: opentelemetry、opentelemetry_sdk、opentelemetry-otlp 0.32。`opentelemetry_sdk` 0.32.1 は、W3C
  Baggage の伝播における無制限のメモリー確保を修正します。
- CI:
  - express と openclaw のための新しいインテグレーションテストのジョブ。
  - Rust のジョブは `--features otlp` をビルドしてテストします。
  - Go のジョブはバージョンを `go.mod` から読みます。
  - 生成した V2 の bundle を CLI で検証します。
  - サーバーと失効のテストを実行します。

<a id="documentation-2"></a>
<a id="documentation_2"></a>

### ドキュメント

- `spec/VERIFICATION.md`:
  - V2 のチェックリストは `schemas/v2/signed_bundle.schema.json` を指すようになりました（引用されていた `*_v2` のスキーマは存在したことがありません）。
  - 存在しないバインディング `independent` を削除しました。
  - リファレンス実装の名前を記しました。
- `spec/CANONICALIZATION_PROFILE.md` §3 に、文字列のエスケープとコードポイント順のキーの並びについての行を追加しました。これは規則 1 と 3 を明確にするもので、プロファイルは変わりません。
- サーバー、オペレーター、移行、API リファレンス、CI、bundle のドキュメントは、実際の V2 の検証、実際の CLI の構文、実在する SDK の API を記述するようになりました。
  - 移行ガイドの API の表には、存在しない関数がいくつも載っていました。
  - サーバーの README は規範以前のエンベロープを示していました。
- Python SDK の README（すべての言語）は ML-KEM-768 や V2 の bundle に対応しているとは書かなくなり、CrewAI のクイックスタートは V2 のスニペットを予定の API として明示しています。
- 翻訳とプロジェクトのドキュメント:
  - Agno を含む 11 のインテグレーション。正規化プロファイルと Agno のクイックスタートへのリンク。
  - このリリースの Rust のインストールのスニペットと、Go の `@latest` の固定。
  - `SECURITY.md` のパッケージごとのサポート対象バージョンと、`ROADMAP.md` の v2.8.x と v2.9.0 のリリース。
  - `CITATION.cff` の Zenodo のコンセプト DOI。

## [2.8.1] - 2026-04-26

<a id="wired-the-canonicalization_profile-field-across-the-four-sdks"></a>

### 4 つの SDK すべてで `canonicalization_profile` フィールドを配線

`v2.8.0` は `canonicalization_profile` フィールドを
`schemas/v2/bundle_manifest.schema.json` で宣言し、
`spec/CANONICALIZATION_PROFILE.md` § 4 で説明しましたが、実際にこのフィールドを書いたり読んだりする SDK はありません
でした。型付きの `BundleManifest` 構造はこのフィールドなしで出荷され、検証者はそれを無視していました。`v2.8.1` は
この空白を端から端まで埋めます。

- **TypeScript（`@dcp-ai/sdk` 2.1.0 → 2.1.1）**: `sdks/typescript/src/types/v2.ts` の `BundleManifest`
  インターフェースに
  `canonicalization_profile?: 'dcp-jcs-v1'` を追加しました。`sdks/typescript/src/bundle/builder-v2.ts` の
  `BundleBuilderV2.build()` は、作成するすべてのマニフェストに
  `canonicalization_profile: "dcp-jcs-v1"` を出力するようになりました。
  `sdks/typescript/src/core/verify-v2.ts` の `verifyV2Bundle` は、フィールドがない場合を受け入れ（`dcp-jcs-v1` と
  みなす）、`"dcp-jcs-v1"` を明示的に受け入れ、それ以外の値を
  `"Unknown canonicalization_profile: <value>"` で拒否します。
- **Python（`dcp-ai` 2.8.0 → 2.8.1）**: `sdks/python/dcp_ai/v2/models.py` の `BundleManifest` に
  `canonicalization_profile: Literal["dcp-jcs-v1"] | None = "dcp-jcs-v1"` を追加しました。
  Pydantic が解析時に未知の値の拒否を強制し、フィールドがない場合は既定値が使われます。検証はモデルの中に
  あるため、検証者を別に変更する必要はありません。
- **Go（`sdks/go/v2.8.0` → `v2.8.1`）**: `sdks/go/dcp/v2/types.go` の `BundleManifest` 構造体に、
  `json:"canonicalization_profile,omitempty"` を付けた `CanonicalizationProfile string` を追加しました。
  `sdks/go/dcp/v2/bundle_builder.go` の `BuildBundleV2` は、作成するすべてのマニフェストでこれを
  `"dcp-jcs-v1"` に設定します。`sdks/go/dcp/v2/verify_bundle.go` の `VerifySignedBundleV2` は、マニフェストが
  `"dcp-jcs-v1"` 以外の `canonicalization_profile` の値を持つ bundle を拒否するようになりました。
- **Rust（crates.io の `dcp-ai` 2.8.0 → 2.8.1）**:
  `sdks/rust/src/v2/types.rs` の `BundleManifest` に、
  `#[serde(skip_serializing_if = "Option::is_none")]` を付けた
  `pub canonicalization_profile: Option<String>` を追加しました。`sdks/rust/src/lib.rs` の `wasm_build_bundle`
  は、出力するマニフェストに `"canonicalization_profile":
  "dcp-jcs-v1"` を設定します。

<a id="spec--profile-document"></a>
<a id="spec-profile-document"></a>

### 仕様とプロファイルの文書

- `spec/DCP-AI-v2.0.md` § 9（bundle マニフェスト）は、マニフェストの他のフィールドと並べて
  `canonicalization_profile` を列挙するようになり、フィールドがない場合は `"dcp-jcs-v1"` と同等とみなさなければ
  ならない（MUST）というインラインの注記を付けました。
- `spec/CANONICALIZATION_PROFILE.md` § 2: 規則 6（undefined / null の扱い）を、TypeScript、Python、Go、Rust の
  ホストの値が、オブジェクトの位置と配列の位置の両方で JSON のワイヤーフォーマットにどう対応するかを明示的に
  列挙する、言語横断の表として書き直しました。
- `spec/CANONICALIZATION_PROFILE.md` § 2: 新しい規則 9 は、Unicode の正規化（NFC、NFD、NFKC、NFKD）を明示的に
  範囲外とします。正規化処理は、ホストのパーサーが渡したとおりに文字列をバイト単位で出力し、将来のプロファイル
  （`dcp-jcs-v2` 以降）は正規化の形式を固定してもかまいません（MAY）。アプリケーション層での正規化の慣例的な選択
  （NFC）として RFC 8259 § 8.1 を参照しています。
- `spec/CANONICALIZATION_PROFILE.md` の規則 9 は、`NaN` / `±Infinity` の相互運用性のフィクスチャを提供しない理由も
  定めています。これらの値は RFC 8259 のワイヤーフォーマットの一部ではないため、ほとんどのパーサーは正規化処理に
  届く前にそれらを拒否します。拒否は、共有のフィクスチャではなく、SDK ごとのユニットテストで確認します。

<a id="behavioural-compatibility"></a>

### 動作の互換性

新しいフィールドは**追加的で、シリアライズにおいて省略可能**です。

- `v2.8.1` が作成した bundle は、マニフェストに `canonicalization_profile:
  "dcp-jcs-v1"` を持ちます。このフィールドを知らない古い検証者は、それを未知のプロパティとして扱いますが、
  JSON Schema がこのフィールドを `additionalProperties` と両立するものとして宣言している（`properties` の中に
  あり、`optional` である）ため、問題ありません。
- `v2.8.0` 以前が作成した bundle には `canonicalization_profile` フィールドがありません。`v2.8.1` の検証者は
  それを受け入れます。`spec/CANONICALIZATION_PROFILE.md` § 4 によれば、フィールドがない場合は `"dcp-jcs-v1"` と
  同等とみなさなければなりません（MUST）。
- 未知の値（たとえば `"dcp-jcs-v2"`）の `canonicalization_profile` を持つ bundle は、`v2.8.1` のすべての SDK が
  拒否します。これは将来のプロファイルに向けた前方互換性のための仕掛けです。新しいプロファイルに更新されていない
  検証者は、検証できないマニフェストを黙って受け入れるのではなく、それを拒否しなければなりません（MUST）。

bundle レベルの署名は `canonical(manifest)` を対象とするため、このフィールドを追加すると、新たに作成した bundle の
マニフェストのハッシュは、`v2.8.0` のもとで作成した場合とは変わります。`v2.8.0` 以前で作成した bundle と、その
保存済みの署名は、`v2.8.1` の検証者のもとでも引き続き有効です。

<a id="versions-bumped"></a>

### 更新したバージョン

- `dcp-ai`（PyPI）2.8.0 → 2.8.1
- `dcp-ai`（crates.io）2.8.0 → 2.8.1
- `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` v2.8.0 → v2.8.1
- `@dcp-ai/sdk`（npm）2.1.0 → 2.1.1: 2.1.0 以来の最初の TypeScript のコード変更
  （2.8.0 のリリースは docstring の編集のみでした）

## [2.8.0] - 2026-04-26

<a id="added--canonicalization-profile-dcp-jcs-v1"></a>
<a id="added-canonicalization-profile-dcp-jcs-v1"></a>

### 追加 — 正規化プロファイル `dcp-jcs-v1`

別のプロトコルとの公開の比較によって、4 つの SDK の JSON の正規化に 3 つの実際の非対称性があることが明らかに
なりました。`1.0`/`1.00` は Python と Rust では拒否され、TypeScript と Go では受け入れられていました。
`1e2` は Rust だけが拒否していました。`undefined` には仕様上の正式な扱いがありませんでした。
`spec/DCP-AI-v2.0.md` § 15 の「RFC 8785 + 整数のみ」という要約は、その範囲では正しかったものの、JCS が実装に
委ねている場合を固定していませんでした。このリリースはそれらをすべて解消します。

- **新しい規範的な文書**: [`spec/CANONICALIZATION_PROFILE.md`](spec/CANONICALIZATION_PROFILE.md)
  は、番号付きの 8 つの規則、22 の入力を扱う境界ケースの受け入れ表、TypeScript だけの非対称性（オブジェクトでは
  省略し、配列では `null` としてシリアライズ）を文書化した undefined の扱いの取り決め、将来のプロファイルの
  ためのバージョン管理の方針によって、プロファイル `dcp-jcs-v1` を形式化します。
- **bundle マニフェストのフィールド**: `canonicalization_profile: "dcp-jcs-v1"` を
  `schemas/v2/bundle_manifest.schema.json` に省略可能なフィールドとして追加しました。このフィールドのない
  bundle を受け取った検証者は `dcp-jcs-v1` とみなさなければなりません（MUST）。将来のプロファイルでは、この
  フィールドは必須になります。
- **Python（`dcp-ai` 2.7.1 → 2.8.0）**: `assert_no_floats` は、値が有限の整数である浮動小数点数（`1.0`、`1e2`、
  `1.00`）を受け入れるようになりました。それらは `json.dumps` の前に整数の形に正規化されます。整数でない浮動
  小数点数（`0.1`）、`NaN`、無限大は引き続き拒否されます。
- **Rust（`dcp-ai` 2.7.0 → 2.8.0）**: `assert_no_floats` は、`fract()` がゼロである `Number(f64)` を受け入れる
  ようになりました。`canonical_recurse` の新しいヘルパー `format_number` は、整数値の浮動小数点数を小数点も指数も
  なしで出力し、他の SDK とバイト単位で一致させます。
- **Go（`sdks/go/v2.7.0` → `v2.8.0`）**: 動作はすでにそろっていました（`v != math.Trunc(v)` の確認）。
  バージョンの更新のみです。
- **TypeScript（`@dcp-ai/sdk` は 2.1.0 のまま）**: 動作はすでにそろっていました。
  `sdks/typescript/src/core/canonicalize.ts` の docstring で、undefined と null の非対称性を形式化しました。

<a id="added--interop-edge-case-fixtures"></a>
<a id="added-interop-edge-case-fixtures"></a>

### 追加 — 境界ケースの相互運用性フィクスチャ

`tests/interop/v2/interop_vectors.json` に `canonicalization.edge_cases` を追加しました。14 個のベクターで、null
の保持（キー付き、配列内）、整数値の浮動小数点数、末尾のゼロ、指数表記、小数の拒否、有限でない値の拒否、
コードポイントによるキーの並べ替え（`é` を含む）、入れ子の null、空のコンテナー、深く入れ子になったオブジェクト、
null を含む配列を扱います。各 SDK の相互運用性テストは同じブロックを読み込み、すべてのベクターについてバイト単位で
同一の出力（または一致するエラー）を確認します。CI はすべての PR で 4 つを並行して実行し、相違があればリリースを
止めます。

<a id="versions-bumped-1"></a>
<a id="versions-bumped_1"></a>

### 更新したバージョン

- `dcp-ai`（PyPI）2.7.1 → 2.8.0
- `dcp-ai`（crates.io）2.7.0 → 2.8.0
- `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` → v2.8.0
- `@dcp-ai/sdk`（npm）は 2.1.0 のまま: TypeScript はすでにこのプロファイルを実装しており、このリリースでは
  docstring による形式化だけを追加します。

<a id="behavioural-compatibility-1"></a>
<a id="behavioural-compatibility_1"></a>

### 動作の互換性

以前のリリースで作成した bundle は引き続き有効です。以前 `1.0`/`1.00`/`1e2` を拒否していた SDK にとって、この
変更は**追加的**です。以前は `TypeError`/`Err` を投げていた入力が成功するようになり、他の SDK がすでに作成していた
のと同じ正規の出力を作ります。以前に正規化に成功していた入力が、2.8.0 で異なる形に正規化されることはありません。

<a id="271---2026-04-23-python-only"></a>
<a id="271-2026-04-23-python-only"></a>

## [2.7.1] - 2026-04-23（Python のみ）

<a id="fixed-3"></a>
<a id="fixed_3"></a>

### 修正

- `dcp-ai`（PyPI）2.7.0 には、必須の依存関係として `cryptography` が欠けていました。このパッケージは、2.5.0 で
  導入された DCP-04 の A2A セッション層が AES-256-GCM の暗号化のために必要とします。`pip install dcp-ai==2.7.0`
  による新規のインストールでは `cryptography` が入らず、クリーンな環境で A2A セッションの 3 つのテスト
  （`test_encrypt_decrypt_round_trip`、`test_tamper_ciphertext_rejected`、`test_session_id_mismatch`）が失敗して
  いました。2.7.1 は wheel の必須の依存関係に `cryptography>=41.0` を追加します。

Rust（crates.io の `dcp-ai`）と Go（`sdks/go/v2`）は影響を受けず、2.7.0 のままです。Python の `cryptography`
パッケージが関係するのは Python の wheel だけです。

## [2.7.0] - 2026-04-23

<a id="added--canonical-error-codes--wire-format-detection-in-py--go--rs"></a>
<a id="added-canonical-error-codes-wire-format-detection-in-py-go-rs"></a>

### 追加 — PY / GO / RS における正規のエラーコードとワイヤーフォーマットの判定

`DcpErrorCode` 列挙型と、それに付随する `DcpError` / `DcpProtocolError` の仕組みを、TS から Python、Rust、Go に
移植し、さらに、入ってくるバイト列を先頭のバイトに基づいて "json" または "cbor" に振り分ける軽量なヘルパー
`detect_wire_format` を移植しました。

**すべての SDK が同じ 38 個の正規のエラーコードで一致するようになりました。** 対象は、スキーマのエラー
（E001-E099）、署名のエラー（E100-E199）、ハッシュとチェーンのエラー（E200-E299）、アイデンティティのエラー
（E300-E399）、ポリシーのエラー（E400-E499）、セッションのエラー（E500-E599）、A2A のエラー（E600-E699）、
レート制限（E700-E799）、内部エラー（E900-E999）です。各コードは正規のメッセージと `retryable` フラグを持つため、
クライアントはポリシーに合った再試行のロジックを SDK 間で一貫して実装できます。

**Python（`dcp-ai` 2.6.0 -> 2.7.0）**: 新しいモジュール `dcp_ai.v2.error_codes`。`DcpErrorCode`（str-enum）、
`DcpError` データクラス、`DcpProtocolError` 例外、`create_dcp_error`、`is_dcp_error`、`detect_wire_format`、
`ERROR_DESCRIPTIONS` の対応表を含みます。

**Rust（`dcp-ai` 2.6.0 -> 2.7.0）**: `dcp_ai::v2::error_codes`。`DcpErrorCode` 列挙型（`Display` → 安定した
識別子 `DCP-E###`）、`DcpError` 構造体、`create_dcp_error`、`detect_wire_format` を含みます。

**Go（`sdks/go/v2.6.0 -> v2.7.0`）**: 37 個の `Err*` 定数を持つ型付き文字列 `v2.DcpErrorCode`、`error`
インターフェースを実装する `v2.DcpError` 構造体、`CreateDcpError`、`IsDcpError`、`DetectWireFormat`。

<a id="cbor-encoderdecoder-scope-decision"></a>

### CBOR エンコーダー/デコーダーの範囲についての決定

完全な CBOR エンコーダー/デコーダーは、2.x では引き続き TypeScript だけのものです。決定的な RFC 8949 の実装を
さらに 3 つの SDK に移植するのは、独自のマイルストーンに値する大きなプロジェクトです。`detect_wire_format` は、
CBOR のペイロードを既存のエコシステムのライブラリ（たとえば Python の `cbor2`、Go の
`github.com/fxamacker/cbor/v2`、Rust の `ciborium`）に振り分けるために、今すべての SDK が必要とする唯一の
ヘルパーです。専用の v3.x のリリースで正規の移植を追加します。

<a id="test-counts"></a>

### テストの件数

- Python: 231/231 合格（変更なし、インポートの範囲を確認）
- Rust: 152/152 合格（新規 +5）
- Go: 115/115 合格（新規 +8）

<a id="versions-bumped-2"></a>
<a id="versions-bumped_2"></a>

### 更新したバージョン

- `dcp-ai`（PyPI）2.6.0 -> 2.7.0
- `dcp-ai`（crates.io）2.6.0 -> 2.7.0
- `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` -> v2.7.0

## [2.6.0] - 2026-04-23

<a id="added--blinded-rpr-multi-party-auth-advisory-helpers-in-rust--go"></a>
<a id="added-blinded-rpr-multi-party-auth-advisory-helpers-in-rust-go"></a>

### 追加 — Rust と Go におけるブラインド化された RPR、マルチパーティの認可、勧告のヘルパー

Python だけにあった 3 つの機能を Rust と Go に移植し、比較で指摘された、Python が TS 以外の他の SDK より先行して
いた差を埋めます。

- **ブラインド化された RPR（Gap #2）**: `compute_pii_hash`、`blind_rpr`、
  `verify_blinded_rpr`、`is_blinded_rpr`。
- **マルチパーティの認可（Gap #5）**: `verify_multi_party_authorization`
  + 4 つの既定の操作ポリシー（`revoke_agent`、`rotate_org_key`、`change_jurisdiction`、
  `modify_recovery_config`）を持つ `MultiPartyPolicy`。
- **アルゴリズム勧告のヘルパー（Gap #4）**: `check_advisory`、
  `evaluate_advisories`、`apply_advisories_to_policy`、
  `build_algorithm_advisory`。

3 つのモジュールはすべて Python の意味に合わせています。個人情報の SHA-256 コミットメント、M-of-N の構造的な
検証（暗号学的な検証はゲートウェイで行う）、猶予期間の扱いを伴うアクション（`revoke` / `deprecate` / `warn`）に
よる振り分けです。

Python（`dcp-ai` 2.5.0 -> 2.6.0）: コードの変更はなく、SDK 一式をそろえるためのバージョンの更新のみです。

<a id="test-counts-1"></a>
<a id="test-counts_1"></a>

### テストの件数

- Rust: 147/147（新規 +14）
- Go: 106/106（新規 +12）
- Python: 231/231（変更なし）

## [2.5.0] - 2026-04-23

<a id="added--dcp-04-agent-to-agent-protocol-parity"></a>
<a id="added-dcp-04-agent-to-agent-protocol-parity"></a>

### 追加 — DCP-04 エージェント間プロトコルの同等性

DCP-04（エージェント間通信）の骨組みを残りの SDK に移植します。

**Python（`dcp-ai` 2.4.0 -> 2.5.0）**: 対称鍵のセッション層（`cryptography` パッケージによる AES-256-GCM）を
含め、TS と完全に同等です。

- 発見: `create_agent_directory`、`find_agent_by_capability`、
  `find_agent_by_id`、`validate_directory_entry`。
- ハンドシェイク: `generate_nonce`、`create_hello`、`create_welcome`、
  `derive_session_id`、`create_close_message`。
- セッション: `A2ASession`、`create_session`、`encrypt_message`、
  `decrypt_message`、`needs_rekeying`、`generate_resume_proof`、
  `verify_resume_proof`、`derive_rekeyed_session_key`。

**Go（`sdks/go/v2.4.0 -> v2.5.0`）**: AES-256-GCM に Go の標準ライブラリの `crypto/aes` + `crypto/cipher` を
使い（新しい依存関係なし）、TS と完全に同等です。

**Rust（`dcp-ai` 2.4.0 -> 2.5.0）**: 発見とハンドシェイクの骨組み。AES-256-GCM のセッション層は後続のリリースで
予定しています。Rust の利用者は、ディレクトリと HELLO/WELCOME のメッセージを作り、セッション ID を導出することは
できます。

テストの件数: Python 231/231、Rust 133/133、Go 94/94。

## [2.4.0] - 2026-04-23

<a id="added--production-hardening-primitives-in-python-rust-go"></a>
<a id="added-production-hardening-primitives-in-python-rust-go"></a>

### 追加 — Python、Rust、Go における本番運用向けの強化プリミティブ

TS のコアから、プロトコルにとって重要な 4 つの強化プリミティブを移植します。

- **セッション nonce** のヘルパー: `generate_session_nonce`、`is_valid_session_nonce`、
  `verify_session_binding`、`generate_session_expiry`、`is_session_expired`。
- **適応型のセキュリティ階層**: `compute_security_tier`、`max_tier`、
  `tier_to_verification_mode`、`tier_to_checkpoint_interval`（Go にはすでに
  `ComputeSecurityTier` があり、v2.4 では 3 つのヘルパー関数を追加）。
- **緊急失効**（Gap #13）: `generate_emergency_revocation_token`、
  `verify_emergency_revocation_secret`、`build_emergency_revocation`。
- **遅延型の PQ チェックポイント**: `audit_events_merkle_root`、`create_pq_checkpoint`、
  および階層に応じた間隔の選択と自動フラッシュの動作を持つ `PQCheckpointManager` クラス。

4 つのモジュールはすべて TS の意味と完全に一致しています。緊急失効のための定数時間での秘密の検証、階層に応じた
チェックポイントの間隔、セッション nonce の検証用の正規表現、`DCP-AI.v2.AuditEvent` のドメイン分離コンテキスト
のもとで署名されたチェックポイントのペイロードです。

<a id="whats-not-in-v24"></a>

### v2.4 に含まれないもの

意図的に範囲外としたもの（需要があれば後続のリリースで提供します）:

- Shamir の秘密分散（Gap #1）: 慎重な暗号のレビューが必要。TS のみ。
- 検証キャッシュ: アプリケーションの関心事であり、プロトコルの関心事ではない。
- レート制限 / サーキットブレーカー / 再試行: 既存のエコシステムのライブラリに委ねるのがよい、アプリケーション
  レベルのパターン。

<a id="test-counts-2"></a>
<a id="test-counts_2"></a>

### テストの件数

- Python: 214/214 合格（新規 +24）
- Rust: 126/126 合格（新規 +10）
- Go: 81/81 合格（新規 +9）

<a id="versions-bumped-3"></a>
<a id="versions-bumped_3"></a>

### 更新したバージョン

- `dcp-ai`（PyPI）2.3.0 -> 2.4.0
- `dcp-ai`（crates.io）2.3.0 -> 2.4.0
- `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` -> v2.4.0

## [2.3.0] - 2026-04-23

<a id="added--dispute--rights--delegation-parity-across-sdks"></a>
<a id="added-dispute-rights-delegation-parity-across-sdks"></a>

### 追加 — SDK 間での紛争、権利、委任の同等性

Python、Rust、Go は、TypeScript の機能群に合わせて、DCP-07（紛争の解決 + 仲裁）、DCP-08（権利と義務）、DCP-09
（委任、認識しきい値、プリンシパルミラー）の動作を実装するようになりました。

**新しい関数群（PY/RS/GO で意味が同一で、TS に一致）:**

DCP-07 の紛争の解決:

- `create_dispute` · `escalate_dispute` · `resolve_dispute` · `create_objection`
- 仲裁: `create_arbitration_panel` · `submit_resolution` ·
  `build_jurisprudence_bundle` · `lookup_precedent`

DCP-08 の権利と義務:

- `declare_rights` · `record_obligation` · `report_violation` ·
  `check_rights_compliance`

DCP-09 の委任と代理:

- 委任: `create_delegation_mandate` · `verify_mandate_validity` ·
  `revoke_delegation` · `generate_interaction_record`
- 認識しきい値: `evaluate_significance` · `should_notify_human` ·
  `create_awareness_threshold` · `create_advisory_declaration`
- プリンシパルミラー: `generate_mirror`

新しいファクトリーはすべて、`DCP-AI.v2.Dispute`、`DCP-AI.v2.Rights`、`DCP-AI.v2.Delegation`、
`DCP-AI.v2.Awareness` のドメイン分離コンテキストのもとで、既存の複合署名の経路を使います。委任マンデートの
成果物は、TS のワイヤーフォーマットに合わせて、人間のプリンシパルの署名を `human_composite_sig` フィールドに
持ちます。

<a id="test-counts-3"></a>
<a id="test-counts_3"></a>

### テストの件数

- Python: 190/190 合格（新規 +21）
- Rust: 116/116 合格（新規 +12）
- Go: 72/72 合格（外側の `dcp_test` パッケージで新規 +12）
- TypeScript: 460/460 合格（変更なし）

<a id="versions-bumped-4"></a>
<a id="versions-bumped_4"></a>

### 更新したバージョン

- `dcp-ai`（PyPI）2.2.0 -> 2.3.0
- `dcp-ai`（crates.io）2.2.0 -> 2.3.0
- `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` -> v2.3.0
- `@dcp-ai/sdk`（npm）は 2.1.0 のまま

## [2.2.0] - 2026-04-23

<a id="added--lifecycle--succession-parity-across-sdks"></a>
<a id="added-lifecycle-succession-parity-across-sdks"></a>

### 追加 — SDK 間でのライフサイクルと承継の同等性

Python、Rust、Go の SDK は、DCP-05（エージェントのライフサイクル）と DCP-06（デジタル承継）の動作を実装するように
なりました。TypeScript は 2.0.x ですでにこれらを提供していました。2.2.0 のリリースは、SDK 間の比較で特定された
最初の動作の同等性の差を埋めます。

**新しい関数（Python/Rust/Go で意味が同一で、TS に一致）:**

DCP-05 エージェントのライフサイクル:

- `validate_state_transition` / `ValidateStateTransition`
- `compute_vitality_score` / `ComputeVitalityScore`
- `create_commissioning_certificate` / `CreateCommissioningCertificate`
- `create_vitality_report` / `CreateVitalityReport`
- `hash_vitality_report` / `HashVitalityReport`
- `create_decommissioning_record` / `CreateDecommissioningRecord`

DCP-06 デジタル承継:

- `create_digital_testament` / `CreateDigitalTestament`
- `update_digital_testament` / `UpdateDigitalTestament`
- `classify_memory` / `ClassifyMemory`
- `create_memory_transfer_manifest` / `CreateMemoryTransferManifest`
- `execute_succession` / `ExecuteSuccession`

新しいファクトリーはすべて、`DCP-AI.v2.Lifecycle` と `DCP-AI.v2.Succession` のドメイン分離コンテキストのもとで
既存の複合署名の経路を使うため、どの SDK が作った成果物もワイヤー上で互換性があり、相互に検証できます。

<a id="test-counts-after-this-release"></a>

### このリリース後のテストの件数

- Python: 169/169 合格（新規 +24）
- Rust: 104/104 合格（新規 +10）
- Go: 60/60 合格（外側の `dcp` パッケージで新規 +13、v2 パッケージは変更なし）
- TypeScript: 460/460 合格（変更なし）

<a id="known-protocol-level-note"></a>

### プロトコルレベルの既知の注記

DCP v2.0 の正規化は、SDK 間の決定性のために浮動小数点数を禁じていますが、バイタリティレポートのスキーマは指標ごとの
値を `number`（0.0..1.0）として表しています。4 つの SDK すべてのファクトリーは API の境界では指標を受け付けるように
なりましたが、署名者はワイヤー上では整数の表現を必要とします。このことは各 SDK のテストに記されています。将来の
リリースでは、この差を完全になくすために、スキーマを整数（またはベーシスポイント）に厳格化する可能性があります。

<a id="versions-bumped-5"></a>
<a id="versions-bumped_5"></a>

### 更新したバージョン

- `dcp-ai`（PyPI）2.1.0 -> 2.2.0
- `dcp-ai`（crates.io）2.1.0 -> 2.2.0
- `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` -> v2.2.0
- `@dcp-ai/sdk`（npm）は 2.1.0 のまま（TS はすでにこれらの関数を持っていました）

<a id="210---2026-04-22"></a>

## [2.1.0] - 2026-04-22

<a id="added-3"></a>
<a id="added_3"></a>

### 追加

**4 つのコア SDK すべてに OpenTelemetry（OTLP）エクスポーターを追加**: TypeScript、Python、**Rust、Go**。採用者は、手作りのブリッジなしで、DCP の可観測性を OTel 互換の任意のバックエンド（Grafana、Jaeger、Honeycomb、Datadog、New Relic、セルフホストの Collector）に送れるようになりました。DCP の暗号処理を行うすべての SDK が、同じメトリクス名、カウンター、スパンの形を報告します。

- **Rust（`dcp-ai` 2.0.0 → 2.1.0）**
    - スレッドセーフな `DcpTelemetry` シングルトン、記録用のメソッド、スパンのライフサイクル、`on_event` のリスナーバス、p50/p95/p99 を持つ `MetricsSummary` を備えた新しいモジュール `dcp_ai::observability`。
    - 省略可能な Cargo の機能 `otlp`（`cargo add dcp-ai --features otlp`）は、`opentelemetry`、`opentelemetry_sdk`、`opentelemetry-otlp`、`tokio` を取り込みます。この機能がない場合、`ExporterType::Otlp` を要求するとパニックせずに明確なエラーイベントを出します。
    - 計測したホットパス: `crypto::sign_object` と `crypto::verify_object` は、有効なときにレイテンシーとエラーのテレメトリーを出します。無効なとき（既定）はオーバーヘッドがありません。
    - 既定で無効な動作、パーセンタイル、スパンのライフサイクル、階層の分布、キャッシュヒット率、リスナーのパニックの隔離を扱う 10 個のユニットテスト。

- **Go（`sdks/go/v2.0.0 → v2.1.0`）**
    - ミューテックスで保護された `Telemetry` 型、`Default()` シングルトン、記録用のメソッド、パニックから回復するサブスクライバー、他の SDK と一致するパーセンタイルの計算を備えた新しいパッケージ `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2/dcp/observability`。
    - OTLP のブリッジはビルドタグ `otlp`（`go build -tags otlp`）で有効になります。タグがない場合、`ExporterOTLP` を要求するとリスナーバスを通じて明確な `otlp_init` のエラーイベントを出します。`go.opentelemetry.io/otel` の依存関係は `go.mod` に記載されていますが、既定のビルドでは実行時に必要ありません。
    - 計測したホットパス: `dcp.SignObject` と `dcp.VerifyObject` は、有効なときにレイテンシーとエラーのテレメトリーを出します。無効なとき（既定）はオーバーヘッドがありません。
    - 可観測性のパッケージの 10 個のユニットテストと、有効と無効の経路を扱う `dcp.SignObject` に対する 2 個のインテグレーションテスト。

- **TypeScript（`@dcp-ai/sdk` 2.0.0 → 2.1.0）**
    - `dcpTelemetry.init({ exporterType: 'otlp' })` が実際に動作するようになりました（設定のフィールドは 2.0.x で宣言されていましたが、配線されていませんでした）。
    - OTel の SDK は**遅延して**インポートされるため、既定のインストールは変わりません。`@opentelemetry/*` パッケージは省略可能な peer 依存関係として宣言されています。ない場合、`init()` はリスナーバスを通じて明確なエラーイベントを出し、アプリケーションは動作を続けます。
    - 保留中のエクスポートを送り出すための新しい `dcpTelemetry.shutdown()`。
    - エンドポイントの解決: 設定の `otlpEndpoint` → 環境変数 `OTEL_EXPORTER_OTLP_ENDPOINT` → `http://localhost:4318`。
    - リソース属性 `service.name` + `service.version` を自動的に設定します。
    - メトリクスの対応: DCP の記録はヒストグラム（`dcp.sign.latency_ms`、`dcp.verify.latency_ms`、`dcp.kem.latency_ms`、`dcp.checkpoint.latency_ms`、`dcp.bundle_verify.latency_ms`）とカウンター（`dcp.signatures.created`、`dcp.signatures.verified`、`dcp.bundles.verified`、`dcp.a2a.sessions`、`dcp.errors`）に対応します。
    - vitest の新しいケースが 2 件。460/460 のテストに合格。

- **Python（`dcp-ai` 2.0.2 → 2.1.0）**
    - TypeScript 版と同じ API を持つ `dcp_telemetry` シングルトンを提供する新しいモジュール `dcp_ai.observability`。スパン、メトリクスの記録（`record_sign_latency`、`record_verify_latency`、`record_kem_latency`、`record_checkpoint_latency`、`record_bundle_verify`、`record_cache_hit/miss`、`record_a2a_*`、`record_error`）、`on_event` のリスナーバス、p50/p95/p99 を持つ `get_metrics_summary` を備えます。
    - エクスポーターのモード: `none`（既定）/ `console` / `otlp`。
    - 新しいインストールの extra: `pip install 'dcp-ai[otlp]'` は `opentelemetry-sdk` + `opentelemetry-exporter-otlp-proto-http` を取り込みます。extra がない場合、`init(exporter_type="otlp")` はクラッシュせずに明確なインストールの案内を表示します。
    - 計測したホットパス: `sign_object` と `verify_object` は、有効なときにレイテンシーとエラーのテレメトリーを出すようになりました。無効なとき（既定）はオーバーヘッドがありません。
    - 公開のエクスポート: `from dcp_ai import dcp_telemetry` が使えます。
    - pytest の新しいケースが 15 件。145/145 のテストに合格。

<a id="documentation-3"></a>
<a id="documentation_3"></a>

### ドキュメント

- コピーして使える 3 つのバックエンドのレシピ（Docker によるローカルの Jaeger、Grafana Cloud の OTLP エンドポイント、Honeycomb）を含む新しい `docs/OBSERVABILITY.md`。

<a id="backward-compatibility"></a>

### 後方互換性

- 4 つの SDK すべてで完全に後方互換です。既定値は変わりません。テレメトリーは無効の状態で出荷され、記録は何もしません。可観測性を望まない採用者はコードを変更する必要がありません。
- semver を同期: `@dcp-ai/sdk`（npm）、`dcp-ai`（PyPI）、`dcp-ai`（crates.io）、`github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2` はすべて 2.1.0 になります。その他の公開可能なパッケージ（CLI、WASM、インテグレーション、create-* のひな形）は現在のバージョンのままです。
- WASM SDK の可観測性は将来のマイナーリリースに延期します。ブラウザーのテレメトリーには異なる転送の要件があります。

<a id="template-packages---2026-04-21"></a>
<a id="template-packages-2026-04-21"></a>

## テンプレートのパッケージ - 2026-04-21

4 つの `npm create @dcp-ai/*` ひな形を初めて公開しました。すべて `v2.0.0` です。

- `@dcp-ai/create-langchain`
- `@dcp-ai/create-crewai`
- `@dcp-ai/create-openai`
- `@dcp-ai/create-express`

使い方: `npm create @dcp-ai/langchain my-app`（または 4 つのいずれか）。各ひな形は、リポジトリの既存の `templates/<name>/` と同じ内容の自己完結したスターターテンプレートと、実行時の依存関係のない 35 行の小さな `bin.js` を含みます。

<a id="infrastructure"></a>

## インフラストラクチャー

- **JSON-LD コンテキスト**を [`https://dcp-ai.org/credentials/v2`](https://dcp-ai.org/credentials/v2) で提供するようになりました（Content-Type `application/ld+json`、CORS `*`、24 h のキャッシュ）。`@dcp-ai/w3c-did` がこれを必要とし、発行されるすべての Verifiable Credential/Presentation を厳格な JSON-LD プロセッサー（Veramo、SpruceID、Trinsic）が参照解決できるようにします。
- 4 つの SDK（TypeScript、Python、Go、Rust）の **Codecov のカバレッジレポート**を、SDK ごとのフラグ付きで集約しました。README にバッジを掲載しています。
- **公開のワークフローを強化**: すべてのジョブ（npm / PyPI / crates.io）が先にレジストリを確認し、マニフェストのバージョンがすでに公開済みであれば、スキップの通知とともに成功で終了します。日常のリリースでジョブが赤くなることはなくなりました。

## Go SDK v2.0.0 - 2026-04-19

`go get` でインストールできる Go SDK の最初のリリースです。以前のモジュールパス（`github.com/dcp-ai/dcp-ai-go`）は存在しないリポジトリを指していたため、外部の利用者はインストールできませんでした。モジュールは今ではこのモノレポ内のサブディレクトリのモジュールとして置かれています。

- **新しいモジュールパス**: `github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2`（メジャーバージョン ≥ 2 では Go が `/v2` の接尾辞を要求する）
- **タグの形式**: `sdks/go/v2.0.0`（マルチモジュールのリポジトリについて Go のモジュールプロキシが要求するとおり、サブディレクトリの接頭辞付き）
- **インストール**: `go get github.com/dcp-ai-protocol/dcp-ai/sdks/go/v2@v2.0.0`

コードは変わりません。書き直したのはモジュールパスと内部のインポートだけです。すべてのテストに引き続き合格します。

## [2.0.2] - 2026-04-18

### Python SDK

- **修正**: `dcp_ai.__version__` は、固定の文字列ではなく `importlib.metadata` を通じて、インストールされたバージョンを動的に反映するようになりました。2.0.1 では、wheel が `2.0.1` であるにもかかわらず、この属性は `"1.0.0"` を報告していました。

<a id="ci--publish-workflows"></a>
<a id="ci-publish-workflows"></a>

### CI / 公開のワークフロー

- すべての公開のジョブ（`publish.yml`、`publish-pypi.yml`、`publish-integrations.yml`）は、マニフェストのバージョンがすでにレジストリにあるかを先に確認し、あればスキップの通知とともに成功で終了するようになりました。以前は、リリースで起動された実行がすでに公開済みのバージョンを再び公開しようとし、Actions タブに 4 つの赤いジョブを残していました。日常のリリースで見た目だけの赤い亡霊が出ることはなくなりました。
- README のインテグレーションの表にあった 2 つの古いパッケージ名を修正しました: `@dcp-ai/a2a` → `@dcp-ai/google-a2a`、`@dcp-ai/mcp` → `@dcp-ai/anthropic-mcp`。
- インテグレーションの表の各行に、npm / PyPI のバージョンを示すライブのバッジを追加しました。

## [2.0.1] - 2026-04-18

### Python SDK

フレームワークとのブリッジをパッケージの中に同梱するようになりました。2.0.1 より前は、それらはリポジトリの
`integrations/<name>/` にあり、pytest の小細工を通じてしか読み込めませんでした。`pip install dcp-ai[fastapi]` を
実行した人は、上流の `fastapi` ライブラリは得られても、`dcp_ai.fastapi` のミドルウェアは得られませんでした。
2.0.1 はこれを修正します。4 つのモジュールは今では `dcp_ai/` の下にあり、公開される wheel に含まれます。

- **追加**: `dcp_ai.fastapi`（ミドルウェア、依存性注入、V2 の構造の確認）
- **追加**: `dcp_ai.langchain`（エージェントのラッパー、コールバック、リスクのスコア付け）
- **追加**: `dcp_ai.openai`（クライアント、ツールのスキーマ、監査証跡のビルダー）
- **追加**: `dcp_ai.crewai`（クルーのエージェント、結合した監査証跡、セッションの一貫性の確認）
- **削除**: `tests/conftest.py` の動的なモジュールローダー（不要になったため）

<a id="installation"></a>

### インストール

```bash
pip install dcp-ai[fastapi]     # brings fastapi + uvicorn
pip install dcp-ai[langchain]   # brings langchain + langchain-core
pip install dcp-ai[openai]      # brings openai
pip install dcp-ai[crewai]      # brings crewai
```

<a id="backward-compatibility-1"></a>
<a id="backward-compatibility_1"></a>

### 後方互換性

2.0.0 のインポートと完全に互換性があります。新しいモジュールは API を追加するだけで、既存の
`from dcp_ai import ...` の呼び出しには影響しません。

## [npm integrations] - 2026-04-18

6 つのフレームワークとのブリッジを、独立した npm パッケージとして初めて公開しました。すべて `v2.0.0` です。

- `@dcp-ai/anthropic-mcp` — Anthropic MCP とのブリッジ
- `@dcp-ai/autogen` — Microsoft AutoGen とのブリッジ
- `@dcp-ai/google-a2a` — Google Agent-to-Agent とのブリッジ
- `@dcp-ai/w3c-did` — W3C DID/VC とのブリッジ
- `@dcp-ai/express` — Express のミドルウェア
- `@dcp-ai/openclaw` — OpenClaw のプラグイン

`@dcp-ai/express` と `@dcp-ai/openclaw` は `@dcp-ai/sdk ^2.0.0` に依存します。

## [2.0.0] - 2026-04-18

最初の公開パッケージのリリースです。npm（`@dcp-ai/sdk`、`@dcp-ai/cli`、`@dcp-ai/wasm`）、PyPI（`dcp-ai`）、crates.io（`dcp-ai`）に同時に公開しました。

<a id="added-4"></a>
<a id="added_4"></a>

### 追加

**プロトコルスタック（DCP-01 から DCP-09）**

- **DCP-01** アイデンティティと人間とのバインディング — エージェントのアイデンティティ、オペレーターによる証明、鍵のバインディング
- **DCP-02** 意図の宣言とポリシーによるゲーティング — 宣言された意図、階層の強制、ポリシーの評価
- **DCP-03** 監査チェーンと透明性 — ハッシュで連鎖した監査エントリー、Merkle の証明、透明性ログ
- **DCP-04** エージェント間通信 — 発見、ハンドシェイク、暗号化されたセッション
- **DCP-05** エージェントのライフサイクル — 運用開始、バイタリティレポート、運用終了記録、4 つの終了モードを持つ状態機械
- **DCP-06** デジタルな承継と継承 — デジタル遺言、承継セレモニー（計画的/強制/緊急）、選択的なメモリー移転マニフェスト
- **DCP-07** 紛争の解決と仲裁 — 型付きの紛争記録、3 段階のエスカレーション、M-of-N の仲裁パネル、判例バンドル、異議記録
- **DCP-08** 権利と義務の枠組み — エージェントの 4 つの権利（メモリーの完全性、尊厳ある移行、アイデンティティの一貫性、不変の記録）、義務の追跡、DCP-07 と結び付いた違反の報告
- **DCP-09** 個人の代理と委任 — 委任マンデート、認識しきい値、助言の宣言、プリンシパルミラー、二層のやり取りの記録。DCP-04 のハンドシェイクをマンデートの検証で拡張

**暗号（4 階層: Routine / Standard / Elevated / Maximum）**

- 耐量子の複合署名 — `pq_over_classical` バインディングによる Ed25519 + ML-DSA-65
- ハッシュベースの予備の署名としての SLH-DSA-192f（FIPS 205）
- 二重ハッシュの監査チェーン — 長期的な完全性のための SHA-256 + SHA3-256
- セッションバインディング — つなぎ合わせを防ぐ、すべての成果物の `session_nonce`
- bundle マニフェスト — 成果物ごとのハッシュ、副の Merkle ルート、PQ チェックポイントの追跡
- アルゴリズムのガバナンス — 自動応答のポリシーを伴う署名付きの勧告
- 鍵の回復 — Shamir Secret Sharing による M-of-N のソーシャルリカバリー
- 緊急失効 — 事前登録したパニックボタン式の失効トークン
- ブラインド化された RPR のモード — プライバシーを守る責任を負うプリンシパルの記録
- ドメイン分離 — すべての署名にコンテキストタグ
- 決定的な kid の導出 — `hex(SHA-256(alg || 0x00 || pk))[0:32]`
- ワイヤーフォーマットの選択肢 — JSON（既定）+ CBOR（省略可能、30〜40% 小さい）

**SDK、インテグレーション、ツール**

- 5 つの SDK — TypeScript、Python、Go、Rust、WASM
- 10 のインテグレーション — Express、FastAPI、LangChain、OpenAI、CrewAI、OpenClaw、W3C DID、Google A2A、Anthropic MCP、AutoGen（DCP-01..09 を対象）
- V2 の JSON Schema — `schemas/v2/` の下の完全なスキーマ一式
- NIST の KAT のテストベクター — FIPS 203/204/205 への適合のための Known Answer Tests
- 相互運用性のテスト — SDK 間での bundle の検証
- Docker Compose のスタック — 検証、アンカー、透明性ログ、失効のサービス
- CI/CD のパイプライン — 適合性テスト、複数の SDK のビルド、公開のワークフロー
- プレイグラウンド — DCP-01..09 のモジュール化したタブを持ち、モバイルに対応した、ブラウザーでの bundle の作成と検証
- プロジェクトのテンプレート — Express、LangChain、OpenAI、CrewAI のスタータープロジェクト
- CLI — `dcp-init` と `dcp-ai` のコマンドを持つ対話型の `@dcp-ai/cli`
- サーバーの強化 — DCP-05..09 のエンドポイントに対する本番水準の認証とレート制限

**ドキュメントと引用**

- Zenodo の関連論文: [doi.org/10.5281/zenodo.19040913](https://doi.org/10.5281/zenodo.19040913)
- `CITATION.cff` — 機械で読める引用のメタデータ

<a id="changed-1"></a>
<a id="changed_1"></a>

### 変更

- `human_binding_record` の名前を `responsible_principal_record`（RPR）に変更
- 署名の形式を `{ alg, public_key_b64, sig_b64 }` から `{ composite_sig: { classical, pq, binding } }` に変更
- bundle のエンベロープを平坦な `bundle_hash` から構造化された `manifest` に変更
- 数値フィールドは整数のみ（署名済みペイロードでは浮動小数点数を禁止）
- 検証は検証者が決定権を持つ（ポリシー駆動）ものに変更

<a id="fixed-4"></a>
<a id="fixed_4"></a>

### 修正

- `sdk/py` の PQ プロバイダー: ML-DSA-65 のモジュールのインポートと `pqc_verify` のシグネチャ（`pk`、`sig`、`msg` を分離）
- `sdk/py` の PQ プロバイダー: SLH-DSA-192f のモジュールのインポートと `pqc_verify` のシグネチャ
- `sdk/py` の PQ プロバイダー: `pqc_verify` の戻り値を取得（`pqcrypto.verify` は例外を投げるのではなく bool を返すため、常に True を返していた）
- `sdk/py` の暗号: `generate_keypair` で Ed25519 の秘密鍵を base64 でエンコード
- CI: 適合性、暗号、複数の SDK のテストの失敗

<a id="backward-compatibility-2"></a>
<a id="backward-compatibility_2"></a>

### 後方互換性

- V2 の検証者は、`allow_v1_bundles: true`（既定）の場合に V1 の bundle を受け入れる
- V1 の検証者は、明確なエラーメッセージとともに V2 の bundle を拒否する

---

<a id="pre-release-milestones"></a>

## リリース前のマイルストーン

以下の日付は、最初のパッケージのリリースより前の仕様の変遷を示します。これらの時点ではパッケージは公開していません。

- **2026-01-15** — Genesis の仕様を凍結（DCP-01、DCP-02、DCP-03）
- **2026-02-28** — V2.0 の規範仕様を確定（耐量子のハイブリッド暗号、4 階層のセキュリティモデル、DCP-04 の A2A）
- **2026-03-16** — Zenodo で論文のプレプリントを公開
- **2026-04-15** — DCP-05..09 の憲章的な枠組みを `main` にマージ
- **2026-04-18** — v2.0.0 を npm、PyPI、crates.io でリリース

[2.0.0]: https://github.com/dcp-ai-protocol/dcp-ai/releases/tag/v2.0.0
