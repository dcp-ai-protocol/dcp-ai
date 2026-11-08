<sub>[English](../../../../../spec/profiles/admission/README.md) · [中文](../../../../zh-CN/spec/profiles/admission/README.md) · [Español](../../../../es/spec/profiles/admission/README.md) · **日本語** · [Português](../../../../pt-BR/spec/profiles/admission/README.md)</sub>

<a id="admission-profile-principal-trust-and-strict-v1"></a>

# アドミッションのプロファイル：プリンシパルへの信頼と `strict-v1`

> [英語の仕様](../../../../../spec/profiles/admission/README.md)の参考訳です（07/11/2026 更新）。**規範となるのは英語版です**。この翻訳に規範的な効力はなく、内容が異なる場合は英語版が優先されます。識別子とコードブロックは翻訳せずにそのまま掲載しています。

**状態：** 草案、v1
**範囲：** 運用者が定めるプロファイルのもとで、検証器が V2 の署名付きバンドルを、すでに信頼しているプリンシパルからの証拠として受け入れるかどうか

---

<a id="1-purpose-and-layering"></a>

## 1. 目的と層

[VERIFICATION.md](../../../../../spec/VERIFICATION.md)（V2-1 から V2-14）は、バンドルが**検証済み**かどうか、つまりそのアーティファクトが損なわれておらず、一貫しており、バンドル自身が列挙する鍵で署名されているかを決めます。誰でも任意の `human_id` と自分の鍵で responsible principal record（RPR）を作れるため、検証済みのバンドルが証明するのは完全性と署名であって、プリンシパルが誰かではありません。

アドミッションは、検証を変えずに、その上に 2 つの省略可能な層を加えます：

1. **プリンシパルへの信頼**（§3）：プリンシパルのために署名した鍵が、運用者が与える信頼セットによれば、運用者がすでに信頼しているプリンシパルのものであること。
2. **`strict-v1` のプロファイル**（§4）：運用者が選ぶ固定の要件（ハイブリッドの署名、オーディエンス、短い署名されたセッションの期間、新しい失効の状態）で、リクエストが弱めることはできません。

どちらも有効にしない検証器は、以前とまったく同じに振る舞います。アドミッションが検証の手順を実装し直すことは決してなく、検証器が報告するものを読みます（§2.3）。

アドミッションは、**証拠**を受け入れるかどうかを決めます。行動は認可しません。このバージョンは、外部の認可をツール、その引数、その実行に結び付けることは決してありません（§7）。

<a id="2-inputs"></a>

## 2. 入力

<a id="21-clock"></a>

### 2.1 時計

検証とアドミッションのすべての時刻の比較は、Unix エポックからのミリ秒で表した 1 つの瞬間 `now` を使います。実装はそれをパラメーターとして受け取り、既定はシステムの時計です。タイムスタンプは `Z` または `±hh:mm` のオフセットを持つ RFC 3339 で、V2-4 と同じくミリ秒の精度で比べます。時計のずれの許容は 30 秒（`SKEW`）で、V2-4 と DCP-04 と同じです。

<a id="22-trust-set"></a>

### 2.2 信頼セット

運用者だけが与えます。ローカルの設定か、運用者が選んだ情報源です。バンドル（その鍵、`legal_name`、`jurisdiction`、そのほかの自己申告のフィールド）、リクエストやツールのパラメーター、RPR が挙げる URL から導いてはなりません（MUST NOT）。スキーマ：[`principal_trust_set.schema.json`](../../../../../schemas/v2/principal_trust_set.schema.json)。

```json
{
  "trust_set_version": "2026-11-01.1",
  "principals": [
    {
      "human_id": "human:acme-ops",
      "keys": [
        { "kid": "…", "alg": "ed25519", "public_key_b64": "…", "status": "active",
          "not_before": null, "expires_at": "2027-06-01T00:00:00Z" },
        { "kid": "…", "alg": "ml-dsa-65", "public_key_b64": "…", "status": "active" }
      ]
    }
  ]
}
```

信頼セットは読み込むときに検証されます。次の場合は、かっこ内の設定のエラーのコードで拒否されます：

| 条件 | コード |
|---|---|
| どの階層であれ、スキーマの外のフィールド | `CONFIG_UNKNOWN_FIELD` |
| `trust_set_version` がないか空でない文字列でない、`principals` が配列でない、プリンシパルの `keys` が空でない配列でない、`status` が `active`、`revoked`、`expired` のいずれでもない、`not_before` や `expires_at` が null でも RFC 3339 でもない | `CONFIG_INVALID_VALUE` |
| `human_id` がない、文字列でない、または空 | `CONFIG_TRUST_EMPTY_ID` |
| `alg` が `ed25519`、`ml-dsa-65`、`slh-dsa-192f` のいずれでもない、`public_key_b64` が正規の base64 でない（V2-5）か、そのアルゴリズムについて 32、1952、48 バイトでない | `CONFIG_TRUST_MALFORMED_KEY` |
| `kid` が `alg` と鍵のバイト列から導いた kid でない（V2-13） | `CONFIG_TRUST_KID_NOT_DERIVED` |
| `human_id` が 2 回挙げられている、またはセット全体で `kid` が 2 回挙げられている（1 つのプリンシパルの下でも 2 つの下でも） | `CONFIG_TRUST_DUPLICATE` |

重複は、同一かどうかにかかわらず、すべて拒否されます。情報源をまとめる運用者は、読み込む前にそれを解消します。プリンシパルのない信頼セットは有効で、誰も信頼しません。

