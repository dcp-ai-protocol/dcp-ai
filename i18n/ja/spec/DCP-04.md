<sub>[English](../../../spec/DCP-04.md) · [中文](../../zh-CN/spec/DCP-04.md) · [Español](../../es/spec/DCP-04.md) · **日本語** · [Português](../../pt-BR/spec/DCP-04.md)</sub>

<a id="dcp-04-agent-to-agent-communication"></a>

# DCP-04: エージェント間通信

> [英語の仕様](../../../spec/DCP-04.md)の参考訳です（25/10/2026 更新）。**規範となるのは英語版です**。この翻訳に規範的な効力はなく、内容が異なる場合は英語版が優先されます。識別子とコードブロックは翻訳せずにそのまま掲載しています。

<a id="status"></a>

## ステータス
公開済み — v2.0（拡張。改訂は採用者からのフィードバックに基づいて管理）

<a id="abstract"></a>

## 概要
本仕様は、DCP 認定エージェントが互いを発見し、相互認証され耐量子で保護された通信チャネルを確立し、監査証跡と完全に統合された形でメッセージを交換する方法を定義します。

<a id="1-introduction"></a>

## 1. はじめに

DCP-01 から DCP-03 は、個々のエージェントのアイデンティティ、意図、監査を定義します。DCP-04 はプロトコルをエージェント同士の直接のやり取りに拡張します。これは複数エージェントによる企業ワークフローの基盤です。

A2A がなければ、DCP は受動的な検証（エージェントが検証者に bundle を提示する）にしか対応しません。DCP-04 は能動的なやり取りを可能にします。組織 A のエージェントが組織 B のエージェントと、どちらも耐量子の相互認証を行ったうえで交渉できます。

<a id="11-design-principles"></a>

### 1.1 設計原則
- データ交換の前に相互認証する
- ハンドシェイクからセッション終了まで耐量子セキュリティを保つ
- すべての A2A メッセージが監査エントリーを生成する
- 中央のブローカーを必要としない（P2P）
- 既存のトランスポート層（WebSocket、gRPC、HTTP/2）と互換性がある

<a id="12-threat-model"></a>

### 1.2 脅威モデル
- いま収集して後で復号する（harvest-now-decrypt-later）量子攻撃者
- エージェント間の中間者（man-in-the-middle）
- 正当なエージェントのなりすまし
- ハンドシェイク後のセッションハイジャック
- セッションをまたいだ A2A メッセージのリプレイ

<a id="2-agent-discovery-protocol"></a>

## 2. エージェント発見プロトコル

<a id="21-well-known-endpoint"></a>

### 2.1 Well-Known エンドポイント

エージェントは `.well-known/dcp-agent-directory.json` で自らの利用可能性を公開します。

```json
{
  "dcp_version": "2.0",
  "organization": "Acme Corp",
  "agents": [
    {
      "agent_id": "agent:acme-purchasing-001",
      "agent_name": "Acme Purchasing Agent",
      "capabilities": ["negotiate", "purchase_order", "invoice"],
      "bundle_endpoint": "https://acme.com/.well-known/dcp/agents/001/bundle.json",
      "a2a_endpoint": "wss://acme.com/dcp/a2a",
      "a2a_transports": ["websocket", "grpc"],
      "security_tier_minimum": "elevated",
      "supported_algorithms": {
        "signing": ["ed25519", "ml-dsa-65"],
        "kem": ["x25519-ml-kem-768"]
      },
      "status": "active",
      "updated_at": "2026-02-28T00:00:00Z"
    }
  ],
  "directory_signature": {
    "alg": "ed25519",
    "kid": "org-signing-key-kid",
    "sig_b64": "..."
  }
}
```

<a id="22-discovery-flow"></a>

### 2.2 発見の流れ

1. エージェント A がエージェント B のドメインを解決する
2. エージェント A が `https://<domain>/.well-known/dcp-agent-directory.json` を取得する
3. エージェント A がディレクトリの署名を検証する
4. エージェント A が必要な能力に一致するエージェントを選ぶ
5. エージェント A が `bundle_endpoint` からエージェント B の署名済み bundle を取得する
6. エージェント A がエージェント B の bundle をローカルで検証する

