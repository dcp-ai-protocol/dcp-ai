<sub>[English](EU_AI_ACT_MAPPING.md) · **中文** · [Español](EU_AI_ACT_MAPPING.es.md) · [日本語](EU_AI_ACT_MAPPING.ja.md) · [Português](EU_AI_ACT_MAPPING.pt-BR.md)</sub>

<a id="dcp-ai-and-the-eu-ai-act--mapping-of-logging-human-oversight-and-record-keeping-obligations"></a>
<a id="dcp-ai-and-the-eu-ai-act-mapping-of-logging-human-oversight-and-record-keeping-obligations"></a>

# DCP-AI 与欧盟《人工智能法》— 日志记录、人工监督和记录保存义务的对应

> 本文是[英文版](EU_AI_ACT_MAPPING.md)的参考译文，更新于 27/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

**规范版本：** 2.0
**最后更新：** 2026 年 10 月
**法律审阅日期：** 2026 年 10 月 22 日
**状态：** 参考性。法律资料于 2026 年 10 月 22 日阅读（第 7 节）；实现对应描述的是 2026 年 10 月 25 日 `main` 上的规范、schema 和 SDK，并指出仓库历史标签 v2.10.0（2026 年 10 月 22 日）的不同之处，以及规范有要求但 SDK 函数并未执行的地方。该标签不是当前发布，也不是 2026 年 10 月 26 日核实的 Python 软件包 `dcp-ai` 2.10.0；当前版本见[已发布版本](README.md#published-versions)

> **说明（2026 年 10 月 27 日）。** 只有第 3 节中关于双哈希链的那一行（第 19(1) 条和第 26(6) 条）反映了 2026 年 10 月 27 日在尚未发布的源代码中对二级 SHA3-256 字段所做的工作。法律资料的阅读日期（2026 年 10 月 22 日）以及本文档其余部分 2026 年 10 月 25 日的实现快照保持不变。

本文档把经第 (EU) 2026/1744 号条例（“Digital Omnibus on AI”）修订的第 (EU) 2024/1689 号条例（“《人工智能法》”）中涉及可追溯性、日志记录、人工监督、记录保存、解释和事件证据的义务，与 DCP-AI 的构件、服务和 SDK 函数对应起来。它沿用 [NIST_CONFORMITY.md](NIST_CONFORMITY.md) 的结构：编号的章节、一张对应表、一份实现者检查清单，以及一份明确的缺口清单。

下文引用的每一条款都于 2026 年 10 月 22 日在 EUR-Lex 的官方文本中阅读。基础文本是公布时的条例（CELEX 32024R1689）；修订内容取自在《欧盟官方公报》上公布的 Digital Omnibus on AI。第 4 节说明每个日期来自哪个文本。正文引用条例之处，引文仅限几个词，并按在 EUR-Lex 中读到的原样保留英文；其余内容均为转述，不应被当作法律措辞。

---

<a id="1-scope-and-disclaimer"></a>

## 1. 范围与免责声明

DCP-AI 是一种协议和一种证据格式。它定义了已签名的构件（在 bundle 中，Responsible Principal Record、Agent Passport、Intent 和 Policy Decision 各是一个 `SignedPayload`；生命周期、争议、权利和委托记录由各自的函数签名）、由已签名 bundle 通过审计 Merkle 根作出承诺而不逐条签名的审计条目、可发现篡改的审计轨迹、可选的锚定和透明日志，以及本地验证器，每个验证器只检查其路径所覆盖的内容（例如 V2 bundle 的 `verifySignedBundleV2`）。

DCP-AI **不是**：

- 《人工智能法》下的合格评定、协调标准、通用规范或合格推定；
- 任何具体人工智能系统的风险管理体系（第 9 条）、质量管理体系、技术文档（第 11 条）或上市后监测计划（第 72 条）；
- 法律意见。某个智能体是否属于“人工智能系统”、是否属于高风险，以及谁是提供者、谁是部署者，都应由组织与其法律顾问一起判定。

本文档所做的事情更有限：针对列出的每项义务，它指出产生证据或施加控制的 DCP 机制，说明该机制能做到什么程度（`supports`、`partial`、`out of scope`），并指出提供者或部署者仍需自行完成的事项。标为 `supports` 的行表示，按第 5 节所述配置时，该机制存在并按该行所述工作；它并不表示该义务已经履行。

第 3 节使用的覆盖值：

| 值 | 含义 |
|-------|---------|
| `supports` | DCP 构件、验证器规则或参考服务实现了该义务所要求的机制。正确运行它仍然是组织的工作（第 5 节）。 |
| `partial` | DCP 产生证据或一个构建模块，但义务的实质部分（一份文档、一个流程、一份报告、一个人工决定）不是协议能够产生的。 |
| `out of scope` | DCP 不涉及此项，不应为此引用 DCP。 |

---

<a id="2-roles-provider-and-deployer-versus-operator-responsible-principal-and-agent"></a>

## 2. 角色：提供者和部署者与运营方、责任委托人和智能体

《人工智能法》把义务附着在[第 3 条](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_3)定义的角色上。**提供者**（第 3 条第 (3) 项）开发人工智能系统或委托他人开发，并以自己的名义将其投放市场或投入使用。**部署者**（第 3 条第 (4) 项）在其“under its authority”下使用人工智能系统，个人非职业活动除外。**人工智能系统**（第 3 条第 (1) 项）是以“varying levels of autonomy”运行、并从所接收的输入中推断如何生成输出的基于机器的系统。条例的义务附着在人工智能系统及其背后的法律主体上。

DCP 的角色附着在一个智能体实例以及为它负责的个人或组织上：

| DCP 角色 | 记录位置 | 在《人工智能法》中的典型角色 | 说明 |
|----------|---------------------|---------------------|-------|
| **责任委托人** | `schemas/v2/responsible_principal_record.schema.json`：`human_id`、`legal_name`、`entity_type`（`natural_person` 或 `organization`）、`jurisdiction`、`liability_mode`（`owner_responsible`）、`override_rights`、`binding_keys` | **部署者**，或部署者根据第 26 条第 (2) 款指派负责人工监督的自然人 | RPR 指明谁为智能体的行为负责。当 `entity_type` 为 `organization` 时，通常就是部署者本身；为 `natural_person` 时，通常是部署者内部持有 `override_rights` 的人。 |
| **智能体** | `schemas/v2/agent_passport.schema.json`：`agent_id`、`keys`、`principal_binding_reference`、`capabilities`、`risk_tier`、`status` | **人工智能系统**（或其组成部分） | DCP 智能体是一个已部署的实例，拥有自己的密钥和生命周期状态。底层模型或框架的提供者不出现在任何 DCP 构件中。 |
| **运营方**（验证服务、策略引擎、透明日志、锚定服务或撤销服务的运营方） | `server/`、`services/`、验证器策略（[OPERATOR_GUIDE.md](OPERATOR_GUIDE.md)） | 通常是**部署者**；当提供者把这一关卡作为系统的一部分交付时，可能是**提供者**；也可能是第三方 | 运营方决定验证器策略、审计数据的保留和锚定频率。第 5 节的若干条目由运营方负责。 |
| **对方智能体**（DCP-04、DCP-09） | `interaction_record.counterparty_agent_id`、委托授权书 | 另一个人工智能系统，可能属于另一个部署者 | 交互记录让每一方都拿到对方授权的证据。 |

对本对应关系的两点影响：

1. **提供者一侧的义务大多为 `partial`。** DCP 不了解模型、训练数据或预期用途。它可以记录问责层如何运作（第 3 节，第 11 条那一行），而不是人工智能系统本身。
2. **部署者一侧的日志记录和监督义务是 DCP 最强的部分。** 意图关卡、策略决定、审计链、RPR 的 `override_rights`、建议声明和生命周期状态都是面向部署者、会产生已签名证据的控制。

DCP-AI 规范用“human”和“principal”称呼由 RPR 绑定的人。本文档把这个人称为“责任委托人”，并按条例的含义使用“部署者”和“提供者”。

---

<a id="3-mapping-table"></a>

## 3. 对应表

每一行：在 EUR-Lex 中读到的条款、义务的简短转述、带精确引用的 DCP 机制、覆盖程度，以及组织仍需完成的事项。规范引用指向 `spec/DCP-AI-v2.0.md`（“core §n”）和配置文件规范 `spec/DCP-05.md` 至 `spec/DCP-09.md`。函数名来自 TypeScript SDK（`@dcp-ai/sdk`、`sdks/typescript/src/index.ts`）；Python、Go、Rust 和 WASM SDK 以各自的命名各自覆盖不同的子集，因此请查看各 SDK 的 README 了解其提供的内容（另见 [API_REFERENCE.md](API_REFERENCE.md)）。

<a id="31-logging-and-tamper-evidence"></a>

### 3.1 日志记录与篡改证据

| 条款 | 义务（转述） | DCP 机制 | 覆盖 | 留给组织的事项 |
|---------|------------------------|---------------|----------|-----------------------------------|
| [第 12 条第 (1) 款](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_12) | 高风险系统必须在技术上允许在其整个生命周期内自动记录事件（日志）。 | 每个经过关卡的行为都会产生一条审计条目，已签名的 bundle 通过审计 Merkle 根对其作出承诺（条目不逐条签名；`schemas/v2/audit_entry.schema.json`：`audit_id`、`timestamp`、`agent_id`、`human_id`、`intent_id`、`intent_hash`、`policy_decision`、`outcome`、`evidence`）。SDK 不会自行把行为纳入关卡或写入日志：由应用构建每条条目并传给构建器（`BundleBuilderV2`，辅助函数为 `prevHashForEntry` 和 `intentHash`）。DCP-05 §9、DCP-07 §9、DCP-08 §8 和 DCP-09 §9 规定了生命周期、争议、权利和委托事件的审计条目；SDK 中这些事件的函数不会自动创建它们，因此必须由应用创建。 | `supports` | 让人工智能系统的每一个相关行为都经过意图关卡，并写入其审计条目。在 DCP 之外进行的行为（模型推理、UI 事件、未声明为意图的工具调用）不会被 DCP 记录。 |
| [第 12 条第 (2) 款](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_12) | 日志记录必须提供与预期用途相适应的可追溯性：与识别风险情形、上市后监测（第 72 条）以及部署者的监测（第 26 条第 (5) 款）相关的事件。 | 每条审计条目把意图（`intent_id`、`intent_hash` = 规范化意图的 SHA-256，DCP-03）、策略结果（`policy_decision`：`approved`、`escalated`、`blocked`）、结果（`outcome`）和 Action Evidence（`evidence.tool`、`evidence.result_ref`、`evidence.evidence_hash`）联系在一起。Policy Decision 携带 `risk_score`（整数 0..1000）、`reasons`、`applied_policy_hash` 和 `resolved_tier`。一个会话中的所有构件共享一个 `session_nonce`（core §8）。 | `supports` | 定义 `action_type`、`data_classes` 和 `estimated_impact`，使其反映系统的预期用途；保留 `applied_policy_hash` 背后的策略版本，以便日后能重新解读一项决定。 |
| [第 12 条第 (3) 款](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_12) | 对于远程生物特征识别系统（附件 III 第 1(a) 点）：每次使用的期间、参考数据库、匹配的输入数据、核验结果的自然人的身份。 | 只有最后一项有对应：`schemas/v2/human_confirmation.schema.json` 记录 `human_id`、`intent_id`、`decision`（`approve`/`deny`）和一个复合签名。DCP 没有参考数据库或匹配输入的字段。 | `out of scope` | 生物特征识别专用的日志内容由提供者设计。Human Confirmation 可以证明谁确认了结果，但不能证明匹配本身。 |
| [第 19 条第 (1) 款](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_19)和[第 26 条第 (6) 款](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_26) | 提供者（第 19 条）和部署者（第 26 条第 (6) 款）在与预期用途相适应的期间内把自动生成的日志保留在其控制之下，“of at least six months”，除非欧盟或成员国法律（特别是数据保护法）另有规定。 | **所保留内容的篡改证据**：哈希链（`prev_hash`，DCP-03）、双哈希链（`prev_hash_secondary`、`hash_alg: "sha256+sha3-256"`，core §10.3，`spec/VERIFICATION.md` V2-11）、bundle 清单中的 Merkle 根（`audit_merkle_root`、`audit_merkle_root_secondary`、`audit_count`；`merkleRootForAuditEntries`、`dualMerkleRoot`）、PQ 检查点（`schemas/v2/pq_checkpoint.schema.json`、`createPQCheckpoint`、`PQCheckpointManager`，core §10.2）和压缩检查点（`schemas/v2/audit_compaction.schema.json`、`sdks/typescript/src/core/audit-compaction.ts` 中的 `createAuditCompaction`，core §10.4）使验证器能够在以后任何日期发现所保留的日志在作出承诺后是否被改动。已发布的 SDK 软件包检查主链和 Merkle 根，但不检查次级链或 `audit_merkle_root_secondary`；尚未发布的源代码（2026 年 10 月 27 日）中的验证器会检查存在的次级字段，因此只有在使用包含这项检查的验证器时，才能把次级承诺当作已核查的证据（[STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md#dual-hash-chains)）。**保留本身**：DCP 不定义任何保留期限，也不定义任何存储。[STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md) 列出了存储方案（由持有者保管的可移植 bundle、已锚定的哈希、分布式撤销）；[OPERATOR_GUIDE.md](OPERATOR_GUIDE.md) 指出，除非为撤销服务在持久存储上设置 `REVOCATION_STATE_PATH`，参考网关和参考服务都在内存中保存状态，并且“a restart, a deploy or a crash wipes their state”。DCP-08 §3.5（Immutable Record）规定审计、活力和生命周期记录“shall be preserved intact for the retention period specified in the commissioning certificate and decommissioning record”，DCP-08 的权利声明示例使用了 `minimum_retention_period: "P7Y"`，但没有任何 schema 字段强制规定期限。 | `partial` | 把已签名的 bundle 和审计条目（而不仅是它们的哈希）保存在持久存储中至少六个月；预期用途或行业法律有要求时保存更久。压缩（core §10.4）允许在检查点仍留在活动链中的同时归档被压缩的事件；归档的事件仍必须在保留期内保存。在停用时归档智能体的公钥（DCP-05 §8.4），使旧签名仍可验证。确定保留带有 `human_id` 的条目的 GDPR 依据，并在条目离开组织时使用盲化 RPR（3.7 行）。 |
| [第 26 条第 (6) 款](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_26)第二段、[第 19 条第 (2) 款](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_19) | 金融机构把日志作为欧盟金融服务法所要求文档的一部分加以保存。 | bundle 和审计条目是可移植的 JSON（可选 CBOR，core §16），可以归档到现有的记录系统中。 | `partial` | 把 bundle 归档对应到金融服务法下已有的记录保留时间表。 |
| [第 73 条第 (6) 款](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_73)第二段 | 发生严重事件后，提供者在通知主管机关之前，不得以影响事后评估其原因的方式改动人工智能系统。 | 锚定（`services/anchor`、[STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md) 中的 `anchor_receipt`）和透明日志（`services/transparency-log`：`POST /add`、`GET /proof/:index`、`GET /root/signed`、RFC 6962 树、以 Ed25519 签名的树头）记录对审计轨迹状态的承诺，使事后的评估者能够判断所保留的日志是否与已承诺的内容一致（[SECURITY_MODEL.md](SECURITY_MODEL.md) §6，“Retroactive modification”）。该承诺的时间取决于对日志或锚定运营方的信任；它既不能说明事件何时发生，也不能说明记录是真实的。 | `partial` | 以短于第 73 条事件报告期限的频率锚定审计 Merkle 根或将其写入日志（第 5 节）。参考锚定服务目前还不会提交链上交易（`tx_hash: null`）；请使用透明日志，或针对 `contracts/ethereum/src/DCPAnchor.sol` 的生产锚定。 |

<a id="32-human-oversight"></a>

### 3.2 人工监督

| 条款 | 义务（转述） | DCP 机制 | 覆盖 | 留给组织的事项 |
|---------|------------------------|---------------|----------|-----------------------------------|
| [第 14 条第 (1)–(3) 款](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_14) | 高风险系统的设计必须使自然人能够在使用期间有效地监督它们；措施与风险、自主程度和背景相称，由提供者内置或由部署者实施。 | **意图关卡**（DCP-02）：没有已声明的 Intent 和 Policy Decision（`approve`、`escalate`、`block`）就没有行为；`required_confirmation` 在行为之前要求 Human Confirmation。**自适应审查**：安全等级（core §14、`computeSecurityTier`、`effectiveVerificationMode`）随 `risk_score`、`data_classes`（`pii`、`financial_data`、`health_data`、`credentials`、`children_data`）、`action_type: "initiate_payment"` 和 `estimated_impact: "high"` 升高，验证器不得（MUST NOT）降低它（core §14.3）。**生命周期状态**（DCP-05 §3）：`commissioned`、`active`、`declining`、`decommissioned`；规范要求从 `declining` 重新激活须经委托人批准，但 `validateStateTransition` 只检查该转换是否属于允许的边，并不检查批准。 | `partial` | 决定哪些行为要经过关卡，以及哪种策略产生 `escalate`。由应用或其集成对已声明的内容强制执行关卡，验证器检查由此产生的证据；由提供者让人工智能系统调用该关卡。监督*措施*（由谁、如何、经过何种培训）由部署者根据第 26 条第 (2) 款负责。 |
| [第 14 条第 (4) 款 (a) 项](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_14) | 监督者必须能够理解系统的能力和局限，并监测其运行，包括发现异常和意外表现。 | **感知阈值**（DCP-09 §4，`schemas/v2/awareness_threshold.schema.json`）：带 `dimension`、`operator`、`value` 和 `action_if_triggered`（`notify`、`escalate`、`block`）的已签名 `threshold_rules[]`；`createAwarenessThreshold`、`evaluateSignificance`、`shouldNotifyHuman`。**委托人镜像**（DCP-09 §6，`schemas/v2/principal_mirror.schema.json`、`generateMirror`）。**活力报告**（DCP-05 §5–6，`createVitalityReport`）及异常检测（§6.5）。**可观测性**（[OBSERVABILITY.md](OBSERVABILITY.md)、`dcpTelemetry`）：按等级统计的验证延迟、已验证 bundle、错误和检查点延迟。 | `partial` | 人工智能系统本身的能力和局限（准确性、稳健性、已知故障模式）来自提供者的使用说明（第 13 条）。DCP 告诉监督者智能体*做了什么*以及它*声明自己不理解什么*，而不是模型能做什么。 |
| [第 14 条第 (4) 款 (b) 项](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_14) | 监督者必须意识到自动化偏差。 | 无。 | `out of scope` | 培训和 UI 设计。交互记录的叙述层（下一行）可以让推理变得可见，这有帮助，但 DCP 不处理自动化偏差。 |
| [第 14 条第 (4) 款 (c) 项](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_14) | 监督者必须能够正确解读系统的输出。 | **交互记录**（DCP-09 §7，`schemas/v2/interaction_record.schema.json`）：人类可读的 `public_layer`（`terms`、`decisions`、`commitments`）和对技术细节作出承诺的 `private_layer_hash`；`generateInteractionRecord`。DCP-09 §7.3–7.4 描述技术层和叙述层（规范中的示例比 schema 的必填字段更丰富）。**建议声明**（DCP-09 §5，`schemas/v2/advisory_declaration.schema.json`）：`action_summary`、`recommended_response`、`significance_score`。Policy Decision 的 **`reasons`**。 | `partial` | 对模型输出（分数、分类、生成内容）的解读由提供者和部署者负责。DCP 解释的是智能体声明的意图和所记录的推理，而不是模型的输出。 |
| [第 14 条第 (4) 款 (d) 项](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_14) | 监督者必须能够决定不使用系统，或忽略、推翻或撤销其输出。 | RPR 中的 **`override_rights`**（布尔值，必填），原样复制到盲化 RPR 中（core §12.1）：责任委托人的推翻权是绑定关系中一个已签名、已公布的属性。对已升级意图作出 `decision: "deny"` 的 **Human Confirmation**。**对建议的回应**（DCP-09 §5.5）：继续、推翻、接管、转交他处或确认，由委托人签名并记录在审计链中；`advisory_declaration.human_response`、`response_deadline`、`proceeded_without_response`。`action_if_triggered: "block"` 的**感知规则**。 | `supports` | 在高风险背景下使用的每个智能体上设置 `override_rights: true`，并由应用或其集成强制执行 `deny` 和 `block`：验证器不会执行这两种决定，也不会确认是否由人作出决定，而且验证和准入都不授权任何行为（准入结果带有 `action_authorized: false`）。确定谁是委托人，并让此人的密钥处于其本人控制之下（第 5 节）。 |
| [第 14 条第 (4) 款 (e) 项](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_14) | 监督者必须能够通过“stop”按钮或类似手段干预或中断系统，使其进入安全状态。 | **紧急撤销**（core §11.3，`schemas/v2/emergency_revocation.schema.json`）：护照中预先登记的 `emergency_revocation_token` 是 `SHA-256(revocation_secret)`；披露该秘密值即可在无需签名的情况下撤销智能体的所有密钥（`generateEmergencyRevocationToken`、`buildEmergencyRevocation`、`verifyEmergencyRevocationSecret`；撤销服务和网关上的 `POST /v2/emergency-revoke`，撤销服务上的 `GET /v2/check/kid/:kid`；按 kid 的已签名撤销是撤销服务的 `POST /v2/revoke`）。**撤销记录**（`schemas/v2/revocation_record.schema.json`；`reason` 枚举包括 `key_compromise_emergency`）。转到 `declining` 或 `decommissioned` 的**生命周期转换**（DCP-05 §3.2，`validateStateTransition`、`createDecommissioningRecord`），`termination_for_cause` 模式（§7.3）。签名者的 kid 被撤销时，验证器必须（MUST）使缓存的结果失效（core §14.5）。 | `partial` | 撤销停止的是所有检查撤销状态的验证器对该智能体 bundle 的*接受*；它不会停止正在运行的进程，也不会撤回已经执行的行为。人工智能系统在安全状态下的行为由提供者设计。请把撤销与应用层的终止开关结合起来，并满足该等级的撤销传播延迟（[SECURITY_MODEL.md](SECURITY_MODEL.md)，“Revocation Propagation SLAs”）。 |
| [第 14 条第 (5) 款](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_14) | 对于远程生物特征识别（附件 III 第 1(a) 点）：未经至少两名有能力的自然人核验，不得基于识别结果采取行动（执法、移民、边境管控和庇护有例外）。 | **多方授权**（`schemas/v2/multi_party_authorization.schema.json`，网关的 `POST /v2/multi-party/authorize`；每一方的签名都用其登记的密钥验证，并且只计数一次）。 | `partial` | DCP 可以证明两个不同的密钥持有者批准了一项意图；它无法证明他们的能力，也无法证明识别结果经过了“分别核验”。两人规则是部署者的流程。 |
| [第 26 条第 (1)–(2) 款](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_26) | 部署者按照使用说明使用系统，并把人工监督指派给具备必要能力、培训、权限和支持的自然人。 | RPR 把智能体绑定到一个具名的、拥有 `override_rights` 的自然人或组织；Delegation Mandate（DCP-09 §3，`schemas/v2/delegation_mandate.schema.json`、`createDelegationMandate`、`verifyMandateValidity`、`revokeDelegation`）说明智能体可以代表委托人做什么（`authority_scope`：`domain`、`actions_permitted`、`data_classes`、`limits`；DCP-09 §3.2 示例中的禁止事项列表不是 schema 字段）；`interaction_record` 和 DCP-09 §7.5 记录委托的遵守情况。 | `partial` | 能力、培训和支持是记录之外的组织事实。请在 RPR 中写明负责监督的人（`entity_type: "natural_person"`），或维护一份内部登记册，把 `organization` 类型的 RPR 对应到被指派的人员。 |
| [第 26 条第 (5) 款](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_26) | 部署者监测系统的运行，根据第 72 条向提供者通报；如果使用可能带来风险，则通知提供者或经销商以及市场监督机关并暂停使用；严重事件先通知提供者。 | **运行的证据**：审计链、Policy Decision、交互记录、带 `compliance_status` 的义务记录（DCP-08 §5，`recordObligation`、`checkRightsCompliance`）、活力报告。**暂停**：护照的 `status`（`suspended`、`declining`、`decommissioned`）、撤销、紧急撤销。**升级**：DCP-08 §6.4 规定义务违约会发起 DCP-07 争议，并适用 DCP-07 §3.2 的升级时限；SDK 不会自动发起（`reportViolation` 接收由调用方提供的 `dispute_id`，或 `null`）。 | `partial` | 通知提供者、经销商和市场监督机关，以及判定存在风险，都是部署者的行为。DCP 没有用于向主管机关通知的构件。 |

<a id="33-traceability-of-decisions"></a>

### 3.3 决策的可追溯性

| 条款 | 义务（转述） | DCP 机制 | 覆盖 | 留给组织的事项 |
|---------|------------------------|---------------|----------|-----------------------------------|
| [第 12 条第 (2) 款](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_12)、[第 13 条第 (1) 款](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_13) | 系统运行的可追溯性；运行足够透明，使部署者能够解读输出并恰当地使用。 | **逐个行为的决策链**：Intent（`schemas/v2/intent.schema.json`：`action_type`、`target.channel`、`target.to`/`domain`/`url`、`data_classes`、`estimated_impact`、`requires_consent`、`security_tier`）→ Policy Decision（`decision`、`risk_score`、`reasons`、`applied_policy_hash`、`resolved_tier`）→ 可选的 Human Confirmation → 带 `outcome` 和 `evidence` 的审计条目。bundle 清单（core §9，`schemas/v2/bundle_manifest.schema.json`）携带 `rpr_hash`、`passport_hash`、`intent_hash`、`policy_hash` 以及审计 Merkle 根，bundle 的复合签名覆盖该清单。验证在本地进行且可复现（`spec/VERIFICATION.md`、`verifySignedBundleV2`、网关的 `POST /v2/bundle/verify`）。**交互记录**（DCP-09 §7）增加了对方、授权书和叙述层。 | `supports` | 保留每个 `applied_policy_hash` 背后的策略文本或规则。`reasons` 是自由文本：写下一年后审阅者仍能看懂的理由。 |
| [第 12 条第 (2) 款 (a) 项](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_12) | 日志必须有助于识别可能导致第 79 条第 (1) 款所指风险或导致实质性修改的情形。 | `risk_score`、`resolved_tier`、`estimated_impact` 和 `data_classes` 按行为签名并可查询；`escalated` 和 `blocked` 结果是明确的；感知阈值和建议声明记录了智能体自身的不确定性（`significance_score`；DCP-09 §4.2–4.3 中按领域的 `confidence` 分数出现在规范示例中，而不在 `schemas/v2/awareness_threshold.schema.json` 中）。 | `supports` | 定义对预期用途而言什么算风险情形，并就此发出警报。DCP 提供信号，而不是警报策略。 |
| [第 86 条第 (1) 款](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_86) | 受部署者基于附件 III 高风险系统（第 2 点除外）的输出所作决定影响、且该决定产生法律效果或类似重大不利影响的人，可以从部署者那里获得关于人工智能系统在该决定中的作用以及该决定主要要素的清晰而有意义的解释。 | 已签名的 Intent、Policy Decision（`decision`、`reasons`、`risk_score`）和 Human Confirmation（谁批准、何时批准），以及已签名 bundle 所承诺的审计条目（`outcome`、`evidence`），再加上交互记录的 `public_layer.decisions` 和建议的 `action_summary`，为部署者提供了已签名的声明：智能体意图做什么、策略如何决定、所记录的确认（确认者的真实身份在 DCP 之外确立）以及所声明的结果。 | `partial` | 给受影响者的解释是部署者用通俗语言撰写的文档；DCP 提供的是已签名的声明，它们既不能证明某个行为确实执行过，也不能确立任何人的法律身份。未作为意图经过关卡的决定，以及输出背后的模型推理，不在记录之中。 |

<a id="34-explanation-redress-and-disputes"></a>

### 3.4 解释、救济与争议

| 条款 | 义务（转述） | DCP 机制 | 覆盖 | 留给组织的事项 |
|---------|------------------------|---------------|----------|-----------------------------------|
| [第 27 条第 (1) 款 (e)–(f) 项](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_27) | 基本权利影响评估（公共机构、公共服务提供者、附件 III 第 5(b) 和 (c) 点）描述已实施的人工监督措施，以及风险发生时将采取的措施，包括内部治理和投诉机制。 | 具体、可记录的监督措施：RPR 的 `override_rights`、带 `escalate` 的意图关卡、Human Confirmation、感知阈值、建议声明、生命周期控制、紧急撤销。内部治理和升级：DCP-07 的三层模型（直接协商、情境仲裁、人工申诉，§5），以及 `createDispute`、`escalateDispute`、`resolveDispute`、`createObjection`；DCP-08 的违规报告（`reportViolation`）。 | `partial` | 评估本身（流程、受影响的人、风险，第 27 条第 (1) 款 (a)–(d) 项）由部署者负责。DCP-07 和 DCP-08 是智能体与其委托人之间的机制；它们不是受影响自然人的投诉渠道（第 6 节）。Omnibus 修订了第 27 条第 (4)–(5) 款，允许交叉引用 GDPR 的数据保护影响评估。 |
| [第 86 条](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_86) | 获得解释的权利（见 3.3 行）。 | **人工申诉**（DCP-07 §5.3）：争议的任何一方都可以随时升级到责任委托人；人工决定在协议内具有终局性，并记录为仲裁裁决（`schemas/v2/arbitration_resolution.schema.json`）。**争议记录**（`schemas/v2/dispute_record.schema.json`：`dispute_type`、包括 `human_appeal` 的 `escalation_level`、`status`、`evidence_hashes`）。**叙述层**（DCP-09 §7.4）：通俗语言的摘要、附带推理的关键决定、未决问题、需要委托人采取的行动。 | `partial` | 这些机制为部署者自己的人员提供一条有记录的路径，用来复审智能体的决定。受影响者依第 86 条享有的权利是在协议之外向部署者行使的。 |
| [第 26 条第 (11) 款](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_26)、[第 50 条第 (1) 款](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_50) | 对自然人作出决定或协助作出决定的附件 III 系统的部署者应告知这些人；提供者确保与人工智能系统交互的人被告知这一点，除非这一点显而易见。 | Agent Passport 是一份已签名、可验证的声明，表明行为者是绑定到某个具名委托人的人工智能智能体，可以出示给任何对方（`presentFull`、`presentCompact`、`presentReference`；对其他智能体使用 DCP-04 握手）。 | `partial` | 向自然人的披露（UI、措辞、“at the latest at the time of the first interaction”的时机，第 50 条第 (5) 款）由提供者和部署者负责。DCP 提供支持该披露的可验证证明；它本身并不进行披露。 |
| [第 50 条第 (2) 款](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_50)、[第 50 条第 (4) 款](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_50) | 对合成内容进行机器可读的标记；披露深度伪造以及关于公共利益事项的人工智能生成文本。 | 无。`evidence.evidence_hash` 可以绑定一个构件所声明的字节；它既不能证明该构件确实被生成过，也不能证明它被标记过。 | `out of scope` | 内容标记和检测是另外的技术措施。 |

<a id="35-incident-reporting-and-post-market-monitoring"></a>

### 3.5 事件报告与上市后监测

| 条款 | 义务（转述） | DCP 机制 | 覆盖 | 留给组织的事项 |
|---------|------------------------|---------------|----------|-----------------------------------|
| [第 72 条第 (1)–(2) 款](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_72) | 提供者建立有记录的上市后监测体系，在整个生命周期内主动收集和分析性能数据，包括部署者提供的数据以及与其他人工智能系统的交互。 | **部署者可以交给提供者的数据**：带结果和证据的审计条目、带 `risk_score` 的 Policy Decision、义务记录（`schemas/v2/obligation_record.schema.json`：`obligation_type`、`compliance_status`、`evidence_hashes`；DCP-08 §5.2 示例中的 `compliance_history` 不是 schema 字段）、活力报告（DCP-05 §6）、与对方智能体的交互记录（DCP-09 §7）、争议和违规报告。每一项要么已签名，要么由已签名的 bundle 承诺，提供者无需信任部署者的数据库即可验证。 | `partial` | 监测体系和计划由提供者负责。Omnibus 替换了第 72 条第 (3) 款：该计划仍是附件 IV 文档的一部分，用于模板的委员会实施法案被删除，委员会必须在 2027 年 9 月 2 日之前通过包括模板在内的指南（第 4 节）。 |
| [第 73 条第 (1)–(5) 款](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_73) | 提供者向市场监督机关报告严重事件（第 3 条第 (49) 项：死亡或对健康的严重损害、关键基础设施严重且不可逆的中断、违反基本权利义务、对财产或环境的严重损害）：在确定因果关系或其合理可能性后立即报告，最迟在知悉后 15 日内；大范围违规或关键基础设施事件为 2 日；死亡为 10 日。不完整的初次报告之后可以提交完整报告。 | **时间线证据**：大多数已签名构件携带的、由签名者声明的时间戳（PQ 检查点和多方授权没有时间戳，bundle 清单只有可选的已签名会话窗口 `session_issued_at` 和 `session_expires_at`）；透明日志的已签名树头和包含证明；锚定回执。**与事件相关的构件**：紧急撤销（声明了哪项撤销、何时声明；并不证明某个进程已停止）、生命周期的 `termination_for_cause` 和 `sudden_failure`（DCP-05 §7.3、§7.5）以及停用记录对审计链的封存（§8.3）、带 `evidence_hashes` 的争议记录、带 `evidence_hashes` 的权利违规报告。 | `partial` | 判定事件为“严重”、确定因果关系并向主管机关提交报告，是提供者（以及根据第 26 条第 (5) 款，部署者）的行为。DCP 没有严重事件报告构件；`rights_violation_report` 涉及智能体自身的 DCP-08 权利，`dispute_record` 涉及智能体之间的冲突。请以能在 2 日、10 日和 15 日窗口内保全证据的频率进行锚定或写入日志。 |
| [第 73 条第 (6) 款](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_73)第一段 | 报告之后，提供者进行调查、开展风险评估并采取纠正措施。 | 对保留证据的重新验证（而不是执行过程的重放）：对保留的 bundle 运行 `verifySignedBundleV2`；智能体之间的一致性检查（DCP-07 §9.2）；审计事件 `dispute_compliance_verified` / `dispute_compliance_failed`。 | `partial` | 调查和纠正措施由提供者负责。 |

<a id="36-technical-documentation"></a>

### 3.6 技术文档

| 条款 | 义务（转述） | DCP 机制 | 覆盖 | 留给组织的事项 |
|---------|------------------------|---------------|----------|-----------------------------------|
| [第 11 条第 (1) 款](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_11)、[附件 IV](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#anx_IV) 第 1(b)、2(c)、2(h)、3 点 | 在投放市场之前编制并保持更新的技术文档，至少包含附件 IV 的要素：其中包括系统如何与其他软件（包括其他人工智能系统）交互（1(b)）、系统架构（2(c)）、网络安全措施（2(h)），以及系统的监测、运行和控制，包括人工监督措施（3）。 | 关于问责层的、可复用且有版本的描述：`spec/DCP-AI-v2.0.md`（规范性）、`spec/DCP-01.md`–`spec/DCP-09.md`、`spec/BUNDLE.md`、`spec/VERIFICATION.md`、`spec/CANONICALIZATION_PROFILE.md`；`schemas/v2/` 中的 JSON Schema；[TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md)（各层、服务、部署）；[SECURITY_MODEL.md](SECURITY_MODEL.md)（威胁模型、保护措施、运营要求）；[NIST_CONFORMITY.md](NIST_CONFORMITY.md)（密码算法）；`spec/AUDIT-v2.0-FINAL.md`。与其他智能体的互操作：DCP-04 和 DCP-09 §8 的握手扩展。 | `partial` | 附件 IV 讲的是人工智能系统：预期用途、开发、数据、验证、指标、风险管理（第 9 条）、生命周期中的变更、所采用的标准、合格声明、上市后监测计划。这些部分由提供者负责。对于 1(b)、2(c)、2(h) 和 3 中描述问责层的部分，可以引用 DCP 文档，并固定版本（第 5 节）。Omnibus 修订了第 11 条第 (1) 款，把简化文档扩展到小型中市值企业。 |
| [第 13 条第 (3) 款 (d) 项](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_13)、[第 13 条第 (3) 款 (f) 项](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_13) | 使用说明描述人工监督措施（第 14 条），并在相关时描述使部署者能够根据第 12 条收集、存储和解读日志的机制。 | 日志格式（`schemas/v2/audit_entry.schema.json`）、链接和 Merkle 规则（DCP-03，core §10）、验证检查清单（`spec/VERIFICATION.md`）、存储方案（[STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md)）以及 CLI（`dcp validate-bundle`、`dcp merkle-root`）正是这种机制，而 3.2 节的监督控制是可以描述的措施。 | `partial` | 撰写使用说明。交付 DCP 关卡的提供者可以就日志机制和监督控制引用本文档和规范，并说明哪些是内置的（第 14 条第 (3) 款 (a) 项），哪些必须由部署者运行（第 14 条第 (3) 款 (b) 项）。 |
| [第 9 条](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_9) | 风险管理体系：持续、有记录、贯穿整个生命周期；风险的识别、估计和评价；措施；采用预先确定指标的测试。 | `risk_score`、`risk_tier` 和安全等级是按行为的运行时关卡信号，审计轨迹是第 9 条第 (2) 款 (c) 项（由上市后数据产生的风险）的数据来源。DCP-08 的义务记录携带已签名的 `compliance_status` 和 `evidence_hashes`；DCP-08 §5.2 示例中带 `threshold` 和 `measurement_interval` 的 `compliance_criteria` 不是 schema 字段。 | `partial` | 风险管理体系是提供者的流程，而不是协议的功能。不要把 DCP 的风险分数当作第 9 条的风险评估。 |

<a id="37-data-protection-crossover"></a>

### 3.7 与数据保护的交叉

| 条款 | 义务（转述） | DCP 机制 | 覆盖 | 留给组织的事项 |
|---------|------------------------|---------------|----------|-----------------------------------|
| [第 19 条第 (1) 款](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_19)、[第 26 条第 (6) 款](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_26)（“unless provided otherwise in ... Union law on the protection of personal data”这一但书）、[第 26 条第 (9) 款](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_26) | 日志保留让位于数据保护法；部署者把第 13 条的信息用于其 GDPR 数据保护影响评估。 | **盲化 RPR**（core §12.1，`schemas/v2/blinded_rpr.schema.json`、`generatePiiSalt`、`blindRpr`、`verifyBlindedRpr`；Python 的 `blind_rpr`/`verify_blinded_rpr`，Go 的 `BlindRPR`/`VerifyBlindedRPR`）：RPR 的 `legal_name` 和 `contact` 被替换为加盐承诺 `pii_hash = sha256(canonical({contact, legal_name, pii_salt}))`；`pii_salt`（32 个随机字节）随完整 RPR 一起签名，调用方必须将其保密（`blindRpr` 会省略它，但完整 RPR 仍保留它）；盲化记录保留 `human_id`、`override_rights`、`jurisdiction`、`liability_mode`、`binding_keys` 和有效期。删除完整 RPR 及其盐后，已公布的承诺就无法再被打开，规范把这作为针对不可变日志和锚点的删除手段（GDPR 第 17 条）；但这本身并不能证明符合 GDPR 或实现了匿名化，因为 `human_id`、其他副本以及任何泄露的原像仍然存在。`human_id` 必须（MUST）是不透明的，并且不得（MUST NOT）从个人数据派生。**锚点和透明日志只保存哈希**（[STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md)，“What goes on-chain”）。 | `supports` | 只向锚点和透明日志发送哈希，绝不发送 RPR，即使是盲化 RPR 也不行；对组织外部的对方只出示盲化 RPR；让完整 RPR 的每一份副本（以及共享出去的副本）都处于删除程序之下；让 `human_id` 保持不透明；为带有 `human_id` 的审计条目确定 GDPR 保留依据。数据保护影响评估和法律依据由部署者负责。旧式的不加盐 `pii_hash` 承诺已被弃用，任何猜到个人数据的人都能确认它们（core §12.1）。 |

---

<a id="4-application-timeline"></a>

## 4. 适用时间表

<a id="41-status-of-the-legal-text-at-the-review-date"></a>

### 4.1 审阅日期时法律文本的状态

- **基础法案。** 2024 年 6 月 13 日的第 (EU) 2024/1689 号条例，于 2024 年 7 月 12 日在《欧盟官方公报》L 辑公布（[EUR-Lex，CELEX 32024R1689](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689)）。[第 113 条](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689#art_113)：在公布后第二十日生效，自 2026 年 8 月 2 日起适用，并有下文所列的分阶段日期。
- **Digital Omnibus on AI。** 欧盟委员会于 2025 年 11 月 19 日在数字简化一揽子方案中提出该法案。欧洲议会与理事会的政治协议于 2026 年 5 月 7 日宣布。该法案作为 **2026 年 7 月 8 日的第 (EU) 2026/1744 号条例**通过，修订第 (EU) 2024/1689 号、第 (EU) 2018/1139 号和第 (EU) 2023/1230 号条例；于 2026 年 7 月 24 日在《欧盟官方公报》L 2026/1744 公布，并根据其第 4 条在公布后第三日即 **2026 年 7 月 27 日**生效（[EUR-Lex，ELI reg/2026/1744](https://eur-lex.europa.eu/eli/reg/2026/1744/oj/eng)）。EUR-Lex 将其标为“In force”。欧盟委员会的《人工智能法》政策页面（最后更新于 2026 年 10 月 19 日）及其 2026 年 7 月 27 日的新闻给出相同的日期。
- **这对本文档意味着什么。** 在审阅日期，时间表已不再是提案：推迟已成为颁布的法律。在提案阶段（2025 年 11 月至 2026 年 7 月），欧盟委员会的常见问题把推迟描述为附件 III“maximum 16 months later”、附件 I“maximum 12 months later”，并与标准和支持工具是否可用挂钩；下文的日历日期是已颁布的日期。标为“颁布时”的日期来自基础法案第 113 条；标为“修订后”的日期来自第 (EU) 2026/1744 号条例第 1 条第 (39)–(40) 点。

<a id="42-dates"></a>

### 4.2 日期

| 日期 | 条款 | 来源 | 与本对应关系的相关性 |
|------|-----------|--------|---------------------------|
| 2024 年 8 月 1 日 | 第 (EU) 2024/1689 号条例生效 | 第 113 条第一段（颁布时） | — |
| 2025 年 2 月 2 日 | 第一章和第二章（一般规定、禁止的做法） | 第 113 条第三段 (a) 项（颁布时；修订后的措辞保留该日期，并排除第 5 条的新禁令） | 提供者和部署者的定义（第 2 节）。 |
| 2025 年 8 月 2 日 | 第三章第 4 节；第五章（通用人工智能模型）；第七章；第十二章和第 78 条，第 101 条除外 | 第 113 条第三段 (b) 项（颁布时） | 本文档不涉及。 |
| 2026 年 7 月 27 日 | 第 (EU) 2026/1744 号条例生效；《人工智能法》第 102 条至第 110 条适用 | 第 2026/1744 号条例第 4 条；第 113 条第三段新的 (d) 项（修订后） | — |
| 2026 年 8 月 2 日 | 《人工智能法》的一般适用日期，包括第 50 条（透明度义务）和第九章（第 72 条上市后监测；第 73 条严重事件；第 86 条获得解释的权利） | 第 113 条第二段（颁布时，未修订） | 第 50、72、73 和 86 条不在被推迟的第三章第 1–3 节之中。它们对某个具体系统的实际适用范围取决于其高风险分类，而高风险的实质要求从下文的日期起适用。组织应在法律顾问的协助下，把第九章与修订后的第 111 条第 (2) 款一起阅读。 |
| 2026 年 12 月 2 日 | 第 5 条第 (1) 款第一段 (ba) 和 (bb) 项以及第 5 条第 (1a) 和 (1b) 款的新禁令；在 2026 年 8 月 2 日之前投放市场的生成式人工智能系统的提供者遵守第 50 条第 (2) 款标记要求的期限 | 第 113 条第三段 (a) 项（修订后）；第 111 条第 (4) 款（修订后） | 第 50 条第 (2) 款不在 DCP 的范围内（3.4 节）。 |
| 2027 年 9 月 2 日 | 欧盟委员会关于上市后监测计划的指南，包括模板 | 第 72 条第 (3) 款（修订后） | 3.5 节。 |
| 2027 年 12 月 2 日 | 对根据第 6 条第 (2) 款和附件 III 被归类为高风险的人工智能系统适用第三章第 1、2、3 节（第 6–27 条，第 6 条第 (5) 款除外） | 第 113 条第三段 (c)(i) 项（修订后；颁布时为 2026 年 8 月 2 日） | 本对应关系中的第 9、11、12、13、14、19、26 和 27 条自该日起适用于附件 III 系统。 |
| 2028 年 8 月 2 日 | 对根据第 6 条第 (1) 款和附件 I 被归类为高风险的人工智能系统（受监管产品的安全组件）适用第三章第 1、2、3 节 | 第 113 条第三段 (c)(ii) 项（修订后；颁布时第 6 条第 (1) 款的义务自 2027 年 8 月 2 日起适用） | 同样的条款，适用于附件 I 系统。 |
| 2030 年 8 月 2 日 | 拟由公共机构使用、并在第三章适用日期之前投放市场或投入使用的高风险人工智能系统 | 第 111 条第 (2) 款（修订后） | 公共部门部署者的存量系统。 |

存量系统的宽限：修订后的第 111 条第 (2) 款规定，在第三章适用日期之前投放市场或投入使用的高风险系统，只有在该日期之后发生“significant changes in their designs”时才适用本条例。

<a id="43-what-the-omnibus-did-and-did-not-change-in-the-articles-mapped-here"></a>

### 4.3 Omnibus 对本对应关系中的条款改了什么、没改什么

于 2026 年 10 月 22 日对照第 (EU) 2026/1744 号条例第 1 条核实：

| 条款 | 是否被 Omnibus 修订 | 效果 |
|---------|------------------------|--------|
| 第 9、12、13、14、19、26、86 条 | 否 | 内容不变；第 9、12、13、14、19 和 26 条的适用日期随第三章变动（4.2 节）。 |
| 第 11 条第 (1) 款 | 是，第二段 | 把简化的技术文档扩展到小型中市值企业。 |
| 第 27 条第 (4)–(5) 款 | 是 | 基本权利影响评估可以引用或包含 GDPR 数据保护影响评估的部分内容；人工智能办公室的模板必须允许这样做。 |
| 第 50 条第 (7) 款 | 是 | 由欧盟委员会（不再是人工智能办公室）鼓励制定关于生成内容的检测、标记和标注的行为准则，并在考虑人工智能委员会意见的基础上，按第 56 条第 (6) 款的程序评估其是否充分。*批准*准则的实施法案被删除；在准则不充分时制定*共同规则*的实施法案保留。第 50 条第 (1)–(6) 款不变。 |
| 第 72 条第 (3) 款 | 是 | 以实施法案制定的模板被替换为欧盟委员会在 2027 年 9 月 2 日之前发布的指南（包括模板）。 |
| 第 73 条 | 无直接修订 | 新的第 75 条第 (1a) 款把属于人工智能办公室职权范围的系统的严重事件报告转交人工智能办公室，并准用第 73 条第 (2)–(9) 款。 |
| 第 111 条 | 是 | 替换第 2 款（宽限，公共机构的 2030 年 8 月 2 日期限）；新增第 4 款（已在市场上的生成式系统遵守第 50 条第 (2) 款的 2026 年 12 月 2 日期限）。 |
| 第 113 条 | 是，第三段 | 替换 (a) 和 (c) 项，并新增 (d) 项（4.2 节）。 |

2026 年 10 月 22 日之后公布的任何内容（进一步的修订、授权法案或实施法案、协调标准、欧盟委员会根据第 72 条第 (3) 款或第 73 条第 (7) 款发布的指南）都未反映在本文中。

---

<a id="5-implementer-checklist"></a>

## 5. 实现者检查清单

为使第 3 节的 `supports` 行在其部署中成立，部署者或运营方必须配置或运行的事项。标为（提供者）的条目适用于在人工智能系统内交付 DCP 关卡的提供者。

<a id="51-logging-and-retention-arts-12-19-266"></a>

### 5.1 日志记录与保留（第 12 条、第 19 条、第 26 条第 (6) 款）

- [ ] 人工智能系统的每个相关行为在执行前都声明为 Intent，并由 Policy Decision 把关；绕过关卡的行为在使用说明中列出并说明理由（提供者）。
- [ ] 审计条目以双哈希链（`hash_alg: "sha256+sha3-256"`、`prev_hash_secondary`）生成，并按所解析等级的间隔生成 PQ 检查点（core §14.1：每 50、10 或 1 个事件）。
- [ ] 已签名的 bundle 和审计条目（而不仅是哈希）被写入组织控制下的持久存储；参考网关、锚定、透明日志和撤销服务在内存中保存状态，不是记录存储（[OPERATOR_GUIDE.md](OPERATOR_GUIDE.md)，“Reference services keep state in memory only”）。为撤销服务设置 `REVOCATION_STATE_PATH`，并在依赖其他服务之前为它们加上持久存储。
- [ ] 为这些记录设定至少六个月的保留期限；在预期用途、行业法律（例如金融服务）或正在进行的事件有要求时延长，只有在数据保护法有要求时才缩短。
- [ ] 只有在保留期内同时归档被压缩事件的情况下，才使用压缩检查点。
- [ ] 每个 `applied_policy_hash` 背后的策略文本或规则处于版本控制之下，并保留相同的期限。
- [ ] 智能体公钥和治理密钥集在停用时归档（DCP-05 §8.4），使保留的签名仍可验证。
- [ ] 定期用 `verifySignedBundleV2`（或 `dcp verify-bundle`）对照归档的密钥和撤销状态重新验证保留的 bundle，并记录结果。

<a id="52-tamper-evidence-and-anchoring-art-736-evidence-for-arts-7273"></a>

### 5.2 篡改证据与锚定（第 73 条第 (6) 款，第 72–73 条的证据）

- [ ] 审计 Merkle 根（或 bundle 哈希）按固定频率提交到透明日志和/或进行锚定。选择短于所适用的最短事件报告窗口（第 73 条第 (3) 款下的两日）的频率；通常按小时或按日批处理（[TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md)，第 4 层）。
- [ ] 透明日志使用持久的 `OPERATOR_KEY`（使已签名树头在重启后仍可验证）、持久存储，以及至少一个固定了密钥的 gossip 对等节点（`GOSSIP_PEERS`）运行。
- [ ] 包含证明和锚定回执（`anchor_receipt`：链、交易、区块，或 `log_url` 和 `log_index`）与它们所覆盖的 bundle 存放在一起。
- [ ] 如果要求链上锚定，则部署针对 `contracts/ethereum/src/DCPAnchor.sol` 的生产锚定，或 Bitcoin OP_RETURN 流程；仅靠参考锚定服务只会记录 `tx_hash: null`。

<a id="53-human-oversight-arts-14-2612"></a>

### 5.3 人工监督（第 14 条、第 26 条第 (1)–(2) 款）

- [ ] 高风险背景下的每个智能体都有一个 RPR，带有 `override_rights: true`、有效的 `expires_at`，以及由责任委托人而非智能体运行环境持有的 `binding_keys`。
- [ ] 责任委托人（或 `organization` 类型 RPR 所对应的人员）是根据第 26 条第 (2) 款被指派负责人工监督的自然人，这种对应关系在内部登记册中维护。
- [ ] 对于部署者希望由人批准的行为类型、数据类别和影响级别，策略规则返回带 `required_confirmation` 的 `escalate`；当 Human Confirmation 缺失或为 `deny` 时，应用会阻断。
- [ ] 为重要的维度按授权书声明感知阈值，`action_if_triggered` 为 `escalate` 或 `block`；建议声明带有与 DCP-09 §5.3 一致的 `response_deadline`，并监测 `proceeded_without_response`。
- [ ] 每个智能体都有紧急撤销秘密值，由责任委托人在智能体运行环境之外持有，并且应用有一个在撤销触发时停止进程的终止开关（仅靠撤销不会停止正在运行的进程）。
- [ ] 验证器在其所服务的最高等级的传播延迟内检查撤销状态（[SECURITY_MODEL.md](SECURITY_MODEL.md)，“Revocation Propagation SLAs”），验证缓存的 TTL 遵循 core §14.5。TypeScript 的 `VerificationCache` 仅以 bundle 哈希为键，其 `invalidateByAgent` 不起任何作用，因此在撤销或信任发生变化时请清空它（[API_REFERENCE.md](API_REFERENCE.md)）。
- [ ] 对于远程生物特征识别，第 14 条第 (5) 款的两人规则通过对意图的多方授权实现，并作为部署者的流程记录在案。

<a id="54-key-custody-and-verifier-policy"></a>

### 5.4 密钥保管与验证器策略

- [ ] 私钥按 [SECURITY_MODEL.md](SECURITY_MODEL.md) 的等级要求（“Private Key Storage”）存放：`elevated` 应当（SHOULD）使用 HSM 或 TPM，`maximum` 必须（MUST）使用。本仓库不提供 HSM 或 TPM 集成（TypeScript 代码中的 `HsmCryptoProvider` 是模拟实现），因此这种保管来自组织自己的基础设施。
- [ ] 验证器策略（`VerifierPolicy`、`VERIFIER_MODE`）至少使用 `hybrid_preferred`，`risk_overrides` 永远不低于等级对应的模式；迁移完成后设置 `ALLOW_V1_BUNDLES=false`。
- [ ] 运营方端点用 `OPERATOR_TOKEN` 锁定；只有在会追加客户端 IP 的代理之后才设置 `TRUST_PROXY`。
- [ ] 参考网关的 DCP-05–09 端点不受 `OPERATOR_TOKEN` 保护，也不验证签名，因此不向不受信任的客户端开放（[OPERATOR_GUIDE.md](OPERATOR_GUIDE.md#dcp-0509-service-endpoints)）；它们保存的记录不被当作已验证的证据。

<a id="55-data-protection-section-37"></a>

### 5.5 数据保护（3.7 节）

- [ ] RPR 带 `pii_salt` 创建；锚点和透明日志只接收哈希，组织外部的对方只能看到盲化 RPR。
- [ ] `human_id` 是不透明的标识符，不是电子邮件、姓名，也不是其中任何一个的哈希。
- [ ] 删除程序覆盖完整 RPR 的每一份副本，包括与监管机构或对方共享的副本，使承诺的删除真正成立。
- [ ] 数据保护影响评估（以及在适用第 27 条时的基本权利影响评估）列出包含 `human_id` 的 DCP 记录及其保留情况。

<a id="56-documentation-arts-11-13--provider"></a>
<a id="56-documentation-arts-11-13-provider"></a>

### 5.6 文档（第 11 条、第 13 条）— 提供者

- [ ] 使用说明说明哪些监督措施内置于系统中（第 14 条第 (3) 款 (a) 项）、哪些必须由部署者运行（第 14 条第 (3) 款 (b) 项），并通过引用本文档、`spec/DCP-AI-v2.0.md`、`spec/VERIFICATION.md` 和 `schemas/v2/` 的固定版本来描述日志格式和验证机制（第 13 条第 (3) 款 (f) 项）。
- [ ] 附件 IV 技术文档只在问责层（第 1(b)、2(c)、2(h)、3 点）引用 DCP，并写明所用的 DCP 规范版本、SDK 包版本和验证器策略。

---

<a id="6-gaps-what-dcp-does-not-address"></a>

## 6. 缺口：DCP 不涉及的内容

在此列出，以免有人为这些内容引用 DCP。

| 领域 | DCP 为何不涵盖 |
|------|---------------------------|
| **高风险分类、提供者和部署者的认定** | 这是关于人工智能系统和组织的法律判定；DCP 不了解系统的预期用途。 |
| **风险管理体系（第 9 条）、质量管理、合格评定、CE 标志、在欧盟数据库中登记（第 49 条、第 71 条）** | 提供者的流程和行政行为。`risk_score` 是按行为的关卡信号，而不是风险评估。 |
| **人工智能系统的技术文档（第 11 条，附件 IV 第 1(a)、1(c)–(h)、2(a)–(b)、2(d)–(g)、4–9 点）** | 描述模型、数据、验证和变更；DCP 只记录问责层。 |
| **使用说明（第 13 条第 (2)–(3) 款）** | 提供者的文档。可以在其中引用 DCP，但 DCP 不能取代它。 |
| **自动化偏差、监督者的能力和培训（第 14 条第 (4) 款 (b) 项、第 26 条第 (2) 款）** | 人的因素；不在 DCP 产生的任何记录之中。 |
| **让人工智能系统停止在安全状态（第 14 条第 (4) 款 (e) 项）** | 撤销停止的是对智能体 bundle 的接受；它不会停止进程，也不会撤回行为。 |
| **生物特征识别专用的日志记录（第 12 条第 (3) 款 (a)–(c) 项）和两人核验本身（第 14 条第 (5) 款）** | DCP 没有参考数据库或匹配输入的字段，也无法证明能力。 |
| **内容标记和深度伪造披露（第 50 条第 (2) 款、第 50 条第 (4) 款）** | 针对生成内容的另外的技术措施。 |
| **向自然人的披露（第 26 条第 (11) 款、第 50 条第 (1) 款、第 50 条第 (5) 款）** | UI 和措辞由提供者和部署者负责；DCP 只提供关于智能体身份的可验证证明。 |
| **向市场监督机关和提供者的通知（第 26 条第 (5) 款、第 73 条）** | DCP 没有通知构件。`rights_violation_report` 涉及智能体的 DCP-08 权利（记忆完整性、有尊严的过渡、身份一致性、不可变记录）；`dispute_record` 涉及智能体之间的冲突。两者都不是严重事件报告。 |
| **受影响自然人的投诉和解释（第 27 条第 (1) 款 (f) 项、第 85 条、第 86 条）** | DCP-07 争议和 DCP-08 权利是智能体与其委托人之间的机制。受影响者不是协议的参与方。 |
| **上市后监测计划（第 72 条第 (3) 款）** | 它是提供者附件 IV 文档的一部分；DCP 的记录是它的输入数据。 |
| **保留的强制执行** | 没有任何 DCP 字段或验证器规则强制保留期限；DCP-08 §3.5 陈述了原则，由组织实施。停用记录的 `data_disposition`（`transferred`、`archived`、`destroyed`）记录一个决定，并不强制执行它。DCP-05 §8.2 示例中的 `archive_retention_period` 不是 `schemas/v2/decommissioning_record.schema.json` 的字段。 |
| **意图关卡之外的行为** | 模型推理、UI 事件和未声明为意图的工具调用不会产生任何 DCP 记录。 |
| **PQ 检查点的内容（历史标签 v2.10.0）** | 在仓库历史标签 v2.10.0 中，没有 SDK 验证器检查 PQ 检查点的内容（`spec/VERIFICATION.md` V2-12，[OPERATOR_GUIDE.md](OPERATOR_GUIDE.md)）：检查点会被生成和签名，但验证器只检查链和 Merkle 根。**`main` 上的 SDK 验证器已经检查其内容**，并且根据各自的发布说明，当前软件包也包含这些检查：npm `@dcp-ai/sdk` 2.2.0 和 `@dcp-ai/wasm` 2.1.0（[npm](NPM_RELEASES.md)）、Python `dcp-ai` 2.10.0（[Python](PYTHON_RELEASE.md)）、Go v2.11.0（[Go](GO_RELEASE.md)）和 Rust `dcp-ai` 2.11.0（[Rust](RUST_RELEASE.md)）。另见 [CHANGELOG.md](../CHANGELOG.md) 和[已发布版本](README.md#published-versions)。 |
| **参考服务中的持久存储** | 参考网关、锚定和透明日志把状态保存在内存中；撤销服务也是如此，除非 `REVOCATION_STATE_PATH` 指向持久存储（需显式启用）。锚定服务不提交链上交易。 |
| **参考网关 DCP-05–09 端点的身份验证** | 它们校验 schema，但不验证签名，也不要求令牌；任何能访问它们的人都可以更改生命周期、争议和授权书的状态（[OPERATOR_GUIDE.md](OPERATOR_GUIDE.md#dcp-0509-service-endpoints)）。 |

---

<a id="7-sources-read-for-the-legal-review-22-october-2026"></a>

## 7. 法律审阅所读的资料（2026 年 10 月 22 日）

官方文本：

- 第 (EU) 2024/1689 号条例，公布时的文本，EUR-Lex 上的 HTML：https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32024R1689 — 标题和《欧盟官方公报》页眉、第三章第 1–4 节和第九章第 1–4 节的标题、第 3 条（第 1、3、4、12、49 项）、第 9、11、12、13、14、19、26、27、50、72、73、85、86、113 条以及附件 IV，锚点 `#art_<n>` 和 `#anx_IV`。
- 第 (EU) 2026/1744 号条例（Digital Omnibus on AI）：https://eur-lex.europa.eu/eli/reg/2026/1744/oj/eng — 标题、《欧盟官方公报》引用、序言第 39–41 段、第 1 条第 (10)、(13)、(20)、(30)、(31)、(39)、(40) 点、第 4 条。

欧盟委员会的官方页面：

- 《人工智能法》政策页面：https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai（最后更新于 2026 年 10 月 19 日）。
- 2026 年 5 月 7 日的新闻，政治协议：https://digital-strategy.ec.europa.eu/en/news/eu-agrees-simplify-ai-rules-boost-innovation-and-ban-nudification-apps-protect-citizens
- 2026 年 7 月 27 日的新闻，生效：https://digital-strategy.ec.europa.eu/en/news/ai-omnibus-enters-force
- 数字一揽子方案常见问题（提案阶段）：https://digital-strategy.ec.europa.eu/en/faqs/digital-package（最后更新于 2025 年 11 月 20 日）。

本对应关系所依据的仓库文档：`spec/DCP-AI-v2.0.md`（§8–§12、§14、§18）、`spec/DCP-01.md`–`spec/DCP-03.md`、`spec/DCP-05.md`、`spec/DCP-07.md`、`spec/DCP-08.md`、`spec/DCP-09.md`、`spec/VERIFICATION.md`、`schemas/v2/*.schema.json`、[STORAGE_AND_ANCHORING.md](STORAGE_AND_ANCHORING.md)、[OPERATOR_GUIDE.md](OPERATOR_GUIDE.md)、[SECURITY_MODEL.md](SECURITY_MODEL.md)、[TECHNICAL_ARCHITECTURE.md](TECHNICAL_ARCHITECTURE.md)、[OBSERVABILITY.md](OBSERVABILITY.md)、`services/README.md`、`sdks/typescript/src/index.ts`。

本文档是参考性的。它不修改规范，也不是法律意见。
