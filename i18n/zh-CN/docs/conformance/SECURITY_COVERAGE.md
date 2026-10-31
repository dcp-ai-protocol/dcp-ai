<sub>[English](../../../../docs/conformance/SECURITY_COVERAGE.md) · **中文** · [Español](../../../es/docs/conformance/SECURITY_COVERAGE.md) · [日本語](../../../ja/docs/conformance/SECURITY_COVERAGE.md) · [Português](../../../pt-BR/docs/conformance/SECURITY_COVERAGE.md)</sub>

<a id="security-guarantees-and-conformance-coverage"></a>

# 安全保证与一致性测试覆盖

> 本文是[英文版本](../../../../docs/conformance/SECURITY_COVERAGE.md)的参考译文，更新于 2026年10月31日。如有差异，以英文版本为准。标识符、命令和代码块保持原文。

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
- **SDK 与适配器测试套件：** 它们是独立测试，具有自己的入口和范围。出现在套件清单中的条目，不等于该套件执行了相应测试。

编号契约是运行器接口，不是 DCP 协议版本。封装程序身份由其自行声明。五个封装程序不代表五个独立外部采用者：WASM 与 Rust 共享代码，且这些封装程序都属于本仓库。

负向结果只有在正向对照正常工作时才有意义。修改已签名内容但不更新签名，可能因多个原因导致失败。`spec_step` 标签或匹配的错误消息本身不能证明由哪项检查导致拒绝。能够隔离规则的有效/无效用例对，比单独构建拒绝 bundle 且仅有套件级正向对照提供更强的证据。

<a id="v2-verification-map"></a>

## V2 验证映射

以下用例名来自 [bundle 向量](../../../../tests/interop/v2/bundle_vectors.json)。`M`、`R`、`A` 分别表示 `must_reject`、`must_reject_bundles`、`must_accept_bundles`；外部 ID 以 `external.v2.bundle_vectors.` 开头，分别后接 `must_reject`、`must_reject_bundles` 或 `must_accept`，再接用例名。`signed_bundle` 是基础正向用例。这里列的是可追溯样例，不是穷尽列表或完整性评级。

| 规范规则 | 选定的现有用例或套件 | 范围与剩余限制 |
|---|---|---|
| V2-1：选择版本 | M `dcp_bundle_version_1_0`, `dcp_bundle_version_3_0` | V2 入口拒绝；不测试所有 V1 要求 |
| V2-2：校验封装与证据对象的模式 | 参考 `v2.signed_bundle.schema_invalid_payload_rejected`；模式套件 | 外部 SDK 验证器操作不是完整的模式关卡；见下文边界 |
| V2-3：清单、载荷哈希与审计绑定 | M `intent_payload_hash_wrong`, `audit_entries_truncated`; R `manifest_intent_hash_mismatch`, `audit_chain_hash_wrong`; A `empty_audit_trail` | 哈希及链绑定样例；未隔离覆盖每个字段和畸形结构 |
| V2-4：会话、时间与未签名元数据一致性 | R `intent_session_nonce_differs`, `session_expired_with_offset`, `session_longer_than_policy_max_with_late_created_at`; M `signature_signer_id_other`; A `session_duration_at_millisecond_precision` | 固定时间测试；必须区分请求策略与实际生效模式 |
| V2-5：签名结构与规范编码 | M `bundle_classical_sig_b64_with_trailing_bits`, `intent_classical_sig_b64_unpadded`; R `classical_only_bundle_signature_without_pq` | 编码样例未覆盖所有签名位置和缺陷组合 |
| V2-6：责任主体签署清单 | R `bundle_signed_by_agent_keys`; 参考 `v2.signed_bundle.forged_classical_signature_rejected` | 角色绑定与签名样例；不建立对自行声明的责任主体的信任 |
| V2-7：验证存在的 PQ 签名 | M `bundle_pq_signature_invalid`, `bundle_pq_slot_holds_ed25519` | 历史证据目录在所选策略下测试；声明覆盖全部实际生效模式需要相应对照 |
| V2-8：依据上下文与签名者角色验证每项证据 | M `rpr_classical_signature_invalid`, `intent_signed_by_principal`, `policy_decision_signed_under_intent_context` | 证据对象与角色样例；未覆盖组件、上下文和密钥的所有组合 |
| V2-9：推导等级，且声明不能降低它 | R `classical_only_intent_action_type_constructor`, `classical_only_intent_security_tier_constructor` | 判定样例；外部 bundle 操作不评估报告的已解析等级 |
| V2-10：执行实际生效模式与算法策略 | R `classical_only_payment_from_low_risk_passport`; 四种模式下的 `classical_only_routine` | 模式样例；历史证据目录没有专门的算法允许列表及安全通告矩阵 |
| V2-11：验证存在的次级字段 | 来自[次级向量](../../../../tests/interop/v2/secondary_sha3_vectors.json)的 `external.v2.secondary_sha3` | 正向对照及畸形或不匹配字段；缺失的链接可选，因此接受不意味着存在完整次级链 |
| V2-12：绑定并验证检查点 | A `pq_checkpoint_over_the_trail`; R `pq_checkpoint_listed_but_missing`, `pq_checkpoint_event_range_count_wrong`, `pq_checkpoint_pq_signature_invalid` | 成员关系、范围及签名样例；未覆盖所有畸形范围或组件组合 |
| V2-13：推导密钥 ID 并验证密钥有效性 | R `passport_key_kid_not_derived`, `passport_key_public_key_with_trailing_bits`, `rpr_binding_key_revoked` | 密钥、编码和状态样例；不是完整密钥策略覆盖 |
| V2-14：跨证据对象一致性 | R `passport_principal_binding_reference_other`, `audit_entry_policy_decision_other`; A `blocked_action_recorded`, `escalated_action_recorded` | 证据一致性与行动许可不同 |