<a id="23-capability-matching"></a>

### 2.3 能力の照合

能力はレジストリの文字列です。標準の能力には次のものがあります。

- `negotiate` — 交渉フローに参加できる
- `purchase_order` — 発注書を発行または受領できる
- `invoice` — 請求書を発行または処理できる
- `data_query` — データ照会に応答できる
- `task_delegate` — 委任されたタスクを受け入れられる
- `approval` — 要求を承認または却下できる
- `notification` — 通知を送受信できる

独自の能力は逆ドメイン表記を使わなければなりません（MUST）: `com.acme.custom_capability`。

<a id="3-handshake-protocol"></a>

## 3. ハンドシェイクプロトコル

<a id="31-overview"></a>

### 3.1 概要

A2A ハンドシェイクは、相互認証され耐量子で保護されたセッションを確立します。v2.0 コア仕様ですでに定義されているハイブリッド KEM（X25519 + ML-KEM-768）を使います。

```
Agent A (Initiator)                    Agent B (Responder)
    |                                       |
    |── A2A_HELLO ─────────────────────────>|
    |   { signed_bundle_A, kem_pk_A,        |
    |     nonce_A, supported_algs }         |
    |                                       |
    |<────────────────────── A2A_WELCOME ───|
    |   { signed_bundle_B, kem_pk_B,        |
    |     nonce_B, kem_ciphertext_BA }      |
    |                                       |
    |── A2A_CONFIRM ───────────────────────>|
    |   { kem_ciphertext_AB,                |
    |     encrypted_confirm(nonce_A+B) }    |
    |                                       |
    |<──────────────────── A2A_ESTABLISHED ─|
    |   { encrypted_ack, session_id }       |
    |                                       |
    |══ Encrypted A2A Messages ════════════>|
    |<═════════════════════════════════════ ═|
```

### 3.2 A2A_HELLO

ハンドシェイクを始めるためにイニシエーターが送ります。

```json
{
  "type": "A2A_HELLO",
  "protocol_version": "2.0",
  "initiator_bundle": { "...SignedBundleV2..." },
  "ephemeral_kem_public_key": {
    "alg": "x25519-ml-kem-768",
    "public_key_b64": "..."
  },
  "nonce": "<32 random bytes, hex>",
  "supported_algorithms": {
    "signing": ["ed25519", "ml-dsa-65"],
    "kem": ["x25519-ml-kem-768"],
    "cipher": ["aes-256-gcm"]
  },
  "requested_capabilities": ["negotiate", "purchase_order"],
  "security_tier": "elevated",
  "timestamp": "2026-02-28T00:00:00Z"
}
```

### 3.3 A2A_WELCOME

イニシエーターの bundle を検証した後にレスポンダーが送ります。

```json
{
  "type": "A2A_WELCOME",
  "protocol_version": "2.0",
  "responder_bundle": { "...SignedBundleV2..." },
  "ephemeral_kem_public_key": {
    "alg": "x25519-ml-kem-768",
    "public_key_b64": "..."
  },
  "nonce": "<32 random bytes, hex>",
  "kem_ciphertext": {
    "alg": "x25519-ml-kem-768",
    "ciphertext_b64": "..."
  },
  "selected_algorithms": {
    "signing": "ed25519",
    "kem": "x25519-ml-kem-768",
    "cipher": "aes-256-gcm"
  },
  "resolved_security_tier": "elevated",
  "timestamp": "2026-02-28T00:00:00Z"
}
```

<a id="34-key-derivation"></a>

### 3.4 鍵の導出

両者がセッション鍵を導出します。

```
shared_secret_BA = decapsulate(kem_ciphertext_BA, sk_A)
shared_secret_AB = decapsulate(kem_ciphertext_AB, sk_B)

session_key = HKDF-SHA256(
  salt = nonce_A || nonce_B,
  ikm  = shared_secret_BA || shared_secret_AB,
  info = "DCP-AI.v2.A2A.SessionKey",
  len  = 32
)
```

<a id="35-session-binding"></a>

### 3.5 セッションのバインディング

