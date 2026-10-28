<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · **日本語** · [Português](README.pt-BR.md)</sub>

<a id="dcp_aifastapi--fastapi-middleware"></a>
<a id="dcp_aifastapi-fastapi-middleware"></a>

# dcp_ai.fastapi — FastAPI のミドルウェア

> [英語版](README.md)の参考訳です（28/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

FastAPI 向けの DCP の検証ミドルウェアです。Signed Bundle を自動で検証し、保護するルートのための依存性注入を提供します。

<a id="supported-dcp-specifications"></a>

## サポートする DCP の仕様

DCP-01 から DCP-09。部分的なもので、以下に述べるバンドルの検証とアドミッション、そして DCP-05 と DCP-09 のいくつかのフィールド（`lifecycle_state`、`mandate_id`）です。これらの仕様の完全な実装ではありません。

<a id="installation"></a>

## インストール

**PyPI 公開済み（26/10/2026）。** `dcp-ai` 2.10.0 はここで説明する実装を含みます。2.9.0 から更新し、環境またはロックファイルを更新してください。[Python のリリースノート](../../docs/PYTHON_RELEASE.md)を参照してください。

2.9.0 は V2 署名を検証しないため、V2 検証には使用しないでください。2.10.0 は修正済み検証器、プリンシパルの信頼、`strict-v1`、本文の予算、信頼・失効ソースの監督、切断処理を含みます。受け入れ判定は行為を認可しません。

```bash
pip install "dcp-ai[fastapi]>=2.10.1,<3"
```

ソース開発の場合：

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
pip install -e "/path/to/dcp-ai/sdks/python[fastapi]"
```

<a id="quickstart"></a>

## クイックスタート

```python
from fastapi import FastAPI, Depends
from dcp_ai.fastapi import DCPVerifyMiddleware, require_dcp, DCPAgentContext

app = FastAPI()

# Add verification middleware
app.add_middleware(DCPVerifyMiddleware, require_bundle=False)

# Public route (no bundle required)
@app.get("/health")
async def health():
    return {"ok": True}

# Protected route (requires a verified bundle)
@app.post("/api/action")
async def agent_action(agent: DCPAgentContext = Depends(require_dcp)):
    return {
        "agent_id": agent.agent_id,
        "human_id": agent.human_id,
        "capabilities": agent.capabilities,
        "risk_tier": agent.risk_tier,
    }
```

<a id="sending-a-bundle"></a>

### バンドルを送る

ハイブリッドの V2 のバンドルは約 33 KB で、ほとんどのサーバーやプロキシのヘッダーの上限を超えるため、JSON のボディで送ってください。ヘッダーは、経路上のすべての上限に収まるバンドルのためのものです。以下のボディを使うリクエストはテンプレートで、`{...}` は実際の署名付きバンドルを表します。

```bash
# Via header
curl -X POST http://localhost:8000/api/action \
  -H "Content-Type: application/json" \
  -H "x-dcp-bundle: $(cat signed_bundle.json)" \
  -d '{}'

# Via JSON body
curl -X POST http://localhost:8000/api/action \
  -H "Content-Type: application/json" \
  -d '{"signed_bundle": {...}}'
