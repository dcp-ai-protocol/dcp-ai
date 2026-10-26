<sub>[English](AGENT_CREATION_AND_CERTIFICATION.md) · [中文](AGENT_CREATION_AND_CERTIFICATION.zh-CN.md) · [Español](AGENT_CREATION_AND_CERTIFICATION.es.md) · **日本語** · [Português](AGENT_CREATION_AND_CERTIFICATION.pt-BR.md)</sub>

<a id="agent-creation-and-certification--p2p-no-central-service"></a>
<a id="agent-creation-and-certification-p2p-no-central-service"></a>

# エージェントの作成と認証 — P2P、中央サービスなし

> [英語版](AGENT_CREATION_AND_CERTIFICATION.md)の参考訳です（25/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

エージェントを作成するシステムは、既定で **DCP 認証済み**のエージェントを生成できます。人間に結び付けられ、パスポートが発行され、バンドルが署名されたエージェントです。**どの中央サービスへの登録も不要です。** 検証はローカルで行います。オプションとして、bundle_hash を公開のログやチェーンにアンカーできます（既存のブロックチェーンやサードパーティーのサービスを使用）。

このページでの「DCP 認証済み」とは、バンドルが以下に定めるローカルのチェックに合格することを意味します。権威が発行する証明書ではなく、プリンシパルが実際に誰であるかを確認するものでもなく、検証者がそのエージェントを受け入れるべきかを決めるものでもありません。それはアドミッションという別のステップです（[ADMISSION.md](ADMISSION.md)）。

