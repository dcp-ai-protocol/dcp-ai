<sub>[English](../../../../docs/conformance/SECURITY_COVERAGE.md) · **中文** · [Español](../../../es/docs/conformance/SECURITY_COVERAGE.md) · [日本語](../../../ja/docs/conformance/SECURITY_COVERAGE.md) · [Português](../../../pt-BR/docs/conformance/SECURITY_COVERAGE.md)</sub>

<a id="security-guarantees-and-conformance-coverage"></a>

# 安全保证与一致性测试覆盖

> 本文是[英文版本](../../../../docs/conformance/SECURITY_COVERAGE.md)的参考译文，更新于 08/11/2026。如有差异，以英文版本为准。标识符、命令和代码块保持原文。

本文提供规范性要求与仓库可执行测试之间的信息性映射。它不是新配置文件、认证、已测试所有输入的声明，也不是某个部署通过测试的证据。测试结果仅适用于该次运行记录的准确实现、输入、策略、验证时间和工具版本。

[验证清单](../../spec/VERIFICATION.md)、[规范化配置文件](../../spec/CANONICALIZATION_PROFILE.md)和[准入配置文件](../../spec/profiles/admission/README.md)仍具有权威性。参考实现和测试套件都可能存在缺陷。应依据规范与可复现用例解决分歧；实现之间的一致并不能决定正确性。

<a id="what-the-guarantees-mean"></a>

## 保证的含义

| 层次 | 检查能够证明什么 | 不能证明什么 |
|---|---|---|
| 模式 | 输入具有允许的结构和字段值 | 有效签名、诚实声明、责任主体身份或授权 |
| 密码学验证 | 所检查的签名、哈希和关系满足所给密钥、策略和时间下的适用规则 | 指定责任主体可信、记录事件确实发生，或允许执行工具 |
| 责任主体信任 | 已验证的责任主体签名组件与运营者带外提供的信任集合匹配 | 超出该信任来源的身份保证，或执行操作的权限 |
| `strict-v1` 准入 | 验证、责任主体信任、已签名的受众与会话约束及足够新鲜的撤销状态满足配置文件 | 一次性使用、快照之后的撤销或操作授权 |
| 适配器执行 | 集成在受保护的处理程序之前执行运营者的准入决定 | 核心协议提供或外部一致性测试套件证明的属性 |

`action_authorized` 始终为 `false`。通过验证或准入的、关于被阻止或升级处理操作的记录，只是该记录中决定的证据，不是执行许可。会话绑定防止拼接不一致的会话；它不会消耗 bundle，也不会使 bundle 只能使用一次。

<a id="reading-the-evidence"></a>

## 如何阅读证据

[套件 README](../../tools/conformance/README.md)定义命令、契约、报告字段和退出码。各测试面有所不同：

- **参考实现：** `tools/conformance.js` 调用参考辅助函数和 `lib/verify.js`；后者校验 V2 模式，并将密码学验证委托给 TypeScript。
- **外部原语：** 契约 `/1` 通过所提供的实现测试规范化和摘要。
- **外部证据：** 契约 `/2` 测试 Merkle 根、复合签名和 V2 bundle 验证。仓库提供 TypeScript、Python、Go、Rust 和 WASM 封装程序。
- **外部准入：** 契约 `/3` 测试组合准入与配置加载。仓库提供 TypeScript、Python、Go 和 Rust 封装程序；WASM 没有准入 API。
- **外部委托：** 契约 `/4` 测试 DCP-09 §3.5.2 委托书链的判定结果。仓库提供 TypeScript、Python、Go 和 Rust 封装程序；WASM 没有委托书链 API。
- **外部实际生效策略：** 契约 `/5`（选择性启用）测试 V2 bundle 验证，以及验证器在同一次验证中解析出的验证模式和安全等级。仓库提供 TypeScript、Python、Go、Rust 和 WASM 封装程序。
- **SDK 与适配器测试套件：** 它们是独立测试，具有自己的入口和范围。出现在套件清单中的条目，不等于该套件执行了相应测试。

编号契约是运行器接口，不是 DCP 协议版本。封装程序身份由其自行声明。五个封装程序不代表五个独立外部采用者：WASM 与 Rust 共享代码，且这些封装程序都属于本仓库。

负向结果只有在正向对照正常工作时才有意义。修改已签名内容但不更新签名，可能因多个原因导致失败。`spec_step` 标签或匹配的错误消息本身不能证明由哪项检查导致拒绝。能够隔离规则的有效/无效用例对，比单独构建拒绝 bundle 且仅有套件级正向对照提供更强的证据。

<a id="v2-verification-map"></a>

## V2 验证映射

以下用例名来自 [bundle 向量](../../../../tests/interop/v2/bundle_vectors.json)。`M`、`R`、`A` 分别表示 `must_reject`、`must_reject_bundles`、`must_accept_bundles`；外部 ID 以 `external.v2.bundle_vectors.` 开头，分别后接 `must_reject`、`must_reject_bundles` 或 `must_accept`，再接用例名。`signed_bundle` 是基础正向用例。这里列的是可追溯样例，不是穷尽列表或完整性评级。

