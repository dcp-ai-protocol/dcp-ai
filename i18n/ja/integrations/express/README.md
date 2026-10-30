<sub>[English](../../../../integrations/express/README.md) · [中文](../../../zh-CN/integrations/express/README.md) · [Español](../../../es/integrations/express/README.md) · **日本語** · [Português](../../../pt-BR/integrations/express/README.md)</sub>

<a id="dcp-aiexpress--express-middleware"></a>
<a id="dcp-aiexpress-express-middleware"></a>

# @dcp-ai/express — Express のミドルウェア

> [英語版](../../../../integrations/express/README.md)の参考訳です（28/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

Express.js 向けの DCP の検証ミドルウェアです。リクエストごとに Signed Bundle を自動で検証し、検証済みのエージェントのデータを挿入します。

<a id="supported-dcp-specifications"></a>

## サポートする DCP の仕様

DCP-01 から DCP-09。部分的なもので、以下に述べるバンドルの検証とアドミッション、そして DCP-05 と DCP-09 のいくつかのフィールド（`requireActiveLifecycle`、`lifecycleState`、`mandateId`）です。これらの仕様の完全な実装ではありません。

<a id="installation"></a>

## インストール

**npm 公開済み（2026 年 10 月 26 日）。** `@dcp-ai/express` 2.1.0 が `latest` で、`@dcp-ai/sdk` `^2.2.0` に依存します。以下で説明する機能は npm から利用できます。

**2.0.0 から更新してください。** そのバージョンは署名を検証せず V2 の構造だけを確認します。修正済み検証器、受け入れ判定、ソースの監督には 2.1.0 を使用してください。[SECURITY.md](../../../../SECURITY.md) を参照してください。

```bash
npm install @dcp-ai/express@^2.1.0 express
```

**ピア依存関係：** Express 4.18+ または 5.x

全パッケージのバージョンは [npm リリース一覧](../../../../docs/NPM_RELEASES.md)を参照してください。

チェックアウトしたソースで開発する場合は、ローカルのパッケージをビルドしてインストールします。

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
cd dcp-ai/integrations/express
npm ci && npm run build
# then, in your project:
npm install /path/to/dcp-ai/integrations/express express
```

<a id="quickstart"></a>

## クイックスタート

```typescript
import express from "express";
import { dcpVerify, type DCPAgent } from "@dcp-ai/express";

// The middleware sets req.dcpAgent; the package does not augment Express's Request type
type DCPRequest = express.Request & { dcpAgent?: DCPAgent };

const app = express();
// The bundle travels in the JSON body: give the parser a budget sized for your bundles.
app.use(express.json({ limit: "64kb" }));

// Verify DCP on all routes
app.use(dcpVerify());

app.post("/api/action", (req: DCPRequest, res) => {
  // The verified agent is available at req.dcpAgent
  const agent = req.dcpAgent!;
  console.log(`Agent ${agent.agentId} (human: ${agent.humanId})`);
  console.log(`Capabilities: ${agent.capabilities}`);
  console.log(`Risk tier: ${agent.riskTier}`);

  res.json({ ok: true, agent_id: agent.agentId });
});

app.listen(3000);
```

<a id="sending-a-bundle-from-the-client"></a>

### クライアントからバンドルを送る

バンドルは JSON のボディの `signed_bundle` に入れて送ってください。ハイブリッドの V2 のバンドルにはこれが推奨される方法で、
ミドルウェアは、ヘッダーに収まるバンドルのために `X-DCP-Bundle` ヘッダーも（先に）読みます。以下の最初のリクエストは
テンプレートで、`{...}` は実際の署名付きバンドルを表します。

```bash
# Via body (recommended)
curl -X POST http://localhost:3000/api/action \
  -H "Content-Type: application/json" \
  -d '{"signed_bundle": {...}, "action": "test"}'