```

<a id="api-reference"></a>

## API リファレンス

### `DCPVerifyMiddleware`

リクエストを捕捉して DCP のバンドルを検証する Starlette/FastAPI のミドルウェアです。

```python
app.add_middleware(
    DCPVerifyMiddleware,
    require_bundle=False,       # If True, rejects requests without a bundle
    header_name="x-dcp-bundle", # Header where the bundle is sent
    verifier_policy={"default_mode": "hybrid_required"},  # Optional, over DEFAULT_VERIFIER_POLICY
)
```

<a id="constructor-parameters"></a>

#### コンストラクターのパラメーター

| パラメーター | 型 | 既定値 | 説明 |
|-----------|------|---------|-------------|
| `app` | `Any` | （必須） | ASGI のアプリケーション |
| `require_bundle` | `bool` | `False` | バンドルのないリクエストを 403 で拒否する |
| `header_name` | `str` | `"x-dcp-bundle"` | HTTP ヘッダーの名前 |
| `verifier_policy` | `dict \| VerifierPolicy \| None` | `None` | 検証器のポリシー。dict は `DEFAULT_VERIFIER_POLICY` の上に `VerifierPolicy` のフィールドを設定する。`risk_overrides` なしの `default_mode` はすべてのリスクティアに適用され、`risk_overrides` の dict はほかより優先してそのティアを設定し、`risk_overrides=None` は既定のティアを保つ。`VerifierPolicy` はもう一度検証され、その `risk_overrides` が含まないリスクティア（`None` ならすべてのティア）は、V2 の検証器が解決するのと同じく、その `default_mode` になる。未知のフィールド、リスクティア、モードは、ミドルウェアの構築時に例外を投げる。 |
| `dcp_version` | `str` | `"2.0"` | 保存されるが強制されない。V1 のバンドルを受け入れるかどうかは `verifier_policy` 次第で（下記参照）、`require_dcp_v2` はルートを V2 に限定する。 |
| `trusted_principals` | `dict \| callable \| None` | `None` | キーワード専用。あなたが信頼するプリンシパルとその鍵。信頼セット（`schemas/v2/principal_trust_set.schema.json`、ミドルウェアの構築時に検証）、またはリクエストのたびに呼ばれる `(tenant) -> trust set`（同期または非同期）。これを使うと、アドミッションを通った V2 のバンドルだけがルートに届き、`require_bundle=True` が必要になる（[信頼するプリンシパルと strict-v1](#trusted-principals-and-strict-v1) を参照）。 |
| `profile` | `dict \| None` | `None` | キーワード専用。strict-v1 のプロファイル（`schemas/v2/admission_profile.schema.json`）で、ミドルウェアの構築時に読み込まれる。`trusted_principals` と `revocation_source` が必要で、検証器のポリシーは自ら設定する。 |
| `revocation_source` | `callable \| None` | `None` | キーワード専用、`profile` と併用。`(subjects, tenant) -> revocation snapshot \| None`、同期（ワーカースレッドで実行）または非同期で、検証済みのバンドルのアドミッションのたびに呼ばれる。`deny_list_revocation_source(url)` で作れる。 |
| `revocation_timeout` | `float` | `5.0` | キーワード専用。失効のソースが応答するまでの秒数。`{"revocation": True}` のもとでは監督された期限で、0 より大きく 2147483.647 以下。 |
| `tenant` | `callable \| None` | `None` | キーワード専用。`(request) -> str`、同期または非同期で、あなた自身のコード（たとえば、認証が `request.state` に設定した呼び出し元のテナント）。信頼と失効の呼び出し可能オブジェクトに渡される。既定では常に `""`。 |
| `clock` | `callable \| None` | `None` | キーワード専用、テスト用：エポックからのミリ秒単位の時刻。既定はシステムの時計。 |
| `source_supervisor` | `SourceSupervisor \| None` | `None` | キーワード専用、`supervise` と併用。[信頼のソースの監督](#supervising-the-trust-source)を参照。 |
| `supervise` | `dict \| None` | `None` | キーワード専用：非同期の `trusted_principals` には `{"trust_timeout": seconds}`（0 より大きく 2147483.647 以下）、非同期の `revocation_source` には `revocation_timeout` のもとで `{"revocation": True}`、またはその両方。[失効のソースの監督](#supervising-the-revocation-source)を参照。 |
| `cancel_on_disconnect` | `bool` | `False` | キーワード専用。アドミッションの最中にクライアントが本当に去ったとき、その監督されたソースの呼び出しを取り消す。その応答は、サーバーが届けない空の 499 で終わる。`max_body_bytes` が必要。[去るクライアント](#a-client-that-leaves)を参照。 |
| `max_body_bytes` | `int \| None` | `None` | キーワード専用。正の整数（`bool`、`float`、文字列、`0`、負の数は不可）で、ミドルウェアが受け付けるリクエストのボディのバイト数。Starlette 0.28.0 以降が必要。既定では以前と同じく予算なし。[ボディの予算](#body-budget)を参照。 |

<a id="behavior"></a>

#### 動作

0. `max_body_bytes` を使うと、まず予算の範囲内でボディを読みます（[ボディの予算](#body-budget)を参照）。
1. ヘッダーまたは JSON のボディ（`signed_bundle`）から署名付きバンドルを取り出します。JSON でないヘッダー、Python の 4300 桁の上限を超える整数を含むヘッダー、入れ子が深すぎるヘッダーは、バンドルがないものとして扱われ（`require_bundle=True` では `403`）、決して `500` にはなりません。
2. Python SDK で検証します。
   - **V2**（`bundle.dcp_bundle_version: "2.0"`）：Ed25519 / ML-DSA-65 / SLH-DSA-192f のレジストリと上記のポリシーで、`dcp_ai.v2` の `await verify_signed_bundle_v2(signed_bundle, registry, policy)` を使います。ペイロードのハッシュとマニフェスト、セッションの結び付けと期限、バンドルと各アーティファクトの複合署名、検証モード（パスポートのリスクティアに対するポリシーのモードと、意図のセキュリティティアのうち厳しい方）、監査のハッシュチェーン（`dcp-ai` 2.10.0 では SHA-256 のものだけ。2.10.1 以降は、存在する V2-11 の二次の SHA3-256 のフィールドも確認します）、鍵の有効性を確認します。`composite_sig_valid` は、バンドルの署名についての検証器の結果です。
   - **V1**（`bundle.responsible_principal_record.dcp_version: "1.0"`）：V1 のバンドルにはポスト量子の署名がないため、VERIFICATION.md の V2-10 がクラシカルのみのバンドルを受け入れる場合にだけ `verify_signed_bundle()` を使います。つまり、`allow_v1_bundles` が真で、ポリシーが ed25519 を受け入れ（`accepted_classical_algs` にあり、`advisory_rejected_algs` にない）、オーディエンスの結び付け、セッションの期限、セッションの最大期間を求めず（V1 のバンドルには `intended_verifier` もセッションの期間もありません）、バンドルの `responsible_principal_record`、`agent_passport`、`intent`、`policy_decision` がオブジェクトで、その `audit_entries` がオブジェクトのリストであり、パスポートの `agent_id` と RPR の `human_id` が文字列で（パスポートの `public_key` と `status` は、あれば文字列、その `capabilities` は文字列のリスト。エージェントのコンテキストに入るため）、V1 のパスポートの `risk_tier` に対するポリシーのモード（それがなければ `default_mode`）と、V1 の意図とポリシー判断のセキュリティティアのモード（V1 の `risk_score` は 0 から 1 で、1000 倍される。ない場合は `elevated` として扱う）のうち厳しい方が `classical_only` または `hybrid_preferred` の場合です。`DEFAULT_VERIFIER_POLICY` では、routine または standard の V1 の意図は通り、支払い、機密データ、高い推定影響、0.5 以上のリスクスコアは拒否されます。
   - バージョンを判別できないバンドルは拒否されます。
3. 有効なら：検証器の `warnings` とともに、`DCPAgentContext` を `request.state.dcp_agent` に保存します
4. 失敗したら：`403` と検証器の `errors`（V2 では `warnings` も）で応答します。それぞれ最大 20 件、各最大 500 文字で、バンドルが提供したテキストの制御文字と書式文字はエスケープされます。コンテキストの `warnings` も同じように制限されます。
5. バンドルがなく `require_bundle=False` なら：検証せずに続行します

<a id="body-budget"></a>

#### ボディの予算

`max_body_bytes` はオプトインです。これがなければ、ミドルウェアは以前と同じく、独自の上限なしでボディを読みます。これを使うと、ミドルウェアはほかの何よりも先に（バンドルのヘッダー、JSON の解析、テナントと信頼セット、検証、失効、ルートより前に）リクエストのボディ全体を読みます。バンドルがヘッダーで届く場合や `require_bundle=False` の場合も同様です。

- 予算を超える `Content-Length` は、ボディのバイトを受け取る前に `413` `{"verified": false, "errors": ["Request body exceeds max_body_bytes"]}` を受け取ります。
- 実際に受け取ったバイトも数えるため、`Content-Length` のないリクエスト、チャンク形式のボディ、小さすぎる `Content-Length` は、予算を超えた最初の ASGI のメッセージで同じ `413` を受け取り（そのメッセージはすでに届いています）、その後は何も受け取りません。
- ASCII の数字の単一の並びでない `Content-Length`（符号、小数点、空白、リスト）や 2 回現れるものは `400` `["Invalid Content-Length"]` を受け取り、ボディの送信中に切断したクライアントは `400` `["Request body could not be read"]` を受け取ります。どちらもルートには届きません。
- 予算内のボディは、空や不正な形式のものも含め、このオプションがない場合とまったく同じに扱われ、ルートはいつもどおりそれを読みます（`request.body()`、`request.json()`、`request.stream()`）。Starlette の `BaseHTTPMiddleware` は、Starlette 0.28.0 以降、ミドルウェアで読んだボディを引き渡します。
- そのため、このオプションには Starlette 0.28.0 以降が必要です。それより古い Starlette、またはバージョンを読めない Starlette では、`max_body_bytes` はミドルウェアの構築時に `AdmissionConfigError`（`CONFIG_INVALID_VALUE`）を投げます。FastAPI/Starlette を更新するか、設定しないでおいてください。このオプションがなければ何も確認されず、パッケージ自体の最低バージョンも変わりません。

これは、あなたのデプロイが設定する、受け取るボディのバイト数の上限であり、DCP のプロトコルの一部ではありません。展開（ASGI サーバーが届けるバイトを数えます）、JSON の深さ、時間、読み取り後の切断は制限しません。サーバー自身の上限とあわせて設定してください。

<a id="supervising-the-trust-source"></a>

#### 信頼のソースの監督

これらのオプションがなければ、非同期または同期の `trusted_principals` は以前と同じく期限なしで実行されます。これらを使うと、**非同期**のものに期限と容量の枠が与えられます。

```python
from dcp_ai.fastapi import DCPVerifyMiddleware, SourceSupervisor

