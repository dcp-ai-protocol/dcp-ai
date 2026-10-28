<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · **日本語** · [Português](README.pt-BR.md)</sub>

<a id="dcp-aiopenclaw--dcp-integration-for-openclaw"></a>
<a id="dcp-aiopenclaw-dcp-integration-for-openclaw"></a>

# @dcp-ai/openclaw — OpenClaw のための DCP の統合

> [英語版](README.md)の参考訳です（28/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

AI エージェントに **Digital Citizenship Protocol (DCP)** のツールを加える [OpenClaw](https://github.com/openclaw/openclaw) のプラグインです。エージェントがこれらのツールを呼んだとき、行動は宣言され、リスクを
採点され、人の所有者に結び付いたハッシュチェーンの監査証跡に記録されます。プラグインはエージェントのほかのツールを
捕捉しません。機密性の高い行動をすべて制御するには、ホストが自らそれらのツール呼び出しを捕捉し、
その前後で `dcp_declare_intent` / `dcp_log_action` を呼ばなければなりません。セッションの状態はメモリー上の `Map` にあり、
プロセスが再起動すると失われます。

<a id="supported-dcp-specifications"></a>

## サポートする DCP の仕様

DCP-01 から DCP-09。部分的なもので、以下のツールはこれらの仕様の形に沿った記録を作り、
`dcp_verify_bundle` はバンドルを検証します。完全には実装していません。

<a id="features"></a>

## 機能

- **アイデンティティ（DCP-01）** — Ed25519 の鍵ペアの生成、Responsible Principal Record、Agent Passport
- **意図の宣言（DCP-02）** — 機密性の高い行動の前のリスクの採点とポリシー判断。それを適用するのはホスト
- **監査証跡（DCP-03）** — 証拠の参照を伴う、ハッシュチェーンでつながった行動の記録。改ざんを検出でき（改変されたエントリーはチェーンを壊す）、不変ではなく、メモリーに保持される
- **ライフサイクル（DCP-05）** — エージェントの稼働開始、バイタリティの報告、廃止
- **承継（DCP-06）** — 後継者の希望と記憶の分類を伴うデジタル遺言
- **委任（DCP-09）** — 人からエージェントへ権限を移す委任マンデートの作成
- **バンドルの検証** — V2 の Signed Bundle は、運用者の検証器のポリシーのもとで、SDK の `verifySignedBundleV2` が検証する（署名、ハッシュ、セッションの結び付け、監査チェーン、鍵の有効性）
- **バンドルの署名** — セッションの終わりに CitizenshipBundle を作って署名する。1 つの意図とそのポリシー判断に、セッションの監査エントリーを加えたもの（[リスクの採点](#risk-scoring)の注記を参照）
- **DCP-05 から DCP-09 の記録** — 稼働開始、バイタリティ、廃止、遺言、マンデートの記録はセッションの状態に保持される。`dcp_sign_bundle` はそれらをバンドルに加えず、プラグインはそれらをどこにも送らない
- **SKILL.md** — DCP のツールの使い方をエージェントに教える付属のスキル

<a id="installation"></a>

## インストール

**npm 公開済み（2026 年 10 月 26 日）。** `@dcp-ai/openclaw` 2.1.0 が `latest` で、`@dcp-ai/sdk` `^2.2.0` に依存します。以下で説明する機能は npm から利用できます。

**2.0.0 から更新してください。** そのバージョンは署名を検証せず V2 の構造だけを確認します。修正済み検証器、受け入れ判定、ソースの監督には 2.1.0 を使用してください。[SECURITY.md](../../SECURITY.md) を参照してください。

```bash
npm install @dcp-ai/openclaw@^2.1.0
```

全パッケージのバージョンは [npm リリース一覧](../../docs/NPM_RELEASES.md)を参照してください。

チェックアウトしたソースで開発する場合は、ローカルのパッケージをビルドしてインストールします。

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
cd dcp-ai/integrations/openclaw
npm ci && npm run build
# then, in your project (or OpenClaw plugins directory):
npm install /path/to/dcp-ai/integrations/openclaw
```

OpenClaw の設定に追加します。

```yaml
plugins:
  - "@dcp-ai/openclaw"
```

<a id="tools-registered"></a>

## 登録されるツール

| ツール | 説明 | DCP の仕様 |
|------|-------------|----------|
| `dcp_identity_setup` | 鍵ペア + RPR + AgentPassport を生成する | DCP-01 |
| `dcp_declare_intent` | 意図を宣言し、ポリシー判断（approve/escalate/block）を得る | DCP-02 |
| `dcp_verify_bundle` | SDK の検証器で Signed Bundle を検証する（署名 + ハッシュ + セッションの結び付け） | VERIFICATION |
| `dcp_log_action` | 行動をハッシュチェーンでつないだ AuditEntry として記録する | DCP-03 |
| `dcp_get_audit_trail` | セッションの監査証跡を取得する | DCP-03 |
| `dcp_commission_agent` | エージェントを稼働させる（ライフサイクル → commissioned） | DCP-05 |
| `dcp_report_vitality` | バイタリティの指標を報告し、計算されたスコアを得る | DCP-05 |
| `dcp_decommission_agent` | エージェントを廃止する（graceful/immediate/emergency） | DCP-05 |
| `dcp_create_testament` | 後継者の希望を伴うデジタル遺言を作る | DCP-06 |
| `dcp_create_mandate` | 人からエージェントへの委任マンデートを作る | DCP-09 |
| `dcp_sign_bundle` | セッションの状態から CitizenshipBundle を作って署名する | BUNDLE |

<a id="usage-flow"></a>

## 利用の流れ

```
┌─────────────────────────────────────────────────────┐
│                  Session Start                       │
│  dcp_identity_setup(owner, jurisdiction, caps)       │
└──────────────────────┬──────────────────────────────┘
                       │
          ┌────────────▼─────────────┐
          │   For each sensitive      │
          │   action:                 │
          │                           │
          │  1. dcp_declare_intent()  │
          │     → approve/escalate/   │
          │       block               │
          │                           │
          │  2. [perform action]      │
          │                           │
          │  3. dcp_log_action()      │
          └────────────┬─────────────┘
                       │ (repeat)
          ┌────────────▼─────────────┐
          │     Session End           │
          │  dcp_sign_bundle()        │
          │  → SignedBundle           │
          └───────────────────────────┘
```

<a id="architecture"></a>

## アーキテクチャ

```
integrations/openclaw/
├── package.json               # Dependencies: @dcp-ai/sdk, @sinclair/typebox
├── tsconfig.json
├── SKILL.md                   # Companion skill with agent instructions
├── README.md                  # This file
└── src/
    ├── index.ts               # Plugin entry — registerTool() calls
    ├── tools/
    │   ├── identity.ts        # dcp_identity_setup
    │   ├── intent.ts          # dcp_declare_intent
    │   ├── verify.ts          # dcp_verify_bundle
    │   ├── audit.ts           # dcp_log_action + dcp_get_audit_trail
    │   ├── lifecycle.ts       # dcp_commission_agent + dcp_report_vitality + dcp_decommission_agent
    │   ├── succession.ts      # dcp_create_testament
    │   └── delegation.ts      # dcp_create_mandate
    └── state/
        └── agent-state.ts     # Per-session DCP state management
```

<a id="bundle-verification"></a>

## バンドルの検証

<a id="policy-set-by-the-operator-tightened-by-the-model"></a>

### ポリシー：運用者が設定し、モデルが厳しくする

`dcp_verify_bundle` の検証器のポリシーは運用者のものです。ホストが `register(api, { verifierPolicy })` または `configureVerifier({ verifierPolicy })` でほかのものを設定しない限り、SDK の `DEFAULT_VERIFIER_POLICY` です（既定のポリシーの上に設定するフィールド。`risk_overrides` なしの `default_mode` はすべてのリスクティアに適用され、未知のフィールドや誤った型は例外を投げます）。

```typescript
import register, { configureVerifier } from '@dcp-ai/openclaw';

configureVerifier({ verifierPolicy: { default_mode: 'hybrid_required', require_audience_binding: true, verifier_id: 'my-service' } });
```

ツールの `verifier_policy` パラメーターは呼び出すモデルが設定するため、そのポリシーを厳しくすることしかできません。`default_mode` はすべてのリスクティアを少なくともそのモードに引き上げ（`classical_only` < `hybrid_preferred` < `hybrid_required`。`pq_only` をほかのモードと組み合わせると `hybrid_required` になります。`pq_only` はほかのモードが求めるクラシカルの署名を省くからです）、`require_session_binding` と `require_composite_binding` は有効にすることしかできず、`allow_v1_bundles` は無効にすることしかできません。ほかのフィールドはエラーです。

<a id="what-is-checked"></a>

### 確認されること

- **V2**：`@dcp-ai/sdk` の `verifySignedBundleV2` を、Ed25519 / ML-DSA-65 / SLH-DSA-192f のレジストリと上記のポリシーで使います。アーティファクトのペイロードのハッシュとマニフェスト、セッションの結び付け、期限、署名されたセッションの開始（`session_issued_at`）、RPR の `binding_keys` でプリンシパルが作ったマニフェストへのバンドルの署名と、それと一致しなければならない署名されていない `signature` ブロック、各アーティファクト自身の署名、検証モード（パスポートの `risk_tier` に対するポリシーのモードと、意図とポリシー判断のセキュリティティアのモードのうち厳しい方。spec §14.2）、PQ のチェックポイント、アーティファクト間の一貫性（パスポートの状態、RPR の期限、アーティファクトと監査エントリーを通じて 1 つのエージェント、プリンシパル、意図）、監査のハッシュチェーン（`@dcp-ai/sdk` 2.2.0 では SHA-256 だけ。ロックファイルが `@dcp-ai/sdk` 2.2.1 以降を解決すると、存在する V2-11 の二次の SHA3-256 のフィールドも確認します）、そして鍵の有効性、kid の導出、正規の base64 の鍵（`spec/VERIFICATION.md` V2-1 から V2-14）を確認します。
- **V1**（Ed25519 の署名 1 つ）：VERIFICATION.md の V2-10 がクラシカルのみのバンドルを受け入れる場合にだけ `verifySignedBundle` で検証します。つまり `allow_v1_bundles` が true で、V1 のパスポートの `risk_tier` に対するポリシーのモードと、V1 の意図とポリシー判断のセキュリティティアのモード（V1 の `risk_score` は 0 から 1 で、1000 倍される。ない場合は `elevated` として扱う）のうち厳しい方が `classical_only` または `hybrid_preferred` の場合です。既定のポリシーでは、routine または standard の V1 の意図は通り、支払い、機密データ、高い推定影響、0.5 以上のリスクスコアは拒否されます。
- バージョンを判別できないバンドルは拒否されます。

V1 のバンドルに適用されるのは `allow_v1_bundles`、モード、ティアだけです。オーディエンスの結び付け、セッションの期限と
期間の上限、Ed25519 を含まない `accepted_classical_algs`、Ed25519 を拒否するアドバイザリーは V2 の確認であり、モードの
確認を通った V1 のバンドルは、それらが設定されていても受け入れられます。それらの制御が必要なら、
`allow_v1_bundles: false` を設定するか、strict-v1 のプロファイルとともに信頼するプリンシパルを使ってください。

結果には、検証器の `errors` と `warnings`、`resolved_tier`（セキュリティティア）、V2 では `verification_mode` が含まれます。`agent_id`、`human_id`、`session_nonce` は検証済みのバンドルについてだけ返されます。

<a id="what-verified-means"></a>

### 「検証済み」の意味

検証済みのバンドルは、内部で一貫しており、それ自身が列挙する鍵で署名されています。バンドルの署名には RPR の `binding_keys`、エージェントのアーティファクトにはパスポートの鍵です。プリンシパルが誰かは証明しません。誰でも鍵を作り、任意の `human_id` を名乗る RPR を作れるからです。そのためには、信頼するプリンシパルを設定してください（次の節）。検証済みのバンドルは、セッションが切れるまで再送されることもあります。運用者のポリシーの、`verifier_id` を伴う `require_audience_binding`（バンドルの `manifest.intended_verifier` がそれを指していなければなりません）と、`require_session_expiry` / `max_session_duration_seconds` がそれを制限しますが、一回限りにはしません。

<a id="trusted-principals-and-strict-v1"></a>

### 信頼するプリンシパルと strict-v1

```typescript
import { configureVerifier, denyListRevocationSource } from '@dcp-ai/openclaw';

configureVerifier({
  trustedPrincipals: trustSet,                     // or () => trust set, read on every call
  profile: { profile: 'strict-v1', verifier_id: 'agent-gateway' },
  revocationSource: denyListRevocationSource({ url: 'https://revocation.acme.example/.well-known/dcp-revocations.json' }),
});
```

`trustedPrincipals` を使うと、結果には `admitted`、`principal_trust`、`profile`、`profile_compliance`、`codes`、`recorded_decision`、`trust_set_version`、`action_authorized`（常に `false`）が加わり、エージェントとプリンシパルはアドミッションを通ったバンドルについてだけ示されます（`docs/ADMISSION.md`、`spec/profiles/admission`）。`verified` は検証器の判定という意味を保ちます。プロファイルのもとでは、モデルの `verifier_policy` パラメーターは、より厳しいものであっても拒否され、ツールが定義しないパラメーター（信頼セット、オーディエンス、失効のスナップショット）は無視されます。`configureVerifier` は矛盾（`verifierPolicy` を伴うプロファイル、あるいは信頼するプリンシパルや失効のソースのないプロファイル）に対して `AdmissionConfigError` を投げ、以前の設定を保ちます。例外を投げる、または `undefined`、`null`、無効な信頼セットを返す `trustedPrincipals` の関数は、`errors` に理由を入れた `admitted: false` になり、ツールは例外を投げません。実行可能な例：`examples/strict-v1.mjs`。

テストは `tests/interop/v2/bundle_vectors.json` のすべてのケースを、それぞれ運用者のポリシーとその `verifier_policy_overrides` のもとで実行します。

<a id="supervising-the-trust-source"></a>

### 信頼のソースの監督

```typescript
import { configureVerifier, createSourceSupervisor } from '@dcp-ai/openclaw';

const supervisor = createSourceSupervisor({ maxInFlight: 16 });
configureVerifier({
  trustedPrincipals: ({ tenant, signal }) => loadTrustSet(tenant, { signal }),
  sourceSupervisor: supervisor,
  supervise: { trustTimeoutMs: 2000 },
});
```

**期限、容量、範囲。**

- 関数は `{ tenant, signal }` を受け取ります。`trustTimeoutMs`（1 から 2147483647 の整数）の後に届いた信頼セットは使われず、それは届いたときに単調な時計で測られます。そのとき呼び出しは、失敗したソースと同じ `admitted: false`（`The trusted principals are unavailable (TRUST_SOURCE_FAILED)`）になります。
- 同時に実行される呼び出しは最大 `maxInFlight` で、キューはありません。**枠が解放されるのは、関数が本当に完了したときだけ**です。完了しないソースは、プロセスが再起動するまで枠を持ち続けます。
- 容量は監督者のオブジェクトごとで、`@dcp-ai/express` が作った監督者（ESM でも CJS でも）を共有できます。
- ほかに保留中のものがない Node のプロセスは、期限が答えるまで生き続けます。
- strict-v1 のプロファイルでは、`supervise: { revocation: true }` が `revocationSource` を同じ監督者のもとで、`revocationTimeoutMs`（このときは 1 から 2147483647 の整数）を期限として実行します。`supervise` は `trustTimeoutMs`、`revocation: true`、またはその両方を受け取り、`revocation: true` は静的な信頼セットでも動きます。
  - ソースは `(subjects, { tenant, signal })` を受け取り、それぞれの答えは監督なしの場合と同じ結果になります。
  - `null`、失敗、時間切れ、空きの枠がないこと、閉じた監督者は、`codes: ["REVOCATION_UNAVAILABLE"]` を伴う `admitted: false` になります。`REVOCATION_INVALID` は期限の前にだけ数えられます。
  - 信頼と失効の呼び出しは監督者の枠を共有します。
  - `denyListRevocationSource` も、監督者の `signal` が中断されると fetch を中断します。
  - それがなければ、失効は以前と同じく `revocationTimeoutMs` を使います。

**再設定。**

- `configureVerifier` は、新しい信頼セット、プロファイル、期限、ソースの選択とともに、同じ監督者を保てます。そのカウンターは残り、呼び出しは開始時の期限を保ちます。
- まだ進行中の呼び出しを持つ監督者を、それがどのソースを監督していても、置き換えたり外したりすることになる場合は、以前の設定を保ったまま `AdmissionConfigError`（`CONFIG_PROFILE_CONTRADICTION`）を投げます。呼び出しは `executeVerifyBundle` が始まった時点から数えられるため、まだバンドルを検証していてソースを呼んでいない間も数えられ、その枠はソースが完了するまで数えられます。これは、呼び出しが進行中のまま `supervisor.close({ drainMs })` が戻った後でも同じです。閉じると新しい呼び出しは拒否されますが、枠は解放されません。`supervisor.stats().inFlight` が 0 になってから置き換えるか、プロセスを再起動してください。
- モデルのパラメーターはこれらのどれも設定できません。

**取り消し。**

- このバージョンの監督者は取り消しの機能も提供し、`@dcp-ai/express` の `cancelOnDisconnect` が使います。
- `dcp_verify_bundle` にはそのオプションがありません。そのホストは呼び出し元が去ったことを知らせず、`configureVerifier({ cancelOnDisconnect })` は未知のオプションとして例外を投げます。
- `stats().cancelled` は、古いパッケージの監督者のために型の上では省略可能です。`?? 0` として読んでください。

**しないこと。** `@dcp-ai/express` と同じ制限です：

- 関数の処理を止めることも、それが自ら始める処理に上限を設けることも、オブザーバーやソースの CPU を隔離することもしません。
- `onSourceEvent` は速くなければなりません。一度に 1 回の呼び出しで、残りは捨てられて数えられます。それが返すプロミスや thenable は `Promise.resolve` と同じように取り込まれるため、保留中のプロミスで解決された thenable はそれを使用中にしたままにします。thenable が始めて返さないプロミスには手が届きません。
- カウンターは `Number.MAX_SAFE_INTEGER` で止まります。

<a id="concept-mapping-openclaw--dcp"></a>
<a id="concept-mapping-openclaw-dcp"></a>

## 概念の対応：OpenClaw → DCP

| OpenClaw の概念 | DCP の対応物 |
|---|---|
| 所有者（人） | `ResponsiblePrincipalRecord` |
| エージェントのセッション | `AgentPassport`（許可されたツールから能力を対応付ける） |
| ツールの呼び出し | `Intent`（action_type はツール名から導く） |
| ツールの許可リスト/拒否リスト | `PolicyDecision` |
| DM のペアリング | `HumanConfirmation` |
| エージェントの行動 | ハッシュチェーンでつないだ `AuditEntry` |

<a id="openclaw-tool--dcp-action-type-mapping"></a>
<a id="openclaw-tool-dcp-action-type-mapping"></a>

## OpenClaw のツール → DCP の行動の種類の対応

| OpenClaw のツール | DCP の `action_type` | DCP の `channel` |
|---|---|---|
| `browser.*` | `browse` | `web` |
| `exec`, `bash` | `execute_code` | `runtime` |
| `web.fetch`, `web.search` | `api_call` | `api` |
| `write`, `edit`, `apply_patch` | `write_file` | `filesystem` |
| `sessions_send` | `api_call` | `api` |
| `cron`, `webhook` | `api_call` | `api` |

<a id="risk-scoring"></a>

## リスクの採点

意図の宣言のツールは、次に基づいてリスクスコアを計算します：

- **行動の種類** — 支払いとコードの実行は、閲覧より高く採点される
- **推定影響** — 低 / 中 / 高
- **データの分類** — 個人データ、認証情報、金融データはスコアを上げる

ポリシー判断：

- **approve**（リスク < 500）— 通常どおり進める
- **escalate**（500 ≤ リスク < 800）— 人に確認を求める
- **block**（リスク ≥ 800）— 行動は拒否され、明示的な上書きが必要

スコアは 0 から 1000 のミリリスクの整数です（ツールの答えでは `risk: 650/1000`）。
判断はエージェントへの助言です。エスカレートまたはブロックされた行動も、宣言されなかった行動も、プラグインの中で止める
ものはありません。

`dcp_sign_bundle` は 1 つの意図（その `intent_id`、または最新のもの）と、セッションの**すべての**監査エントリーを
使います。検証器はすべての監査エントリーがバンドルの `intent_id` を持つことを求めるため、複数の意図のもとで行動を記録した
セッションは、`verifySignedBundleV2` が拒否するバンドルを作ります。このツールは意図ごとにバンドルを分けません。

<a id="programmatic-usage"></a>

## プログラムからの利用

ツールは OpenClaw のプラグインの仕組みなしで直接使うこともできます：

```typescript
import {
  executeIdentitySetup,
  executeDeclareIntent,
  executeLogAction,
  executeGetAuditTrail,
} from '@dcp-ai/openclaw';

// Set up identity
const identity = await executeIdentitySetup({
  session_id: 'my-session',
  owner_name: 'Alice',
  jurisdiction: 'US',
});

// Declare intent
const intent = await executeDeclareIntent({
  session_id: 'my-session',
  action_type: 'api_call',
  target_channel: 'api',
  estimated_impact: 'low',
});

// Log action
await executeLogAction({
  session_id: 'my-session',
  intent_id: intent.intent_id,
  outcome: 'API call succeeded',
  evidence_tool: 'web.fetch',
});

// Get audit trail
const trail = await executeGetAuditTrail({ session_id: 'my-session' });
console.log(trail.entries);
```

<a id="dependencies"></a>

## 依存関係

- [`@dcp-ai/sdk`](../../sdks/typescript/README.md) — DCP の TypeScript SDK（型、暗号、ビルダー、署名者、検証器）
- [`@sinclair/typebox`](https://github.com/sinclairzx81/typebox) — JSON Schema の型ビルダー（OpenClaw がツールのパラメーターに使う）

<a id="license"></a>

## ライセンス

Apache-2.0