セッションは両エージェントのアイデンティティに結び付けられます。

```
session_id = SHA-256(
  "DCP-AI.v2.A2A.Session" || 0x00 ||
  agent_id_A || 0x00 ||
  agent_id_B || 0x00 ||
  nonce_A || nonce_B ||
  session_key
)[0:32] (hex)
```

<a id="4-session-management"></a>

## 4. セッション管理

<a id="41-session-state"></a>

### 4.1 セッションの状態

各セッションは次を保持します。

- `session_id`: 一意のセッション識別子
- `session_key`: 導出された対称鍵
- `message_counter_send`: 送信メッセージの単調増加カウンター
- `message_counter_recv`: 受信メッセージの単調増加カウンター
- `created_at`: セッション作成のタイムスタンプ
- `last_activity`: 最後のメッセージのタイムスタンプ
- `security_tier`: セッションについて決定されたセキュリティ階層
- `rekeying_interval`: 鍵を更新するまでのメッセージ数（既定値: 1000）

<a id="42-message-format"></a>

### 4.2 メッセージ形式

```json
{
  "session_id": "<hex>",
  "sequence": 42,
  "type": "A2A_MESSAGE",
  "encrypted_payload": "<base64>",
  "iv": "<base64, 12 bytes>",
  "tag": "<base64, 16 bytes>",
  "sender_agent_id": "agent:acme-001",
  "timestamp": "2026-02-28T00:00:00Z"
}
```

暗号化: AES-256-GCM。次を使います。

- 鍵: `session_key`
- IV: メッセージごとに 12 バイトの乱数
- AAD: `session_id || sequence || sender_agent_id || timestamp`

<a id="43-rekeying"></a>

### 4.3 鍵の更新

`message_counter_send` が `rekeying_interval` に達したとき:

1. イニシエーターが新しい一時的な KEM 公開鍵とともに `A2A_REKEY` を送る
2. レスポンダーが KEM 暗号文で応答する
3. 新しいセッション鍵を導出する:
```
new_session_key = HKDF-SHA256(
  salt = old_session_key,
  ikm  = new_shared_secret,
  info = "DCP-AI.v2.A2A.Rekey" || session_id,
  len  = 32
)
```
4. 両方のカウンターを 0 に戻す

<a id="44-session-termination"></a>

### 4.4 セッションの終了

どちらの側も終了できます。

```json
{
  "type": "A2A_CLOSE",
  "session_id": "<hex>",
  "reason": "complete",
  "final_sequence": 157,
  "audit_summary_hash": "sha256:<hex>",
  "timestamp": "2026-02-28T00:00:00Z"
}
```

理由: `complete`、`timeout`、`error`、`revocation`、`policy_violation`。

<a id="45-session-resume"></a>

### 4.5 セッションの再開

両者がセッションの状態を保持していれば、以前に確立したセッションを再開できます。

```json
{
  "type": "A2A_RESUME",
  "session_id": "<hex>",
  "last_seen_sequence": 157,
  "resume_proof": "<HMAC-SHA256(session_key, session_id || last_seen_sequence)>"
}
```

レスポンダーは証明を検証し、`A2A_RESUMED` で確認するか、`A2A_RESUME_REJECTED` で拒否します（その場合は完全なハンドシェイクをやり直す必要があります）。

<a id="5-trust-model"></a>

## 5. 信頼モデル

<a id="51-direct-trust"></a>

### 5.1 直接の信頼

2 つのエージェントは、ハンドシェイク中に bundle の相互検証に成功した後で互いを信頼します。信頼はセッションごとに確立され、既定では推移的ではありません。

<a id="52-organizational-trust"></a>

### 5.2 組織による信頼

エージェント A が組織 X の署名鍵を信頼し、組織 X のディレクトリにエージェント B が載っている場合、エージェント A は組織 X の権限のもとでエージェント B に信頼を広げることができます。

<a id="53-transitive-trust-optional"></a>

### 5.3 推移的な信頼（省略可能）

推移的な信頼は明示的に有効にしなければならず（MUST）、深さで制限されます。