supervisor = SourceSupervisor(max_in_flight=64, max_in_flight_per_tenant=8)  # one per event loop / worker

async def trust_set_for(tenant):
    return await load_trust_set(tenant)

app.add_middleware(DCPVerifyMiddleware, require_bundle=True, trusted_principals=trust_set_for,
                   source_supervisor=supervisor, supervise={"trust_timeout": 2.0})
```

- **期限。** ソースは監督者が所有する Task として実行されます。`trust_timeout` の後に届いた信頼セットは使われず、それは届いたときと使われるときに `loop.time()` で測られます。リクエストは失敗したソースと同じ `503` を受け取り、Task には取り消しが要求されます。協力を待つものは何もありません。
- **容量。** 同時に実行されるソースの呼び出しは最大 `max_in_flight` で、キューはありません。`max_in_flight_per_tenant` は 1 つのテナントを制限し、これがなければ 1 つのテナントが容量全体を使えてしまいます。空きの枠がない呼び出しは、ソースを呼ばずにただちに `503` を受け取ります。**枠が解放されるのは、ソースの Task が本当に終わったときだけ**で、リクエストに応答したときではありません。取り消しを無視するソースは枠を持ち続けます。このようにしてすべての枠が埋まると、それらのソースが終わるかプロセスが再起動するまで、すべてのリクエストが `503` を受け取ります。
- **失敗。** 自ら取り消すソース、取り消された呼び出し元（そのソースは終わるまで枠を持ち続けます）、無効な信頼セットは、すべてフェイルクローズします。これらのオプションとともに静的または同期の `trusted_principals` を使うと `AdmissionConfigError` を投げます。同期のものはイベントループの上で実行され、そこではどの期限も守られないからです。
- **範囲。** 容量は `SourceSupervisor` のオブジェクトごとで、それを渡したミドルウェアが共有します。最初に使ったイベントループに結び付くため、ワーカープロセスやループごとに個別のものを与えてください。ほかのループやスレッドからの呼び出しはフェイルクローズし、ほかのループからの `close()` は何も変えずに `RuntimeError` を投げます。
- **`await supervisor.close(drain_timeout=0)`** は新しい呼び出しを拒否し、保留中の呼び出しに `503` で応答し、すべてのソースの Task に取り消しを要求し、最大 `drain_timeout` 秒待ちます。`{"in_flight": n}` を返し、それらの枠は埋まったままで、再開はできません。
- **`supervisor.stats()`** はテナントを含まないカウンターを返します：`open`、`in_flight`、`tenants`、`timeouts`、`saturated`、`closed`、`wrong_loop`、`late_results`、`late_errors`。2**53 - 1 で止まります。
- **しないこと。** 取り消しを無視する処理を止めることも、ソースが自ら開始する処理に上限を設けることも、CPU を隔離することもしません。イベントループをブロックする `async def` はすべての期限を遅らせます。シャットダウン中のサーバーや `asyncio.run` は、取り消しを無視するソースの Task を待ち続けることがあります。`{"revocation": True}` がなければ、失効は以前と同じく `revocation_timeout` を使います。信頼のソースへの問い合わせは、以前と同じく、バンドルの検証の前に行われます。

<a id="supervising-the-revocation-source"></a>

#### 失効のソースの監督

strict-v1 のプロファイルでは、`supervise={"revocation": True}` が、**非同期**の `revocation_source` を、同じ種類の監督者の Task として、`revocation_timeout` を期限に実行します。

```python
app.add_middleware(DCPVerifyMiddleware, require_bundle=True, trusted_principals=TRUST_SET,  # static, or async with trust_timeout
                   profile={"profile": "strict-v1", "verifier_id": "verifier:acme-api"},
                   revocation_source=deny_list_revocation_source("https://revocations.example.com/.well-known/dcp-revocations.json"),
                   revocation_timeout=2.0, source_supervisor=supervisor,
                   supervise={"revocation": True})  # or {"trust_timeout": 2.0, "revocation": True}
