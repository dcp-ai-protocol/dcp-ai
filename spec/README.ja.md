<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · **日本語** · [Português](README.pt-BR.md)</sub>

<a id="specs--dcp-ai-normative"></a>
<a id="specs-dcp-ai-normative"></a>

# 仕様 — DCP-AI の規範

> [英語版](README.md)の参考訳です（27/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

Digital Citizenship Protocol for AI Agents の規範的な仕様です。形式の正となるのは `schemas/v1/` と `schemas/v2/` の JSON Schema で、これらの文書は範囲、アーティファクト、検証の仕方を定義します。[V2-WIRE-COMPATIBILITY.md](V2-WIRE-COMPATIBILITY.md) は、DCP-05、DCP-08、DCP-09 の名前、署名のコンテキスト、例をその形式に合わせる正誤と、別々に判断される 4 つの層（表現可能、スキーマ上有効、検証済み、適合）を示します。

<a id="foundation-specifications-dcp-01--dcp-03"></a>
<a id="foundation-specifications-dcp-01-dcp-03"></a>

## 基礎の仕様（DCP-01 – DCP-03）

| 仕様 | 範囲 | アーティファクト |
|------|-------|-----------|
| [DCP-01](DCP-01.md) | アイデンティティとプリンシパルへの結び付け | Responsible Principal Record、Agent Passport、Revocation Record |
| [DCP-02](DCP-02.md) | 意図の宣言とポリシーによる制御 | Intent、PolicyDecision、HumanConfirmation（省略可能） |
| [DCP-03](DCP-03.md) | 監査チェーンと透明性 | AuditEntry、prev_hash によるチェーン、省略可能な Merkle |
| [BUNDLE](BUNDLE.md) | Citizenship Bundle と Signed Bundle | Citizenship Bundle（L3）、Signed Bundle（Ed25519 の署名、bundle_hash、merkle_root） |
| [VERIFICATION](VERIFICATION.md) | 検証のチェックリスト | Signed Bundle を検証する規範的な手順（スキーマ、署名、期限、失効、intent_hash、監査チェーン、Merkle。すべてローカル） |

**検証**（`dcp` はチェックアウトのリファレンスの CLI、`node bin/dcp.js`）：`dcp validate <schema> <json>`、`dcp validate-bundle <bundle.json>`、`dcp verify-bundle [--policy <mode>] <signed.json> [public_key.txt]`、`dcp intent-hash <intent.json>`。
**適合性：** `npm run conformance` は L3-OBJECTS + L3-BUNDLE + L3-SIGNED + intent_hash と prev_hash のチェーンを検証します。

これらのコマンドと DCP-01 から DCP-03 は V1 のアーティファクトを説明しています。V2 のアーティファクトと確認は
[DCP-AI v2.0](DCP-AI-v2.0.md) と [VERIFICATION](VERIFICATION.md) の V2 のチェックリストにあります。検証を通るバンドルは一貫しており、
列挙する鍵で署名されています。そのプリンシパルへの信頼は別の手順です（[docs/ADMISSION.md](../docs/ADMISSION.md)）。

---

<a id="communication--cryptography-dcp-04-v20"></a>
<a id="communication-cryptography-dcp-04-v20"></a>

## 通信と暗号（DCP-04、v2.0）

| 文書 | 範囲 |
|----------|-------|
| [DCP-04](DCP-04.md) | エージェント間の通信 |
| [DCP-AI v2.0](DCP-AI-v2.0.md) | ポスト量子の規範的な仕様 |
| [正規化のプロファイル](CANONICALIZATION_PROFILE.md) | `dcp-jcs-v1` — すべての署名、ハッシュ、Merkle の葉のための、バイト単位で正確な JSON の正規化 |
| [セキュリティ監査](AUDIT-v2.0-FINAL.md) | 2026 年 2 月 26 日の v2.0 最終セキュリティ監査（13 の欠落を解消）。過去の記録であり、後のレビューが限定した点についての注記がある |

---

<a id="constitutional-framework-dcp-05--dcp-09"></a>
<a id="constitutional-framework-dcp-05-dcp-09"></a>

## 憲法的な枠組み（DCP-05 – DCP-09）

エージェントのライフサイクル、承継、紛争の解決、権利、委任を定める仕様で、プロトコルの憲法的な層です。

| 仕様 | 範囲 | 主なアーティファクト |
|------|-------|---------------|
| [DCP-05](DCP-05.md) | エージェントのライフサイクルの管理 | CommissioningCertificate、VitalityReport、DecommissioningRecord |
| [DCP-06](DCP-06.md) | デジタルの承継と相続 | DigitalTestament、SuccessionRecord、MemoryTransferManifest |
| [DCP-07](DCP-07.md) | 紛争の解決と仲裁 | DisputeRecord、ArbitrationResolution、JurisprudenceBundle、ObjectionRecord |
| [DCP-08](DCP-08.md) | 権利と義務の枠組み | RightsDeclaration、ObligationRecord、RightsViolationReport |
| [DCP-09](DCP-09.md) | 個人の代理と委任 | DelegationMandate、AdvisoryDeclaration、PrincipalMirror、AwarenessThreshold |

**スキーマ：** DCP-05–09 のすべてのアーティファクトを扱う、`schemas/v2/` の 18 の JSON Schema。
**サーバーのエンドポイント：** リファレンスの検証サーバーの 31 の REST エンドポイントで、認証も署名の検証もありません（[OPERATOR_GUIDE](../docs/OPERATOR_GUIDE.md#dcp-0509-service-endpoints) を参照）。
**ドメインの分離：** 7 つの新しいコンテキスト — `Lifecycle`、`Succession`、`Dispute`、`Rights`、`Delegation`、`Awareness`、`SubMandate`。

---

<a id="core-and-profiles"></a>

## コアとプロファイル

仕様は、**コア**（最小限の相互運用可能なプロトコル）と**プロファイル**（特定の展開の必要のための拡張）に整理されつつあります：

| ディレクトリ | 範囲 |
|-----------|-------|
| [core/](core/) | DCP コア — アーティファクト、検証のモデル、バンドルの構造 |
| [profiles/](profiles/) | プロファイル — 暗号、A2A、ガバナンスの拡張 |
| [profiles/crypto/](profiles/crypto/) | アルゴリズムの選択、複合署名、暗号の俊敏性 |
| [profiles/a2a/](profiles/a2a/) | エージェントの発見、ハンドシェイク、セッションの管理 |
| [profiles/governance/](profiles/governance/) | リスクティア、管轄区域、失効、鍵の回復 |
| [profiles/admission/](profiles/admission/) | アドミッション：信頼するプリンシパルと strict-v1 のプロファイル（`main` の SDK にあり、npm SDK 2.2.0 で公開済み。他の環境の公開は別） |

既存の仕様（DCP-01 から DCP-09、BUNDLE、VERIFICATION、DCP-AI v2.0）が引き続き基準です。コアとプロファイルの文書は、編集上の文脈を与え、関心事の分離を明確にします。予定している発展については [ROADMAP](../ROADMAP.md) を参照してください。