必须结合语料声明的策略、逐用例覆盖配置和验证时间来解释预期结果。正向混合签名 bundle 可以在 `pq_only` 下通过验证；包含绑定所需的经典签名字节并不会使它成为负向对照。由于操作等级，请求的 `classical_only` 策略可能解析为更严格的实际生效模式。

<a id="schema-and-cryptographic-api-boundary"></a>

### 模式与密码学 API 的边界

V2-2 要求模式校验。SDK 的密码学 API 与执行模式校验的参考入口是不同的接口。例如，在未签名外层封装中加入未知属性，可能不破坏任何签名：模式通过 `additionalProperties: false` 封闭该对象，但单独的 TypeScript、Python、Go、Rust 和 WASM SDK 验证 API 仍可能返回 `verified: true`。这是验证边界缺口，不是伪造签名或受保护应用已准入该输入的证据。

声称符合完整 V2 清单的实现，必须同时覆盖 V2-2 和密码学检查。不要为了让测试通过而放宽模式，或把局部 API 描述为完整关卡。套件必须分别报告这些层次。

并非所有未知成员都被禁止。有些模式对象是开放的。模式接受已签名对象中的扩展，不会保留原签名的有效性：已签名内容变化后，必须重新计算哈希并重新签名。本文未定义任何新的必需扩展机制。

需要明确选择的[模式诊断目录](../../../../tools/conformance/external-schema-catalog.json)使这一边界可以执行验证：基础数据和允许的扩展是正向对照；封闭对象扩展及枚举范围外的值仍保持规范要求的拒绝。失败的 SDK 用例仍是失败。独立的 `tools/conformance/schema-boundary.js` 报告区分模式校验、有限语料的完整性，以及在语料时间下组合模式与 SDK 的检查。组合通过不能证明 SDK 自身实现了 V2-2，完整性辅助函数也不是通用规范验证器。

<a id="verifier-policy-samples"></a>

### 验证器策略样例

显式选择的[策略目录](../../../../tools/conformance/external-policy-catalog.json)通过现有 `/2` 契约增加 74 个用例：10 个正向对照、24 个存在但无效的 PQ 签名用例、14 个算法列表及安全通告用例，以及 26 个已纳入版本控制的等级用例。每个请求携带准确的策略和验证时刻。默认的证据目录保持不变。

新的 routine 等级混合签名对照测试实际生效的 `classical_only` 及其他三种模式。standard 等级混合签名对照会将请求的 `classical_only` 提升为 `hybrid_preferred`。语料记录此推导；`/2` 评估判定，不比较实现报告的等级或实际生效模式。

PQ 负向用例仅修改 bundle、护照或检查点中的 PQ 签名，经典签名仍然有效。算法列表用例保持相同 bundle，仅改变策略。等级用例复用分别签名的已版本控制 bundle，并在相同请求模式下使用 routine 对照；它们不是仅有一个变化的配对。每个负向用例都要求其正向对照在同次运行中通过。

`pq_only` 下的经典算法排除仍待解释澄清，暂不运行且不指定预期判定。语料记录延后的用例与解释问题；未测试某个组合本身并不证明规范有矛盾。这些样例不解决模式校验缺口，也不证明完整的 V2 合规性。

<a id="structural-samples"></a>

### 结构测试样例

显式选择的[结构目录](../../../../tools/conformance/external-structural-catalog.json)通过 `/2` 新增16个案例：2个正向对照和14个负向案例，覆盖签名编码、检查点签名组件与范围、清单承诺、含小数的载荷、会话时间顺序，以及使经典签名无效后正确重新计算PQ签名的包。有效模式为 `hybrid_preferred`；这些经典签名负向案例不对 `pq_only` 的结果作出声明。

4个编码案例保留解码后的签名字节。检查点范围使用审计序列中的实际位置，标识符有意不排序。修改后的清单会重新签名。时间顺序颠倒的会话有一个独立的正向对照，位于允许的时钟偏差内。每个负向案例都要求其对照在同一次运行中通过。

缺陷隔离有明确限制：小数没有 `dcp-jcs-v1` 表示，因此原有哈希和签名不再对应修改后的内容；逆向范围也不存在该范围的有效根。组件检查记录预期缺陷，但不能确定SDK中的哪项检查导致了拒绝。这些样例既不解决模式验证缺口，也不证明完全符合规范。

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
| DCP-05 至 DCP-09 | 内部模式/传输套件声明的检查 | 完整的生命周期、权利或委托语义 |
| 实验性 `dcp-jcs-v2` | 单独选择的实验测试 | 规范或默认地位；`dcp-jcs-v1` 保持不变 |

子集结果必须注明子集及其限制。不要把 `unsupported`、缺失用例、崩溃、超时或跳过的矩阵变成通过。预留的 SDK 测试如果未执行矩阵就返回，不能证明矩阵已运行。

<a id="further-validation"></a>

## 进一步验证

[实现者指南](IMPLEMENTER_GUIDE.md)说明如何独立复现和报告结果。外部实现与独立安全审查是额外里程碑；本仓库测试不能替代它们。

性能测量使用其自身[有文档说明的运行器](../../tools/conformance/README.md#performance-baseline)。端到端耗时不能将成本归因于某个密码学原语，也不能证明不存在提前退出。只有在测得具体成本后才进行优化，并保留验证判定与兼容性。
