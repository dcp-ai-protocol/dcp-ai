<sub>[English](../../../../../spec/profiles/multi-party/README.md) · [中文](../../../../zh-CN/spec/profiles/multi-party/README.md) · [Español](../../../../es/spec/profiles/multi-party/README.md) · **日本語** · [Português](../../../../pt-BR/spec/profiles/multi-party/README.md)</sub>

<a id="multi-party-authorization-profile-mpa-v1"></a>

# 複数当事者による認可のプロファイル：`mpa-v1`

> [英語の仕様](../../../../../spec/profiles/multi-party/README.md)の参考訳です（24/11/2026 更新）。**規範となるのは英語版です**。この翻訳に規範的な効力はなく、内容が異なる場合は英語版が優先されます。識別子とコードブロックは翻訳せずにそのまま掲載しています。

**状態：** 草案、v1
**範囲：** 運用者が定めたポリシーのもとで、複数当事者による認可が、ある検証器に対して、1 つの対象への 1 つの操作を認可するかどうか

---

<a id="1-purpose-and-layering"></a>

## 1. 目的と層

複数当事者による認可（[`multi_party_authorization.schema.json`](../../../../../schemas/v2/multi_party_authorization.schema.json)）は、1 つの操作に対する複数の当事者の複合署名を並べたものです。それだけでは何も決めません。その `required_parties` は署名されておらず、それぞれの役割は署名する当事者自身が書き、操作の対象についてどの当事者が発言できるのか、認可をどこで使えるのか、いつまで使えるのかを示すものは何もありません。

`mpa-v1` は、それに判断させるオプトインのプロファイルです。レコードのスキーマも、当事者が署名する内容も変えません。次を加えます：

1. `operation_payload` の中の**署名されたリクエスト**（§2.2）：対象、オーディエンス、有効期間。当事者がすでに署名している内容の一部なので、すべての当事者がこれに署名します。
2. **運用者のポリシー**（§2.3）：対象ごとに、その当事者と役割、そして操作ごとに、必要な当事者の数と役割。
3. **運用者が持つ当事者の鍵**（§2.4）：[アドミッションのプロファイル](../../../../../spec/profiles/admission/README.md)のプリンシパルの信頼セット。

3 つの問いを分けて扱い、`authorized` を与えるのは 3 つ目だけです：

| 層 | 問い | 読み取る元 |
|---|---|---|
| 構造 | レコードは正しい形をしているか | レコードだけ |
| 検証 | どの当事者がまさにこのリクエストに署名したか | 運用者が各当事者について信頼する鍵 |
| 認可 | 実行者は今、この対象に対してこの操作を実行してよいか | 運用者のポリシーと、実行者がこれから行おうとしていること |

構造だけの確認（§8）は、署名を 1 つも検証せず、何も認可しません。

リクエストのないレコードも、有効な v2.0 のレコードのままです。このプロファイルのもとで認可されることは決してありません。レガシーモードはありません。

<a id="2-inputs"></a>

## 2. 入力

<a id="21-clock"></a>

### 2.1 時計

Unix エポックからのミリ秒で表した 1 つの瞬間 `now` を、パラメーターとして受け取ります。既定はシステムの時計です。タイムスタンプは `Z` または `±hh:mm` のオフセットを持つ RFC 3339 で、アドミッションのプロファイルと同じくミリ秒の精度で比べます。時計のずれの許容は 30 秒で、`issued_at` だけに適用されます。

<a id="22-the-request"></a>

### 2.2 リクエスト

`mpa-v1` のもとで、`operation_payload` はちょうど 2 つのメンバーを持ちます。スキーマ：[`multi_party_request.schema.json`](../../../../../schemas/v2/multi_party_request.schema.json)。

```json
{
  "request": {
    "profile": "mpa-v1",
    "request_id": "mpa:6f1c0a52d3b84e7f9a1c2d3e4f506172",
    "target": "agent:acme-bot",
    "audience": "verifier:acme-gateway",
    "issued_at": "2026-11-18T00:00:00Z",
    "expires_at": "2026-11-18T00:30:00Z"
  },
  "parameters": { "reason": "key_compromise" }
}
```