信頼セットにこれらの問題が複数ある場合、そのセットが実際に持つ問題のうちどれか 1 つのコードを報告してかまいません。どのコードを報告しても信頼セットは拒否され、コードの間の優先順位は定めません。

鍵の状態として優先されるのは、信頼セットのものです。鍵を `active` と挙げるバンドルは、信頼セットが `revoked` か `expired` とした鍵、または `expires_at` が過ぎた鍵を復活させることはできません。

**ローテーション**は、信頼セットの明示的な更新（新しい `trust_set_version`）です。運用者は新しい鍵を加え、必要なら重なりの間は古い鍵を `active` のままにし、その後それを退かせます（`revoked`、`expired`、`expires_at`、または削除）。バンドルの鍵は決して信頼の源にならないため、バンドルが自らのローテーションを認可することはできません。

エージェントの鍵は信頼セットに登録しません。エージェントは、`passport_hash` を覆うマニフェストに対するプリンシパルの署名によって、プリンシパルに結び付けられます（V2-6、V2-7）。

<a id="23-signer-keys-reported-by-the-verifier"></a>

### 2.3 検証器が報告する署名者の鍵

確認する各複合署名（マニフェストに対するバンドルの署名、4 つのアーティファクト、各 PQ のチェックポイント）について、検証器は構成要素ごとに、解決した鍵のエントリーと、その構成要素が検証を通ったかどうかを報告します：

```json
{ "signature": "bundle", "component": "classical", "kid": "…", "alg": "ed25519",
  "public_key_b64": "…", "verified": true }
```

`signature` は `bundle`、`responsible_principal_record`、`agent_passport`、`intent`、`policy_decision`、または `pq_checkpoints[<checkpoint_id>]` で、`component` は `classical` か `pq` です。検証器が鍵を解決しなかった構成要素（`pq_only` のもとで存在しないクラシカルの鍵）は報告されません。これらは実際に署名を検証した鍵で、検証器が解決したとおりに解決されています。アドミッションが別の方法で鍵を解決することは決してありません。このリストは検証済みのバンドルについて定義されます。検証を通らなかったものについては、実装は最初の失敗で止まっても続けてもよく、アドミッションはそれを使いません。

**プリンシパルの署名**は `bundle` と `responsible_principal_record` です。

<a id="24-revocation-snapshot"></a>

### 2.4 失効のスナップショット

`strict-v1` が求めます。運用者のアダプターは、運用者が設定したローカルまたはリモートの情報源（中央のサービスは不要）から、バンドルの**失効の対象**、つまりパスポートの `agent_id` と、すべての署名を含む検証済みの署名者の鍵（§2.3）それぞれの kid についてそれを得ます。スキーマ：[`revocation_snapshot.schema.json`](../../../../../schemas/v2/revocation_snapshot.schema.json)。

```json
{ "checked_at": "2026-11-01T00:00:20Z",
  "agents": { "agent:acme-bot": "not_revoked" },
  "keys": { "<kid>": "not_revoked", "<kid>": "not_revoked" } }
```

`checked_at` は情報源がこれらの状態を確定した時刻で、アダプターがそれを読んだ時刻ではありません。各状態は `revoked`、`not_revoked`、`unknown` のいずれかです。答えられない情報源（時間切れ、エラー、到達不能）はスナップショットを作りません。アダプターは失敗を `not_revoked` に変えてはなりません（MUST NOT）。

<a id="3-principal-trust"></a>

## 3. プリンシパルへの信頼

信頼セットが与えられ、バンドルが検証を通った（V2-1 から V2-14）場合にだけ評価され、そうでなければ結果は `not_evaluated` です。`human_id` を RPR のペイロードの `human_id` とすると：

- **T1.** `human_id` が信頼セットのプリンシパルでない：`TRUST_PRINCIPAL_UNKNOWN`。終了。
- **T2.** 各プリンシパルの署名（§2.3）の検証済みの各構成要素について、同じ `kid` を持つそのプリンシパルの信頼セットのエントリーを、次のうち最初に当てはまるもので判定する：
  - ない、または `alg` か鍵のバイト列が異なる：`TRUST_KEY_NOT_ANCHORED`；
  - `status` が `revoked`：`TRUST_KEY_REVOKED`；
  - `status` が `expired`、または `expires_at` が `now` より前：`TRUST_KEY_EXPIRED`；
  - `not_before` が `now` より後：`TRUST_KEY_NOT_YET_VALID`。

プリンシパルの検証済みの構成要素がまったくない検証済みのバンドルも、`TRUST_KEY_NOT_ANCHORED` になります。T1 と T2 がどのコードも加えなければプリンシパルは `trusted`、そうでなければ `untrusted` です。検証済みの構成要素はすべて数えられます。プリンシパルの Ed25519 の鍵だけを信頼しても、その PQ の鍵や RPR のほかの鍵が信頼されることにはなりません。

<a id="4-the-strict-v1-profile"></a>

## 4. `strict-v1` のプロファイル

<a id="41-configuration"></a>

### 4.1 設定

スキーマ：[`admission_profile.schema.json`](../../../../../schemas/v2/admission_profile.schema.json)。

```json
{ "profile": "strict-v1", "verifier_id": "api.acme.example",
  "max_session_duration_seconds": 300, "max_revocation_age_seconds": 300,
  "verifier_policy": { "advisory_rejected_algs": ["slh-dsa-192f"] } }
```