```

- **オプトイン。** `supervise` は `trust_timeout`、`"revocation": True`、またはその両方を受け取ります。`"revocation": True` には非同期の `revocation_source`（`async def`、非同期の `__call__` を持つオブジェクト、または `functools.partial` に包まれたそのいずれか）が必要で、静的な信頼セットでも動きます。同期のものは `AdmissionConfigError` を投げます。監督者が所有しないワーカースレッドで実行されることになるからです。このオプションがなければ何も変わらず、同期のソースは引き続き `asyncio.wait_for` のもとでワーカースレッドで実行されます。
- **同じ応答。** それぞれの答えは監督なしの場合と同じ応答になります。スナップショットは以前と同じく評価されます。`None`、例外、時間切れ、自ら取り消すソース、空きの枠がないこと、閉じた監督者、ほかのループに結び付いた監督者は `codes: ["REVOCATION_UNAVAILABLE"]` とともに `403` になり、決して失効していないとはされません。`code` が `REVOCATION_INVALID` の例外は、期限の前に届いた場合にだけ `REVOCATION_INVALID` になります。
- **変わる場合。** このオプションがないと、`asyncio.wait_for` は自身の取り消しを抑え込むソースを待ち、そのとき返されたスナップショットを使います。このオプションを使うと、リクエストは期限の時点で `REVOCATION_UNAVAILABLE` を受け取り、その遅れたスナップショットは決して使われません。
- **1 つの容量。** 信頼と失効の呼び出しは同じ監督者の枠を使い、それぞれ Task が本当に終わるまで保持されます。
- **`deny_list_revocation_source` の制限。** 既定では `asyncio.to_thread` でダウンロードします。その Task を取り消すと Task は終わって枠も解放されますが、ワーカースレッドは解放されません。そのスレッドは urllib が戻るまで接続を保持します。監督者はそれらのスレッドを制限せず、その I/O も取り消しません。それらを制限するには、ソースに `DenyListWorkers` の予算を与えてください（[拒否リストのダウンロードの制限](#bounding-deny-list-downloads)を参照）。

<a id="a-client-that-leaves"></a>

#### 去るクライアント

`cancel_on_disconnect=True` を使うと、リクエストのアドミッションの最中に去ったクライアントは、そのリクエストの処理を止めます。

- **どう検出するか。** ミドルウェアはまずボディ全体を読みます。このオプションには `max_body_bytes`、したがって Starlette 0.28 以降が必要です。その後、リクエストのアドミッションの間、保留中の `receive()` を 1 つ保持します。ボディを読み終えた後、サーバーがそこに送れるのは `http.disconnect` だけです。
- **クライアントが去ったとき：**
  - アドミッションは取り消されます。その監督された呼び出しも取り消されます。`SourceSupervisor` は Task を待たずに取り消し、枠は Task が本当に終わるまで埋まったままです。`DenyListWorkers` のスレッドも同じように枠を保持します。
  - どのルートも実行されず、そのアドミッションのものは何も `request.state` に公開されません。その `dcp_agent` はクライアントがまだいるとわかったときにだけ設定され、あなた自身のコードが設定した値は変更されません。
  - そのリクエストの ASGI の応答は、`Content-Length: 0` と `Cache-Control: no-store` を伴う空の `499`（nginx の「client closed request」。登録されたものではなく、DCP のステータスでもありません）で終わります。これは DCP の応答がその外側の層に送る 2 つの ASGI のメッセージで、クライアントへの答えではありません。`http.disconnect` を受け取った後にだけ送られ、残っているクライアントには決して送られず、応答を待つ DCP の外側の `BaseHTTPMiddleware` が正常に終われるようにします。そのため、DCP はミドルウェアの**どの順序**でも動きます。
  - ネットワークに何が届くかはサーバー次第です。Uvicorn は、もう存在しない接続については何も書かず、何もログに残さず、`500` も送りません（uvicorn 0.54 と h11 で測定）。ASGI の仕様では、ほかのサーバーは、閉じた接続で応答が送られたときに `OSError` のサブクラスを投げることがあります。
  - DCP の外側の層はその 499 を見ます。ログの層は、成功ではなく、クライアントがリクエストを閉じたことを記録します。応答を変換する層や ASGI に違反する層はそれを変えることがありますが、それはこの保証の範囲外です。どの層の本当のエラーも引き続き伝播します。
  - ボディの途中で去ったクライアントは、このオプションなしで送られる 400 ではなく、同じ 499 の終わり方になります。
- **ルートから何も奪いません。** ルートは同じボディを読み、その保留中の `receive()` は次に読むもの（ルート、`request.is_disconnected()`、Starlette）に引き渡され、二度読まれることも失われることもありません。解釈されるのはアドミッションの最中に起きる読み取りだけで、完全な応答の後にサーバーが送る `http.disconnect` は、クライアントが去ったものとは見なされません。
- **要件。** ミドルウェアの構築時に確認されます。
  - `max_body_bytes`
  - 監督されたすべてのソースの呼び出し可能オブジェクト（呼び出し可能な `trusted_principals` には `trust_timeout`、`revocation_source` には `{"revocation": True}`）
  - 同期の `tenant` の呼び出し可能オブジェクト。非同期のものは、もう去ったリクエストを待たせ続けることがあるからです。

  そうでなければ `AdmissionConfigError`（`CONFIG_PROFILE_CONTRADICTION`）です。このオプションを使うと、awaitable を返す `tenant` の呼び出し可能オブジェクトは、待たれることなく、解決できないテナントの `503` を受け取ります。このオプションがなければ何も変わりません。
- **しないこと。** バンドルの検証やテナントの呼び出し可能オブジェクトは中断せず、取り消しを無視するソースも止めません。飛ばすのは、切断を見た後に始まる段階だけです。外側の層の後ろでは、切断が届くのはループの数回後になるため、ソースがすでに始まっていることがあります（そのときは取り消され、終わるまで枠を保持します）。asyncio でのみ動きます。接続が失われたときに `http.disconnect` を送るサーバーが必要です。uvicorn は送りますが、プロセス内の httpx のトランスポートは応答が完了したときにしか送りません。

<a id="what-verified-means"></a>

#### 「検証済み」の意味

検証済みのバンドルは、内部で一貫しており、それ自身が列挙する鍵（パスポートの鍵と RPR の結び付けの鍵）で署名されています。プリンシパルが誰かは証明しません。誰でも鍵を作り、任意の `human_id` を名乗る RPR を作れるからです。そのためには `trusted_principals` を設定してください（次の節）。検証済みのバンドルは、セッションが切れるまで再送されることもあります。`verifier_policy={"require_audience_binding": True, "verifier_id": "my-service"}`（バンドルの `manifest.intended_verifier` がこの検証器を指していなければなりません）、`require_session_expiry`、`max_session_duration_seconds` がそれを制限し、strict-v1 のプロファイルも同様です。どれもバンドルを一回限りにするものではありません。それが必要なら、使用済みの nonce の記録を自分で保持してください。

<a id="trusted-principals-and-strict-v1"></a>

### 信頼するプリンシパルと strict-v1

`trusted_principals` を使うと、リクエストがルートに届くのは、そのバンドルが**アドミッションを通った**場合だけです（`docs/ADMISSION.md`、`spec/profiles/admission`）。つまり、プリンシパルの署名（RPR とバンドルのマニフェスト、クラシカルとポスト量子）が、あなたの信頼セットがその `human_id` について挙げる、有効で有効期間内の鍵で作られた V2 のバンドルです。`profile` を使うと、strict-v1 の要件も適用されます。すべてのリスクティアでのハイブリッドな署名、あなたの `verifier_id` と等しい署名された `intended_verifier`、最大 300 秒の署名されたセッション、そしてエージェントとすべての署名鍵が失効していないと報告する、最大 300 秒前の失効のスナップショットです。

```python
import os

