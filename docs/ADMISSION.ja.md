<sub>[English](ADMISSION.md) · [中文](ADMISSION.zh-CN.md) · [Español](ADMISSION.es.md) · **日本語** · [Português](ADMISSION.pt-BR.md)</sub>

<a id="admission-trusted-principals-and-the-strict-v1-profile"></a>

# アドミッション：信頼済みのプリンシパルと strict-v1 プロファイル

> [英語版](ADMISSION.md)の参考訳です（26/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

検証済みのバンドルは、その完全性と、列挙された鍵で署名されたことを証明します。誰でも任意の `human_id` と自分の鍵で責任あるプリンシパルのレコードを作れるので、検証だけではプリンシパルが**誰**なのかはわかりません。

アドミッションは、オペレーターがすでに信頼しているプリンシパルからの証拠だけを受け入れるために必要なものを加えます。

- **信頼済みのプリンシパル。** オペレーターは信頼セットを用意します。各プリンシパルの `human_id` と、そのプリンシパルが署名に使ってよい公開鍵です。バンドルが受け入れられるのは、プリンシパルの署名（RPR とバンドルのマニフェスト、クラシカルとポスト量子の両方）を実際に検証した鍵が、そのプリンシパルの信頼済みの鍵であり、有効で、有効期間内にある場合だけです。
- **strict-v1 プロファイル。** オプションで、バージョン管理され、オペレーターが固定します。すべてのリスクティアでのハイブリッド署名、オペレーターの `verifier_id` と一致する署名済みの `intended_verifier`、最長 300 秒の署名済みのセッションウィンドウ、作成から 300 秒以内の失効スナップショットを求めます。

> **公開状況（26/10/2026）。** 受け入れ判定と `strict-v1` は `@dcp-ai/sdk` 2.2.0、Express/OpenClaw 2.1.0、Python `dcp-ai` 2.10.0 で公開済みです。[npm](NPM_RELEASES.md) と [Python](PYTHON_RELEASE.md) を参照してください。Go と Rust の公開は別です。未公開 API はチェックアウトを使います。参照サーバーとルートの CLI は引き続きチェックアウトから実行します。

すべてのルールとエラーコードを含む規範的な定義は [`spec/profiles/admission`](../spec/profiles/admission/README.md) です。共通のテストベクターは [`tests/interop/v2/admission_vectors.json`](../tests/interop/v2/admission_vectors.json) にあります。

<a id="it-is-opt-in"></a>

## オプトインである