| 规范规则 | 选定的现有用例或套件 | 范围与剩余限制 |
|---|---|---|
| V2-1：选择版本 | M `dcp_bundle_version_1_0`, `dcp_bundle_version_3_0` | V2 入口拒绝；不测试所有 V1 要求 |
| V2-2：校验封装与证据对象的模式 | 参考 `v2.signed_bundle.schema_invalid_payload_rejected`；模式套件；需要明确选择的模式校验目录（57 个用例） | 自 `@dcp-ai/sdk` 2.3.0、`@dcp-ai/wasm` 2.1.3、`dcp-ai` 2.10.2（PyPI）、Go v2.13.0 和 Rust `dcp-ai` 2.13.0 起，SDK 验证器自行执行 V2-2；更早的版本不执行。见下文边界 |
| V2-3：清单、载荷哈希与审计绑定 | M `intent_payload_hash_wrong`, `audit_entries_truncated`; R `manifest_intent_hash_mismatch`, `audit_chain_hash_wrong`; A `empty_audit_trail` | 哈希及链绑定样例；未隔离覆盖每个字段和畸形结构 |
| V2-4：会话、时间与未签名元数据一致性 | R `intent_session_nonce_differs`, `session_expired_with_offset`, `session_longer_than_policy_max_with_late_created_at`; M `signature_signer_id_other`; A `session_duration_at_millisecond_precision` | 固定时间测试；必须区分请求策略与实际生效模式 |
| V2-5：签名结构与规范编码 | M `bundle_classical_sig_b64_with_trailing_bits`, `intent_classical_sig_b64_unpadded`; R `classical_only_bundle_signature_without_pq` | 编码样例未覆盖所有签名位置和缺陷组合 |
| V2-6：责任主体签署清单 | R `bundle_signed_by_agent_keys`; 参考 `v2.signed_bundle.forged_classical_signature_rejected` | 角色绑定与签名样例；不建立对自行声明的责任主体的信任 |
| V2-7：验证存在的 PQ 签名 | M `bundle_pq_signature_invalid`, `bundle_pq_slot_holds_ed25519` | 历史证据目录在所选策略下测试；声明覆盖全部实际生效模式需要相应对照 |
| V2-8：依据上下文与签名者角色验证每项证据 | M `rpr_classical_signature_invalid`, `intent_signed_by_principal`, `policy_decision_signed_under_intent_context` | 证据对象与角色样例；未覆盖组件、上下文和密钥的所有组合 |
| V2-9：推导等级，且声明不能降低它 | R `classical_only_intent_action_type_constructor`, `classical_only_intent_security_tier_constructor` | 判定样例；`/2` 的 bundle 操作不评估报告的已解析等级；`/5` 的实际生效策略目录会评估 |
| V2-10：执行实际生效模式与算法策略 | R `classical_only_payment_from_low_risk_passport`; 四种模式下的 `classical_only_routine` | 模式样例；历史证据目录没有专门的算法允许列表及安全通告矩阵 |
| V2-11：验证存在的次级字段 | 来自[次级向量](../../../../tests/interop/v2/secondary_sha3_vectors.json)的 `external.v2.secondary_sha3` | 正向对照及畸形或不匹配字段；缺失的链接可选，因此接受不意味着存在完整次级链 |
| V2-12：绑定并验证检查点 | A `pq_checkpoint_over_the_trail`; R `pq_checkpoint_listed_but_missing`, `pq_checkpoint_event_range_count_wrong`, `pq_checkpoint_pq_signature_invalid` | 成员关系、范围及签名样例；未覆盖所有畸形范围或组件组合 |
| V2-13：推导密钥 ID 并验证密钥有效性 | R `passport_key_kid_not_derived`, `passport_key_public_key_with_trailing_bits`, `rpr_binding_key_revoked` | 密钥、编码和状态样例；不是完整密钥策略覆盖 |
| V2-14：跨证据对象一致性 | R `passport_principal_binding_reference_other`, `audit_entry_policy_decision_other`; A `blocked_action_recorded`, `escalated_action_recorded` | 证据一致性与行动许可不同 |

必须结合语料声明的策略、逐用例覆盖配置和验证时间来解释预期结果。正向混合签名 bundle 可以在 `pq_only` 下通过验证；包含绑定所需的经典签名字节并不会使它成为负向对照。由于操作等级，请求的 `classical_only` 策略可能解析为更严格的实际生效模式。

<a id="schema-and-cryptographic-api-boundary"></a>

### 模式与密码学 API 的边界

V2-2 要求模式校验。自 `@dcp-ai/sdk` 2.3.0、`@dcp-ai/wasm` 2.1.3、`dcp-ai` 2.10.2（PyPI）、Go v2.13.0 和 Rust `dcp-ai` 2.13.0 起，TypeScript、Python、Go、Rust 和 WASM SDK 的 V2 验证器自行执行它：`verifySignedBundleV2` 及其对应函数、先进行验证的组合准入 API，以及实验性候选验证器；根据先前的验证结果评估准入时不会再次执行它。更早的 SDK 版本不包含它。该关卡按 `schemas/v2` 校验已签名 bundle 的封装和四个载荷（`responsible_principal_record`、`agent_passport`、`intent`、`policy_decision`）。它在验证器的策略和时钟检查之后、验证器检查清单、载荷哈希、密钥和签名之前执行。所有 SDK 都解释同一个由 `schemas/v2` 生成的表示（`tools/schema-ir/`）；CI 会重新生成它并比较各份副本。