from dcp_ai.fastapi import DCPVerifyMiddleware, deny_list_revocation_source

app.add_middleware(
    DCPVerifyMiddleware,
    require_bundle=True,
    trusted_principals=trust_set,  # or a callable: lambda tenant: trust_sets[tenant]
    profile={"profile": "strict-v1", "verifier_id": "api.acme.example"},
    revocation_source=deny_list_revocation_source(
        "https://revocation.acme.example/.well-known/dcp-revocations.json",
        headers={"Authorization": f"Bearer {os.environ['REVOCATION_TOKEN']}"},
    ),
    tenant=lambda request: request.state.tenant,  # set by your own authentication
)
```

- **拒否されたリクエスト**は `{"verified", "admitted": false, "principal_trust", "profile", "profile_compliance", "codes", "errors"}`（`codes` は整列され、`errors` は `"CODE: message"` の形で、制限されエスケープされます）とともに `403` を受け取り、ルートには届きません。V1 のバンドルは拒否されます。アンカーするプリンシパルの署名を持たないからです。テナントの呼び出し可能オブジェクトや信頼セットのソースが失敗するか、無効なものを返した場合、リクエストは `503` を受け取り、やはりルートには届きません。
- **アドミッションを通ったリクエスト**は、上と同じ `request.state.dcp_agent` を受け取り、そこには `admitted=True`、`principal_trust`、`profile`、`profile_compliance`、`recorded_decision`（バンドルの `approve`、`escalate`、`block`）、`trust_set_version` があります。`action_authorized` は常に `False` です。アドミッションが示すのは、証拠が本物で信頼するプリンシパルから来たことであり、行動を実行してよいことではありません。
- **リクエストのたびに改めて評価されます**。信頼の呼び出し可能オブジェクトと失効のソースはアドミッションのたびに呼ばれるため、信頼セットから外されたプリンシパル、そこで `revoked` とされた鍵、ソースが挙げる失効は、次のリクエストで同じバンドルを拒否します。
- **失効はフェイルクローズします。** 例外を投げる、時間切れになる（`revocation_timeout`）、`None` を返すソースは `REVOCATION_UNAVAILABLE` になり、`code` が `REVOCATION_INVALID` の例外や、`schemas/v2/revocation_snapshot.schema.json` に合わないスナップショットは `REVOCATION_INVALID` になります。どれも失効していないとは見なされません。
- **`deny_list_revocation_source(url, *, headers=None, timeout=5.0, workers=None)`** は、リファレンスの失効サービスの `/.well-known/dcp-revocations.json` の形式（`updated_at`、`revocations[].agent_id`、`kid_revocations[].revoked_kid`）の完全な拒否リストを、標準ライブラリで読みます。スナップショットの `checked_at` は `updated_at` で、挙げられたエージェントや鍵は失効し、それ以外のすべての対象は失効していません。ネットワークのエラー、時間切れ、2xx 以外の応答は `REVOCATION_UNAVAILABLE`、ほかの形のボディは `REVOCATION_INVALID` です。リダイレクトをたどらず（あなたのヘッダーはあなたの URL にしか送られません）、HTTPS には TLS 1.2 以降が必要です。`https` を使い、認証情報は環境変数か vault に保管してください。`timeout` は、各ソケット操作、ボディの読み取り、呼び出しが待つ時間を制限しますが、DNS の解決や、少しずつ届くステータス行とヘッダーは制限しません。`workers` は後述します。
- **設定はあなたのコードからだけ来ます。** 信頼セット、プロファイル、ポリシー、失効のソース、テナントは、リクエストのヘッダー、クエリ、ボディから読まれることはありません。ほかのテナントを名乗るリクエストは何も変えません。
- **設定のエラー**は、ミドルウェアの構築時に（`code` 付きの）`AdmissionConfigError` を投げます。`require_bundle=True` なしの `trusted_principals` や `profile`、`trusted_principals` または `revocation_source` のないプロファイル、あるいは `verifier_policy` を伴うプロファイル（`CONFIG_PROFILE_CONTRADICTION`）、無効な信頼セットやプロファイル（それぞれのコード）、型の誤った引数、`profile` のない `revocation_source`（`CONFIG_INVALID_VALUE`）です。Starlette はミドルウェアのスタックを `add_middleware` ではなく最初のリクエストで構築するため、このようなエラーはまずすべてのリクエストで `500` として現れます（ルートには決して届きません）。起動時に失敗させるには、信頼セットとプロファイルを自分で読み込み（`create_principal_trust_store`、`resolve_strict_v1_profile`）、読み込んだオブジェクトを渡してください。
- **同期の失効のソース**はワーカースレッドで実行されます。時間切れになるとリクエストはただちに拒否されますが、スレッドはソースが戻るまで実行を続けます。非同期のソース、または `deny_list_revocation_source(url, timeout=...)` のように独自のタイムアウトを持つものを選んでください。それは環境のプロキシを使わず、リダイレクトをたどらず、16 MiB を超えるリストを拒否します。その `timeout` は各ソケット操作とボディの読み取りを制限しますが、DNS の解決や少しずつ届くステータス行は制限しません。

共有のアドミッションのベクターを使ってオフラインで実行できます：`python integrations/fastapi/examples/strict_v1.py`。

<a id="bounding-deny-list-downloads"></a>

#### 拒否リストのダウンロードの制限

既定では、`deny_list_revocation_source` の各呼び出しは `asyncio.to_thread` でダウンロードし、呼び出しが待つのをやめた後のそれらのスレッドを数えるものはありません。`DenyListWorkers` の予算を使うと、それらを数えます。

```python
from dcp_ai.v2 import DenyListWorkers, deny_list_revocation_source