- `request` はちょうどこの 6 つのメンバーを持ちます。`request_id` は 1 から 128 文字、`target` と `audience` は 1 から 256 文字です。長さは Unicode のコードポイントで数えます。
- `target` は、運用者のポリシーが名付けるとおりに、操作の対象を示します。`audience` は、この認可に基づいて行動してよい検証器を示します。
- `parameters` はオブジェクトです。操作そのもののパラメーターで、何もないときは空です。
- `operation_payload` の中の数値はすべて、最も近い binary64 として読んだときに、-(2^53 - 1) から 2^53 - 1 までの整数です。binary64 が正確に保持できる整数の範囲です。`1.0` や `1e2` はそのような整数であり、binary64 がそのような整数と区別できないリテラルも同じです。この範囲の外では、JSON の数値を binary64 として読む実装と正確に読む実装が、同じレコードに対して異なる `dcp-jcs-v1` のテキストを書き、ある整数に対する署名が隣の整数にも通用してしまいます。64 ビットの識別子のようにこれより大きい値は、文字列に入れます。
- `operation_payload` の中の文字列はすべて、メンバーの名前も含めて、整形式の Unicode テキストです。エスケープとして書かれたものもそうでないものも含め、対になっていないサロゲートはなく、UTF-8 でないバイト列もありません。それ以外のものを、実装は同じようには読みません。ある実装はその位置に U+FFFD を置き、別の実装は読むことができません。
- `operation_payload` の入れ子は最大 32 階層です。`operation_payload` 自身が 1 階層目で、`parameters` が 2 階層目です。

当事者が署名する内容は変わりません：`UTF8("DCP-AI.v2.MultiPartyAuth") || 0x00 || dcp-jcs-v1({operation, operation_payload, party_id, role})`。古典署名はこのバイト列を対象とし、ポスト量子署名は、このバイト列に古典署名を続けたものを対象とします。

<a id="23-policy-set"></a>

### 2.3 ポリシーセット

運用者だけが与えます。ローカルの設定か、運用者が選んだ情報源です。レコード、リクエストやツールのパラメーター、リクエストが書き込めるレジストリから導いてはなりません（MUST NOT）。スキーマ：[`multi_party_policy_set.schema.json`](../../../../../schemas/v2/multi_party_policy_set.schema.json)。

```json
{
  "policy_set_version": "2026-11-18.1",
  "profile": "mpa-v1",
  "audience": "verifier:acme-gateway",
  "max_validity_seconds": 1800,
  "subjects": [
    {
      "target": "agent:acme-bot",
      "parties": [
        { "party_id": "human:alice", "role": "owner" },
        { "party_id": "human:bob", "role": "org_admin" },
        { "party_id": "human:carol", "role": "recovery_contact" }
      ],
      "operations": {
        "revoke_agent": {
          "required_parties": 2,
          "allowed_roles": ["owner", "org_admin", "recovery_contact"],
          "required_roles": ["owner"]
        }
      }
    }
  ]
}
```

ポリシーセットは、読み込むときに検証されます。次の場合、表の設定のコードで拒否されます：

| 条件 | コード |
|---|---|
| いずれかの階層にスキーマの外のフィールドがある | `CONFIG_UNKNOWN_FIELD` |
| `policy_set_version` がないか空である。`profile` が `mpa-v1` でない。`audience` が 1 から 256 文字の文字列でない。`max_validity_seconds` が 1 から 86400 の整数でない。役割または操作が一覧の外にある。`parties` が空である。`allowed_roles` が空であるか、同じ役割を繰り返している。`required_parties` が 2 未満である。`required_roles` が `allowed_roles` の中にない | `CONFIG_INVALID_VALUE` |
| 同じ対象が 2 回挙げられている、または 1 つの対象について同じ当事者が 2 回挙げられている | `CONFIG_MPA_DUPLICATE` |
| `required_parties` が、許可された役割を持つ当事者の数より大きい、または 1 つのレコードに入る認可の最大数である 16 より大きい。または必須の役割をそのような当事者の誰も持っていない | `CONFIG_MPA_UNSATISFIABLE` |

ポリシーセットにこれらの問題がいくつもあるときは、そのうちのどれか 1 つのコードが報告されることがあります。

既定値はありません。運用者がある対象について挙げていない操作は認可されず、サブジェクトのないポリシーセットは有効で、何も認可しません。当事者は対象ごとに 1 つの役割を持ちます。

<a id="24-trust-set"></a>

### 2.4 信頼セット