# Via header: only for bundles that fit the header limits of the server and every proxy
curl -X POST http://localhost:3000/api/action \
  -H "Content-Type: application/json" \
  -H "X-DCP-Bundle: $(cat signed_bundle.json)" \
  -d '{"action": "test"}'
```

ハイブリッドのバンドル（Ed25519 + ML-DSA-65）は約 33 KB です。アドミッションのベクターの基本のバンドルは 32,996 バイトです。
Node のリクエストヘッダー全体の既定の上限は 16 KiB なので、`X-DCP-Bundle` では Express が動く前に `431` になります。
収めるために上限を上げないでください。ボディでは、パーサーの `limit` があなたの予算で、それより大きなボディはミドルウェアの
前に `413` になります。予算はあなたのデプロイのための選択であり、プロトコルの上限ではありません。最大のバンドルを測定し
（監査証跡と PQ チェックポイントに応じて大きくなります）、余裕を持たせ、前段のプロキシも少なくとも同じだけ許容するように
してください。`examples/strict-v1-body.mjs` は、これらすべてを実際の HTTP で確認します（`examples/README.md` を参照）。

<a id="api-reference"></a>

## API リファレンス

### `dcpVerify(options?)`

Express のミドルウェアを返すファクトリー関数です。

```typescript
import { dcpVerify } from "@dcp-ai/express";