アドミッションは、信頼セットまたはプロファイルを設定したコードにだけ適用され、`verified` の意味は変わりません。検証器には、オプションのクロックと、同じ検証で使った鍵の報告も加わります。同じ変更は、アドミッションとは別に検証そのものも変えます。[互換性](#compatibility)を参照してください。

<a id="the-trust-set"></a>

## 信頼セット

オペレーターが書くものであり、バンドル、リクエスト、ツールのパラメーター、RPR 内の URL から来ることは決してありません。スキーマ：[`schemas/v2/principal_trust_set.schema.json`](../schemas/v2/principal_trust_set.schema.json)。

```json
{
  "trust_set_version": "2026-11-02.1",
  "principals": [
    {
      "human_id": "human:acme-ops",
      "keys": [
        { "kid": "…", "alg": "ed25519", "public_key_b64": "…", "status": "active" },
        { "kid": "…", "alg": "ml-dsa-65", "public_key_b64": "…", "status": "active", "expires_at": "2027-06-01T00:00:00Z" }
      ]
    }
  ]
}
```

kid がその鍵から導出されていない、鍵の形式が不正、識別子が空、`human_id` や kid が重複している、のいずれかに当てはまると、読み込み時に拒否されます。信頼セットの `status`、`not_before`、`expires_at` が権威を持ちます。バンドルがある鍵を `active` として列挙していても、オペレーターが失効させた鍵を復活させることはできません。

**ローテーション。** 新しい鍵を追加し（必要なら `not_before` 付きで）、重複期間中は古い鍵を `active` のままにし、その後退役させます（`revoked`、`expired`、`expires_at` の設定、または削除）。そのたびに新しい `trust_set_version` を付けます。バンドルが自分の鍵をローテーションすることはできません。

**エージェントの鍵**は列挙しません。マニフェストに対するプリンシパルの署名がパスポートのハッシュを含んでおり、それによってエージェントとその鍵がプリンシパルに結び付けられます。

<a id="the-strict-v1-profile"></a>

## strict-v1 プロファイル

スキーマ：[`schemas/v2/admission_profile.schema.json`](../schemas/v2/admission_profile.schema.json)。

```json
{ "profile": "strict-v1", "verifier_id": "api.acme.example" }
```

| 要件 | 値 |
|---|---|
| バンドルのバージョン | V2 のみ |
| 署名 | すべてのリスクティアで、クラシカルと PQ の両方が有効（`hybrid_required`。`pq_only` では満たさない） |
| プリンシパル | 信頼済み（上記）で、署名の両方の要素がアンカーされている |
| セッションバインディング | 必須 |
| セッションウィンドウ | `session_issued_at` と `session_expires_at` がマニフェストで署名されている。長さは最長 `max_session_duration_seconds`（既定値・上限とも 300）。開始時刻はクロックのずれ 30 秒以内。期限切れでない |
| オーディエンス | 署名済みの `intended_verifier` が `verifier_id` と一致する |
| 失効 | エージェントと、検証された各署名鍵のスナップショットで、作成から最長 `max_revocation_age_seconds`（既定値・上限とも 300）。失効済みや不明のものがない |

プロファイルが定めるのは要件であり、既定値ではありません。`max_session_duration_seconds`、`max_revocation_age_seconds`、オプションの `verifier_policy` はプロファイルを厳しくすることしかできません。緩めることになる値（`allow_v1_bundles: true`、`require_*: false`、クラシカルや `pq_only` のモード、より長いセッション、別の `verifier_id`）は設定エラーです。アダプターも、プロファイルを緩めることになる自分のオプションを拒否します。

<a id="revocation-sources"></a>

## 失効情報の提供元

失効は、オペレーターが選んだ提供元によって解決されます。中央のサービスは必要ありません。提供元は対象（`agent_ids` と `kids`）を受け取り、スナップショットを返します。

```json
{ "checked_at": "2026-11-02T10:00:30Z", "agents": { "agent:acme-bot": "not_revoked" }, "keys": { "<kid>": "not_revoked" } }
```

`checked_at` は、提供元が状態を確定した時刻です。タイムアウトする、失敗する、何も返さない提供元では、リクエストは `REVOCATION_UNAVAILABLE` で失敗します。既定で「失効していない」と扱われるものは何もありません。

`denyListRevocationSource`（TypeScript の統合、リファレンス検証器）と `deny_list_revocation_source`（Python）は、リファレンスの失効サービスの `/.well-known/dcp-revocations.json` の形式の完全な拒否リストを、オペレーターの URL とヘッダーで、タイムアウト付き、リダイレクトなし、最大 16 MiB で読み込みます。URL は `https` でなければなりません（平文の `http` はループバックのホストに対してのみ）。`revocations` または `kid_revocations` のどちらか一方でも欠けているリストは、空ではなく無効です。切り詰められている可能性があるからです。

<a id="results"></a>

## 結果

| フィールド | 意味 |
|---|---|
| `verified` | 検証器の判定（そのまま） |
| `principal_trust` | `trusted`、`untrusted`、または `not_evaluated`（信頼セットがない、または検証されていない） |
| `profile` / `profile_compliance` | `strict-v1` または null / `compliant`、`non_compliant`、`not_evaluated` |
| `admitted` | この設定のもとでの最終的な判断 |
| `action_authorized` | 常に `false`：アドミッションはアクションを承認しない |
| `recorded_decision` | バンドルが記録しているポリシー判断（`approve`、`escalate`、`block`） |
| `trust_set_version` | 使われた信頼セット |
| `errors` | `{ code, message }`。コードは仕様の § 5.3 に列挙されている |

`block` や `escalate` の判断を記録したバンドルも受け入れられることがあります。それはその判断の証拠であって、許可ではありません。

<a id="using-it"></a>

## 使い方

<a id="typescript-dcp-aisdk"></a>

### TypeScript（`@dcp-ai/sdk`）

```ts
import { admitSignedBundleV2, createPrincipalTrustStore, resolveStrictV1Profile } from '@dcp-ai/sdk';

const trust = createPrincipalTrustStore(trustSetJson);           // throws AdmissionConfigError
const profile = resolveStrictV1Profile({ profile: 'strict-v1', verifier_id: 'api.acme.example' });
const result = await admitSignedBundleV2(signedBundle, registry, { profile, trust, revocation: snapshot });
if (!result.admitted) throw new Error(result.errors.map((e) => e.code).join(', '));
```

`evaluateAdmissionV2` は、手元にある検証結果を受け取り（暗号処理も I/O も行いません）、それを信頼します。同じバンドルを、同じ `now` で、プロファイルのポリシーのもとで検証した結果だけを渡してください。`revocationSubjects` は、提供元が何について答えるべきかを示します。Python、Go、Rust も同じ関数を公開しています。仕様の § 8 を参照してください。

<a id="express-dcp-aiexpress"></a>

### Express（`@dcp-ai/express`）

```ts
import { dcpVerify, denyListRevocationSource } from '@dcp-ai/express';

app.use('/api/agents', dcpVerify({
  trustedPrincipals: trustSetJson,                               // or ({ tenant }) => trust set
  profile: { profile: 'strict-v1', verifier_id: 'api.acme.example' },
  revocationSource: denyListRevocationSource({ url: 'https://revocation.acme.example/.well-known/dcp-revocations.json' }),
  tenant: (req) => req.auth.tenant,                              // from your own authentication
  cacheTtlSeconds: 60,
}));
```

リクエストがルートに届くのは、バンドルが受け入れられた場合だけです。`req.dcpAgent.admission` に結果が入ります。信頼関数が例外を投げる、あるいは `undefined`、`null`、有効な信頼セットでないもの（たとえば、エントリのないテナント）を返すと、リクエストは `503` で拒否されます。それが「信頼の要件なし」を意味することはありません。キャッシュが保持するのは暗号上の検証だけで、キーはバンドル、検証器のポリシー、テナントです。信頼、プロファイルのチェック、失効はリクエストのたびに評価されるので、プリンシパルの削除や鍵の失効は次のリクエストから効きます。実行可能な例：[`integrations/express/examples/strict-v1.mjs`](../integrations/express/examples/strict-v1.mjs)。

<a id="fastapi-dcp_aifastapi"></a>

### FastAPI（`dcp_ai.fastapi`）

`DCPVerifyMiddleware(app, require_bundle=True, trusted_principals=..., profile=..., revocation_source=deny_list_revocation_source(url), tenant=...)` で、同じルールが適用されます（FastAPI では `require_bundle` の既定値は `False` で、信頼済みのプリンシパルを使う場合は `True` にする必要があります）。[`integrations/fastapi/README.md`](../integrations/fastapi/README.md) を参照してください。

<a id="openclaw-dcp-aiopenclaw"></a>

### OpenClaw（`@dcp-ai/openclaw`）

```ts
configureVerifier({ trustedPrincipals, profile: { profile: 'strict-v1', verifier_id: 'agent-gateway' }, revocationSource });
```

すると `dcp_verify_bundle` は `admitted` を報告し、受け入れられたバンドルの場合にだけエージェントの名前を示します。プロファイルのもとでは、モデルの `verifier_policy` パラメーターは拒否され、ツールが定義していないパラメーターは無視されます。実行可能な例：[`integrations/openclaw/examples/strict-v1.mjs`](../integrations/openclaw/examples/strict-v1.mjs)。

<a id="reference-server-and-cli"></a>

### リファレンスサーバーと CLI

検証サーバー（`npm run server`）は、オペレーターが `DCP_TRUSTED_PRINCIPALS_FILE` を設定すると `POST /v2/admit` を公開します（内容が変わるたびに再読み込みされます）。strict-v1 には、さらに `DCP_ADMISSION_PROFILE_FILE` と `DCP_REVOCATION_LIST_URL`（オプションで `DCP_REVOCATION_LIST_AUTHORIZATION`）を設定します。矛盾した設定や、設定されているが空のアドミッション変数があると、起動を拒否します。オフラインでは次のとおりです。

```bash
# the reference CLI of a checkout; it reads only files in the current directory
node /path/to/dcp-ai/bin/dcp.js admit-bundle bundle.signed.json --trust trust.json --profile profile.json --revocation snapshot.json
```

<a id="compatibility"></a>

## 互換性

- **検証 API。** `verifySignedBundleV2` / `verify_signed_bundle_v2` / `VerifySignedBundleV2WithPolicy` / `verify_signed_bundle_v2_with_policy` のシグネチャは変わりません。署名鍵は、TypeScript と Python では `details.signer_keys`、Go では新しい `SignerKeys` フィールドです。Rust では `V2VerificationResult` が 10 個のフィールドを保つので、それを全フィールド指定で構築したり `..` なしで分割代入したりするコードも引き続きコンパイルできます。署名鍵は新しい `verify_signed_bundle_v2_at` から得られ、これは `V2VerificationDetails`（`result` と `signer_keys`）を返し、アドミッションが受け取るのもこれです。リリース前のアドミッション API に対して書かれたコードは、`verification.verified` ではなく `verification.result.verified` を読みます。
- **検証の動作。** 同じ変更は、アドミッションとは別に検証の動作も変えます。S >= L の Ed25519 署名は拒否されるようになりました。また、Go と Rust の検証器は、ポリシーの `accepted_classical_algs` と `accepted_pq_algs` を適用するようになりました。以前は、強制されないとしてこれらを拒否していました。そのようなポリシーのもとでは、リストにないバンドルは失敗し、リストにあるバンドルは検証できるようになります。すべての変更は [CHANGELOG](../CHANGELOG.md) に挙げられています。
- **バンドル。** ワイヤ形式の変更はありません。strict-v1 には、マニフェストに `session_issued_at`、`session_expires_at`、`intended_verifier` を含めて署名したバンドルが必要です。すべての SDK の署名器は、有効期限とオーディエンスを与えられればこれらを書き込みます。
- **信頼セットがある場合、V1 バンドルは拒否されます**。アンカーすべきプリンシパルの署名を持たないからです。
- **統合のオプション。** 新しく、オプションです。信頼済みのプリンシパルを使う場合、`requireBundle: false`（Express）と `require_bundle=False`（FastAPI）は設定エラーです。バンドルのないリクエストがルートに届いてしまうからです。プロファイルのもとでは、`verifierPolicy`、`requireHybrid: false`、`checkRevocation` のオプション（Express）、`verifier_policy`（FastAPI）、`verifierPolicy`（OpenClaw）も同様です。

<a id="limits"></a>

## 制限

- **リプレイ。** セッションの nonce、オーディエンス、有効期限は、バンドルをどこで、どれだけの期間リプレイできるかを制限しますが、1 回限りにはしません。1 回限りの使用が必要な検証器は、消費済みの nonce やバンドルのハッシュを自分で記録します。アドミッションはそれらを消費しません。
- **承認。** `action_authorized` は常に `false` です。外部の承認をツール、その引数、その実行に結び付けることは、後のフェーズで扱います。
- **アイデンティティ**の確かさは、信頼セットとそれを維持するプロセスの確かさで決まります。
- **失効**の新しさはスナップショットの新しさで決まります。`checked_at` の後の失効は、次のスナップショットで反映されます。