workers = DenyListWorkers(max_workers=8, max_workers_per_tenant=2)  # one per process
source = deny_list_revocation_source(
    "https://revocations.example.com/.well-known/dcp-revocations.json",
    timeout=5.0,
    workers=workers,
)
```

- **容量。** 同時に実行されるダウンロードは最大 `max_workers`（1 から 64 の整数）で、1 つのテナントについては最大 `max_workers_per_tenant` です。これがなければ、1 つのテナントがすべてを使えてしまいます。
  - 各ダウンロードは、その枠を予約した後にだけ開始される、専用のスレッドで実行されます。
  - 空きの枠がない呼び出しは、接続せずにただちに `REVOCATION_UNAVAILABLE` を受け取ります。キューはありません。
  - 容量はオブジェクトごとです。それを共有すべきすべてのソースに同じものを与えてください。
- **枠は、ダウンロードが本当に終わるまで保持されます。** 呼び出しが待つのをやめたときではありません。時間切れ、取り消されたリクエスト、C3 の監督者の期限、閉じたイベントループでは解放されません。
  - 予算が数えるのは進行中のダウンロードです。ダウンロードを終えたばかりのスレッドは、結果を引き渡して終了するまでの短い間、まだ存在します。
- **同じ答え。**
  - ダウンロードは、同じ TLS、プロキシ、リダイレクト、サイズの規則による同じ GET です。
  - ボディは引き続きイベントループの上で確認され、解析されます。
  - エラーはこのオプションなしの場合と同じです。
  - `timeout` の後に届いた、または使われた結果は、ループが忙しくてタイマーを実行できなかった場合でも `REVOCATION_UNAVAILABLE` です。
- **`workers.close()`** は新しいダウンロードを拒否し、`{"in_flight": n}` を返します。実行中のものを待つことも止めることもせず、それらの枠は終わるまで埋まったままで、再開はできません。
- **`workers.stats()`** は、URL、テナント、ヘッダーを含まないカウンターを返します：`open`、`in_flight`、`tenants`、`saturated`、`closed`、`start_failed`、`late_results`、`dropped`。
- **プロセスの終了は待ちます。** スレッドはデーモンスレッドではないため、プロセスの終了時、インタープリターはまだ実行中のダウンロードを待ちます。これは `asyncio.to_thread` ですでに起きていることで、長くかかることがあります。ここでは DNS、TLS、urllib を止めるものは何もなく、呼び出しを取り消しても、それを待つのをやめるだけです。待ち続けるプロセスを終わらせるには、猶予期間の後のプロセスマネージャーによる強制終了に頼ってください。
- **プロセスごとに 1 つ。** 作成した後にフォークしたプロセスでは、`stats()` と `close()` は `RuntimeError` を投げ、ソースは親のロックやカウンターに触れずに `REVOCATION_UNAVAILABLE` を返します。ワーカープロセスごとに 1 つ作ってください。
- **しないこと。** 実行するダウンロードの数を制限するのであって、1 つにかかる時間ではありません。ボディの期限はブロックする読み取りの間で確認されるため、すでに進行中の読み取りはそれを超えることがあります。

### `require_dcp(request)`

検証済みの DCP のエージェントを求める FastAPI の依存関係です。

```python
from fastapi import Depends
from dcp_ai.fastapi import require_dcp, DCPAgentContext