- **封闭对象与开放对象。** 封闭对象（`additionalProperties: false`，例如封装、`SignedPayload`、`composite_sig`、审计条目和检查点）中的未知成员会被拒绝，即使哈希和签名仍然有效。在开放对象中（例如 intent 的 `target` 或审计的 `evidence`），已声明的成员仍保留其约束（例如 `target.channel` 是必需的枚举值）；只有模式未描述的附加成员不会在这一层被检查，处于承诺之下的附加成员可能进入规范化。`bundle` 对象自身的附加成员会被接受：模式让 `bundle` 保持开放，该成员不受任何承诺覆盖（不同于 bundle 所含的已签名证据对象和清单），而且后续检查都不会读取它。
- **缺失与 `null`。** 缺失的必需成员和模式期望其他类型之处的 `null` 都会被拒绝，诊断不同（`required`、`type`）。清单中的 `session_issued_at` 和 `session_expires_at` 存在时必须是字符串：`null` 会被拒绝。
- **诊断。** 模式失败返回 `verified: false`，错误形式为 `schema: <JSON pointer> <keyword>[ <member>]`，最多 16 条，后接 `schema: further errors not listed`，从不包含输入值，也没有密码学细节。过去由更深层检查报告的拒绝，现在可能改为模式诊断；模式失败并不表明深层检查已经运行。
- **候选叠加。** 在由调用方明确选择的实验性 `dcp-jcs-v2` 路径上，唯一的区别是清单的 `canonicalization_profile`，它必须是 `dcp-jcs-v2`。默认配置文件和已签名字节不变。
- **`date-time`。** 格式检查就是参考验证器采用的检查，即 full 模式下的 ajv-formats 3.0.1，包括其特殊行为：任何 ECMAScript 空白字符或 `t` 都可作分隔符，接受 `+hh` 和 `+hhmm` 偏移，按偏移换算后为 23:59 时接受第 60 秒。这是模式层的兼容性边界，不是严格的 RFC 3339。V2-4、V2-13 和 V2-14 的时间解析器仍是独立的后续层，仍可能拒绝模式接受的时间。
- **解析器在前。** JSON 解析器拒绝的内容永远不会到达 V2-2。Go 把非对象的根报告为其历史解析错误；Rust 的 API 接收已解析的 `serde_json::Value`，因此 serde_json 的拒绝（孤立代理项、`1e400`）属于调用方；WASM 绑定在 V2-2 之前保留其策略解析错误、`JSON parse error` 和版本分派。
- **接受范围变化。** SDK 验证器以前接受的模式无效 bundle，现在返回 `verified: false`。没有新增仅做模式校验的 API，也没有修改任何模式或配置文件。

声称符合完整 V2 清单的实现，必须同时覆盖 V2-2 和密码学检查。不要为了让测试通过而放宽模式，或把局部 API 描述为完整关卡。套件会分别报告这些层次。

并非所有未知成员都被禁止。有些模式对象是开放的。模式接受已签名对象中的扩展，不会保留原签名的有效性：已签名内容变化后，必须重新计算哈希并重新签名。本文未定义任何新的必需扩展机制。

需要明确选择的[模式校验目录](../../../../tools/conformance/external-schema-validation-catalog.json)让一个实现运行 57 个已签名用例：13 个正向用例和 44 个负向用例，每个负向用例只有在同一次运行中基础用例通过验证时才计入。CI 通过五个 SDK 包装器运行它。需要明确选择的[模式诊断目录](../../../../tools/conformance/external-schema-catalog.json)保留 15 个封闭性用例：基础数据和允许的扩展是正向对照；封闭对象扩展及枚举范围外的值仍保持规范要求的拒绝。失败的 SDK 用例仍是失败，通过任一目录都只覆盖其自身的用例。独立的 `tools/conformance/schema-boundary.js` 报告区分模式校验、有限语料的完整性，以及在语料时间下组合模式与 SDK 的检查。组合通过不能证明 SDK 自身实现了 V2-2，完整性辅助函数也不是通用规范验证器。

<a id="verifier-policy-samples"></a>

### 验证器策略样例

显式选择的[策略目录](../../../../tools/conformance/external-policy-catalog.json) 2.0 版通过现有 `/2` 契约在两个套件中增加 108 个用例。第一个套件保留 1.1 版的 74 个用例：10 个正向对照、24 个存在但无效的 PQ 签名用例、14 个算法列表及安全通告用例，以及 26 个已纳入版本控制的等级用例。第二个运行 V2-10 澄清（见下文）的 34 个用例。每个请求携带准确的策略和验证时刻。默认的证据目录保持不变，1.1 版按字节原样存档为 [`external-policy-catalog-1.1.json`](../../../../tools/conformance/external-policy-catalog-1.1.json)。