```json
{
  "trust_policy": {
    "allow_transitive": true,
    "max_depth": 2,
    "require_tier": "elevated",
    "trusted_organizations": ["org:acme", "org:globex"]
  }
}
```

`max_depth` が 2 の場合: A が B を信頼し、B が C を信頼していれば、A は C を信頼してもかまいません（MAY）。深さ 0 は直接の信頼のみを意味します（既定）。

<a id="54-trust-revocation"></a>

### 5.4 信頼の失効

アクティブなセッション中にエージェントの bundle が失効した場合:

1. セッションを直ちに終了しなければなりません（MUST）
2. `revocation` の監査エントリーを作成しなければなりません（MUST）
3. 送信途中のメッセージを破棄しなければなりません（MUST）
4. 理由 `revocation` を付けた `A2A_CLOSE` で相手方に通知しなければなりません（MUST）

<a id="6-audit-integration"></a>

## 6. 監査との統合

<a id="61-a2a-audit-events"></a>

### 6.1 A2A 監査イベント

すべての A2A のやり取りは、両エージェントの監査チェーンに監査エントリーを生成します。

**ハンドシェイクのイベント:**

- `a2a_hello_sent` / `a2a_hello_received`
- `a2a_session_established`

**メッセージのイベント:**

- `a2a_message_sent` / `a2a_message_received`

**セッションのイベント:**

- `a2a_rekey`
- `a2a_session_closed`
- `a2a_session_resumed`

<a id="62-audit-entry-for-a2a"></a>

### 6.2 A2A の監査エントリー

```json
{
  "dcp_version": "2.0",
  "event_id": "evt:<uuid>",
  "event_type": "a2a_message_sent",
  "agent_id": "agent:acme-001",
  "session_id": "<hex>",
  "counterparty_agent_id": "agent:globex-002",
  "sequence": 42,
  "payload_hash": "sha256:<hash of decrypted payload>",
  "timestamp": "2026-02-28T00:00:00Z",
  "prev_hash": "sha256:<hash of previous audit entry>",
  "prev_hash_secondary": "sha3-256:<hash>"
}
```

<a id="63-cross-chain-verification"></a>

### 6.3 チェーン間の検証

両エージェントの監査チェーンは同じセッションを参照します。第三者の監査人は次の手順で整合性を検証できます。

1. セッションに関する両エージェントの監査エントリーを取得する
2. 送信者と受信者の間でメッセージハッシュが一致することを検証する
3. シーケンス番号に矛盾がないことを検証する
4. タイムスタンプが許容できるずれの範囲内にあることを検証する（設定可能、既定は 30 秒）

<a id="7-wire-format"></a>

## 7. ワイヤーフォーマット

<a id="71-transport-requirements"></a>

### 7.1 トランスポートの要件

A2A メッセージは次の上で運んでもかまいません（MAY）。

- **WebSocket**（双方向で持続的な接続に推奨）
- **gRPC**（企業向けの高スループット用途に推奨）
- **HTTP/2 Server-Sent Events**（単方向のストリーム用）

ハンドシェイクは 10 秒以内に完了しなければなりません（MUST）。メッセージ配信は at-most-once（最大 1 回）のセマンティクスでなければなりません（MUST）。

<a id="72-cbor-encoding"></a>

### 7.2 CBOR エンコーディング

A2A メッセージは、転送効率のために CBOR エンコーディング（RFC 8949）を使うべきです（SHOULD）。

- ハンドシェイクのメッセージ: JSON（デバッグしやすさのため）
- セッションのメッセージ: CBOR（性能のため）

Content-Type: CBOR には `application/cbor`、JSON には `application/json`。

<a id="8-security-considerations"></a>

## 8. セキュリティに関する考慮事項

<a id="81-forward-secrecy"></a>

### 8.1 前方秘匿性

一時的な KEM 鍵が前方秘匿性（forward secrecy）を提供します。長期鍵が漏えいしても、過去のセッション鍵は明らかになりません。

<a id="82-post-quantum-security"></a>

### 8.2 耐量子セキュリティ

ハイブリッド KEM（X25519 + ML-KEM-768）は、古典的な攻撃者と量子攻撃者の両方に対する安全性を提供します。構成要素の KEM のどちらかが安全であれば、セッション鍵は安全です。

