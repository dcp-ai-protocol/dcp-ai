<sub>[English](../../../../docs/conformance/IMPLEMENTER_GUIDE.md) · **中文** · [Español](../../../es/docs/conformance/IMPLEMENTER_GUIDE.md) · [日本語](../../../ja/docs/conformance/IMPLEMENTER_GUIDE.md) · [Português](../../../pt-BR/docs/conformance/IMPLEMENTER_GUIDE.md)</sub>

<a id="independent-implementation-and-review-guide"></a>

# 独立实现与审查指南

> 本文是[英文版本](../../../../docs/conformance/IMPLEMENTER_GUIDE.md)的参考译文，更新于 2026年10月31日。如有差异，以英文版本为准。标识符、命令和代码块保持原文。

DCP 是可以独立实现的协议。本指南帮助实现者和审查者在不采用本仓库应用或服务的情况下评估同一份证据。它不构成审计、认证或背书。

<a id="establish-the-boundary-first"></a>

## 首先明确边界

先阅读[核心概述](../../spec/core/dcp-core.md)，再阅读适用的规范性文件：

1. [V1 和 V2 验证清单](../../spec/VERIFICATION.md)。
2. [规范化配置文件](../../spec/CANONICALIZATION_PROFILE.md)。
3. [V2 规范](../../spec/DCP-AI-v2.0.md)，包括算法、复合签名组件绑定和验证器策略。
4. 如果实现了对责任主体的信任或 `strict-v1`，阅读[准入配置文件](../../spec/profiles/admission/README.md)。
5. [V2 模式](../../../../schemas/v2/)中适用的文件，以及规范引用的勘误。

核心与配置文件的划分用于组织规范，并不免除 V2 实现的必需检查。应用、网络信息源、缓存和受保护的处理程序属于集成层。应将它们是否落实控制措施的主张与核心验证分开。

规范具有权威性。Rust/WASM 和其他 SDK 是实现参考，不是替代性的规范定义。复用参考库可能是合适的做法，但应披露这种依赖，而不是将结果称为对其验证逻辑的独立实现。

<a id="freeze-a-reproducible-input-set"></a>

## 固定可复现的输入集合

使用经过审查的仓库修订版本。记录完整的提交 ID，以及工作树是否有修改。将该版本的模式、测试数据、目录和运行器源码保存在一起。记录实现版本、解析到的代码路径或构建产物哈希、运行时、工具链、策略和验证时间。

目录和测试数据的哈希可以标识字节，但不能认证其提供者。应从可信来源获取该修订版本。封装程序的名称和版本由其自行声明，因此需要独立确认实际运行的是哪个可执行文件或软件包。

公开测试套件需要 Node 20 或更新版本。外部实现可以使用任何语言，只需实现所选的标准输入/标准输出契约。构建仓库中的封装程序还需要文档中列出的 SDK 工具链和依赖。构建说明和来源检查见[套件 README](../../tools/conformance/README.md)。

<a id="run-the-relevant-interfaces"></a>

## 运行相关接口

在仓库根目录，先查看可用用例：

```bash
node tools/conformance-external.js --list
node tools/conformance-external.js --catalog evidence --list
node tools/conformance-external.js --catalog admission --list
```

然后在 `--` 后提供可执行文件及其参数。将 `/path/to/implementation` 替换为实际命令：

```bash
node tools/conformance-external.js --report /tmp/dcp-primitives.json -- /path/to/implementation
node tools/conformance-external.js --catalog evidence --assessment verdict --report /tmp/dcp-evidence.json -- /path/to/implementation
node tools/conformance-external.js --catalog admission --report /tmp/dcp-admission.json -- /path/to/implementation
```

这些命令选择三种不同的运行器契约。实现可以只支持其中一个子集，但报告必须明确说明该子集。本仓库的 WASM 没有准入 API。不要将不支持的操作报告为成功。

证据命令明确选择 `--assessment verdict`：它评估规范要求的判定，并单独保留诊断文字。历史评估方式仍然可用，且保持现有默认值。仅仅匹配诊断字符串，不能证明执行了预期的检查。

请求包含用例 ID 和操作输入，不包含预期结果。必须严格返回契约规定的响应封装和必需字段，使用相同的运行标识，并为每个请求用例提供恰好一个结果。日志输出到 stderr。响应后进程以失败状态退出，不能算作成功运行。

[套件契约](../../tools/conformance/README.md)规定了准确的编码规则、限制、退出码和报告结构。不要从本指南推导出新的传输协议。