app.use(dcpVerify({
  requireBundle: true,
  checkRevocation: false,
  cacheTtlSeconds: 300,
  headerName: "x-dcp-bundle",
  onFailure: (req, res, errors) => {
    res.status(403).json({ error: "DCP verification failed", details: errors });
  },
}));
```

<a id="options-dcpverifyoptions"></a>

### オプション（`DCPVerifyOptions`）

未知のオプション、未知の `verifierPolicy` のフィールド、誤った型の値（たとえば `allow_v1_bundles: "false"`）は、ミドルウェアの作成時に例外を投げます。綴りを誤ったオプションが確認を無効にしてはならないからです。

| オプション | 型 | 既定値 | 説明 |
|--------|------|---------|-------------|
| `requireBundle` | `boolean` | `true` | すべてのリクエストにバンドルを求める。`false` なら、バンドルのないリクエストは検証なしで通る。 |
| `checkRevocation` | `boolean` | `false` | キャッシュした判定の有無にかかわらず、リクエストのたびに、エージェント（`GET /check/<agent_id>`）、または V2 ではバンドルの署名に使われうる鍵（パスポートの各鍵、RPR の各結び付けの鍵、バンドルの署名のクラシカルと PQ の kid について `GET /v2/check/kid/<kid>`）が失効しているかを失効サービスに問い合わせる。`revoked` が真と評価される JSON の応答はリクエストを拒否する。 |
| `revocationFailClosed` | `boolean` | `false` | `checkRevocation` と併用：問い合わせが答えを返さないとき、つまり `fetch` が例外を投げる（サービスに到達できない）、応答が 2xx でない、ボディが JSON でない、その `revoked` がないか、真と評価されず `false` でもないときにどうするか。`false`（既定）はリクエストを通し（フェイルオープン）、`true` は `403` で拒否する。 |
| `revocationServiceUrl` | `string` | `"http://localhost:3003"` | 失効サービスのベース URL。 |
| `cacheTtlSeconds` | `number` | `0` | 検証の結果をキャッシュする秒数。`0` でキャッシュを無効にする。 |
| `cacheMaxEntries` | `number` | `1000` | キャッシュに保持する検証済みのバンドルの最大数。最も長く使われていないものから追い出す。 |
| `headerName` | `string` | `"x-dcp-bundle"` | バンドルを送れる HTTP ヘッダーの名前で、`req.body.signed_bundle` より先に読む。サーバーとすべてのプロキシのヘッダーの上限（Node の既定はヘッダー全体で 16 KiB）に収まるバンドルだけが対象で、ハイブリッドのバンドルはボディで送ってください。 |
| `onFailure` | `function` | `undefined` | 検証のエラーの独自のハンドラー。`(req, res, errors)` を受け取り、アドミッションが拒否された場合はその結果を 4 つ目の引数として受け取る。 |
| `verifierPolicy` | `object` | `undefined` | 検証器のポリシーのフィールド（`@dcp-ai/sdk` の `VerifierPolicy`）で、SDK の `DEFAULT_VERIFIER_POLICY` の上に統合される。`risk_overrides` なしの `default_mode` はすべてのリスクティアに適用され、`risk_overrides` のエントリはほかより優先してそのティアを設定する。 |
| `requireHybrid` | `boolean` | `false` | `hybrid_required` 未満のすべてのモードが `hybrid_required` になり、V1 のバンドルは拒否される。 |
| `requireActiveLifecycle` | `boolean` | `false` | パスポートの `status` が `decommissioned` のエージェントを拒否する。パスポートの状態を読むもので、DCP-05 の稼働開始の証明書やライフサイクルの記録ではない。V2 のみ。 |
| `trustedPrincipals` | `object` または `function` | `undefined` | あなたが信頼するプリンシパルとその鍵。信頼セット（`schemas/v2/principal_trust_set.schema.json`）、またはリクエストのたびに呼ばれる `({ tenant }) => trust set`。これを使うと、アドミッションを通った V2 のバンドルだけがルートに届く（下記参照）。例外を投げる関数、または `undefined`、`null`、無効な信頼セットを返す関数は、リクエストを `503` で拒否する。 |
| `profile` | `object` | `undefined` | strict-v1 のプロファイル（`schemas/v2/admission_profile.schema.json`）。`trustedPrincipals` と `revocationSource` が必要。 |
| `revocationSource` | `function` | `undefined` | `(subjects, { tenant }) => snapshot`、プロファイルの失効のソース。例：`denyListRevocationSource({ url, headers })`。 |
| `revocationTimeoutMs` | `number` | `5000` | リクエストを拒否する前に失効のソースにかけられる時間。`supervise.revocation` のもとでは監督された期限で、1 から 2147483647 の整数。 |
| `sourceSupervisor` | `object` | `undefined` | `createSourceSupervisor` の監督者で、`supervise` と一緒に渡す（[信頼のソースの監督](#supervising-the-trust-source)を参照）。 |
| `supervise` | `object` | `undefined` | `{ trustTimeoutMs?, revocation? }`、少なくとも 1 つ：`trustTimeoutMs` は 1 から 2147483647 の整数で、`sourceSupervisor` のもとでの `trustedPrincipals` の関数の期限。`revocation: true` は、プロファイルの `revocationSource` を `revocationTimeoutMs` とともにその監督のもとで実行する（[失効のソースの監督](#supervising-the-revocation-source)を参照）。 |
| `cancelOnDisconnect` | `boolean` | `false` | アドミッションの最中にクライアントが本当に去ったとき、その監督されたソースの呼び出しを取り消す（[去るクライアント](#a-client-that-leaves)を参照）。 |
| `tenant` | `function` | 単一のテナント | `(req) => string`。クライアントが設定するヘッダーではなく、必ずあなた自身の認証済みのコンテキストから得る。信頼セットを選び、キャッシュした判定を分ける。 |
| `clock` | `function` | `Date.now` | テスト用。 |

### `req.dcpAgent`

検証に成功すると、`req.dcpAgent` には次が入ります。

```typescript
interface DCPAgent {
  agentId: string;      // Agent ID
  humanId: string;      // ID of the responsible human
  publicKey: string;    // Ed25519 public key
  capabilities: string[];  // Declared capabilities
  riskTier: string;     // Risk level (low/medium/high)
  status: string;       // Status (active/suspended/revoked)
  dcpVersion: "1.0" | "2.0";
  kids?: string[];          // V2: key identifiers of the passport keys
  sessionNonce?: string;    // V2: session nonce of the bundle
  lifecycleState?: string;  // DCP-05 lifecycle state
  mandateId?: string;       // DCP-09 delegation mandate ID
  warnings?: string[];      // V2: warnings of the SDK verifier (e.g. classical-only signature)
  verificationMode?: string; // V2: the mode the bundle was verified in
  securityTier?: string;     // V2: security tier of its intent and policy decision (spec §14.2)
  admission?: {              // with trustedPrincipals
    admitted: true;
    principalTrust: "trusted";
    profile: "strict-v1" | null;
    profileCompliance: "compliant" | "not_evaluated";
    recordedDecision: string | null; // approve, escalate, block: evidence, not a permission
    trustSetVersion: string | null;
    actionAuthorized: false;         // always: admission does not authorize an action
  };
}
```

<a id="behavior"></a>

### 動作

1. `X-DCP-Bundle` ヘッダー（JSON）または `req.body.signed_bundle` から署名付きバンドルを取り出す
2. それを検証する：
   - **V2**（`bundle.dcp_bundle_version: "2.0"`）：Ed25519 / ML-DSA-65 / SLH-DSA-192f のレジストリと上記のポリシーで、`@dcp-ai/sdk` の `verifySignedBundleV2()` を使う。アーティファクトのペイロードのハッシュとマニフェスト、セッションの結び付け、期限、署名されたセッションの開始（`session_issued_at`）、RPR の `binding_keys` でプリンシパルが行ったマニフェストに対するバンドルの署名と、それと一致しなければならない署名のない `signature` のブロック、各アーティファクト自身の署名、検証モード（パスポートの `risk_tier` に対するポリシーのモードと、意図とポリシー判断のセキュリティティアのモードのうち厳しい方、仕様 §14.2）、PQ チェックポイント、アーティファクト間の一貫性（パスポートの状態、RPR の期限、アーティファクトと監査エントリを通じて 1 つのエージェント、プリンシパル、意図）、監査のハッシュチェーン、そして鍵の有効性、kid の導出、正規の base64 の鍵（`spec/VERIFICATION.md` の V2-1 から V2-14）を確認する。`@dcp-ai/sdk` 2.2.0 では、確認する監査チェーンとマークルルートは SHA-256 のものであり、V2-11 の二次の SHA3-256 のフィールドは確認しないため（ロックファイルが `@dcp-ai/sdk` 2.2.1 以降を解決すると、存在するものが確認されます）、VERIFICATION.md への参照は、そこにあるすべての手順が確認されることを意味しない。不正な形式のバンドルは `403` で拒否され、構造だけで受け入れられることはない。
   - **V1**（`bundle.responsible_principal_record.dcp_version: "1.0"`）：V1 のバンドルにはポスト量子の署名がないため、VERIFICATION.md の V2-10 がクラシカルのみのバンドルを受け入れる場合にだけ `verifySignedBundle()` を使う。つまり、`allow_v1_bundles` が `true`、`requireHybrid` がオフで、V1 のパスポートの `risk_tier` に対するポリシーのモード（それがなければ `default_mode`）と、V1 の意図とポリシー判断のセキュリティティアのモード（V1 の `risk_score` は 0 から 1 で、1000 倍される。ない場合は `elevated` として扱う）のうち厳しい方が `classical_only` または `hybrid_preferred` の場合である。既定のポリシーでは、routine または standard の V1 の意図は通り、支払い、機密データ、高い推定影響、0.5 以上のリスクスコアは拒否される。V1 のバンドルに適用されるのは `allow_v1_bundles`、モード、ティアだけである。オーディエンスの結び付け、セッションの期限と期間の上限、Ed25519 を含まない `accepted_classical_algs`、Ed25519 を拒否するアドバイザリーは V2 の確認であり、モードの確認を通った V1 のバンドルは、それらが設定されていても受け入れられる。それらの制御が必要なら、`allow_v1_bundles: false` または `requireHybrid: true` を設定するか、strict-v1 のプロファイルとともに `trustedPrincipals` を使うこと。
   - バージョンを判別できないバンドルは `403` で拒否される。
3. 有効なら：`req.dcpAgent` を挿入して `next()` を呼ぶ
4. 失敗したら：`403` と検証器の `errors` と `warnings` で応答する（設定されていれば `onFailure` を使う）
5. 内部のエラーが起きたら：`500` で応答する

<a id="what-verified-means"></a>

### 「検証済み」の意味

検証済みのバンドルは、内部で一貫しており、それ自身が列挙する鍵、つまりバンドルの署名については RPR の `binding_keys`、エージェントのアーティファクトについてはパスポートの鍵で署名されています。プリンシパルが誰かは証明しません。誰でも鍵を作り、任意の `human_id` を名乗る RPR を作れるからです。そのためには `trustedPrincipals` を設定してください（次の節）。

検証済みのバンドルは、それを持つ誰でも、セッションが切れるまで再送できます。V2 のバンドルの再送に対しては（これらの確認は V1 のバンドルには適用されません。「動作」を参照）、`verifierPolicy.require_audience_binding: true` をあなたの `verifier_id` とともに設定し（バンドルの `manifest.intended_verifier` がこの検証器を指していなければなりません）、セッションを制限するために `require_session_expiry` / `max_session_duration_seconds` を設定するか、strict-v1 のプロファイルを使ってください。どれもバンドルを一回限りにするものではありません。それが必要なら、使用済みの nonce の記録を自分で保持してください。

<a id="trusted-principals-and-strict-v1"></a>

### 信頼するプリンシパルと strict-v1

`trustedPrincipals` を使うと、リクエストがルートに届くのは、そのバンドルが**アドミッションを通った**場合だけです（`docs/ADMISSION.md`、`spec/profiles/admission`）。つまり、プリンシパルの署名（RPR とバンドルのマニフェスト、クラシカルとポスト量子）が、あなたの信頼セットがその `human_id` について挙げる、有効で有効期間内の鍵で作られた V2 のバンドルです。`profile` を使うと、strict-v1 の要件も適用されます。すべてのリスクティアでのハイブリッドな署名、あなたの `verifier_id` と等しい署名された `intended_verifier`、最大 300 秒の署名されたセッション、そして新しい失効のスナップショットです。

```typescript
import { dcpVerify, denyListRevocationSource } from "@dcp-ai/express";