当事者の鍵は、運用者のプリンシパルの信頼セット（[アドミッションのプロファイル §2.2](../../../../../spec/profiles/admission/README.md#22-trust-set)）から来ます。同じバリデーターが読み込み、当事者はそのセットの `human_id` です。kid はその鍵から導かれ、2 回挙げられた kid は、セットを読み込むときに拒否されます（`CONFIG_TRUST_DUPLICATE`）。そのため、1 つの鍵を 2 人の当事者のものとすることはできず、1 人の署名者が 2 回数えられることもありません。評価は、読み込まれた信頼セットだけを受け取ります。

この 2 つは別々に読み込まれます。ポリシーにある当事者が信頼セットにないことは、設定のエラーではありません。その署名には `MPA_KEY_NOT_ANCHORED` が付きます。

<a id="3-what-the-executor-states"></a>

## 3. 実行者が示すもの

実行者は、これから実行しようとしている操作、対象、パラメーターを与えます。それらは、一覧にある操作、整形式のテキストである 1 から 256 文字の対象、そして §2.2 のデータであるオブジェクトでなければなりません。数値はその範囲にあり、テキストは整形式で、`parameters` は `operation_payload` の 2 階層目なので入れ子は最大 31 階層です。そうでなければ、呼び出しは設定のエラー（`CONFIG_INVALID_VALUE`）として拒否され、結果を返しません。認可は、まさにそれらに対するものでなければなりません。

<a id="4-evaluation"></a>

## 4. 評価

5 つのフェーズがあります。コードを加えたフェーズは、その後のフェーズを止めます。そのため、形の正しくないリクエスト、ほかに向けたリクエスト、期限切れのリクエストの署名は 1 つも検証されません。最初のフェーズは、下の順で最初の失敗で止まります。ほかのフェーズは、当てはまるコードをすべて加えます。評価は厳格です。失敗した認可が 1 つあれば、残りがしきい値に達していても、レコードは拒否されます。

| フェーズ | 確認 | コード |
|---|---|---|
| 1. 構造 | レコードがそのスキーマに適合する | `MPA_SCHEMA_INVALID` |
| | `operation_payload` に `request` のメンバーがある | `MPA_REQUEST_MISSING` |
| | `operation_payload` が §2.2 に適合し、瞬間が RFC 3339 である | `MPA_REQUEST_INVALID` |
| | `operation_payload` が §2.2 のデータ（数値がその範囲にあり、テキストが整形式で、入れ子が最大 32 階層）であり、`dcp-jcs-v1` で表現できる | `MPA_NOT_REPRESENTABLE` |
| | 認可は最大 16 個 | `MPA_TOO_MANY_AUTHORIZATIONS` |
| 2. 結び付け | `operation` が、実行者の示すものである | `MPA_OPERATION_MISMATCH` |
| | `request.target` が、実行者の示すものである | `MPA_TARGET_MISMATCH` |
| | `parameters` が、正規形で比べて、実行者の示すものである | `MPA_PARAMETERS_MISMATCH` |
| | `request.audience` が、ポリシーセットの `audience` である | `MPA_AUDIENCE_MISMATCH` |
| | `issued_at` が、`now` に許容を加えた時点より後でない | `MPA_NOT_YET_VALID` |
| | `expires_at` が `now` より後である | `MPA_EXPIRED` |
| | `expires_at` が `issued_at` より後で、その差が最大 `max_validity_seconds` である | `MPA_VALIDITY_INVALID` |
| | ポリシーセットに `request.target` のサブジェクトがある | `MPA_TARGET_UNKNOWN` |
| | そのサブジェクトがその操作を挙げている | `MPA_OPERATION_NOT_ALLOWED` |
| 3. 当事者 | それぞれの `party_id` が、そのサブジェクトの当事者である | `MPA_PARTY_UNKNOWN` |
| | それぞれの `party_id` が 1 回だけ現れる | `MPA_PARTY_DUPLICATE` |
| | 署名された役割が、運用者がその当事者に与えるものである | `MPA_ROLE_MISMATCH` |
| | その役割が、その操作に許可されている | `MPA_ROLE_NOT_ALLOWED` |
| 4. 検証 | 結び付けが `pq_over_classical` で、古典のスロットに古典のアルゴリズム、もう一方にポスト量子のアルゴリズムがある | `MPA_HYBRID_REQUIRED` |
| | それぞれの kid が、信頼セットにあるその当事者の、そのアルゴリズムの鍵である | `MPA_KEY_NOT_ANCHORED` |
| | その鍵が、`now` において失効しておらず、期限切れでなく、すでに有効である | `MPA_KEY_REVOKED`, `MPA_KEY_EXPIRED`, `MPA_KEY_NOT_YET_VALID` |
| | 両方の署名が正規の base64 で、§2.2 のバイト列について検証を通る | `MPA_SIGNATURE_INVALID` |
| 5. 判断 | ポリシーの `required_parties` 以上の当事者が認可した | `MPA_THRESHOLD_NOT_MET` |
| | `required_roles` のそれぞれの役割を、認可した当事者の誰かが持っている | `MPA_REQUIRED_ROLE_MISSING` |

- レコードの `required_parties` は署名されておらず、決して読まれません。
- フェーズ 3 で数えられる役割は、運用者のものです。署名された役割がそれと違うときは `MPA_ROLE_MISMATCH`、運用者の役割がその操作に許可されていないときは `MPA_ROLE_NOT_ALLOWED` です。両方が当てはまることもあります。知られていない当事者には `MPA_PARTY_UNKNOWN` だけが付きます。
- フェーズ 4 では、それぞれの鍵に、アンカーされていない、失効している、期限切れ（`status` が `expired`、または `expires_at` が `now` より前）、まだ有効でない（`not_before` が `now` より後）のうち、最初に当てはまるものが付きます。署名は、両方の鍵が数えられるときにだけ検証されます。
- フェーズ 4 のアルゴリズムは、このプロファイルのものです。古典のコンポーネントは `ed25519`、もう一方は `ml-dsa-65` または `slh-dsa-192f` です。変更されうる検証ポリシーから読むことはありません。
- 瞬間はミリ秒で比べます。小数部の 4 桁目以降は捨てられ、それより細かい分解能の `now` は切り捨てられます。
- 整形式でないテキストは、`operation_payload` の外でも拒否されます。そのような `party_id` を持つレコードはスキーマに適合せず（`MPA_SCHEMA_INVALID`）、そのような対象、オーディエンス、`party_id` を持つポリシーセットは読み込まれません（`CONFIG_INVALID_VALUE`）。

<a id="5-result"></a>

## 5. 結果

<a id="51-verdicts"></a>

### 5.1 判定

`structure` は `valid` か `invalid` です。`verification` は `verified`、`failed`、またはフェーズ 4 に達しなかったときの `not_evaluated` です。`authorized` は、どのフェーズもコードを加えなかったときにだけ真です。

<a id="52-fields"></a>

### 5.2 フィールド

| フィールド | 値 |
|---|---|
| `profile` | `"mpa-v1"` |
| `structure`, `verification`, `authorized` | §5.1 |
| `operation`, `target`, `request_id`, `expires_at` | 形の正しいレコードの、署名された値。そうでなければ null |
| `parties` | 認可ごとに 1 つ：`party_id`、`role`（署名されたもの）、`verified`（フェーズ 4 に達しなかったときは null） |
| `parties_counted` | フェーズ 4 でコードが 1 つも付かなかった認可。そのフェーズに達しなかったときは null |
| `required_parties` | 運用者のしきい値。その対象へのその操作の規則が見つからなかったときは null |
| `policy_set_version`, `trust_set_version` | 使われた設定のバージョン |
| `errors` | フェーズの順の `{ code, message }`。1 つのフェーズの中の順は定めません |

<a id="53-codes"></a>

### 5.3 コード

| コード | フェーズ |
|---|---|
| `MPA_SCHEMA_INVALID`, `MPA_REQUEST_MISSING`, `MPA_REQUEST_INVALID`, `MPA_NOT_REPRESENTABLE`, `MPA_TOO_MANY_AUTHORIZATIONS` | 1 |
| `MPA_OPERATION_MISMATCH`, `MPA_TARGET_MISMATCH`, `MPA_PARAMETERS_MISMATCH`, `MPA_AUDIENCE_MISMATCH`, `MPA_NOT_YET_VALID`, `MPA_EXPIRED`, `MPA_VALIDITY_INVALID`, `MPA_TARGET_UNKNOWN`, `MPA_OPERATION_NOT_ALLOWED` | 2 |
| `MPA_PARTY_UNKNOWN`, `MPA_PARTY_DUPLICATE`, `MPA_ROLE_MISMATCH`, `MPA_ROLE_NOT_ALLOWED` | 3 |
| `MPA_HYBRID_REQUIRED`, `MPA_KEY_NOT_ANCHORED`, `MPA_KEY_REVOKED`, `MPA_KEY_EXPIRED`, `MPA_KEY_NOT_YET_VALID`, `MPA_SIGNATURE_INVALID` | 4 |
| `MPA_THRESHOLD_NOT_MET`, `MPA_REQUIRED_ROLE_MISSING` | 5 |
| `CONFIG_UNKNOWN_FIELD`, `CONFIG_INVALID_VALUE`, `CONFIG_MPA_DUPLICATE`, `CONFIG_MPA_UNSATISFIABLE` | ポリシーセットを読み込むとき、または実行者が示すもの（§3）について発生します |
| `CONFIG_TRUST_*` | 信頼セットを読み込むときに発生します（アドミッションのプロファイル §2.2） |

メッセージは最大 300 文字で、秘密鍵やトークンを含むことは決してありません。一方で、結果は運用者の設定を伝えます。コード、メッセージ、各フィールドは、ポリシーセットが求めるもの（対象、操作、当事者とその役割、しきい値、最長の有効期間）と、信頼セットが当事者について持つもの（アンカーされていない鍵、失効した鍵、期限切れの鍵とその `kid`）を示し、フェーズ 2 と 3 は署名を 1 つも検証する前にそれを示します。§6 の A4 を参照してください。

<a id="6-adapters"></a>

## 6. アダプター

コアの関数は決定的で、ネットワークの呼び出しをせず、状態を持ちません。アダプター（サーバー、ツール、ミドルウェア）は、運用者の設定を解決し、判断を適用します：

- **A1.** 操作が実行されるのは `authorized` が真の場合だけで、それは評価に与えた操作を、その対象に、そのパラメーターで実行するものです。
- **A2.** ポリシーセット、信頼セット、それらの情報源、オーディエンス、テナントは、運用者のコードと設定から来ます。リクエストのフィールド、ヘッダー、ツールのパラメーターがそれらを選んだり変えたりすることはありません。
- **A3.** 冪等でない操作は一回限りの使用であり、それを守らせるのはアダプターです（§7）。
- **A4.** 結果は、誰も署名していないレコードに対しても、運用者のポリシーセットと信頼セットを、読む者に伝えます。アダプターは、運用者がそれを知ることを認めた呼び出し元にだけ結果を返さなければなりません（MUST）。それ以外には、操作が認可されたかどうかまでしか返しません。

<a id="7-guarantees-and-limits"></a>

## 7. 保証と限界

`authorized` が真のとき：

- それぞれの認可は、運用者の信頼セットがその当事者について挙げる、`now` において使える鍵で、両方の構成要素について、別々の当事者が署名している；
- それぞれの当事者は、その対象について自分が署名した役割を持ち、運用者はその役割をその操作に許可している；
- 運用者がその対象へのその操作に求める数以上の当事者が認可しており、必須の役割がその中にある；
- その全員が、実行者が示した操作、対象、パラメーターに、この検証器に向けて、運用者が受け入れる期間の中で署名している。

次は保証**しません**：

- **一回限りの使用。** 評価は状態を持たず、`request_id` を消費しません。同じリクエストを 2 回評価すると、同時の場合も含めて、どちらも `authorized` になります。操作が冪等でない実行者は、消費した `request_id` を `expires_at` まで記録し、消費と実行をアトミックに行います。1 つのトランザクションの中で行うか、実行の前に識別子を予約し、予約がすでにあったときは実行しません。先に確認して後から記録するやり方では、同時に走る 2 つの実行が通ってしまいます。
- **認可されたものが実行されるものであること。** 実行者は、これから行おうとしていることを示します。まさにそのとおりに行うのは、実行者自身の責任です。
- **設定を超えるアイデンティティ。** 判断は、運用者の信頼セット、ポリシーセット、それらの情報源とまったく同じだけのものです。
- **当事者の能力や独立性。** 2 つの鍵は 2 人の人ではなく、署名は何かが確認されたことを示しません。
- **読み込まれた信頼セットより新しい失効。**

<a id="8-api-correspondence"></a>

## 8. API の対応

| 概念 | TypeScript（`@dcp-ai/sdk`） | Python（`dcp_ai.v2`） | Go（`dcp/v2`） | Rust（`dcp_ai::v2::multi_party_auth`） |
|---|---|---|---|---|
| 構造の確認 | `checkMultiPartyAuthorizationStructure(record, policy?)` | `check_multi_party_authorization_structure(record, policy=None)` | `CheckMultiPartyAuthorizationStructure(record, policy)` | `check_multi_party_authorization_structure(&record, policy)` |
| ポリシーセットの読み込み | `createMultiPartyPolicyStore(json)` | `create_multi_party_policy_store(json)` | `NewMultiPartyPolicyStore(json)` | `MultiPartyPolicyStore::from_json(&json)` |
| 評価 | `evaluateMultiPartyAuthorization(record, registry, { policy, trust, expected, now? })` | `evaluate_multi_party_authorization(record, registry, policy=…, trust=…, expected=…, now_ms=…)` | `EvaluateMultiPartyAuthorization(registry, json, options)` | `evaluate_multi_party_authorization(&record, &options)` |
| リクエストの作成 | `createMultiPartyRequest(input)` | `create_multi_party_request(…)` | `NewMultiPartyRequest(input)` | `create_multi_party_request(&input)` |
| 当事者としての署名 | `createPartyAuthorization(…)` | `create_party_authorization(…)` | `CreatePartyAuthorization(…)` | `create_party_authorization(…)` |
| 設定のエラー | `MultiPartyConfigError`（`code`） | `MultiPartyConfigError`（`code`） | `*MultiPartyConfigError`（`Code`） | `MultiPartyConfigError`（`code`） |

結果のフィールドは、どの SDK の JSON の形でも §5.2 の名前のままです。

構造の確認は、認可の数、その役割、`composite_sig` があることを、それ自身の形のポリシーに照らして見ます。署名を 1 つも検証せず、当事者を誰も知らず、運用者のポリシーを読みません。Python、Go、Rust では `verify_multi_party_authorization` / `VerifyMultiPartyAuthorization` として公開されていました。その名前は非推奨で、同じ結果を返します。

<a id="9-test-vectors"></a>

## 9. テストベクター

[`tests/interop/v2/multi_party_vectors.json`](../../../../../tests/interop/v2/multi_party_vectors.json) に共有のケースがあります。レコード、信頼セット、ポリシーセット、実行者が示すもの、`now`、そしてケースごとに、期待される `authorized`、`structure`、`verification`、`parties_counted`、`required_parties`、コードの集合と、それが確認する規則です。設定のケースは、ポリシーセットまたは信頼セットと、期待されるコードを与えます。すべての SDK がこれらを実行します。基準は SDK どうしの一致ではなく、期待される値です。[`generate-multi-party-vectors.mjs`](../../../../../tests/interop/v2/generate-multi-party-vectors.mjs) がこのファイルを書き出し、SDK のコードを使わずに書かれた独自の評価器で、すべての期待値を確認します。

<a id="implementation-notes-informative"></a>

## 実装に関する注記（参考）

> **2026 年 11 月 18 日に追加。規範的ではありません。** これらの注記は要件を加えず、上の内容を何も変えません。`main` のリファレンスの
> コードがこの文書とどう関係するかを説明するものです。食い違う場合は、上の規範的な本文がそのまま有効です。

- **どこに実装されているか。** `main` の 4 つの SDK がこのプロファイルを実装しています。公開済みのバージョンには入っていません。公開済みの TypeScript の SDK はレコードの型だけをエクスポートしており、公開済みの Python、Go、Rust の SDK には、以前の名前のままの構造の確認だけがあります。
- **リファレンスのサーバー。** `POST /v2/multi-party/authorize` は、運用者のポリシーセット（`DCP_MULTI_PARTY_POLICY_FILE`）のもとでこのプロファイルを適用し、それがなければ存在しません。運用者のトークンにだけ応答し、何も実行しません。[server/README.md](../../../../../server/README.md) を参照してください。
- **認可を消費する操作はありません。** このリポジトリには、複数当事者による認可から `revoke_agent`、`rotate_org_key`、`change_jurisdiction`、`modify_recovery_config` を実行するものはありません。プロファイルが判断し、アダプターが実行します。
- **誰がベクターを確認したか。** ジェネレーターの評価器と 4 つの実装は、同じ作者によるものです。それらが一致することは、独立したレビューではありません。