@app.post("/protected")
async def protected_route(agent: DCPAgentContext = Depends(require_dcp)):
    return {"agent_id": agent.agent_id}
```

- **戻り値：** `DCPAgentContext`
- **例外：** 検証済みのエージェントがいない場合は `HTTPException(403)`

### `DCPAgentContext`

検証済みのエージェントのデータを持つデータクラスです。

```python
@dataclass
class DCPAgentContext:
    dcp_version: str = "1.0"
    agent_id: str = ""
    human_id: str = ""
    session_nonce: str = ""                # V2: verified session nonce
    public_key: str = ""
    capabilities: list[str] = field(default_factory=list)
    risk_tier: str = "medium"
    status: str = "active"
    passport: dict[str, Any] = field(default_factory=dict)
    rpr: dict[str, Any] = field(default_factory=dict)
    intent: dict[str, Any] = field(default_factory=dict)
    policy_decision: dict[str, Any] = field(default_factory=dict)
    composite_sig_valid: bool = False      # V2: the bundle signature verified
    session_binding_valid: bool = False    # V2: session binding verified
    blinded_rpr: bool = False
    lifecycle_state: str = "active"        # DCP-05
    mandate_id: str = ""                   # DCP-09
    mandate_valid: bool = False            # DCP-09
    warnings: list[str] = field(default_factory=list)  # V2: verifier warnings
    # Admission: set only with trusted_principals (admitted stays False otherwise)
    admitted: bool = False
    principal_trust: str = "not_evaluated" # "trusted" when admitted with trusted_principals
    profile: str | None = None             # "strict-v1" under the profile
    profile_compliance: str = "not_evaluated"
    recorded_decision: str | None = None   # approve, escalate or block
    trust_set_version: str | None = None
    action_authorized: bool = False        # always False