| フィールド | 規則 |
|---|---|
| `profile` | 必須、`"strict-v1"` |
| `verifier_id` | 必須、空でない文字列。バンドルの署名された `intended_verifier` はこれと等しくなければならない |
| `max_session_duration_seconds` | 1 から 300 の整数、既定は 300 |
| `max_revocation_age_seconds` | 1 から 300 の整数、既定は 300 |
| `verifier_policy` | 省略可能な VerifierPolicy のフィールド。それぞれ、プロファイルのポリシーを保つか厳しくすることしかできない（§4.2） |

プロファイルは既定値ではなく要件を定めます。その検証器のポリシーは次のとおりです：

| フィールド | 値 | `verifier_policy` が設定できるもの |
|---|---|---|
| `default_mode`、`risk_overrides` のすべてのティア | `hybrid_required` | `hybrid_required` のみ。`pq_only` はクラシカルの署名を省くため、プロファイルを満たさない |
| `require_session_binding`、`require_composite_binding`、`require_session_expiry`、`require_audience_binding` | `true` | `true` のみ |
| `allow_v1_bundles`、`allow_classical_fallback_disable` | `false` | `false` のみ |
| `verifier_id` | プロファイルのもの | 同じ値のみ |
| `max_session_duration_seconds` | プロファイルのもの | 1 からプロファイルの値まで。小さい方が適用される |
| `min_classical`、`min_pq` | `1` | `1` のみ：複合署名には 1 つのクラシカルと 1 つの PQ の構成要素がある |
| `accepted_hash_algs` | `["sha256", "sha384"]` | この 2 つのみ、順序は任意：検証器は V2-4 によりバンドルの `hash_alg` を確認する |
| `max_key_age_days` | `365` | `365` のみ：検証器は鍵の古さについて警告するだけ |
| `accepted_classical_algs` | `["ed25519"]` | 空でない部分集合 |
| `accepted_pq_algs` | `["ml-dsa-65", "slh-dsa-192f"]` | 空でない部分集合 |
| `advisory_rejected_algs` | `[]` | 任意の文字列のリスト |
| `warn_classical_only_deprecated` | `false` | 任意の真偽値（警告のみ） |

`verifier_policy` が変えられるフィールドは、どれもすべての検証器が同じように適用するものなので、プロファイルが、ある SDK が黙って無視したり拒否したりする要件を伴って読み込まれることは決してありません。

プロファイルを読み込むときに発生する設定のエラー：

| 条件 | コード |
|---|---|
| 最上位または `verifier_policy` の中の、スキーマの外のフィールド | `CONFIG_UNKNOWN_FIELD` |
| 型の誤った値、または列挙 `classical_only`、`hybrid_preferred`、`hybrid_required`、`pq_only` の外にあるモード（`default_mode`、`risk_overrides` の値）、`"strict-v1"` でない `profile` | `CONFIG_INVALID_VALUE` |
| `verifier_id` がないか空、1 未満か 300 を超える最大値、上の表が認めないその他の `verifier_policy` の値（その列挙のうち `hybrid_required` 以外のモードや、既知かどうかにかかわらず許された部分集合の外にあるアルゴリズムなど） | `CONFIG_PROFILE_CONTRADICTION` |

設定に複数の問題がある場合、そのどれか 1 つのコードを報告してかまいません。

プロファイルを有効にするアダプターは、信頼セットや失効の情報源がない場合や、プロファイルを弱める自らのオプション（バンドルのないリクエストの受け入れ、独自の検証器のポリシー、フェイルオープンの失効の確認）も、`CONFIG_PROFILE_CONTRADICTION` で拒否します。

<a id="42-profile-checks"></a>

### 4.2 プロファイルの確認

`max` を実効のセッションの最大期間、`m` をバンドルのマニフェストとすると：

- **P1.** `bundle.dcp_bundle_version` が `"2.0"` でない：`PROFILE_V2_REQUIRED`。終了：ほかには何も評価しない。
- **P2.** `m.intended_verifier` がない、null、文字列でない、または空：`PROFILE_AUDIENCE_MISSING`。`verifier_id` と異なるそれ以外の値：`PROFILE_AUDIENCE_MISMATCH`。
- **P3.** `m.session_issued_at` がないか null：`PROFILE_SESSION_START_MISSING`。`m.session_expires_at` がないか null：`PROFILE_SESSION_EXPIRY_MISSING`。どちらかが存在するが RFC 3339 でない、または開始が期限より後：`PROFILE_SESSION_TIME_INVALID`。それ以外では：
  - 開始が `now + SKEW` より後：`PROFILE_SESSION_NOT_STARTED`；
  - 期限が `now` より前：`PROFILE_SESSION_EXPIRED`；
  - 期限から開始を引いたものが `max` 秒より大きい：`PROFILE_SESSION_TOO_LONG`。
- **P4.** バンドルの署名または RPR の `composite_sig` が、`pq` の構成要素を持つ `pq_over_classical` でない：`PROFILE_HYBRID_REQUIRED`。検証の後で、いずれかのプリンシパルの署名に検証済みのクラシカルまたは PQ の構成要素がない場合、または検証モードが `hybrid_required` でない場合も同様。

P2 と P3 は、プロファイルのポリシーが V2-4 に適用させるものをコード付きで繰り返すもので、拒否されたバンドルがどの要件で失敗したかを示すようにします。それらは認証される前のマニフェストを読みます。受け入れられるのは検証済みのバンドルだけです。

<a id="43-revocation-checks"></a>

### 4.3 失効の確認

バンドルが検証を通った場合に、§2.4 の対象で評価されます：