app.use("/api/agents", dcpVerify({
  trustedPrincipals: trustSet,
  profile: { profile: "strict-v1", verifier_id: "api.acme.example" },
  revocationSource: denyListRevocationSource({ url: "https://revocation.acme.example/.well-known/dcp-revocations.json" }),
  tenant: (req) => req.auth.tenant,
  cacheTtlSeconds: 60,
}));
```

拒否されたリクエストは `{ verified, admitted: false, principal_trust, profile, profile_compliance, codes, errors }` とともに `403` を受け取り、ルートには届きません。`denyListRevocationSource` には `https` の URL（平文の `http` はループバックのホストだけ）が必要で、リダイレクトをたどらず、最大 16 MiB を読みます。失敗する、時間切れになる、何も返さない失効のソースは、リクエストを拒否します（`REVOCATION_UNAVAILABLE`）。信頼するプリンシパルを使う場合、`requireBundle: false` はミドルウェアの作成時に `AdmissionConfigError` を投げます。そうでなければ、バンドルのないリクエストがルートに届いてしまうからです。プロファイルのもとでは、`verifierPolicy`、`requireHybrid: false`、`checkRevocation` のオプションも例外を投げます。信頼するプリンシパルを使う場合、V1 のバンドルは拒否されます。アンカーするプリンシパルの署名を持たないからです。実行できる例：`examples/strict-v1.mjs`、そして実際の HTTP で、バンドルをボディに入れ、ボディの予算を設けた `examples/strict-v1-body.mjs`。

テストは `tests/interop/v2/bundle_vectors.json` のすべてのケースを、それぞれの `verifier_policy_overrides` のもとで実行します。

<a id="supervising-the-trust-source"></a>

### 信頼のソースの監督

これらのオプションがなければ、`trustedPrincipals` の関数には以前と同じく期限がありません。これらを使うと、期限と、容量の一部が与えられます。

```typescript
import { createSourceSupervisor, dcpVerify } from "@dcp-ai/express";