新的 routine 等级混合签名对照测试实际生效的 `classical_only` 及其他三种模式。standard 等级混合签名对照会将请求的 `classical_only` 提升为 `hybrid_preferred`。语料记录此推导；`/2` 评估判定，不比较实现报告的等级或实际生效模式。选择性启用的实际生效策略目录（见下文）通过契约 `/5` 评估它们。

PQ 负向用例仅修改 bundle、护照或检查点中的 PQ 签名，经典签名仍然有效。算法列表用例保持相同 bundle，仅改变策略。等级用例复用分别签名的已版本控制 bundle，并在相同请求模式下使用 routine 对照；它们不是仅有一个变化的配对。每个负向用例都要求其正向对照在同次运行中通过。

[VERIFICATION.md](../../../../spec/VERIFICATION.md) 步骤 V2-10 的澄清（05/11/2026）解决了语料中的三个问题。[`verifier_policy_clarification_vectors.json`](../../../../tests/interop/v2/verifier_policy_clarification_vectors.json) 包含其用例，使用 routine 基础 bundle，使每个请求模式就是实际模式：

- **Q1.** 在 `pq_only` 下，经典列表和安全通告的排除接受混合 bundle；在 `hybrid_required` 下，同样的策略拒绝它。
- **Q2.** 在 bundle 签名、护照和检查点处，当 PQ 组件对这些经典字节验证通过时，失败的经典组件在 `pq_only` 下被接受，在其他三种模式下被拒绝。不规范的经典 `sig_b64` 和未知的经典 kid 在 `pq_only` 下被拒绝。
- **Q3.** PQ 列表和安全通告的排除在 `classical_only` 和 `hybrid_preferred` 下接受仅经典签名的 bundle，并在同一策略下拒绝混合 bundle。

`verifier_policy_vectors.json` 把其省略的 Q1 用例作为历史保留。这些用例是这些规则的样例：并不覆盖每个位置、算法或密钥状态。未测试某个组合本身并不证明规范有矛盾。这些是策略样例：模式校验（V2-2）有自己的目录，自 05/11/2026 的版本起在 SDK 验证器内部运行，更早的版本中则不运行。这些样例不证明完整的 V2 合规性。

<a id="structural-samples"></a>

### 结构测试样例

显式选择的[结构目录](../../../../tools/conformance/external-structural-catalog.json)通过 `/2` 新增16个案例：2个正向对照和14个负向案例，覆盖签名编码、检查点签名组件与范围、清单承诺、含小数的载荷、会话时间顺序，以及使经典签名无效后正确重新计算PQ签名的包。有效模式为 `hybrid_preferred`；这些经典签名负向案例不对 `pq_only` 的结果作出声明。

4个编码案例保留解码后的签名字节。检查点范围使用审计序列中的实际位置，标识符有意不排序。修改后的清单会重新签名。时间顺序颠倒的会话有一个独立的正向对照，位于允许的时钟偏差内。每个负向案例都要求其对照在同一次运行中通过。

缺陷隔离有明确限制：小数没有 `dcp-jcs-v1` 表示，因此原有哈希和签名不再对应修改后的内容；逆向范围也不存在该范围的有效根。组件检查记录预期缺陷，但不能确定SDK中的哪项检查导致了拒绝。这些是结构样例：模式校验（V2-2）有自己的目录，自 05/11/2026 的版本起在 SDK 验证器内部运行，更早的版本中则不运行。这些样例不证明完全符合规范。

<a id="effective-mode-and-tier"></a>

### 实际生效的模式与等级

选择性启用的[实际生效策略目录](../../../../tools/conformance/external-effective-policy-catalog.json)通过契约 `/5` 运行 130 个用例：判定结果，以及实现的验证器在同一次验证中解析出的验证模式和安全等级，按返回的原样使用，测试套件从不重新计算。112 个用例要求这两个值：bundle 通过 V2-2 的 94 个验证器策略和澄清用例，17 个已签名用例（在每种请求模式下增加 elevated 和 maximum 等级的有效正向用例、`risk_score` 边界、显式和声明的 `security_tier` 下限，以及替换默认值的护照覆盖），以及一个对照。在 bundle 未通过 V2-2 的 14 个用例和更早的 4 个拒绝中，这些值可以缺失；报告的值仍必须已知且一致。各 SDK 在先前失败后是否解析这些值上有所不同，两种行为都允许。受控实现表明，判定会让报告请求模式或默认模式、仅等级下限、声明的等级或策略决定的 `resolved_tier` 的封装程序失败。DCP-09 链的下限、`@dcp-ai/wasm` 的 JavaScript API 和浏览器不在覆盖范围内，通过只证明这些用例。

<a id="admission-map"></a>

## 准入映射

[共享准入向量](../../../../tests/interop/v2/admission_vectors.json)和[外部准入目录](../../../../tools/conformance/external-admission-catalog.json)通过组合准入 API 和配置加载器测试以下分组。应阅读每个用例准确的 `rule`、输入和预期字段；分组名称不能证明覆盖完整。