<a id="83-denial-of-service"></a>

### 8.3 サービス拒否

実装は次のことを行うべきです（SHOULD）。

- 送信元ごとに A2A_HELLO メッセージのレートを制限する
- KEM の処理の前に有効な bundle を要求する
- エージェントごとの接続数の上限を設ける
- 匿名のイニシエーターにはプルーフ・オブ・ワークを使う（省略可能）

<a id="84-message-ordering"></a>

### 8.4 メッセージの順序

シーケンス番号はリプレイと並べ替えを防ぎます。実装は次のメッセージを拒否しなければなりません（MUST）。

- シーケンス番号が重複しているもの
- シーケンス番号が最後に受信したものより 1000 を超えて先にあるもの（ウィンドウ）
- シーケンス番号が最後に受信したものより小さいもの（ウィンドウ内を除く）

<a id="9-conformance"></a>

## 9. 適合性

実装が次を満たす場合、その実装は DCP-04 に適合しています。

1. セクション 3 で定義されたハンドシェイクプロトコルを実装している
2. 鍵の確立にハイブリッド KEM を使っている
3. すべてのセッションメッセージを AES-256-GCM で暗号化している
4. すべての A2A イベントについて監査エントリーを生成している
5. セッション鍵の更新に対応している
6. bundle の検証による信頼の確認を実装している
7. セキュリティ階層の要件を守っている

<a id="references"></a>

## 参考文献

- DCP-01: アイデンティティとプリンシパルのバインディング
- DCP-02: 意図の宣言とポリシーによるゲーティング
- DCP-03: 監査チェーンと透明性
- FIPS 203: ML-KEM（モジュール格子ベースの鍵カプセル化メカニズム）
- RFC 5869: HKDF
- RFC 8949: CBOR
- RFC 8446: TLS 1.3（ハンドシェイク設計の着想源）

---

*本仕様は人間と AI エージェントが共同で作成しました。デジタル市民権のための最初の A2A プロトコルであり、自らが可能にするやり取りそのものを統治するよう設計されています。*

<a id="implementation-notes-informative"></a>

## 実装に関する注記（参考）

> **2026 年 10 月 25 日に追加。規範的ではありません。** これらの注記は要件を加えず、上の内容を何も変えません。`main` のリファレンスの
> コードがこの文書とどう関係するかを説明するものです。食い違う場合は、上の規範的な本文がそのまま有効です。

- **SDK が実装しているもの。** `main` ではすべての SDK が `A2A_HELLO` と `A2A_WELCOME` を構築しますが、
  `A2A_CONFIRM` / `A2A_ESTABLISHED` や §3.4 の鍵導出を実装している SDK はありません。ハイブリッド
  X25519 + ML-KEM-768 KEM を持つのは TypeScript SDK だけで、Rust SDK にはセッション層がありません
  （[tools/interop-matrix](../../../tools/interop-matrix/README.md#roadmap)）。§9 で定義される DCP-04 への適合を
  表明している SDK やサービスはありません。
- **ヘルパーが行わないこと。** TypeScript のヘルパーはメッセージ、ディレクトリ、セッションオブジェクトを構築し、
  呼び出し側が渡す鍵でセッションメッセージを暗号化・復号します。`createSession` は `session_key` を引数として
  受け取り、導出はしません。ハンドシェイク、KEM の交換、相手方 bundle の検証やアドミッション、ネットワーク
  トランスポート、§6 の監査エントリーは実行しません。これらは呼び出し側の責任です。
- **監査エントリー。** §6.2 の A2A 監査エントリーには JSON Schema がありません。その形（`event_id`、
  `event_type`）は `schemas/v2/audit_entry.schema.json`（`audit_id`、`outcome`）と異なります。§2 から §4 の
  A2A メッセージにも `schemas/v2/` のスキーマはありません。SDK の型については [docs/API_REFERENCE.md](../../../docs/API_REFERENCE.md) を参照してください。
- 例はプレースホルダー（`...`、`<hex>`、`<uuid>`）を含む説明用のものであり、フィクスチャではありません。