// One object per process, shared by every middleware (and by @dcp-ai/openclaw) that should share one capacity.
const supervisor = createSourceSupervisor({ maxInFlight: 64, maxInFlightPerTenant: 8 });

app.use("/api/agents", dcpVerify({
  trustedPrincipals: ({ tenant, signal }) => loadTrustSet(tenant, { signal }),
  sourceSupervisor: supervisor,
  supervise: { trustTimeoutMs: 2000 },
  tenant: (req) => req.auth.tenant,
}));
```

- **期限。** 関数は `{ tenant, signal }` を受け取ります。`trustTimeoutMs` の後に届いた信頼セットは使われません。イベントループが忙しくてタイマーを実行できなかった場合も同様で、期限は結果が届いたときに単調な時計で測られます。そのときリクエストは、失敗したソースと同じ `503`（`TRUST_SOURCE_FAILED`）を受け取り、`signal` は中断されます。
- **容量。** `maxInFlight` は、ミドルウェアが開始してまだ確定していない呼び出しを、すべてのテナントにわたって数えます。`maxInFlightPerTenant` は 1 つのテナントを制限し、これがなければ 1 つのテナントが容量全体を使えてしまいます。空きの枠がない呼び出しは、ただちに同じ `503` を受け取ります。キューはありません。**枠が解放されるのは、関数が本当に確定したときだけ**で、リクエストが時間切れになったときではありません。決して確定しないソースは枠を持ち続け、すべての枠が埋まると、プロセスを再起動するか別の監督者を作るまで、ミドルウェアはすべてのリクエストを拒否します。
- **範囲。** 容量は監督者のオブジェクトごとです。2 つの監督者は 2 つの容量なので、プロセスの上限はそれが作る監督者の合計です。`@dcp-ai/openclaw` が作った監督者も、ESM と CJS のどちらのビルドからでもここで動き、その逆も同様です。
- **`supervisor.close({ drainMs })`** は新しい呼び出しを拒否し、保留中の呼び出しに `503` で応答し、すべての `signal` を中断し、実行中の呼び出しを最大 `drainMs`（既定 0）待ちます。まだ実行中の数で解決し、それらの枠は埋まったままです。
- **`supervisor.stats()`** はカウンターを返します：`open`、`inFlight`、`tenants`、`timeouts`、`saturated`、`closed`、`lateResults`、`lateErrors`、`droppedEvents`。`createSourceSupervisor` の `onSourceEvent` は `{ source, reason, inFlight }` を受け取り、テナントは受け取りません。同じイベントループで動くため、速くなければなりません。一度に 1 回の呼び出しで、1 つがキューにあるかそのプロミスが保留中のときに届いたイベントは捨てられ、数えられます。返されたプロミスや thenable は `Promise.resolve` と同じように取り込まれます。保留中のプロミスで解決された thenable はそれを使用中にしたままで、後でもう一度呼ばれた解決関数は何も解放しません。そのエラーと拒否は無視されます。カウンターは `Number.MAX_SAFE_INTEGER` で止まります。
- **しないこと。** ソースの処理を止めません。`signal` を無視する関数は最後まで実行されます。関数が自ら開始して返さない処理には上限を設けません。イベントループをブロックする関数は助けず、それはすべての期限を遅らせます。バンドルの検証は、引き続き信頼のソースの前に実行されます。`supervise.revocation` がなければ、失効は以前と同じく `revocationTimeoutMs` を使います。

<a id="supervising-the-revocation-source"></a>

#### 失効のソースの監督

strict-v1 のプロファイルでは、`supervise: { revocation: true }` が、`revocationTimeoutMs` を期限として（そのときは 1 から 2147483647 の整数）、同じ種類の監督者のもとで `revocationSource` を実行します。

```typescript
app.use("/api/agents", dcpVerify({
  trustedPrincipals: trustSet, // a static trust set, or a function supervised with trustTimeoutMs
  profile: { profile: "strict-v1", verifier_id: "verifier:acme-api" },
  revocationSource: denyListRevocationSource({ url: "https://revocations.example.com/.well-known/dcp-revocations.json" }),
  revocationTimeoutMs: 2000,
  sourceSupervisor: supervisor,
  supervise: { revocation: true }, // or { trustTimeoutMs: 2000, revocation: true }
}));
```

- **オプトイン。** `supervise` は `trustTimeoutMs`、`revocation: true`、またはその両方を受け取ります。`revocation: true` には `revocationSource` が必要で、静的な信頼セットでも動きます。これがなければ、失効は以前と同じく `revocationTimeoutMs` を使います。
- **同じ応答。** ソースは `(subjects, { tenant, signal })` を受け取り、それぞれの答えは監督なしの場合と同じ応答になります。スナップショットは以前と同じく評価されます。`null`、失敗、時間切れ、空きの枠のない呼び出し、閉じた監督者は `codes: ["REVOCATION_UNAVAILABLE"]` とともに `403` になり、決して失効していないとはされません。`code` が `REVOCATION_INVALID` のエラーは、期限の前に届いた場合にだけ `REVOCATION_INVALID` になり、期限の後では時間切れになります。
- **1 つの容量。** 信頼と失効の呼び出しは同じ監督者の枠を使い、それぞれソースが本当に確定するまで保持されます。遅れて届いたスナップショットは、そのリクエストにもほかのどのリクエストにも決して使われず、判定のキャッシュに入ることもありません。
- **`denyListRevocationSource`** は、自身の `timeoutMs` に加えて、監督者の `signal` が中断されたときにも、fetch とそのボディの読み取りを中断します。
- **テレメトリ。** そのイベントは `source: 'revocation'` を持ちます。
- **制限。** 信頼のソースと同じ制限です。従来の `checkRevocation` / `revocationServiceUrl` の経路は監督されません。

<a id="a-client-that-leaves"></a>

#### 去るクライアント

`cancelOnDisconnect: true` を使うと、リクエストのアドミッションの最中にクライアントが本当に去った場合、そのリクエストの処理を止めます。

```typescript
app.use("/api/agents", dcpVerify({
  trustedPrincipals: ({ tenant, signal }) => loadTrustSet(tenant, { signal }),
  sourceSupervisor: supervisor,
  supervise: { trustTimeoutMs: 2000 },
  cancelOnDisconnect: true,
}));
```

- **去ったとみなすもの。** 応答が送られる前に閉じた場合、またはボディが揃う前にリクエストが閉じた場合です。ボディを読み終えた後のリクエスト自身の `close` は、正常なリクエストでも起きるため、数えません。
- **取り消すもの。**
  - そのリクエストの監督されたソースの呼び出しだけです。その `signal` が中断され、呼び出しは `stats().cancelled` に数えられ、`onSourceEvent` の理由は `'cancelled'` になります。
  - 監督者も、ほかのどのリクエストも取り消しません。
  - その枠は、期限の後と同じく、ソースが本当に確定するまで埋まったままです。`signal` を無視するソースは実行を続けます。
- **リクエストに起きること。** それ以上は何もありません。
  - ハンドラーも `next()` もなし
  - キャッシュへの書き込みも `onFailure` もなし
  - 応答は書き込まれない
  - バンドルの検証は中断されず、ミドルウェアはその後で確認します。
- **要件。** ミドルウェアの作成時に確認されます。
  - すべてのソースの関数が監督されていなければなりません。`trustedPrincipals` の関数には `trustTimeoutMs`、`revocationSource` には `revocation: true` です。`checkRevocation` も、監督されたソースのない `cancelOnDisconnect` も許されません（`AdmissionConfigError`、`CONFIG_PROFILE_CONTRADICTION`）。
  - 監督者は取り消しをサポートしていなければなりません（そうでなければ `CONFIG_INVALID_VALUE`）。このバージョンの `@dcp-ai/express` または `@dcp-ai/openclaw` の監督者は、ESM でも CJS でもサポートしています。古いパッケージの監督者はサポートしておらず、このオプションがなければ以前と同じく動きます。
- **`cancelled` の読み方。** 古いパッケージの監督者でも型チェックを通るよう、`stats().cancelled` は型の上では任意です。`stats().cancelled ?? 0` として読んでください。

<a id="cache"></a>

### キャッシュ

`cacheTtlSeconds > 0` のとき、各ミドルウェアは検証済みのバンドルのキャッシュを独自に保持します。キーは、署名付きバンドルの正規の形（`canonicalizeV2`）の SHA-256、検証器のポリシーのフィンガープリント、テナントです。キャッシュした判定は、同じバンドル、同じポリシー、同じテナントに対してだけ再利用され、正規の形を持たないバンドル（`1e999` のような整数でない数、または深すぎる入れ子）は検証されてもキャッシュされません。エントリは `cacheTtlSeconds` の後、またはバンドルのセッション（`manifest.session_expires_at`）、RPR、パスポートの鍵、RPR の結び付けの鍵が期限切れになったときに、それより早く失効します。期限のタイムスタンプが RFC 3339 でないバンドルはキャッシュされません。キャッシュは最大 `cacheMaxEntries` 個のバンドルを保持し、期限切れのエントリから、次に最も長く使われていないものから追い出します。`checkRevocation` を使うと、キャッシュにヒットするたびに失効がもう一度確認されます。`trustedPrincipals` を使うと、キャッシュが保持するのは暗号の検証だけで、プリンシパルの信頼、プロファイルの確認、失効はリクエストのたびに評価されるため、信頼セットから外されたプリンシパルや失効した鍵は、次のリクエストで拒否されます。

<a id="advanced-example--selectively-protected-routes"></a>
<a id="advanced-example-selectively-protected-routes"></a>

## 高度な例 — 選択的に保護するルート

```typescript
import express from "express";
import { dcpVerify, type DCPAgent } from "@dcp-ai/express";

type DCPRequest = express.Request & { dcpAgent?: DCPAgent };

const app = express();
app.use(express.json());

// Public routes (no verification)
app.get("/health", (req, res) => res.json({ ok: true }));

// Protected routes (require DCP)
const protectedRoutes = express.Router();
protectedRoutes.use(dcpVerify({ cacheTtlSeconds: 60 }));

protectedRoutes.post("/agent/action", (req: DCPRequest, res) => {
  res.json({ agent: req.dcpAgent!.agentId });
});

protectedRoutes.get("/agent/profile", (req: DCPRequest, res) => {
  res.json(req.dcpAgent);
});

app.use("/api", protectedRoutes);
app.listen(3000);
```

<a id="development"></a>

## 開発

```bash
# Development build uses the published SDK from package-lock.json:
npm install

# Build (ESM + CJS + types)
npm run build

# Tests
npm test
```

<a id="dependencies"></a>

### 依存関係

- `@dcp-ai/sdk` — DCP の検証の SDK
- `express`（ピア） — HTTP のフレームワーク

<a id="license"></a>

## ライセンス

Apache-2.0