- **R1.** スナップショットがない：`REVOCATION_UNAVAILABLE`。終了。
- **R2.** スキーマの外のスナップショット（フィールドの欠落や追加、RFC 3339 でない `checked_at`、3 つ以外の状態）、または `checked_at` が `now + SKEW` より後：`REVOCATION_INVALID`。終了。
- **R3.** `now - checked_at` が `max_revocation_age_seconds` より大きい：`REVOCATION_STALE`。
- **R4.** 対象が `revoked`：`REVOCATION_REVOKED`。
- **R5.** 対象がスナップショットにないか `unknown`：`REVOCATION_UNKNOWN`。

対象を失効と示す古いスナップショットは、両方のコードを報告します。これらの結果のどれも `not_revoked` とは見なされません。

<a id="5-admission"></a>

## 5. アドミッション

<a id="51-procedure"></a>

### 5.1 手順

署名付きバンドル、省略可能なプロファイル、省略可能な信頼セット（プロファイルでは必須）、失効のスナップショット（プロファイルのもとでだけ評価）、そして `now` が与えられたとき：

1. プロファイルのもとで P1。P1 が当てはまる場合は、ほかに何も評価せず、バンドルは検証を通らなかったものとして報告する。そうでなければ P2、P3、P4 の構造の部分。
2. `now` において、プロファイルのポリシー、またはプロファイルがなければ呼び出し元のポリシーのもとで、バンドルを V2 の署名付きバンドルとして検証する（V2-1 から V2-14）。検証を通らない：`VERIFICATION_FAILED`。V2 でないバンドルは、ポリシーの `allow_v1_bundles` が何であっても、ここでは検証を通らない（[DCP-AI-v2.0](../../../../../spec/DCP-AI-v2.0.md#implementation-notes-informative)、§17 についての注）。
3. 検証を通った場合：信頼セットが与えられていればプリンシパルへの信頼（§3）、プロファイルのもとでは P4 の検証済みの部分と失効の確認（§4.3）。

実装は、呼び出し元がすでに持っている検証を再利用できるように、手順 3 を単独で公開してもかまいません（`evaluateAdmissionV2` とその対応物）。その関数は与えられた検証の結果を信頼し、検証し直しません。それは、同じバンドルについて、同じ `now` で、プロファイルがあればプロファイルのポリシーのもとで行った手順 2 の結果でなければなりません。作り上げた結果、別のバンドルの結果、より弱いポリシーのもとでの結果は、誤った答えを返します。組み合わせた関数（`admitSignedBundleV2`）は両方の手順を行います。

プロファイルには信頼セットが必要です。プロファイルがあり信頼セットがない呼び出しは、組み合わせた関数でも、単独で公開した手順 3 でも、アダプターと同じように（§4.1）`CONFIG_PROFILE_CONTRADICTION` で拒否されます。組み合わせた関数は、プロファイルなしで使うための呼び出し元の検証器のポリシーも受け付けますが、プロファイルがある場合はそのようなポリシーを同じコードで拒否します。プロファイルが自身のポリシーを定めるからです。これらの拒否が検証の前に起きるか後に起きるかは、この文書では定めません。

<a id="52-result"></a>

### 5.2 結果

| フィールド | 値 |
|---|---|
| `verified` | 検証器の判定で、その意味は変わらない |
| `verification` | 検証器の完全な結果（エラー、警告、詳細、署名者の鍵） |
| `principal_trust` | `trusted`、`untrusted`、または `not_evaluated`（信頼セットがない、または検証されていない） |
| `profile` | `"strict-v1"` または null |
| `profile_compliance` | `compliant`、`non_compliant`、または `not_evaluated`（プロファイルなし） |
| `admitted` | `verified` であり、信頼セットが与えられていれば `principal_trust` が `trusted` で、プロファイルのもとでは `profile_compliance` が `compliant` |
| `action_authorized` | このバージョンでは常に `false`（§7） |
| `recorded_decision` | 検証済みのバンドルのポリシー判断の `decision`（`approve`、`escalate`、`block`）、それ以外は null |
| `trust_set_version` | 信頼セットのバージョン、または null |
| `errors` | 加えられた各コードについての `{ code, message }`、§5.1 の順：P1、P2、P3、P4 の構造の部分、`VERIFICATION_FAILED`、プリンシパルへの信頼、P4 の検証済みの部分、失効。複数の構成要素や対象に当てはまる確認は、それぞれについて 1 回ずつコードを加えてかまいません。順序はこれらの段階の間だけのもので、プリンシパルへの信頼や失効のような 1 つの段階の中では順序を定めません |

`profile_compliance` は、バンドルが検証を通り、`PROFILE_*` や `REVOCATION_*` のコードが加えられなかったときに `compliant` です。`block` や `escalate` の判断を記録したバンドルは、その判断の証拠として受け入れられることがあります。`action_authorized` は `false` のままです。

未知のプリンシパルからの自己一貫したバンドルは検証済みのままですが、信頼セットが与えられていれば受け入れられません。

<a id="53-codes"></a>

### 5.3 コード

| コード | 手順 |
|---|---|
| `VERIFICATION_FAILED` | §5.1 の手順 2 |
| `TRUST_PRINCIPAL_UNKNOWN`, `TRUST_KEY_NOT_ANCHORED`, `TRUST_KEY_REVOKED`, `TRUST_KEY_EXPIRED`, `TRUST_KEY_NOT_YET_VALID` | §3 |
| `PROFILE_V2_REQUIRED`, `PROFILE_AUDIENCE_MISSING`, `PROFILE_AUDIENCE_MISMATCH`, `PROFILE_SESSION_START_MISSING`, `PROFILE_SESSION_EXPIRY_MISSING`, `PROFILE_SESSION_TIME_INVALID`, `PROFILE_SESSION_NOT_STARTED`, `PROFILE_SESSION_EXPIRED`, `PROFILE_SESSION_TOO_LONG`, `PROFILE_HYBRID_REQUIRED` | §4.2 |
| `REVOCATION_UNAVAILABLE`, `REVOCATION_INVALID`, `REVOCATION_STALE`, `REVOCATION_REVOKED`, `REVOCATION_UNKNOWN` | §4.3 |
| `CONFIG_UNKNOWN_FIELD`, `CONFIG_INVALID_VALUE`, `CONFIG_PROFILE_CONTRADICTION`, `CONFIG_TRUST_EMPTY_ID`, `CONFIG_TRUST_MALFORMED_KEY`, `CONFIG_TRUST_KID_NOT_DERIVED`, `CONFIG_TRUST_DUPLICATE` | 信頼セットやプロファイルを読み込むときに発生 |

メッセージは制限されており、比べている識別子を超えて、秘密鍵、トークン、運用者の設定を含むことは決してありません。

<a id="6-adapters-and-caching"></a>

## 6. アダプターとキャッシュ

コアの関数は決定的で、ネットワークの呼び出しをしません。アダプター（ミドルウェア、ツール、サーバー）は、運用者の設定を解決し、信頼と失効の情報源を呼び、判断を適用します：

- **A1.** リクエストが保護されたハンドラーに届くのは、`admitted` が真の場合だけです。信頼やプロファイルが設定されたら、アダプターは `verified` だけで先へ進むことは決してなく、バンドルのないリクエストをハンドラーに届かせるオプションは設定の時点で拒否します（`CONFIG_PROFILE_CONTRADICTION`）。運用者が信頼の情報源を設定した場合、すべての答えは信頼セットとして読み込まれます（§2.2）。失敗した、何も答えない（`undefined`、`null`）、または有効な信頼セットでないものを答える情報源は、リクエストを拒否します。それが「信頼セットなし」を表すことは決してありません。§5.1 の評価はそれを、プリンシパルへの信頼なしのアドミッションと解釈するからです。
- **A2.** プロファイル、信頼セットまたはその情報源、失効の情報源、その URL と認証情報、テナントは、運用者のコードと設定から来ます。リクエストのフィールド、ヘッダー、ツールのパラメーターがそれらを選んだり変えたりすることはありません。リモートの情報源は TLS で取得し（暗号化しない HTTP はループバックのホストに対してだけ）、リダイレクトをたどらず、サイズと時間を制限します。
- **A3.** キャッシュは、検証器の結果（§5.1 の手順 2）を、正規の署名付きバンドルの SHA-256、正規の実効の検証器のポリシーの SHA-256、運用者が導いたテナントをキーとして、その TTL、`session_expires_at`、RPR の `expires_at`、各鍵の `expires_at` のうち最も早いものより長くは保持しない形で、保持してもかまいません（MAY）。プリンシパルへの信頼、プロファイルの確認、失効は、各アドミッションで、現在の `now` において、現在の信頼セットと新しい失効のスナップショットで評価されます。そのため、キャッシュした受け入れが、信頼セットの変更、失効、異なるポリシー、異なるテナントを越えて生き残ることは決してありません。

<a id="7-guarantees-and-limits"></a>

## 7. 保証と限界

`strict-v1` のもとで、受け入れられたバンドルは：

- すべての署名について両方の署名の構成要素が有効な状態で、V2-1 から V2-14 のもとで検証を通っている；
- 運用者の信頼セットがその `human_id` について挙げる、`now` において有効で期限内の鍵で、プリンシパルのために署名されている（RPR とマニフェスト、両方の構成要素）；
- 署名された `intended_verifier` でこの検証器を指している；
- 最大 `max_session_duration_seconds` の署名されたセッションの期間を持ち、`now` において（`SKEW` の範囲で）始まっており、期限切れでない；
- 最大 `max_revocation_age_seconds` 前の失効のスナップショットが失効していないと報告する、エージェントと検証済みの署名者の鍵を持つ。

次は保証**しません**：

- **一回限りの使用。** 共有されたセッションの nonce、オーディエンス、期限は、バンドルがどこで、どれだけの間再送されうるかを制限しますが、一回限りにはしません。一回限りの使用が必要な検証器は、消費した nonce やバンドルのハッシュの記録を自ら保持します。検証とアドミッションはそれらを消費しません。
- **行動の認可。** `action_authorized` は常に `false` です。アドミッションは、証拠が本物で信頼するプリンシパルから来たことを示します。ツールが与えられた引数で実行してよいかどうかは、後のフェーズです。
- **信頼セットを超えるアイデンティティ。** 信頼は、運用者の信頼セットとその情報源とまったく同じだけのものです。
- **スナップショットより新しい失効。** `checked_at` の後に行われた失効は、次のスナップショットまで見えません。

<a id="8-api-correspondence"></a>

## 8. API の対応

| 概念 | TypeScript（`@dcp-ai/sdk`） | Python（`dcp_ai.v2`） | Go（`dcp/v2`） | Rust（`dcp_ai::v2`） |
|---|---|---|---|---|
| `now` での検証 | `verifySignedBundleV2(b, registry, policy, { now })` | `verify_signed_bundle_v2(b, registry, policy, now_ms=…)` | `VerifySignedBundleV2At(registry, json, policy, now)` | `verify_signed_bundle_v2_at(&b, &policy, now_ms)` |
| 署名者の鍵（§2.3） | `details.signer_keys` | `details["signer_keys"]` | `SignerKeys` | `V2VerificationDetails.signer_keys` |
| 信頼セットの読み込み | `createPrincipalTrustStore(json)` | `create_principal_trust_store(json)` | `NewPrincipalTrustStore(json)` | `PrincipalTrustStore::from_json(&json)` |
| プロファイルの読み込み | `resolveStrictV1Profile(json)` | `resolve_strict_v1_profile(json)` | `ResolveStrictV1Profile(json)` | `resolve_strict_v1_profile(&json)` |
| 失効の対象 | `revocationSubjects(b, verification)` | `revocation_subjects(b, verification)` | `RevocationSubjects(b, verification)` | `revocation_subjects(&b, &verification)` |
| 評価（暗号なし） | `evaluateAdmissionV2(input)` | `evaluate_admission_v2(…)` | `EvaluateAdmissionV2(…)` | `evaluate_admission_v2(…)` |
| 検証と評価 | `admitSignedBundleV2(b, registry, options)` | `admit_signed_bundle_v2(b, registry, …)` | `AdmitSignedBundleV2(registry, json, options)` | `admit_signed_bundle_v2(&b, &options)` |
| 設定のエラー | `AdmissionConfigError`（`code`） | `AdmissionConfigError`（`code`） | `*AdmissionConfigError`（`Code`） | `AdmissionConfigError`（`code`） |

結果のフィールドは、すべての SDK の JSON の形で §5.2 の名前を保ちます。

<a id="9-test-vectors"></a>

## 9. テストベクター

[`tests/interop/v2/admission_vectors.json`](../../../../../tests/interop/v2/admission_vectors.json) は共有のケースを持ちます。署名付きバンドル、信頼セット、プロファイル、失効のスナップショット、`now`、そして各ケースについて、期待される `verified`、`principal_trust`、`profile_compliance`、`admitted` とコードの集合を、確認する規則とともに持ちます。設定のケースは、設定と期待されるエラーのコードを示します。すべての SDK がそれらを実行します。基準は SDK の間の一致ではなく、期待値です。

<a id="10-delegated-admission-opt-in"></a>

## 10. 委任付きアドミッション（オプトイン）

追加の関数が、末端のバンドルを、そのエージェントへ委任する [DCP-09](../../../../../spec/DCP-09.md) のマンデートチェーン、および
委任する各エージェントのバンドル 1 つずつと一緒にアドミッションします。オプトインです。既定でこれを呼ぶものはなく、
§1〜§9、`strict-v1`、そのコード、そのベクターは変わりません。

**入力。** 証拠はリクエストから来てもかまいません。末端の署名付きバンドル、マンデートチェーン（ルートが先頭）、委任する
エージェントごとの署名付きバンドル 1 つです。残りは運用者が与え、リクエストが与えることはありません（A2）。

- 信頼セット、または読み込み済みの信頼ストア（必須）。
- `strict-v1` プロファイルまたは検証者ポリシーのどちらか一方。両方は不可。
- 構成のエージェントと鍵の失効のスナップショット、およびマンデートの失効のスナップショット
  `{ checked_at, mandates: { <mandate_id>: status } }`（スナップショットがないことは、ソースが応答できなかったことを
  意味し、失効の確認がそれを報告します）。
- プロファイルがなければ `max_revocation_age_seconds`（1〜300 の整数）。プロファイルがあればプロファイルの値が適用され、
  両方を渡すと `CONFIG_PROFILE_CONTRADICTION` です。
- `now`。1 回だけ読みます。

**手順。** すべては、開始時に取った入力のスナップショットに対して、その 1 つの `now` で評価します。証拠は JSON の文書で、
各 SDK の JSON の表現によります。TypeScript と Python は JSON の値、Go は JSON のテキストをバイトで、Rust は
`serde_json::Value` を受け取ります。その表現で JSON でないものは `DELEGATION_INPUT_INVALID` です。たとえば
TypeScript では `Map`、`Date`、クラスのインスタンス、アクセサー、`undefined`、Python ではタプル、dict のサブクラス、
その他のオブジェクト、Go では解析できないテキストや配列でないチェーンです。

1. **形式。** チェーンは空でなく、その中で `mandate_id` もエージェントも重複しません（`DELEGATION_REPEATED_ID`）。
2. **下限。** チェーンの最大の `minimum_security_tier`（未知の値は `elevated` とみなす）は階層を引き上げるだけです。
   チェーンが検証を通った場合、その実効的な階層はそれと等しくなければなりません（`DELEGATION_FLOOR_MISMATCH`）。
3. **バンドル。** 末端と各委任者は、その下限で、同じ `now`、同じプロファイルまたはポリシーのもとで検証され、その後
   アドミッションされます（§5）。末端自身のアドミッションのコードはそのまま報告されます。ただし `REVOCATION_*` は除き、
   これは手順 10 が各対象について 1 回だけ評価します。アドミッションされない委任者は
   `DELEGATION_DELEGATOR_NOT_ADMITTED` となり、その委任者自身のコードは入れ子の結果に残ります。
4. **結び付き。** チェーンの `human_id` は各バンドルのプリンシパルです（`DELEGATION_PRINCIPAL_MISMATCH`）。最後の
   マンデートは末端のエージェントを指します（`DELEGATION_LEAF_MISMATCH`）。委任する各エージェントにちょうど 1 つの
   バンドルがあります（`DELEGATION_DELEGATOR_MISSING`、`DELEGATION_DELEGATOR_UNEXPECTED`）。
5. **鍵。** プリンシパルの鍵は末端の RPR の `binding_keys`、各エージェントの鍵はその検証済みバンドルのパスポートの
   `keys` です。使われるすべての鍵は、導出された `kid` と正準な base64 を持ちます（V2-13）。2 つの主体のリストに同じ
   鍵がある場合、または 1 つのリストで `kid` が重複する場合は `DELEGATION_KEY_AMBIGUOUS` です。
6. **チェーン。** それらの鍵と、状態が `revoked` のマンデートを使った
   [DCP-09 §3.5.2](../../../../../spec/DCP-09.md#352-chain-verification)（`DELEGATION_CHAIN_INVALID`）。
7. **チェーンへのアルゴリズムポリシー。** 検証者のポリシーは、V2-10 がバンドルに適用するのと同じように、末端の実効モード
   のもとで、チェーンが使うすべての署名の構成要素に適用されます。`pq_only` では古典的なリストを参照しませんが、各
   マンデートの両方の構成要素が検証を通らなければなりません（DCP-09 §3.5.1）。そうでなければ
   `DELEGATION_ALGORITHM_REJECTED` です。
8. **ルートの固定。** ルートの `human_composite_sig` の各構成要素は、信頼セットがそのプリンシパルについて挙げ、`now`
   において有効で有効期間内にある鍵で署名されていなければなりません（§3）。鍵が RPR にあるだけでは足りません。
   そうでなければ `TRUST_KEY_*` のコードです。
9. **`session_nonce`。** マンデートとバンドルの間でも、マンデート同士の間でも一致は求めません。マンデートのノンスは、
   それを発行したセッションのものです。各バンドルの中では引き続き V2-4 が適用されます。
10. **失効。** §4.3 を、同じ `now`、同じ最大経過時間で、チェーンの各エージェントと、バンドルまたはマンデートが使う
    各鍵に適用します。マンデートのスナップショットは各 `mandate_id` に適用されます。

**結果。** どの手順もコードを追加しなかったときの `admitted`、`delegation_verified`、常に `not_evaluated` の
`activation` と常に `false` の `delegation_active`（アクティベーションは §12 が評価します）、常に `false` の
`action_authorized`、末端の `security_tier` と `verification_mode`、`chain`（`depth`、`mandate_ids`、
`effective_floor`、評価されない `leaf_authority_scope` のコピー）、末端と各委任者のアドミッションの結果、`inputs`、
`errors` です。構成のエラーは、何かを検証する前に、§5.3 の `AdmissionConfigError` になります。

**制限。** すべては `now` で確認します。過去の時点での検証は定義されていません。各委任者について、現在の、アドミッション
済みのバンドルが必要です。DCP-09 が禁止していないエージェントの重複（A → B → A）は拒否されます。レジストリと暗号
プロバイダーは運用者のものであり、信頼されます。Go では、入力のコピー中に別の goroutine から入力を変更する呼び出し元は
データ競合を起こします。WASM には委任付きアドミッションがありません。

| SDK | 関数 |
|---|---|
| TypeScript | `admitDelegatedBundleV2(evidence, registry, operator)` |
| Python | `admit_delegated_bundle_v2(evidence, registry, operator)`（async） |
| Go | `AdmitDelegatedBundleV2(registry, evidence, operator)` |
| Rust | `admit_delegated_bundle_v2(&evidence, &operator)` |

ベクター：[`tests/interop/v2/delegated_admission_vectors.json`](../../../../../tests/interop/v2/delegated_admission_vectors.json)。
71 件のケースと 6 件の構成のケースです。

<a id="11-admission-from-bytes-opt-in"></a>

## 11. バイトからのアドミッション（オプトイン）

追加の関数が、署名付きバンドルをバイトとして受け取り、どのパーサーもそれを読む前にそのバイトについて判定します。§5 の
オプションを伴えばアドミッション、信頼セットもプロファイルもなければ検証です。

1. **スナップショット。** バイトをコピーし、解析の前にそのコピーについて `unit_sha256` を計算します。
2. **スキャナー。** 実験的な候補プロファイルの入口のスキャナーを、変更せずに使います。拒否はそのクラスとオフセットを
   保持します（層 `scanner`）。
3. **可搬なドメイン。** 文字列の外では、すべての数値リテラルが `-?(0|[1-9][0-9]*)` でなければなりません。小数部、
   指数、`-0` はいずれも不可です。そうでなければ、リテラルのオフセットを伴って `NUMBER_NOT_PORTABLE` です（層
   `domain`）。これは追加の拒否で、すべての SDK で同じです。署名者が `100` と書いたところを `100.0` と書く伝送路は、
   署名がまだ検証を通るとしても拒否されます。
4. **パーサー。** SDK 自身のデコーダーがコピーを解析します。その値を `dcp-jcs-v1` で正準化したものは、スキャナーの正準
   なバイトと等しくなければなりません。違いや解析の失敗は `INGRESS_PARSER_MISMATCH` です（層 `parser`）。これはその
   パーサーの局所的な不具合であり、データについての規則ではありません。
5. **アドミッション**（§5）を、まさにその値に対して行い、結果はその値を返します。呼び出し元の入力は再び解析されません。

結果には `ingress`（`accepted`、`layer`、`class`、`offset`、`unit_sha256`、`canonical_sha256`）、`admission`
（入口で拒否された場合は何も検証されていないため null）、`value` があります。`dcp-jcs-v1`、候補プロファイル、
`strict-v1`、既定値、解析済みの値を受け取る関数は変わりません。それらの関数は、重複したキーや単独のサロゲートの
ように、パーサーがすでに失ったものを取り戻すことはできません。サイズと時間の予算はこの関数の対象外です。

| SDK | 関数 |
|---|---|
| TypeScript | `admitSignedBundleV2FromBytes(bytes, registry, options)` |
| Python | `admit_signed_bundle_v2_from_bytes(data, registry, *, …)`（async。§5 のオプションはキーワード引数） |
| Go | `AdmitSignedBundleV2FromBytes(registry, signedBundleJSON, opts)` |
| Rust | `admit_signed_bundle_v2_from_bytes(bytes, &options)` |

ベクター：[`tests/interop/v2/v1_ingress_vectors.json`](../../../../../tests/interop/v2/v1_ingress_vectors.json)。

<a id="12-delegation-activation-opt-in"></a>

## 12. 委任のアクティベーション（オプトイン）

アクティベーションは、§10 に加えて、各マンデートに対する受任エージェントの署名付き確認応答を評価します。確認応答は
[DCP-09 §3.3.1](../../../../../spec/DCP-09.md#331-mandate-acknowledgment-opt-in) で定義されています。この関数は、証拠、確認応答、
認識しきい値、構成のスナップショットを 1 つ取り、`now` を 1 つ固定し、そのスナップショットに対して §10 を実行し、
構成がアドミッションされ入力が有効な場合にだけ、構成が検証したエージェント、鍵、ポリシー、モード、失効の
スナップショットを使って確認応答を評価します。証拠は署名付きの記録を、それが署名するハッシュとともに運び、運用者は
信頼セットと §10 の構成を与えます。この関数は、事前に計算された構成の結果も鍵のマップも、権威としては受け付けません。
エージェントの鍵は構成が検証したパスポートの鍵であり、マンデート、チェーン、しきい値のハッシュは成果物から再計算され、
確認応答と比較されます。

結果は `composition` を入れ子にします。これは同じスナップショットに対する §10 の結果そのものです（その中の
`activation` は `not_evaluated` のままです）。さらに `activation`（`evaluated` または `not_evaluated`）、
`delegation_active`（構成がアドミッションされ、チェーンの各マンデートにちょうど 1 つの有効な確認応答がある場合にだけ
true）、`action_authorized`（常に `false`）、`acknowledgments` の下のマンデートごとのエントリー、`inputs`、および
DCP-09 §3.3.1 のコードを持つ `errors` を加えます。`admitDelegatedBundleV2` とその対応関数は変わりません。

| SDK | 関数 |
|---|---|
| TypeScript | `evaluateDelegationActivationV2(evidence, registry, operator)` |
| Python | `evaluate_delegation_activation_v2(evidence, registry, operator)`（async） |
| Go | `EvaluateDelegationActivationV2(registry, evidence, operator)` |
| Rust | `evaluate_delegation_activation_v2(&evidence, &operator)` |

<a id="implementation-notes-informative"></a>

## 実装に関する注記（参考）

> **2026 年 10 月 25 日に追加。規範的ではありません。** これらの注記は要件を加えず、上の内容を何も変えません。`main` のリファレンスの
> コードがこの文書とどう関係するかを説明するものです。食い違う場合は、上の規範的な本文がそのまま有効です。

- V2-1 から V2-14 への参照は、[VERIFICATION.md](../../../../../spec/VERIFICATION.md) の規範的なチェックリストを指しています。`@dcp-ai/sdk` 2.2.1、`@dcp-ai/wasm` 2.1.1、`dcp-ai` 2.10.1（PyPI）、Go v2.11.1、Rust `dcp-ai` 2.11.1より前の SDK のパッケージは V2-11 の二次の SHA3-256 のフィールドを確認しないため、それらでは「V2-1 から V2-14 のもとで検証を通っている」（§7）はその限界付きで成り立ちます。これらのバージョン以降では、SDK の検証器は存在する二次フィールドを確認し、存在しないものは要求しません。ほかのすべての検証の確認、プリンシパルへの信頼、`strict-v1` のすべての確認は
  引き続き適用されます。SHA-256 のチェーンだけでバンドルが受け入れられることは決してありません。
- §2.2、§2.3、§2.4、§4.1 の JSON は形を示すもので、鍵と識別子にはプレースホルダー（`…`、`<kid>`）を使っています。
  フィクスチャーではなく、そのままでは読み込めません。§2.4 の 2 つの `<kid>` のエントリーは 2 つの異なる本当の
  kid を表しており、適合させたスナップショットに重複した JSON のキーはありません。共有の実行可能なケースは
  [`tests/interop/v2/admission_vectors.json`](../../../../../tests/interop/v2/admission_vectors.json)（§9）にあります。
- 25/10/2026 の時点では、§8 の API は `main` の SDK にあり、公開されたリリースには含まれていませんでした。*29/10/2026 の更新（この提供状況を置き換えます）：* これらは `@dcp-ai/sdk` 2.2.0 以降、`dcp-ai`（PyPI）2.10.0 以降、Go v2.11.0 以降、Rust `dcp-ai` 2.11.0 以降で公開されています。[npm](../../../../../docs/NPM_RELEASES.md)、[Python](../../../../../docs/PYTHON_RELEASE.md)、[Go](../../../../../docs/GO_RELEASE.md)、[Rust](../../../../../docs/RUST_RELEASE.md) のリリースノートを参照してください。`@dcp-ai/wasm` にはアドミッションの API はありません。
