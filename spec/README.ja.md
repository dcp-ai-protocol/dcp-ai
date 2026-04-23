<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · **日本語** · [Português](README.pt-BR.md)</sub>

# Specs — DCP-AI 規範仕様

AIエージェントのためのデジタル市民権プロトコルの規範仕様です。フォーマットの真の情報源は `schemas/v1/` および `schemas/v2/` のJSONスキーマであり、これらのドキュメントはスコープ、成果物、および検証方法を定義します。

## 基盤仕様 (DCP-01 – DCP-03)

| Spec | スコープ | 成果物 |
|------|-------|-----------|
| [DCP-01](DCP-01.md) | アイデンティティと責任主体バインディング | Responsible Principal Record、Agent Passport、Revocation Record |
| [DCP-02](DCP-02.md) | 意図宣言とポリシーゲーティング | Intent、PolicyDecision、HumanConfirmation (オプション) |
| [DCP-03](DCP-03.md) | 監査チェーンと透明性 | AuditEntry、prev_hashチェーン連結、オプションのMerkle |
| [BUNDLE](BUNDLE.md) | 市民権バンドルと署名済みバンドル | Citizenship Bundle (L3)、Signed Bundle (Ed25519署名、bundle_hash、merkle_root) |
| [VERIFICATION](VERIFICATION.md) | 検証チェックリスト | 署名済みバンドルを検証するための規範的ステップ (スキーマ、署名、有効期限、失効、intent_hash、監査チェーン、merkle; すべてローカル) |

**検証:** `dcp validate <schema> <json>`、`dcp validate-bundle <bundle.json>`、`dcp verify-bundle <signed.json> <public_key.txt>`、`dcp intent-hash <intent.json>`。
**適合性:** `npm run conformance` はL3-OBJECTS + L3-BUNDLE + L3-SIGNED + intent_hash および prev_hash チェーンを検証します。

---

## 通信と暗号 (DCP-04、v2.0)

| ドキュメント | スコープ |
|----------|-------|
| [DCP-04](DCP-04.md) | エージェント間通信 |
| [DCP-AI v2.0](DCP-AI-v2.0.md) | 耐量子規範仕様 |
| [Security Audit](AUDIT-v2.0-FINAL.md) | v2.0最終セキュリティ監査 (13件のギャップ解消) |

---

## 憲法的フレームワーク (DCP-05 – DCP-09)

エージェントのライフサイクル、継承、紛争解決、権利、委任を統治する仕様 — プロトコルの憲法層です。

| Spec | スコープ | 主な成果物 |
|------|-------|---------------|
| [DCP-05](DCP-05.md) | エージェントライフサイクル管理 | CommissioningCertificate、VitalityReport、DecommissioningRecord |
| [DCP-06](DCP-06.md) | デジタル継承と相続 | DigitalTestament、SuccessionRecord、MemoryTransferManifest |
| [DCP-07](DCP-07.md) | 紛争解決と仲裁 | DisputeRecord、ArbitrationResolution、JurisprudenceBundle、ObjectionRecord |
| [DCP-08](DCP-08.md) | 権利と義務のフレームワーク | RightsDeclaration、ObligationRecord、RightsViolationReport |
| [DCP-09](DCP-09.md) | 人格代理と委任 | DelegationMandate、AdvisoryDeclaration、PrincipalMirror、AwarenessThreshold |

**スキーマ:** `schemas/v2/` に、DCP-05–09のすべての成果物をカバーする18のJSONスキーマ。
**サーバーエンドポイント:** 検証サーバーに31のRESTエンドポイント ([OPERATOR_GUIDE](../docs/OPERATOR_GUIDE.md) を参照)。
**ドメイン分離:** 6つの新しいコンテキスト — `Lifecycle`、`Succession`、`Dispute`、`Rights`、`Delegation`、`Awareness`。

---

## コアとプロファイル

仕様は**コア** (最小の相互運用可能プロトコル) と**プロファイル** (特定のデプロイメントニーズのための拡張) に整理されつつあります。

| ディレクトリ | スコープ |
|-----------|-------|
| [core/](core/) | DCP Core — 成果物、検証モデル、バンドル構造 |
| [profiles/](profiles/) | プロファイル — crypto、A2A、governance拡張 |
| [profiles/crypto/](profiles/crypto/) | アルゴリズム選択、複合署名、暗号アジリティ |
| [profiles/a2a/](profiles/a2a/) | エージェントディスカバリ、ハンドシェイク、セッション管理 |
| [profiles/governance/](profiles/governance/) | リスクティア、管轄、失効、鍵復旧 |

既存の仕様 (DCP-01からDCP-09、BUNDLE、VERIFICATION、DCP-AI v2.0) は依然として権威的です。コアおよびプロファイルドキュメントは、編集上のコンテキストを提供し、関心の分離を明確化します。計画されている進化については [ROADMAP](../ROADMAP.md) を参照してください。
