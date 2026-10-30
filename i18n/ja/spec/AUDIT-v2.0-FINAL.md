<sub>[English](../../../spec/AUDIT-v2.0-FINAL.md) · [中文](../../zh-CN/spec/AUDIT-v2.0-FINAL.md) · [Español](../../es/spec/AUDIT-v2.0-FINAL.md) · **日本語** · [Português](../../pt-BR/spec/AUDIT-v2.0-FINAL.md)</sub>

<a id="dcp-ai-v20-final-security-audit--all-13-gaps-verified-closed"></a>
<a id="dcp-ai-v20-final-security-audit-all-13-gaps-verified-closed"></a>

# DCP-AI v2.0 最終セキュリティ監査 — 13 の欠落すべての解消を確認

> [英語版](../../../spec/AUDIT-v2.0-FINAL.md)の参考訳です（25/10/2026 更新）。**日付のある過去の記録**であり、現在の状態を示すものではありません。内容が異なる場合は英語版が優先されます。

**監査日：** 2026-02-26  
**監査者：** DCP-AI Protocol Governance  
**範囲：** DCP-AI v2.0 フェーズ 3 の欠落の解消の完全な確認  
**結果：** 13 の欠落すべてを解消  

> **過去の記録で、書かれたとおりに残しています。** この監査の日付は 2026 年 2 月 26 日です。後のレビュー（2026 年 10 月）は、その結論の一部を限定しています。現在の状態は、この記録ではなく、ここでリンクした文書にあります：
>
> - **欠落 11 と HSM のリファレンスの実装。** `HsmCryptoProvider` と `HsmProviderFactory` はシミュレートしたパターンで、HSM との統合ではありません。`@dcp-ai/sdk` からはエクスポートされておらず、PKCS#11 の結び付けもありません。`sign` は署名ではなくハッシュを返し、`verify` は正しい長さの署名なら何でも受け入れます。本当の証拠に使ってはなりません（[docs/NIST_CONFORMITY.md](../../../docs/NIST_CONFORMITY.md) §2.2）。
> - **欠落 1。** SDK の鍵の回復と `dcp recovery-setup` はシャミアの分け前を作りますが、ハイブリッドの KEM でそれを暗号化しません。
> - **欠落 4。** リファレンスのサーバーは、アドバイザリーの `composite_sig` の構造を確認しますが、その署名は確認しません。それを守っているのは運用者のトークンです（[server/README.md](../../../server/README.md)）。
> - **PQ のみのモード。** SDK の検証器の `pq_only` は、引き続きクラシカルの署名のバイト列を必要とします。`pq_over_classical` のもとで PQ の署名がそれを覆うためで、クラシカルの構成要素を省けるという意味ではありません。
> - **欠落 6。** 二重のハッシュのヘルパーは存在しますが、検証器は `prev_hash_secondary` も `audit_merkle_root_secondary` も再計算しません（[VERIFICATION.md](../../../spec/VERIFICATION.md)、V2-11）。
> - **`dcp audit gaps`** は、ファイルが存在してマーカーを含むことを確認するもので、動作は確認しません。2026 年 10 月 25 日には欠落 7 を未解消と報告します。`integrations/fastapi/__init__.py` を探しますが、それは今では `sdks/python/dcp_ai/fastapi/__init__.py` だからです。

---

<a id="gap-verification-matrix"></a>

## 欠落の確認のマトリクス

<a id="gap-1-key-recovery-m-of-n-social-recovery"></a>

### 欠落 1：鍵の回復（M-of-N のソーシャルな回復）

- **状態：** 解消
- **実装：** `sdks/typescript/src/core/key-recovery.ts`
- **CLI：** `dcp recovery-setup --threshold <M> --shares <N>`
- **スキーマ：** `schemas/v2/recovery_config.schema.json`
- **確認：** シャミアの秘密分散がマスターの秘密をしきい値 M で N 個の分け前に分割する。分け前はハイブリッドの KEM で暗号化。回復には M-of-N の分け前と帯域外の認証が必要。

<a id="gap-2-rpr-privacy--blinded-mode"></a>
<a id="gap-2-rpr-privacy-blinded-mode"></a>

### 欠落 2：RPR のプライバシー — ブラインドのモード

- **状態：** 解消
- **実装：** `sdks/typescript/src/core/blinded-rpr.ts`
- **型：** `sdks/typescript/src/types/v2.ts` の `BlindedResponsiblePrincipalRecordV2`
- **スキーマ：** `schemas/v2/blinded_rpr.schema.json`
- **確認：** 個人データのフィールドは `pii_hash` に置き換えられる。管轄区域、責任、鍵は保たれる。規制上の開示は、求めに応じて完全な RPR で行う。

<a id="gap-3-missing-v2-artifacts"></a>

### 欠落 3：欠けていた V2 のアーティファクト