```

### `require_dcp_commissioned(request)`

`lifecycle_state` が `decommissioned` のエージェントを拒否する FastAPI の依存関係です。ミドルウェアは `lifecycle_state` をパスポートの `status` から設定し、DCP-05 の稼働開始の証明書やライフサイクルの記録は読みません。

```python
@app.post("/active-only")
async def active_only(agent: DCPAgentContext = Depends(require_dcp_commissioned)):
    return {"agent_id": agent.agent_id}
```

### `require_dcp_mandated(request)`

委任マンデート（DCP-09 §3.1）を求める FastAPI の依存関係ですが、確認するのは `mandate_id` が空でないことだけです。マンデートを取得することも、その署名を検証することも、`mandate_valid` を確認することもしません。ミドルウェアは `mandate_id` を自ら設定しないため、あなた自身のコードがそれを設定しない限り、すべてのリクエストが `403` を受け取ります（設定した場合、マンデートを確認するのはあなたの責任です）。

```python
@app.post("/delegated")
async def delegated(agent: DCPAgentContext = Depends(require_dcp_mandated)):
    return {"agent_id": agent.agent_id, "mandate_id": agent.mandate_id}
```

<a id="advanced-example--global-middleware--selective-routes"></a>
<a id="advanced-example-global-middleware-selective-routes"></a>

## 高度な例 — グローバルなミドルウェア + 選択的なルート

```python
from fastapi import FastAPI, Depends, HTTPException, Request
from dcp_ai.fastapi import DCPVerifyMiddleware, require_dcp, DCPAgentContext

app = FastAPI()

# Global middleware (non-blocking, only verifies if a bundle is present)
app.add_middleware(DCPVerifyMiddleware, require_bundle=False)

# Public route
@app.get("/health")
async def health():
    return {"ok": True}

# Route that REQUIRES a verified agent
@app.post("/agent/execute")
async def execute(agent: DCPAgentContext = Depends(require_dcp)):
    if "api_call" not in agent.capabilities:
        raise HTTPException(403, "Capability 'api_call' required")
    return {"executed_by": agent.agent_id, "risk": agent.risk_tier}

# Route that uses the agent if available
@app.get("/info")
async def info(request: Request):
    agent = getattr(request.state, "dcp_agent", None)
    if agent:
        return {"mode": "verified", "agent": agent.agent_id}
    return {"mode": "anonymous"}
```

<a id="development"></a>

## 開発

チェックアウトから：

```bash
cd sdks/python
pip install -e ".[fastapi,dev]"
pytest tests/test_fastapi_*.py -v
```

<a id="dependencies"></a>

### 依存関係

- `dcp-ai` — DCP の検証の SDK
- `fastapi` — Web のフレームワーク
- `starlette` — ASGI のツールキット（FastAPI に含まれる）

<a id="license"></a>

## ライセンス

Apache-2.0
