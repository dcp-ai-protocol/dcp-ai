<sub>[English](README.md) · **中文** · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="dcp-ai-conformance-kit"></a>

# DCP-AI 一致性测试套件

> 本文是[英文版](README.md)的参考译文，更新于 25/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

`tools/conformance.js` 针对仓库中已提交的 fixture 和向量，运行 [`catalog.json`](catalog.json) 中声明的各个
测试集。目录带有版本（`kit_version`），并为每个测试集固定其必须产生的确切用例 ID。该套件只读取 fixture：
不会在检出目录中生成密钥或 fixture，也不会改动规范化、签名、配置文件、模式或向量。

<a id="commands"></a>

## 命令

```bash
npm run conformance                                    # every suite (same as node tools/conformance.js)
node tools/conformance.js --list                       # suites, pinned case counts and inventory
node tools/conformance.js --suite v1.integrity --suite v2.hashes
node tools/conformance.js --report /tmp/conformance.json
node --test tools/conformance/conformance.test.mjs     # runner self-tests (temporary copies only)
```

fixture、模式和目录的路径相对于脚本解析，而不是相对于当前目录。请在仓库根目录运行上述命令；在其他目录下，
请用绝对路径调用脚本（`node /path/to/dcp-ai/tools/conformance.js`）。`--root <dir>` 让套件使用另一份
fixture 副本（自测在临时副本上使用该选项）。

<a id="contract"></a>

## 约定

| 退出码 | 含义 |
|--------|------|
| 0 | 所选用例全部通过 |
| 1 | 至少一处不一致（某个值或判定与预期不同） |
| 2 | 用法错误：未知参数，未知、重复或为空的测试集 ID，`--list` 与 `--report` 同时使用 |
| 3 | 基础设施错误：fixture 缺失或格式错误、预期格式错误、未知的配置 `kind`、目录缺失或格式错误、异常、已固定的用例未产生或产生了未固定的用例，或没有执行任何检查 |

- 用例缺失或多出都算错误，因此从仍有其他向量的集合中删除一个向量，不会悄无声息地降低覆盖范围。抛出异常的
  测试集即使已经产生了全部固定用例，也判为失败。
- 使用 `--report` 时，运行前先写入 `incomplete` 占位内容，再由最终报告替换；用法错误或目录错误同样会替换该文件。
  这仅适用于套件能处理的错误且报告路径可写的情况：如果 Node 无法启动或文件无法写入，旧文件可能仍然存在，
  因此使用方应检查退出码以及报告中的 `run.id` 和 `status`，而不是信任已有的文件。
- 报告包含 `kit`（名称、版本、目录的 SHA-256）、`run`（uuid、时间戳、根目录、Node 版本）、`selection`、
  `status`、`totals`（`cases`、`executed`、`pass`、`fail`、`error`）、每个测试集及其声明、限制和用例
  （`status`，以及 `kind`：`discrepancy`、`fixture`、`expectation`、`exception` 或 `catalog`）、清单和
  全局限制。

<a id="suites"></a>

## 测试集

| 测试集 | 用例数 | 规范 | 模式 / 向量 | 通过能证明什么 |
|--------|--------|------|-------------|----------------|
| `v1.schema` | 7 | DCP-01、DCP-02、DCP-03、`BUNDLE.md` | `schemas/v1`、`tests/conformance/examples/*.json` | 仅模式有效性 |
| `v1.integrity` | 9 | `VERIFICATION.md`（V1）、DCP-03 | `citizenship_bundle.signed.json`、`keys/public_key.txt`、`golden_vectors.json#v1_bundle_verification` | 一个 fixture 的 Ed25519 签名、bundle 哈希、Merkle 根、意图哈希、条目哈希和 `prev_hash` 链，并与 golden 值比较；密钥元数据一致 |
| `v2.canonicalization` | 11 | `CANONICALIZATION_PROFILE.md` | `golden_vectors.json#canonicalization`、`#v2_canonicalization`、`interop_vectors.json#canonicalization` | 参考规范化器输出的 `dcp-jcs-v1` 字节 |
| `v2.hashes` | 9 | DCP-AI-v2.0 §2.3、§10.3 | `golden_vectors.json#hash_vectors`、`#dual_hash_vectors` | SHA-256 / SHA3-256 值、双哈希和双 Merkle 根 |
| `v2.signed_bundle` | 10 | `VERIFICATION.md`（V2） | `lib/verify.js`、在内存中构建的 bundle | 参考验证器对有效和被篡改 bundle 的判定；已验证不等于准入 |
| `v2.secondary_sha3` | 51 | `VERIFICATION.md` 的 V2-11 及其勘误 | `secondary_sha3_vectors.json`、`lib/verify.js` | 参考验证器对存在的二级 SHA3-256 字段的判定，每个被拒绝的用例都有对照；不代表完整的二级链 |
| `v2.schema` | 4 | DCP-AI-v2.0 | `schemas/v2`、`*_v2.json` 示例 | 仅模式有效性 |
| `ext.dcp05_09.schema` | 18 | DCP-05 至 DCP-09 | `schemas/v2`、`<record>_v2.json` 示例 | 仅模式有效性 |
| `ext.dcp05_09.wire` | 28 | DCP-05、DCP-08、DCP-09、`V2-WIRE-COMPATIBILITY.md` | `schemas/v2`、在内存中签名的记录、`interop_vectors.json#domain_separation_all_contexts` | 将这些记录的表示、模式有效性和签名作为不同层次分别检查；不代表功能合规 |
| `admission.strict_v1` | 117 | `spec/profiles/admission` | `admission_vectors.json` | 预期的准入结果和错误码；`action_authorized` 始终为 false |

<a id="limits"></a>

## 限制

- 通过部分测试集，只证明这些检查在这些 fixture 上成立，不证明完整的 DCP 实现、其他 SDK 或某个部署。模式
  测试集只证明模式有效性；没有规范化、哈希和签名测试集，仅凭 V2 模式测试集不构成 V2 实现。
- `verified` 和 `admitted` 从不授权任何操作。
- 适配器（Express、FastAPI、OpenClaw、验证服务器）不属于该套件。
- 协议问题（依据 `spec/V2-WIRE-COMPATIBILITY.md`）：DCP-09 的到期字段（`valid_until`）以及 DCP-05、DCP-08 和
  DCP-09 的签名上下文已由勘误更正，并由 `ext.dcp05_09.wire` 测试。仍有待明确的、有版本的设计、套件不作裁定的有：
  DCP-05 `vitality_report` 的小数指标（在 `dcp-jcs-v1` 下只能表示 0 和 1）、DCP-08 §4.3 中以反向域名表示的权利
  （被 `right_type` 枚举拒绝），以及第二签名者或确认（DCP-05 §4.4、DCP-09 §3.3 和 §6.3）。DCP-04、DCP-06 和
  DCP-07 的示例不在这些勘误范围内。

<a id="inventory"></a>

## 清单

在 `--list` 和报告中列出，不计入总数：套件不执行这些内容，它们的存在也不等于测试通过。
`interop_vectors.json` 中的攻击向量、规范化边界用例和其他类别以及 bundle 与授权（mandate）向量在各 SDK
的测试套件中运行。`tests/nist-kat/` 包含已知答案向量和属性测试，各有其适用范围（见
[其 README](../../tests/nist-kat/README.zh-CN.md)）；它们同样在各 SDK 的测试套件中运行。`dcp-jcs-v2` 候选方案属于实验性质，不在 `dcp-jcs-v1` 范围内，有自己的测试集
（`tests/interop/candidate/`）。