- **状態：** 解消
- **JurisdictionAttestationV2：** 型 + スキーマ（`schemas/v2/jurisdiction_attestation.schema.json`）
- **HumanConfirmationV2：** 型 + スキーマ（`schemas/v2/human_confirmation.schema.json`）
- **確認：** どちらのアーティファクトも、セッションの結び付けのために複合署名と session_nonce を含む。

<a id="gap-4-algorithm-deprecation-protocol"></a>

### 欠落 4：アルゴリズムの非推奨化のプロトコル

- **状態：** 解消
- **実装：** `sdks/typescript/src/core/algorithm-advisory.ts`
- **自動の対応：** `autoApplyAdvisoriesToPolicy()` 関数
- **ガバナンスの確認：** `verifyGovernanceAdvisory()` 関数
- **スキーマ：** `schemas/v2/algorithm_advisory.schema.json`
- **サーバー：** `POST /v2/advisory/publish`、`GET /v2/advisory/check`、`POST /v2/advisory/auto-apply`
- **CLI：** `dcp advisory check [url]`
- **確認：** アドバイザリーはガバナンスが署名する。検証器は非推奨または失効したアルゴリズムを自動で取り除き、代替を加え、すべてのクラシカルなアルゴリズムが取り除かれると自動で pq_only に切り替える。

<a id="gap-5-multi-party-authorization"></a>

### 欠落 5：複数の当事者による認可

- **状態：** 解消
- **実装：** `sdks/typescript/src/core/multi-party-auth.ts`
- **スキーマ：** `schemas/v2/multi_party_authorization.schema.json`
- **サーバー：** `POST /v2/multi-party/authorize`
- **確認：** M-of-N の複合署名が必要。所有者の役割は常に必須。役割：owner、org_admin、recovery_contact。

<a id="gap-6-dual-hash-chains"></a>

### 欠落 6：二重のハッシュチェーン

- **状態：** 解消
- **実装：** `sdks/typescript/src/core/dual-hash.ts`
- **確認：** SHA-256 + SHA3-256 を並行して実行。AuditEventV2 は `prev_hash_secondary` と `intent_hash_secondary` を含む。バンドルのマニフェストは `audit_merkle_root_secondary` を含む。

<a id="gap-7-python-integrations-v2"></a>

### 欠落 7：Python の V2 の統合

- **状態：** 解消
- **FastAPI：** `integrations/fastapi/__init__.py`
- **LangChain：** `integrations/langchain/`
- **OpenAI：** `integrations/openai/`
- **CrewAI：** `integrations/crewai/`
- **確認：** すべての統合を、V2 のアイデンティティの設定、複合署名、セッションの nonce の伝播、V2 の検証で更新。

<a id="gap-8-grpcprotobuf-v2-messages"></a>

### 欠落 8：gRPC/Protobuf の V2 のメッセージ

- **状態：** 解消
- **実装：** `api/proto/dcp.proto`
- **確認：** V2 のメッセージの型：CompositeSignature、SignedPayload、BundleManifest、AgentPassportV2、ResponsiblePrincipalRecordV2、IntentV2、PolicyDecisionV2、AuditEventV2、PQCheckpoint、SignedBundleV2。

<a id="gap-9-cli-v2-commands"></a>

### 欠落 9：CLI の V2 のコマンド

- **状態：** 解消
- **実装：** `bin/dcp.js`
- **V2 のコマンド：** `keygen --hybrid`、`sign-bundle --composite`、`verify-bundle --policy`、`kid`、`recovery-setup`、`emergency-revoke`、`rotate-key`、`capabilities`、`advisory check`
- **フェーズ 3 のコマンド：** `keys rotate`、`keys certify`、`governance ceremony`、`governance sign-advisory`、`governance verify-advisory`、`audit gaps`
- **確認：** V1、V2、フェーズ 3 の操作を CLI で完全に網羅。

<a id="gap-10-nist-kat-validation"></a>

### 欠落 10：NIST の KAT による検証

- **状態：** 解消
- **プロバイダー：** `sdks/typescript/src/providers/ml-dsa-65.ts`、`slh-dsa-192f.ts`
- **確認：** プロバイダーの実装は FIPS 204/205 の規格を参照する。KAT による検証の構造はテスト計画で定義。プロバイダーの `isConstantTime` のフラグを適用。

<a id="gap-11-secure-memory--hsm-provider"></a>
<a id="gap-11-secure-memory-hsm-provider"></a>

### 欠落 11：安全なメモリー / HSM のプロバイダー

- **状態：** 解消
- **安全なメモリー：** `sdks/typescript/src/core/secure-memory.ts` — 破棄時に安全にゼロにする `SecureKeyGuard`
- **HSM のプロバイダー：** `sdks/typescript/src/providers/hsm-provider.ts` — リファレンスの実装 `HsmCryptoProvider`
- **HSM のファクトリー：** 複数のアルゴリズムの HSM に対応する `HsmProviderFactory`
- **確認：** HsmCryptoProvider は CryptoProvider のインターフェースを実装する。秘密鍵がアプリケーションのメモリーに入ることはない。PKCS#11 のセッションの管理。Ed25519、ML-DSA-65、ML-DSA-87、SLH-DSA-192f をサポート。