如需明确选择模式诊断，将证据命令中的 `--catalog evidence` 替换为 `--catalog tools/conformance/external-schema-catalog.json`。它使用相同的 `/2` 契约，并将规范性失败保持为失败；它独立于默认的证据目录。解读单独 SDK API 的结果前，请查阅覆盖映射。

<a id="inspect-a-generated-report"></a>

### 检查生成的报告

套件 README 提供[最小请求与响应示例](../../tools/conformance/README.md#external-implementations)，以及可运行的 [TypeScript](../../../../tools/conformance/wrappers/ts-sdk.mjs) 和 [Python](../../../../tools/conformance/wrappers/python_sdk.py) 封装程序示例。在实现 bundle 验证前，先用摘要交换检查通信契约。复用这些封装程序并不会使其 SDK 验证逻辑成为独立实现。

运行上面的证据命令后，应检查实际报告，而不是复制一个成功示例：

```bash
node --input-type=module - <<'NODE'
import fs from 'node:fs';
const report = JSON.parse(fs.readFileSync('/tmp/dcp-evidence.json', 'utf8'));
console.log(JSON.stringify({
  status: report.status,
  run_id: report.run.id,
  started_at: report.run.started_at,
  finished_at: report.run.finished_at,
  contract: report.kit.contract,
  catalog_sha256: report.kit.catalog_sha256,
  fixtures_sha256: report.kit.fixtures_sha256,
  implementation: report.implementation,
  totals: report.totals,
}, null, 2));
NODE
```

这只打印本次运行的值，不验证报告或认证实现。请将其与命令退出状态、运行时间区间及固定的目录和测试数据字节进行比对。除最低要求外，还应记录已安装工具链的准确版本；原生封装程序的构建要求见套件 README。

<a id="interpret-a-result-honestly"></a>

## 严谨解读结果

同时检查进程退出状态和报告。确认报告属于本次运行、总体状态为通过、所有选定用例都已运行，且没有跳过任何必需实现。旧报告、部分结果，或多个有缺陷实现之间的一致结果都不够。

在声明兼容性之前，请阅读[安全覆盖映射](SECURITY_COVERAGE.md)。模式校验、密码学验证、责任主体信任和准入是不同的层次。尤其是，单独一个 SDK 验证器的结果不能证明已完成全部 V2 模式检查。

负向用例需要正常工作的正向对照。如果修改后的载荷既有语义缺陷又有无效签名，其拒绝结果不能隔离证明语义检查。复现解析或规范化差异时应保留输入字节；解析并重写它们可能消除原因。

当各实现出现分歧时：

1. 使用相同的字节、时间和策略，并附带有效对照来复现。
2. 区分协议判定与进程崩溃、结果缺失或超时。
3. 在保留相关失败和对照的前提下缩小用例。
4. 引用准确的规范性要求。如果规范无法决定结果，应报告为开放问题，而不是选择多数实现的判定。
5. 只有在预期行为有充分依据后，才添加回归测试。

<a id="prepare-an-independent-security-review"></a>

## 准备独立安全审查

有用的审查材料应包含固定的修订版本、[安全模型](../SECURITY_MODEL.md)、覆盖映射、选定契约、准确命令、输入输出哈希及未解决问题。说明每项主张涉及哪个实现和公开 API。

核心审查可以涵盖规范化、清单与各项证据的绑定、签名策略、模式校验、责任主体信任、准入以及测试工具的可靠性。还应审查密码学依赖及其版本，作为供应链风险的一部分；已知答案测试是有用证据，但不等于对这些库的审计。如果审查工作排除了这些库内部的密码学实现，应明确记录该排除范围。

传输、密钥保管、远程信任与撤销信息源、缓存、租户隔离、应用授权和部署控制需要各自的审查范围。测试核心函数不能证明这些属性。

不要将私钥、生产凭证、个人记录或机密日志作为测试数据提交。使用公开的合成测试材料。发现漏洞时遵循仓库的[安全报告流程](../../SECURITY.md)；公开测试语料不能替代协调披露。

<a id="report-implementation-experience"></a>

## 报告实现经验

可复现的实现报告应说明：

- 规范修订版本、支持的传输格式版本，以及明确选择的配置文件。
- 复用了哪些密码学实现或 SDK 代码。
- 准确的测试套件、评估方式、命令、实现版本和报告标识。
- 记录的策略和验证时间、正向对照、跳过或不支持的功能，以及已知缺口。
- 与规范文本对应的最小差异，并移除秘密信息。

[早期采用者计划](../EARLY_ADOPTERS.md)介绍了维护者如何收集集成反馈。本指南为该工作做准备，并不声称已有外部实现者审查或采用 DCP。