| 要求 | 测试面 | 限制 |
|---|---|---|
| T1–T2：责任主体与组件密钥锚定到运营者信任 | `external.admission.outcomes` | 信任由带外提供；套件不建立真实世界身份 |
| P1–P4：V2、已签名受众、已签名会话窗口与责任主体混合签名 | 结果与组合用例 | 结构检查和验证检查不同；未枚举所有畸形值组合 |
| R1–R5：快照可用性、结构、时效及主体状态 | 结果 | 新鲜快照不能证明其 `checked_at` 之后的撤销事件 |
| 配置：拒绝未知字段、畸形信任配置与配置文件弱化 | `external.admission.config` | 多缺陷用例可能允许多种规范错误；诊断消息的具体措辞不是规则 |
| 组合过程与结果 | 结果与组合用例 | 评估 `action_authorized:false`、记录的决定及信任/配置文件结果；不直接比较完整 `signer_keys` 输出 |
| A1–A3：受保护处理程序、运营者配置、信息源、租户与缓存 | 独立的适配器测试 | 不属于此外部套件；SDK 结果不能证明集成落实了控制 |

接受预计算验证结果的评估器，信任调用者提供的是针对同一 bundle、策略和时间的结果。外部准入操作使用组合 API。组合测试通过，不代表调用者任意提供的验证对象都是安全的。

<a id="delegation-map"></a>

## 委托映射

[外部委托目录](../../../../tools/conformance/external-delegation-catalog.json)（2.0.0 版）通过 `verify_mandate_chain` 运行已提交的[委托书链](../../../../tests/interop/v2/mandate_chain_vectors.json)、[链时间](../../../../tests/interop/v2/mandate_chain_time_vectors.json)和[重复领域](../../../../tests/interop/v2/mandate_domain_vectors.json)向量。每个规范性用例都标明其 [DCP-09 §3.5.2](../../../../spec/DCP-09.md) 规则；判定的是判定结果，以及被接受的链的有效层级。

| 要求 | 测试的范围 | 限制 |
|---|---|---|
| 规则 1–2：根和子委托书的签名、签名者角色与上下文、与父级的链接、深度和 `human_id` | `external.delegation.chain` | 密钥在请求中给出；工具包不确认它们属于责任主体或代理 |
| 规则 3：再委托许可与最大深度 | `external.delegation.chain` | 已提交的链，而非所有深度 |
| 规则 4：有效期窗口、其嵌套，以及作为 RFC 3339 时刻的验证时间，以毫秒比较 | `external.delegation.chain`、`external.delegation.chain_time` | 自 §3.5.2 的澄清（05/11/2026）起，毫秒精度是规范性的；已存档的目录 1.0.0 版把这三个用例保留为参考性用例 |
| 规则 1–2：每个签名密钥处于活动状态，其 `expires_at` 不存在、为 `null` 或不早于验证时间（05/11/2026 的澄清） | `external.delegation.chain_time` | 七个关于 `expires_at` 的用例；没有任何用例的密钥 `status` 不是 `active`。1.0.0 版把这七个保留为参考性用例 |
| 规则 5：操作、数据类别和限额的收窄；±(2^53 − 1) 范围内的限额；同一委托书中重复的领域 | `external.delegation.chain`、`external.delegation.domains` | 错误文本是诊断；拒绝按其判定结果判定 |
| 规则 6：层级下限与有效层级 | `external.delegation.chain` | 有效层级在被接受的链上判定；`tier_floor`（`computeSecurityTier`）不在目录范围内 |
| 规则 7：根或中间委托书的吊销 | `external.delegation.chain` | 吊销是请求中已吊销 ID 的本地集合，而不是吊销来源 |

只有当其对照存在时拒绝才计入：对照是规范性地被接受的链，其与拒绝用例的关系（`same_chain`、`single_mandate`、`same_shape` 或 `suite`）按字节检查。这些关系都不表明两个用例只相差一个缺陷。已验证的链既不是准入，也不是授权。

目录 1.0.0 版按字节原样存档为 [`external-delegation-catalog-1.0.0.json`](../../../../tools/conformance/external-delegation-catalog-1.0.0.json)，判定 87 个用例，并单独报告十个参考性用例；2.0.0 版判定全部 97 个。运行器固定每个版本的分类，因此 1.0.0 版的报告只是 1.0.0 版的证据。

<a id="differential-samples"></a>

### 差分样例

[差分测试工具](../../../../tools/difffuzz/README.md)在相同字节上比较各 SDK；一致从来不是判定依据。

- **委托书链。** `run-mandates.mjs` 通过契约 `/4` 把重新签名的 DCP-09 链发送给四个链验证器：每次运行在 73 个变体适用的每个深度上覆盖一遍（167 个用例），再执行有上限的随机变异体。只有以 §3.5.2、规范化配置文件或 RFC 8259 为依据的用例才算作规则证据。观察以及归因受无法签名的值或数字表示限制的用例单独报告；它们之间的分歧仍然是发现项。
- **含 WASM 的 bundle。** `run.mjs --sdks five` 把编译为 WASM、由 Node 运行的 Rust SDK 加入四个 bundle 验证器。四个 SDK 的发现项从不被当作五个 SDK 的证据。