<a id="gap-12-version--capability-negotiation"></a>
<a id="gap-12-version-capability-negotiation"></a>

### 欠落 12：バージョンと能力の交渉

- **状態：** 解消
- **サーバー：** `GET /.well-known/dcp-capabilities.json`
- **ヘッダー：** `DCP-Version` のヘッダーをサポート
- **CLI：** `dcp capabilities <endpoint>`
- **確認：** 能力の文書は、サポートするバージョン、アルゴリズム、通信路上の形式、機能、検証器のポリシーのハッシュを含む。

<a id="gap-13-emergency-revocation-panic-button"></a>

### 欠落 13：緊急の失効（パニックボタン）

- **状態：** 解消
- **実装：** `sdks/typescript/src/core/emergency-revocation.ts`
- **スキーマ：** `schemas/v2/emergency_revocation.schema.json`
- **サーバー：** レート制限付きの `POST /v2/emergency-revoke`
- **CLI：** `dcp emergency-revoke --agent <id> --token <secret>`
- **確認：** 事前に登録した失効のトークン（SHA-256 の約束）。原像を明かすとエージェントのすべての鍵が失効する。一回限り。レート制限付き。

---

<a id="phase-3-specific-verifications"></a>

## フェーズ 3 に固有の確認

<a id="pq-only-mode"></a>

### PQ のみのモード

- **検証器：** `verify-v2.ts` の `PQ_ONLY_VERIFIER_POLICY` のプリセット
- **サーバー：** 実行時にモードを切り替える `POST /v2/policy/mode`
- **確認：** クラシカルの署名は省略可能。V1 のバンドルは拒否。クラシカルのみのバンドルには非推奨の警告。

<a id="key-rotation-ceremony"></a>

### 鍵のローテーションの儀式

- **CLI：** `dcp keys rotate --key-dir <dir> --new-alg <alg>`
- **CLI：** `dcp keys certify --key-dir <dir> --endpoint <url>`
- **SDK：** `proof-of-possession.ts` — `createKeyRotation()` と `verifyKeyRotation()`
- **確認：** 新しい鍵による所有の証明 + 古い鍵による認可。猶予期間をサポート。ゲートウェイによる認証。

<a id="algorithm-deprecation-protocol--automated-response"></a>
<a id="algorithm-deprecation-protocol-automated-response"></a>

### アルゴリズムの非推奨化のプロトコル — 自動の対応

- **SDK：** `algorithm-advisory.ts` の `autoApplyAdvisoriesToPolicy()`
- **サーバー：** `POST /v2/advisory/auto-apply`
- **確認：** 非推奨または失効したアルゴリズムの自動の除去。代替のアルゴリズムの注入。すべてのクラシカルが除去されたときの pq_only への自動の切り替え。ポリシーの変更の監査証跡。

<a id="hsmtpm-reference-implementation"></a>

### HSM/TPM のリファレンスの実装

- **SDK：** `providers/hsm-provider.ts` の `HsmCryptoProvider`
- **ファクトリー：** 複数のアルゴリズムの HSM のセッションのための `HsmProviderFactory`
- **確認：** CryptoProvider のインターフェースを実装。PKCS#11 のセッションのライフサイクル。秘密鍵がアプリケーションのメモリーにあることはない。

<a id="governance-key-ceremony"></a>

### ガバナンスの鍵の儀式

- **SDK：** `governance.ts` — `generateGovernanceParticipant()`、`executeGovernanceCeremony()`、`signAdvisoryAsGovernance()`
- **CLI：** `dcp governance ceremony`、`dcp governance sign-advisory`、`dcp governance verify-advisory`
- **サーバー：** `POST /v2/governance/register`、`GET /.well-known/governance-keys.json`
- **確認：** M-of-N の複合署名。各参加者は Ed25519 + ML-DSA-65 を持つ。しきい値を適用。

<a id="normative-specification"></a>

### 規範的な仕様

- **文書：** `spec/DCP-AI-v2.0.md`
- **確認：** アルゴリズム、鍵の管理、署名、検証、プライバシー、ガバナンス、脅威のモデル、適合性の要件など、プロトコルのすべての側面を扱う完全な仕様。

---

<a id="audit-conclusion"></a>

## 監査の結論

DCP-AI v2.0 のポスト量子のプロトコルのアップグレード計画で特定された 13 の欠落は、すべて解消されたことが確認されました。フェーズ 3 の追加（pq_only のモード、鍵のローテーションの儀式、アルゴリズムの非推奨化への自動の対応、HSM のプロバイダー、ガバナンスの儀式）は完全に実装されています。

DCP-AI v2.0 のプロトコルは公開の準備ができています。

**監査の確認：** CLI のコマンド `dcp audit gaps`  
**実行：** リポジトリのルートから `node bin/dcp.js audit gaps`