> **このページのツール。** `dcp` はソースのチェックアウトにあるリファレンス CLI、`node /path/to/dcp-ai/bin/dcp.js` です。読み書きするのは現在のディレクトリの中だけです。インタラクティブなウィザード `@dcp-ai/cli init` は、有効な V2 のアイデンティティを作らないデモです。[CLI ウィザード（デモのみ）](#cli-wizard-demo-only)を参照してください。

<a id="certification-flow-p2p-no-registry"></a>

## 認証の流れ（P2P、レジストリなし）

```
Human → Onboard (identity / pseudonymous, jurisdiction)
     → System: keygen human, build RPR, sign RPR

Human → Create agent (capabilities, risk_tier)
     → System: keygen agent, build AP, build bundle, sign bundle
     → Optional: publish bundle_hash only to existing chain/log (user or third party)
     → System: issue signed bundle + keys (+ optional anchor_receipt)

Agent → On each action: build Intent, PolicyDecision, AuditEntry (intent_hash, prev_hash chain)
      → append to audit trail; present signed bundle to verifier
      → Optional: anchor new bundle_hash for audit trail (user or third party)
```

- **検証はローカルで行い、中央サーバーは不要です。** オプションのアンカリングは、ユーザーまたはサードパーティーのアンカーサービスが既存のチェーンやログに対して行います。

<a id="definition-of-dcp-certified"></a>

## 「DCP 認証済み」の定義

- **認証済み（ローカル）：** 有効な Citizenship Bundle（スキーマに適合）、Signed Bundle（署名が有効）、署名が有効な RPR と AP、AP.status = active、期限切れでない RPR。検証者はオフラインで検証できます。**サーバー不要。**
- **認証済み + アンカー済み（オプション）：** 上記 + 公開のログやチェーンにアンカーされた bundle_hash（または merkle_root）。検証者は、ハッシュが特定の時刻にアンカーされたことを任意で確認できます。agent_id や human_id を知る中央の API はやはり存在しません。アンカリングには**既存の**ブロックチェーンか**サードパーティー**のログを使います。

どのツールが何を確認するか：

- **V1：** `dcp verify-bundle` と `verifySignedBundle` は、スキーマ、バンドルの署名、`bundle_hash`、`merkle_root`、監査チェーンを確認します。RPR とパスポートの署名、パスポートの `status`、RPR の `expires_at` は呼び出し側に任されます。署名の確認方法はクイックスタートにあります。
- **V2：** `verifySignedBundleV2` は、各アーティファクトの複合署名、パスポートの状態（`active` と `declining` を受け入れる）、RPR の有効期限も確認します。[spec/VERIFICATION.md](../spec/VERIFICATION.md) を参照してください。

<a id="integration-points-no-registry"></a>

## 統合ポイント（レジストリなし）

<a id="on-human-onboarding"></a>

### 人間のオンボーディング時

- 人間の鍵ペアを生成または受け入れます（例：`dcp keygen keys/human`）。
- RPR を構築します（human_id は仮名でもかまいません：ハッシュ、UUID、DID）。
- 人間の秘密鍵で、`signature` フィールドを除いた RPR に署名します（例：`signObject(rprBody, humanSecretKeyB64)`）。
- ローカルに保存し、どの中央サーバーにも POST しません。

<a id="on-agent-creation"></a>

### エージェントの作成時

- エージェントの鍵ペアを生成します（例：`dcp keygen keys/agent`、または 2 つ目の鍵ペア）。
- AP を構築します：principal_binding_reference = RPR.human_id、public_key = エージェントの公開鍵（base64 の Ed25519）。エージェントの秘密鍵で、`signature` フィールドを除いた AP に署名します。
- 最小限のバンドルを構築します：RPR + AP + intent + policy_decision + audit_entries（少なくとも 1 つ。[spec/DCP-03.md](../spec/DCP-03.md) に従って実際の intent_hash と prev_hash のチェーンを使う）。
- **人間の**秘密鍵でバンドルに署名します（例：`dcp sign-bundle bundle.json keys/human/secret_key.txt out.signed.json`）。
- オプションで、bundle_hash を公開のログやチェーンにアンカーします（Bitcoin の OP_RETURN、Ethereum のイベント、サードパーティーの透明性ログ）。使う場合は、anchor_receipt をバンドルと一緒に保存します。
- ユーザーに返すもの：署名済みのバンドル、エージェントの秘密鍵、オプションで anchor_receipt。

<a id="at-runtime-agent-execution"></a>

### 実行時（エージェントの実行）

- 各アクションの前に：Intent → PolicyDecision → AuditEntry を構築します（実際の intent_hash = SHA-256(canonical(intent))、prev_hash のチェーン：GENESIS、その後は SHA-256(canonical(直前のエントリ))）。
- 監査証跡に追加します。オプションで、バンドルに署名し直すか、更新された監査証跡のために新しい署名済みバンドルを作ります。
- 署名済みのバンドルを検証者に提示します（例：API リクエストのヘッダーやボディで）。検証者はローカルの検証を実行し（[spec/VERIFICATION.md](../spec/VERIFICATION.md) を参照）、オプションで失効のセット（P2P またはハッシュでアンカーされたリスト）とオプションのアンカーを確認します。

<a id="reference-implementation"></a>

## リファレンス実装

- **スクリプト：** [scripts/generate-production-examples.js](../scripts/generate-production-examples.js) — サーバーも登録もなしに、実際の RPR、AP、意図、ポリシー、2 つの監査エントリ（実際の intent_hash と prev_hash のチェーン付き）、署名済みバンドルを生成します。リポジトリ自身の V1 の例を再生成するもので（`npm run examples:generate`）、人間の鍵を `keys/secret_key.txt` から読みますが、これはリポジトリにはありません（あるのは `keys/public_key.txt` だけです）。そのため、クローンしたばかりのチェックアウトではそこで止まります。手順の順序を示す参考として読んでください。エージェントの鍵は `keys/agent_secret_key.txt` / `keys/agent_public_key.txt` から読み、なければ生成されます。
- **CLI：** `dcp keygen`、`dcp sign-bundle`、`dcp verify-bundle`、`dcp intent-hash`、`dcp bundle-hash`、`dcp merkle-root`。オプションのアンカーのステップはジェネシス CLI にはありません。ユーザーやサードパーティーのツールが既存のチェーンにハッシュを公開します。

<a id="checklist-for-agent-creation-systems"></a>

## エージェント作成システムのためのチェックリスト

1. 人間とエージェントの鍵を生成します（または鍵を受け入れます）。
2. RPR を構築して署名します（人間の鍵）。
3. AP を構築して署名します（エージェントの鍵。public_key = エージェントの公開鍵）。
4. intent、policy_decision、audit_entries を構築します（実際の intent_hash、prev_hash のチェーン）。
5. Citizenship Bundle を構築し、人間の鍵で署名します → Signed Bundle。
6. オプションで、bundle_hash をアンカーし（既存のチェーンまたはサードパーティーのログ）、anchor_receipt を保存します。
7. 署名済みのバンドルとエージェントの秘密鍵を、エージェントまたはその実行環境に渡します。
8. 実行時：intent → policy → 監査エントリを構築して追加し、署名済みのバンドルを検証者に提示します。検証者はローカルで検証し、中央サーバーは呼び出しません。

---

<a id="v20-agent-creation"></a>

## V2.0 でのエージェントの作成

DCP v2.0 では、ポスト量子のハイブリッド暗号と適応型のセキュリティティアが導入されました。

<a id="recommended-path-the-sdks"></a>

### 推奨の方法：SDK

テスト済みのクイックスタートのように、SDK で V2 のアイデンティティとバンドルを作成します。

- TypeScript：TypeScript SDK の [Quick Start (V2)](../sdks/typescript/README.md#quick-start-v2) と [QUICKSTART.md](QUICKSTART.md)
- Python：Python SDK の README の [V2 Bundles](../sdks/python/README.md#v2-bundles)

これらは `main` に従います。各 README の *Release status* の説明どおりに、チェックアウトから SDK をビルドしてください。

チェックアウトから実際のハイブリッド鍵を生成するには、`dcp keygen --hybrid <out_dir>` を使います。Ed25519 と ML-DSA-65 の鍵ペア（ML-DSA-65 は `@noble/post-quantum` による）を kid とともに書き出し、秘密鍵のファイルはモード `0600` で書き出します。

<a id="cli-wizard-demo-only"></a>

### CLI ウィザード（デモのみ）

`npx @dcp-ai/cli init`（2026 年 10 月 26 日時点で公開済みの `@dcp-ai/cli` は 2.1.0 で、その `init` のファイルはこのリポジトリのものと同一でした）は、いくつか質問をして次のものを書き出します。

- `.dcp/config.json` — エージェントの設定
- `.dcp/keys/` — Ed25519 の鍵ペアと、ハイブリッド鍵を選んだ場合は「ML-DSA-65」の鍵ペア
- `.dcp/identity.json` — RPR に似たレコード
- `.dcp/passport.json` — パスポートに似たレコード

試しに見て回るために使い、エージェントのアイデンティティを作るためには使わないでください。

- **「ML-DSA-65」の鍵はシミュレーションです。** 正しい長さのランダムなバイト列であり、ML-DSA の鍵ではありません。ウィザードも実行時にそう表示します。これで署名したり、ポスト量子の鍵として公開したりしないでください。
- **`identity.json` と `passport.json` は V2 のアーティファクトではありません。** 署名されておらず、V2 スキーマにも合いません。RPR には `entity_name` と `keys` がありますが、スキーマが要求するのは `legal_name`、`binding_keys`、`liability_mode`、`override_rights`、`issued_at`、`expires_at` です。パスポートには `owner_rpr_hash` がありますが、スキーマが要求するのは `principal_binding_reference` と `risk_tier` です。これらから作ったバンドルは検証に失敗します。
- **その失効トークンは使えません。** RPR の `revocation_token` は保持されないシークレットのハッシュであり、パスポートの `emergency_revocation_token` はランダムで、あなたが持つどのシークレットのハッシュでもありません。
- **秘密鍵のファイルは既定の権限になります**（通常の umask `022` では `0644`）。`chmod 600 .dcp/keys/*_secret.key` を実行し、`.dcp/keys/` をバージョン管理から外してください。
- **`dcp-ai sign` は DCP のバンドル署名ではありません。** ファイルの `dcp-jcs-v1` 正規形ではなく `JSON.stringify` に署名し、`signatures` 配列に追加します。

<a id="v2-certification-flow"></a>

### V2 の認証の流れ

```
Human → Onboard (identity, jurisdiction)
     → System: generate hybrid keypair (Ed25519 + ML-DSA-65)
     → System: build RPR with binding_keys[] (KeyEntry array), sign with composite signature
     → Optional: recovery configuration (Shamir SSS, spec §11.2)

Human → Create agent (capabilities, risk_tier)
     → System: generate agent hybrid keypair
     → System: build AgentPassport with keys[], principal_binding_reference (the RPR's human_id),
               capabilities and risk_tier; optional emergency_revocation_token (spec §11.3)
     → System: build bundle with session_nonce and manifest
     → System: composite-sign bundle (Ed25519 + ML-DSA-65, pq_over_classical binding)
     → Optional: anchor bundle_hash

Agent → On each action:
      → Build IntentV2 (with action_type, data_classes, estimated_impact; optional security_tier)
      → Evaluate PolicyDecisionV2 (with risk_score; optional resolved_tier)
      → Compute the security tier (routine/standard/elevated/maximum) of the action
      → Build AuditEventV2 (SHA-256 prev_hash chain; optional SHA3-256 secondary chain)
      → Generate PQ checkpoint every N events (tier-dependent)
      → Present signed bundle to verifier

Agent → Lifecycle management (DCP-05):
      → Initial state: commissioned → active (via lifecycle transition)
      → Submit periodic VitalityReport (health metrics, performance)
      → On decline: active → declining (time to prepare succession, DCP-06); declining → active on recovery
      → On end-of-life: → decommissioned (DecommissioningRecord with data_disposition)
```

<a id="v2-key-structure"></a>

### V2 の鍵の構造

V2 のエージェントは、決定的な鍵識別子を持つハイブリッドな鍵ペアを使います。

```json
{
  "keys": [
    {
      "kid": "a1b2c3d4e5f6...",
      "alg": "ed25519",
      "public_key_b64": "...",
      "created_at": "2026-02-28T00:00:00Z",
      "expires_at": null,
      "status": "active"
    },
    {
      "kid": "f6e5d4c3b2a1...",
      "alg": "ml-dsa-65",
      "public_key_b64": "...",
      "created_at": "2026-02-28T00:00:00Z",
      "expires_at": null,
      "status": "active"
    }
  ]
}
```

鍵 ID の導出：`kid = hex(SHA-256(UTF8(alg) || 0x00 || raw_public_key))[0:32]`

<a id="v2-security-tier-selection"></a>

### V2 のセキュリティティアの選択

セキュリティティアは、ポリシー判断の `risk_score` と、意図の `data_classes`、`action_type`、`estimated_impact` から自動的に計算されます（仕様 §14.2）。

| 条件 | ティア |
|-----------|------|
| risk_score >= 800、または data_classes に credentials/children_data を含む | Maximum |
| risk_score >= 500、または data_classes に pii/financial_data/health_data を含む、または initiate_payment、または estimated_impact が high、または値が不明か欠落 | Elevated |
| risk_score >= 200、または estimated_impact が medium | Standard |
| 既定 | Routine |

意図に明示した `security_tier` は、ティアを上げることしかできません。

ティアによって決まるもの：検証モード、PQ チェックポイントの頻度、推奨されるバンドルの提示モード。

<a id="v2-checklist-for-agent-creation-systems"></a>

### エージェント作成システムのための V2 チェックリスト

1. ハイブリッドな鍵ペアを生成する：Ed25519 + ML-DSA-65（SDK のプロバイダー、またはチェックアウトからの `dcp keygen --hybrid`。ML-DSA の鍵がシミュレーションである `@dcp-ai/cli init` は使わない）
2. `binding_keys[]` 配列（KeyEntry 形式）を持つ RPR を構築し、複合署名で署名する
3. オプションで、パスポートに `emergency_revocation_token` を設定する（仕様 §11.3）：`generateEmergencyRevocationToken()` はトークンとそのシークレットを返し、シークレットはオフラインで保管する。オプションで、Shamir SSS による回復を設定する（`RecoveryConfig`、仕様 §11.2）
4. `keys[]`、`principal_binding_reference`、`capabilities`、`risk_tier` を持つ AgentPassport を構築する
5. `action_type`、`data_classes`、`estimated_impact` を持つ IntentV2 を構築し、`security_tier` を計算する
6. `risk_score`（0〜1000 の整数）と、オプションで `resolved_tier` を持つ PolicyDecisionV2 を構築する
7. `prev_hash` のチェーン（SHA-256。オプションで SHA3-256 の二次チェーン）を持つ AuditEventV2 のエントリを構築する
8. ティアの間隔に従って PQ チェックポイントを生成する
9. `session_nonce` とマニフェスト（すべてのアーティファクトのハッシュ）を持つ CitizenshipBundleV2 を構築する
10. バンドルに複合署名する：`pq_over_classical` バインディングを持つ Ed25519 + ML-DSA-65
11. オプションで、bundle_hash をアンカーする
12. ライフサイクルの状態を初期化する：`commissioning_authority`、`purpose`、`initial_capabilities` を持つ `CommissioningCertificate` を作成する（DCP-05）
13. 継承を設定する：オプションで、`successor_preferences` と `memory_classification` を持つ `DigitalTestament` を作成する（DCP-06）
14. 権利を宣言する：該当する `RightEntry` の項目と `ObligationRecord` を持つ `RightsDeclaration` を作成する（DCP-08）
15. 委任を設定する：エージェントが代理人として行動する場合は、`authority_scope` を持つ `DelegationMandate` を作成する（DCP-09）
16. 注意の閾値を設定する：人間の関与（human-in-the-loop）のきっかけとなる `threshold_rules` を持つ `AwarenessThreshold` を設定する（DCP-09）

コード例は [QUICKSTART.md](QUICKSTART.md) を、V1 からのアップグレードは [MIGRATION_V1_V2.md](MIGRATION_V1_V2.md) を参照してください。

<a id="reference"></a>

## 参考資料

- ストレージとアンカリング：[STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md)
- 検証のチェックリスト：[spec/VERIFICATION.md](../spec/VERIFICATION.md)