有限的活动只能表明这些用例一致，或记录不一致之处；它并非穷尽。WASM 不验证委托书链；契约 `/4` 不会送达每个 SDK 的输入（`NaN` 标记、字节顺序标记、`1e400`）由单独的传输探测测量：封装程序的拒绝从不算作 SDK 的拒绝，TypeScript 和 Python 的 SDK 对 `1e400` 返回的拒绝也不作为任何语义规则的证据。

<a id="local-source-additions-07112026"></a>

## 本地源代码中的新增内容（07/11/2026）

这些行描述的是 TypeScript、Python、Go 和 Rust SDK 的本地源代码，而不是已发布的包。每一项都由四个 SDK 测试套件
运行的共享向量来检验；外部工具包尚无针对它们的契约，因此工具包的结果对这些规则不说明任何问题。其中任何一项都不是
完全符合或企业就绪的声明。

**可选部分。** 只有调用它们的代码才会使用。

| 要求 | 检验的对象 | 限制 |
|---|---|---|
| 委托准入（[准入配置文件 § 10](../../../../spec/profiles/admission/README.md#10-delegated-admission-opt-in)） | [`delegated_admission_vectors.json`](../../../../tests/interop/v2/delegated_admission_vectors.json)：71 个用例和 6 个配置用例 | 只在 `now` 检查；`delegation_active` 和 `action_authorized` 为 `false`；WASM 没有 API |
| 从字节准入（§ 11） | [`v1_ingress_vectors.json`](../../../../tests/interop/v2/v1_ingress_vectors.json)：26 个用例和 30 个域差异 | 大小和时间预算不在范围内；接收已解析值的函数无法恢复其解析器丢失的内容 |
| 授权书确认与激活（[DCP-09 § 3.3.1](../../../../spec/DCP-09.md#331-mandate-acknowledgment-opt-in)、§ 12） | [`mandate_acknowledgment_vectors.json`](../../../../tests/interop/v2/mandate_acknowledgment_vectors.json)：TypeScript 和 Python 中 93 个用例；Go 和 Rust 中 89 个，它们明确排除容器不是列表的 4 个用例，因为其类型化 API 无法携带这类输入 | 已签名的声明，不是时间顺序或理解的证明；不授权；没有全局重放检查；没有从字节进行的激活；WASM 没有 API |

**Ed25519 验证（密码学配置文件）。** 适用于 SDK 验证器检查的每个 Ed25519 签名。

| 要求 | 检验的对象 | 限制 |
|---|---|---|
| V1 对象和 V2 默认提供方上的 [P-ED-1](../../../../spec/profiles/crypto/README.md#p-ed-1-ed25519-acceptance-criterion) | [`ed25519_ped1_vectors.json`](../../../../tests/interop/v2/ed25519_ped1_vectors.json) 及其检查器（在四个 SDK 的测试套件中）；在 `wasm32` 上运行的 Rust 提供方 | 自 08/11/2026 起，也包括参考验证器、CLI 的 V1 路径和 playground，以及 Node 和 Chrome 中的 WASM：见[公开接口](#public-interfaces-mp-03-08112026)，其中列出了从已安装 SDK 继承它的部分。自定义提供方由操作员负责 |

<a id="public-interfaces-mp-03-08112026"></a>

## 公开接口（MP-03，08/11/2026）

本节同样描述本地源代码，而不是已发布的包。对每项能力，它说明该能力经过的公开函数，以及在那里到达它的证据。

- **WASM** 指 `@dcp-ai/wasm` 的 `DcpWasm` 类。
- **原始**指它的 wasm-bindgen 导出（`@dcp-ai/wasm/pkg`），在 Node 中运行。
- **Chrome** 中的运行通过套件的[浏览器包装器](../../tools/conformance/README.md#browser-wrapper-dcpwasm-in-chrome)。

| 能力 | TypeScript、Python、Go、Rust | WASM | 不作主张 |
|---|---|---|---|
| `dcp-jcs-v1` 规范字节与摘要 | 套件 `/1`（38） | 原始 `/1`（38）。在 Chrome 中 `/1`（38）：规范化在 `JSON.parse` 之后经 `DcpWasm.canonicalize`，摘要对文本经 `dualHash` 和 `sha3_256` | 解析器已经改变的字节（见下方的解析表） |
| V2 验证：bundle、Merkle 根、复合签名 | 套件 `/2`（241：211 个 bundle 用例、24 个复合用例、6 个 Merkle 用例）、策略（108）、结构（16）、模式（57）、`/5`（130） | 原始运行相同的目录（552 个用例；含 `/1` 为 590）。在 Chrome 中各自经由对应的 `DcpWasm` 方法：bundle 经 `verifyBundle`，复合用例经 `compositeVerify`，Merkle 用例经 `dualMerkleRoot` | 准入、信任、授权 |
| 复合签名、域分离、安全等级 | 套件 `/2` 的复合用例（24）；SDK 测试套件中的 interop 向量 | Chrome 中的直接调用（103）：`domainSeparatedMessage` 20（interop 向量的 19 个上下文和 `MandateAcknowledgment`）、`computeSecurityTier` 79、2 次带有负载、上下文和签名反例的混合签名与验证往返，以及 P-ED-1 的 2 个复合原像 | `/5` 不调用 `computeSecurityTier`：它读取 `verifyBundle` 报告的模式和等级 |
| P-ED-1 | 四个 SDK 测试套件中的语料库 | Node 上 `wasm32` 中的 Rust 提供方：67 个提供方用例、4 个 V1 对象，以及使用真实 ML-DSA-65 密钥的 2 个复合用例。在 Chrome 中：以 `classical_only` 绑定经 `compositeVerify` 的 2 个复合原像 | 经 `DcpWasm` 的完整语料库，因为它没有原始 Ed25519 方法 |
| `strict-v1` 准入 | 套件 `/3`（140） | 不支持 | — |
| 授权书链 | 套件 `/4`（97） | 不支持 | — |
| 委托准入、从字节准入、激活 | 上述 SDK 测试套件，以及字节函数和激活函数的配置错误 | 不支持 | 套件的约定 |

WASM 没有授权书链、准入或激活的 API。这是试点的范围（D-04），而不是浏览器的限制：浏览器应用程序的后端用四个 SDK
之一检查委托并进行准入。在浏览器中根据客户端控制的输入计算出的准入，不会授权服务器上的任何操作。

**SDK 之外的 P-ED-1。** 自己用 TweetNaCl 计算 Ed25519 的验证器会先检查 P-ED-1。它使用一个字节辅助模块三份相同副本中
的一份：`tools/`、`cli/lib/` 和 `playground/js/core/ed25519-ped1.js`。其他所有验证器只从其加载的 SDK 获得 P-ED-1。

| 验证器 | Ed25519 路径 | P-ED-1 |
|---|---|---|
| 参考 V1（`tools/crypto.js` 的 `verifyObject`）：`lib/verify.js` 和 `bin/dcp.js` 的 V1、透明日志的 gossip、撤销服务 | 自己的检查，然后是 TweetNaCl | 在源代码中；`tools/ed25519-ped1-consumers.test.mjs` |
| 对 V1 文件执行的 `dcp-ai verify` | 自己的检查（`cli/lib/ed25519-ped1.js`） | 在源代码中；已发布的 `@dcp-ai/cli` 中没有 |
| 对 V2 文件执行的 `dcp-ai verify`、参考 V2、服务器 | 已安装的 `@dcp-ai/sdk` | 只有在 SDK 包含它时才有。CI 会构建并安装工作区的 SDK。任何已发布的 `@dcp-ai/sdk`（2.3.0 及更早版本）都没有，从它们安装的副本也没有 |
| Playground（PQ 签名为模拟的演示） | 自己的检查 | 在源代码中 |
| Express、OpenClaw | 锁定在 2.2.0 的 `@dcp-ai/sdk` | 按锁定版本不适用；CI 也用工作区的 SDK 运行它们的测试 |
| Anthropic MCP、Google A2A | 锁定在 2.2.0 的 `@dcp-ai/sdk` | 不适用（已记录的限制） |
| FastAPI、LangChain、OpenAI、CrewAI | 本代码树中的 Python SDK | 适用 |

**错误、拒绝与缺失的结果。** 每个公开函数保留自己的错误约定，均不做统一。P-ED-1 只拒绝通过了该函数先前的类型、
大小和解码检查的输入：原本是错误的仍然是错误。在套件和浏览器测试框架中，`error`、`unsupported`、缺失的用例、崩溃
或超时都不能满足预期的拒绝。

| 函数 | 拒绝 | 错误 |
|---|---|---|
| Ed25519 提供方、V1 的 `verifyObject`（SDK、参考、CLI、playground） | `false`：S >= L、P-ED-1 或方程 | 各有各的约定，且无效 base64 只出现在函数解码 base64 的地方（提供方的密钥，`verifyObject` 的签名和密钥）。TypeScript 和参考验证器对无效 base64 以及解码后大小错误的签名或密钥抛出异常；playground 的 `verifyDetached` 接收字节，对大小错误或不是 `Uint8Array` 的值抛出异常。Python 对大小错误抛出 PyNaCl 的 `ValueError`。Go 对签名长度错误返回 `false`，对密钥长度错误返回错误。Rust 对任一长度错误以及无法解压的密钥都返回错误。CLI 对 INVALID 和错误以 1 退出，只有 VALID 才以 0 退出 |
| `compositeVerify` | `valid: false`，并给出每个组件的判定 | 在 `pq_over_classical` 下缺少 PQ 签名，在 Rust 和经由 WASM 时是错误；TypeScript、Python 和 Go 返回布尔值 |
| bundle 验证 | 带诊断信息的 `verified: false`，对格式错误的输入也是如此 | WASM 的 `verifyBundle` 以同样方式报告它自己的 JSON 和策略解析错误 |
| `strict-v1` 准入（`admitSignedBundleV2`） | `admitted: false` 和代码；`action_authorized` 始终为 `false` | `AdmissionConfigError`（Go 中为 `*AdmissionConfigError`）。无效的配置文件，或与验证者策略一起传入的配置文件，会在验证 bundle 之前被拒绝。其他配置错误在何处被发现取决于 SDK：例如没有信任集的配置文件，在 TypeScript 中于验证之后的准入阶段（`evaluateAdmissionV2`）发现，在 Rust 中于验证之前发现。无论哪种情况，都是错误且没有结果 |
| 委托准入、激活 | 委托准入：`admitted: false` 和代码。激活：`composition`（委托准入的结果）、`activation`、`delegation_active` 和 `ACK_*` 代码。`action_authorized` 始终为 `false` | 操作员配置无效时，在读取任何证据之前抛出 `AdmissionConfigError` |
| 从字节准入 | 入口检查的拒绝是一个结果：`ingress.accepted: false`，带有其层和类别，且没有准入 | 入口检查先作出判定，被接受的字节随后按 `admitSignedBundleV2` 的方式准入，带有它的配置错误（Rust 中为 `IngressError::Config`）。不是字节的输入在 TypeScript 和 Python 中是 `TypeError` |
| `DcpWasm` 的方法 | 按绑定的报告 | `Error('<method>: …')`。`canonicalize` 读取带标签的 `wasm_canonicalize_v2_result`；`hashObject` 和 `deriveKid` 只返回其十六进制格式。原始导出把 `{"error": …}` 保留在带内，`wasm_canonicalize_v2` 无法把它与规范形式就是该对象的值区分开 |

支撑此表的测试：

- 各 SDK 的 P-ED-1 语料库测试；
- `sdks/wasm/test/interface-errors.mjs` 和 `sdks/wasm/test/schema-v2.mjs`；
- 配置错误测试 `e5-config-errors.test.ts`、`test_e5_config_errors.py`、`e5_config_errors_test.go` 和
  `tests/e5_config_errors.rs`。

**由谁解析。** 没有任何函数为另一个函数修复输入：每个函数读取其解析器产生的结果。

| 函数 | 解析器 | 解析器之前的检查 |
|---|---|---|
| `verifySignedBundleV2`、`admitSignedBundleV2` 及其 Python 和 Rust 对应函数 | 调用方的解析器（`JSON.parse`、`json.loads`、`serde_json`） | 无 |
| Go 的 `VerifySignedBundleV2At`、`AdmitSignedBundleV2` | SDK 的 `encoding/json`，作用于 `[]byte` | 无：接收字节并不是[准入 § 11](../../../../spec/profiles/admission/README.md#11-admission-from-bytes-opt-in)的入口检查 |
| 各 SDK 的 `FromBytes` 准入函数 | SDK | 入口检查：扫描器、可移植域，然后是解析器比对，在准入之前 |
| `DcpWasm` 的方法 | 调用方的 `JSON.parse`，然后对 `JSON.stringify` 写出的内容使用 `serde_json` | 无，也不可能有：JavaScript 值已经解析过 |
| WASM 的原始导出 | 对文本使用 `serde_json` | 无 |
| `experimentalCandidateIngress` 及其对应函数 | 实验性候选自己的解析器 | 它的扫描器。它不是 § 11 的入口检查，也不改变 `dcp-jcs-v1` 的任何内容 |

<a id="claims-for-core-and-profiles"></a>

## 核心与配置文件的声明范围

| 测试面 | 根据套件可以报告什么 | 哪些内容必须分开 |
|---|---|---|
| 核心数据表示 | 实际测试过的准确 `dcp-jcs-v1` 规范字节与摘要 | 未测试输入和实验候选方案 |
| V2 证据验证 | 选定 bundle、Merkle 和签名用例的结果 | 完整 V2 符合性，尤其是模式覆盖，除非另行证明 |
| 密码学原语 | 测试过的域分离、组件验证和绑定 | 验证器策略、责任主体信任与准入 |
| `strict-v1` 准入 | 选定准入和配置用例的结果 | 部署中的控制执行与操作授权 |
| V1 | 对已提交测试数据的参考模式与完整性检查 | 独立第三方 V1 一致性 |
| A2A 与治理 | 仅限指定套件实际测试的具体规则 | 任一配置文件的完整功能一致性 |
| DCP-05 至 DCP-08 | 内部模式/传输套件声明的检查 | 这些文档完整的生命周期、权利或其他语义 |
| DCP-09 | 内部模式/传输套件声明的检查，以及外部委托目录中选定的委托书链用例的判定结果 | 完整的委托语义、有效性辅助函数、对密钥的信任、准入或行为授权 |
| 实验性 `dcp-jcs-v2` | 单独选择的实验测试 | 规范或默认地位；`dcp-jcs-v1` 保持不变 |

子集结果必须注明子集及其限制。不要把 `unsupported`、缺失用例、崩溃、超时或跳过的矩阵变成通过。预留的 SDK 测试如果未执行矩阵就返回，不能证明矩阵已运行。

<a id="further-validation"></a>

## 进一步验证

[审计资料](AUDIT_DOSSIER.md)给出审查基准、复现命令、制品来源和已知限制。[实现者指南](IMPLEMENTER_GUIDE.md)说明如何独立复现和报告结果。外部实现与独立安全审查是额外里程碑；本仓库测试不能替代它们。

性能测量使用其自身[有文档说明的运行器](../../tools/conformance/README.md#performance-baseline)。端到端耗时不能将成本归因于某个密码学原语，也不能证明不存在提前退出。只有在测得具体成本后才进行优化，并保留验证判定与兼容性。
