<sub>[English](README.md) · **中文** · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="canonicalization-candidate-dcp-jcs-v2"></a>

# 规范化候选 `dcp-jcs-v2`

**Rust 发布 (26/10/2026).** Rust `dcp-ai` 2.11.0 已在 crates.io 发布，包含验证器修复、准入和实验性显式启用 API。`dcp-jcs-v1` 仍是规范性默认配置。见 [Rust 2.11.0](../../RUST_RELEASE.md).

**Go 发布 (26/10/2026).** Go SDK `v2.11.0` 已通过模块标签 `sdks/go/v2.11.0` 发布，包含验证器修复、准入和实验性显式启用 API。Rust 仍独立发布。见 [Go v2.11.0](../../GO_RELEASE.md).

**Python 发布 (26/10/2026).** `dcp-ai` 2.10.0 已在 PyPI 发布，包含验证器修复、准入和实验性显式启用 API。Go 和 Rust 仍独立发布。见 [Python 2.10.0](../../PYTHON_RELEASE.md).

> 本文是[英文版](README.md)的参考译文，更新于 26/10/2026。这是实验性、非规范的提案；如有出入，以英文版为准。标识符和代码块保持原文，不作翻译。

| | |
|---|---|
| **日期** | 2026 年 10 月 25 日 |
| **版本** | 1.1 |
| **分类** | 公开 |
| **状态** | **非规范、实验性且未启用。** `dcp-jcs-v1` 仍是唯一具有规范效力的规范化配置文件，也是默认配置；SDK 的候选 API（第 15 至 18 节）是实验性的、需显式启用 |
| **语料库** | [`corpus.json`](corpus.json)（修订版 `design-2`，187 个用例）和 [`baseline-corpus.json`](baseline-corpus.json)（87 个用例，另加 10 个选择用例和 3 个策略用例） |
| **实验室工具** | [`tools/canonicalization-lab/`](../../../tools/canonicalization-lab/)：设计模型、语料库生成器和运行器 |

> **注意。** 本文档提出一个候选配置文件并记录其设计。它不改变
> `dcp-jcs-v1` 或 [`spec/CANONICALIZATION_PROFILE.md`](../../../spec/CANONICALIZATION_PROFILE.md)，二者
> 仍是唯一的规范性参考。现有的验证器、签名器、schema、一致性检查或默认值都不
> 使用标识符 `dcp-jcs-v2`。第 15 至 18 节中实验性、需显式启用的 API 能识别它，
> 但不会启用它：没有任何现有路径或默认路径调用它们，只有显式启用的调用方才会调用。第 15 节
> 和第 16 节的 API 不验证任何内容；第 17 节的验证器从原始字节验证候选 bundle，
> 而通过验证的 bundle 不授予信任或准入。第 18 节的生产方只为这些调用方生成新的候选证据；
> 第 3 阶段的向量由仅用于测试的生成器签名。实验性、需显式启用的 API 已包含在 npm SDK 2.2.0 和 WASM 2.1.0 中；其他生态独立发布。见[已发布的 npm 软件包](../../NPM_RELEASES.md)。实验室工具的 CI 作业运行
> 设计模型，SDK 测试作业在语料库和第 3 阶段向量上运行这些 API，
> 第 4 阶段矩阵有自己的工作流。
> 现有的 V2 验证器，例如 TypeScript SDK 的验证器
> （[`verify-v2.ts`](../../../sdks/typescript/src/core/verify-v2.ts)），在收到已解析对象或文本时
> 仍会把该配置文件当作未知而拒绝，这正是预期行为。这里的任何内容都不是一致性要求。实验室
> 工具是设计的可执行模型，而不是实现：它为其合成承诺计算 SHA-256，
> 但不签名任何内容，也不验证任何签名。

<a id="1-why-a-candidate"></a>

## 1. 为什么需要候选

`dcp-jcs-v1` 对 JSON 解析器返回的值进行规范化。JSON 解析器对同一文本并不都返回相同的
值：RFC 8259 把重复的成员名（§4）、转义中的孤立代理项（§8.2）
和开头的字节顺序标记（§8.1）留给实现决定，而把数字读成 binary64 的解析器
可能把不同的字面量变成同一个值。于是，同一文本的两个读取者可能算出不同的规范
字节、哈希和签名输入，而签名者从未见过的值（例如较早出现的重复
成员）可能随已签名的证据一起传播。

候选保留 `dcp-jcs-v1` 的输出规则，并在任何解析器修复、舍入或丢失信息之前，
基于原始字节决定是否接受。

<a id="2-principles"></a>

## 2. 原则

1. **相同的值得到与 `dcp-jcs-v1` 相同的字节。** 候选不改变任何输出规则；它只
   收窄可接受的输入。对其值域中的任何精确值，两个规范化器都产生相同的
   字节。
2. **是否接受基于原始字节决定。**
3. **配置文件只从已签名的清单字段中选择一次。** 未知的配置文件会被拒绝；失败后不会
   重试其他配置文件。
4. **不是 JCS。** 键按 Unicode 码点排序，与 `dcp-jcs-v1` 相同；RFC 8785 §3.2.3 按
   UTF-16 码元排序。该配置文件不声称与 JCS 兼容。
5. **没有静默降级。** 不认识候选的验证器会拒绝它。

<a id="3-rules"></a>

## 3. 规则

<a id="31-ingress-bytes"></a>

### 3.1 输入（字节）

| 规则 | 要求 | 类别 |
|---|---|---|
| I1 | 格式正确的 UTF-8：没有无效字节、没有过长形式、没有编码的代理项（`ED A0 80`）、没有超过 U+10FFFF 的内容 | `UTF8_INVALID` |
| I2 | 开头没有 U+FEFF（`EF BB BF`） | `BOM` |
| I3 | 恰好一个 RFC 8259 JSON 文本：空白只能是空格、制表符、LF 和 CR，值之后不能有任何内容，不能有 `NaN`、`Infinity`、`+1`、`01`、`1.` 或末尾逗号 | `SYNTAX` |
| I4 | 从被验证单元的根开始计数，最多 64 层嵌套的数组和对象（§5） | `DEPTH_EXCEEDED` |

<a id="32-strings-and-keys"></a>

### 3.2 字符串和键

- **S1. 标量值。** 每个字符串（包括键）都是 Unicode 标量值的序列。
  `\uD800`–`\uDBFF` 转义后面必须紧跟一个 `\uDC00`–`\uDFFF` 转义，这一对
  表示一个标量值。任何其他代理项转义都是 `SURROGATE_UNPAIRED`。
- **S2. 不修复。** U+FFFD 无论转义还是字面都是合法字符。被拒绝的是解析器
  *会变成* U+FFFD 的数据。
- **S3. 接受非字符**（D2）。
- **S4. 不做规范化。** 与 `dcp-jcs-v1` 规则 9 相同，`"é"`（U+00E9）和 `"e\u0301"` 是不同的字符串和
  不同的键。
- **S5. 键唯一。** 同一对象的两个成员在解除转义后不能有相同的键
  （`DUPLICATE_KEY`），即使值相同、在任何深度，也没有特例（`__proto__` 与其他键
  一样）。

<a id="33-numbers"></a>

### 3.3 数字

- **N1. 字面量的精确值。** 是否接受取决于字面量的精确十进制值，
  而不是其 binary64 转换。不是整数的值为 `NUMBER_NOT_INTEGER`；超出
  `[-(2^53-1), 2^53-1]` 的整数为 `NUMBER_OUT_OF_RANGE`。
- **N2. 保留的形式。** 精确十进制值为范围内整数的字面量会被接受，不论
  其形式：`1.0` 是 `1`，`1e2` 和 `1E+2` 是 `100`，`100e-2` 是 `1`，`1.5e1` 是 `15`，`-0`、`-0.0`
  和 `0e-400` 是 `0`。这并非 `dcp-jcs-v1` 接受的所有字面量：binary64 解析器会
  舍入为整数的字面量，例如 `1.0000000000000001`，会被拒绝（N3）。
- **N3. 因不是范围内的精确整数而被拒绝的：** `0.5`、`2^53`、`1e-400`、
  `0.99999999999999999`、`1.0000000000000001`、`4503599627370497.5`、`9007199254740993`、`1e21`。
- **N4. 无需大数运算的算法。** 对字面量 `-?E(.F)?(e[+-]?X)?`：
  1. `D` = 去掉前导零的 `E` 和 `F` 的数字，`s = X − len(F)`。空的 `D` 为 `0`。
  2. 去掉 `D` 的末尾零，并把它们的个数加到 `s` 上。
  3. 如果 `s < 0`，该值不是整数。
  4. 如果 `len(D) + s > 16`，该值至少为 10^16，超出范围。
  5. 否则将 `D·10^s` 与 `2^53-1` 比较。

  读取 `X` 时在 `len(literal) + 17` 处饱和；超过该界限结果不会再改变。既是小数又
  超出范围的字面量为 `NUMBER_NOT_INTEGER`（第 3 步先于第 4 步）。
- **N5. 大的应用整数** 应放在十进制字符串中，并在其 schema 中如此声明。
- **N6. 值来自字面量。** 在候选下，被规范化的数字是 N4 计算出的
  那个，而绝不是 binary64 解析器返回的那个。`dcp-jcs-v1` 路径不变。

<a id="34-output"></a>

### 3.4 输出

`dcp-jcs-v1` 的输出规则（规则 1–3 和 5–8）：在每一层按码点排序的键；紧凑
形式；RFC 8785 §3.2 的转义（`\b \t \n \f \r`，C0 其余字符用小写的 `\u00xx`，`\"` 和
`\\`），其他所有内容作为字面 UTF-8，包括 `/`、U+007F、U+2028 和 U+2029；没有小数部分
或指数的整数，`-0` 写作 `0`；字面的 `null`、`true` 和 `false`；保留 `{}` 和 `[]`。

<a id="4-design-decisions"></a>

## 4. 设计决定

| # | 决定 | 理由 | 兼容性 |
|---|---|---|---|
| D1 | **拒绝单元中开头的 BOM**（`BOM`，偏移 0）。传输封装之前的 BOM 是传输缺陷 | RFC 8259 §8.1 允许接收方忽略它，而各读取者做法不同：有的去掉它，有的拒绝它。拒绝它就消除了差异。字符串内部的 U+FEFF 是内容 | `dcp-jcs-v1` 路径不变（§7） |
| D2 | **接受非字符**（U+FFFE、U+FFFF 及其他） | 它们是只有一种 UTF-8 编码和一种规范形式的标量值。拒绝它们将是内容策略，而不是规范化规则 | 该配置文件不是 I-JSON（RFC 7493 §2.1 禁止它们），也不声称是 |
| D3 | **最多 64 层嵌套，从被验证单元的根开始计数**（已签名 bundle 的字节），**绝不把传输封装计算在内**（§5） | 有效性不应取决于传输是否加了封装。64 低于 `serde_json` 的默认递归上限（128）。这不是对其他解析器、对数字或其他限制、或对可能更低的运营方预算的保证 | 只影响选择候选的单元 |
| D4 | **字面量的精确值**（N1–N6） | 标准是 `[-(2^53-1), 2^53-1]` 中的精确整数。其他一切都被拒绝：binary64 能精确表示但在值域之外的字面量（`0.5`、`2^53`），以及 binary64 会读成另一个值的字面量（`1e-400` 读成 0）。代价是线性的；字面量的长度是传输预算，而不是配置文件规则 | 只影响选择候选的单元 |
| D5 | **不在启用范围内：** 没有清单的工件（吊销、密钥轮换、授权）和 A2A | 配置文件在已签名的清单字段中声明；这些工件没有这样的字段。之后的设计可以为每种类型提供自己的已签名字段，并为 A2A 在握手记录中提供一个 | 它们仍使用 `dcp-jcs-v1`。验证器可以按策略对它们应用严格的输入检查，但不能声称生产方已承诺使用候选 |
| D6 | **候选名称 `dcp-jcs-v2` 已保留。** 只有第 18 节中实验性、需显式启用的生产方在调用方要求时才会输出它；包括已发布的 npm 软件包在内，没有任何默认路径会这样做。在规范性文档获批之前，它仍是候选名称。（在第 4 阶段修订：第 18 节之前没有需显式启用的 SDK 生产方；第 3 阶段的向量来自仅用于测试的生成器。） | 线路上的草案后缀将是又一个需要维护的标识符。验证器只通过显式策略启用它（§7） | 在候选下产生的证据是实验性的。如果规则在对外发布后改变，就需要一个新的标识符（`dcp-jcs-v1` §5） |
| D7 | **可选的 `dcp-jcs-v1` 警告。** 在有字节可用时，验证器可以在 `dcp-jcs-v1` 结果中加入一个警告，给出主要缺陷的类别和偏移（§6） | 它可以在迁移前找出需要修复的生产方 | 绝不改变 `dcp-jcs-v1` 的判定。基于对象的 API 无法产生它 |

<a id="5-the-validated-unit-and-the-transport"></a>

## 5. 被验证单元与传输

**单元** 是已签名 bundle 值（`{"bundle": …, "signature": …}`）的确切字节。其根是
深度 1；载荷从深度 4（根、`bundle`、工件、`payload`）开始，因此其自身的嵌套最多可达
61 层。偏移相对于单元的第一个字节。

**传输** 由端点的配置确定，绝不从内容推断：

| 传输 | 单元 |
|---|---|
| `bare` | 整个输入：HTTP 请求体、文件，或经过其自身解码后的请求头值 |
| `envelope` | 顶层对象中唯一的 `signed_bundle` 成员的值 |

**不重新序列化的提取。** 用一种在不解码字符串的情况下界定字符串的字节级语法遍历封装。
成员名在解除转义后比较，因此 `"signed\u005fbundle"` 也
指向该单元。单元是该值的 `[start, end)` 片段，原样传递：其重复项、
数字字面量和转义完整地到达扫描器。封装中的其他成员不做解释；
传输的大小和深度预算是另外的。

**限制。** 在封装内，语法损坏的单元无法界定，结果为
`TRANSPORT_INVALID`；同一单元不加封装发送时为 `SYNTAX`。两者都被拒绝。对于字符串内部的缺陷、
重复项、数字和深度，封装既不改变类别，也不改变相对于单元的偏移。

**一个新的、需显式启用的契约。** 字节级提取会拒绝当前基于对象的解析所接受的封装
（重复的 `signed_bundle` 成员、封装之前的 BOM）。它属于新的字节 API 或
显式选项，带有自己的兼容性说明，不能静默地安装在
`dcp-jcs-v1` 路径之上。

**为什么不把封装计算在内。** 在传输文档上计算深度会使有效性依赖于
传输：同一个 64 层的 bundle 不加封装时有效，放在 `{"signed_bundle": …}` 中却无效，而
重新包装请求体的代理会改变判定。实验室工具可以评估该规则以作比较
（`depth_scope: "transport"`，用例 `d-unit-64-envelope-v03-rule` 和
`b-v2-unit-depth-64-envelope-v03-rule`）。

<a id="6-precedence"></a>

## 6. 优先级

<a id="61-the-scanners-diagnosis-by-layers"></a>

### 6.1 扫描器的诊断，按层

在单元扫描器的诊断中，较早的层总是胜出，无论偏移如何。各层
选择**哪个违规是主要的**；是否拒绝由流水线决定（§6.4）。

| 层 | 类别 | 偏移 | 层内 |
|---|---|---|---|
| 1. 编码 | `BOM`、`UTF8_INVALID` | `BOM`：0。`UTF8_INVALID`：第一个格式错误子序列的第一个字节 | BOM 位于偏移 0，胜出 |
| 2. 语法 | `SYNTAX` | 第一个无法延续任何 JSON 文本前缀的字节；若输入提前结束，则为输入长度 | 只有一个：第一个 |
| 3. 值 | `SURROGATE_UNPAIRED`、`DUPLICATE_KEY`、`NUMBER_NOT_INTEGER`、`NUMBER_OUT_OF_RANGE`、`DEPTH_EXCEEDED` | §6.2 | **最早的偏移** |

<a id="62-offsets-of-the-value-layer"></a>

### 6.2 值层的偏移

| 类别 | 偏移 |
|---|---|
| `SURROGATE_UNPAIRED` | 不属于任何一对的转义的反斜杠 |
| `DUPLICATE_KEY` | 键**第二次**出现时的开引号 |
| `NUMBER_NOT_INTEGER`, `NUMBER_OUT_OF_RANGE` | 字面量的第一个字节 |
| `DEPTH_EXCEEDED` | 开启第 65 层的方括号或花括号 |

键中的缺陷先于其值中的缺陷，因为键在字节中排在前面。键在
解除转义后作为单元序列进行比较：一个有效的对是一个标量值，孤立代理项
仍是一个单元。在单次遍历中，不会有两个违规共享同一偏移；为完整起见，相同偏移
将按表中的顺序处理。超过第 64 层后，扫描器继续检查语法直到
单元结束；那里的值层缺陷已不可能胜出，因为其偏移在开启第 65 层的方括号
之后。扫描器是迭代式的：两万层会在没有递归上限的情况下得到
`DEPTH_EXCEEDED`。

<a id="63-transport-phases"></a>

### 6.3 传输阶段

在封装中由阶段决定，而不是偏移：

| 阶段 | 检查 | 类别 / 详情 | 偏移（从输入开头算起） |
|---|---|---|---|
| T1 | 封装之前的 BOM | `TRANSPORT_INVALID` / `BOM` | 0 |
| T2 | **整个**封装（包括单元）的字节级语法 | `TRANSPORT_INVALID` / `SYNTAX` | 与第 2 层相同 |
| T3 | 根是对象 | `TRANSPORT_INVALID` / `NOT_AN_OBJECT` | 根的偏移 |
| T4 | 恰好一个 `signed_bundle` 成员 | `TRANSPORT_INVALID` / `NO_SIGNED_BUNDLE`，或 `TRANSPORT_AMBIGUOUS` / `SIGNED_BUNDLE_REPEATED` | 无，或第二个成员的名称 |
| T5 | 单元**之外**的 UTF-8 格式正确，先检查其前，再检查其后 | `TRANSPORT_INVALID` / `UTF8_INVALID` | 格式错误子序列的第一个字节 |

封装的编码只能在单元之外判断，而单元只有在 T2–T4 之后才存在；单元在
五个阶段之后才被扫描。例如，`{"bad":"<FF>","signed_bundle":{},"signed_bundle":{}}` 在偏移 30 处为
`TRANSPORT_AMBIGUOUS`，尽管无效的 UTF-8 位于偏移 8。

<a id="64-the-complete-pipeline"></a>

### 6.4 完整流水线

1. **配置**（仅 bundle）：`POLICY_INVALID`，在读取输入之前。
2. **传输**（仅封装）：阶段 T1–T5。
3. **单元扫描器：** 主要诊断，或无。
4. **文档：** 有诊断则以其类别拒绝；否则生成规范字节。
5. **扫描器能遍历的 bundle**（没有编码或语法诊断）：
   1. `unknown` 读取结果为 `PROFILE_UNKNOWN`，**即使存在值层诊断**；
   2. 不在策略内的配置文件为 `PROFILE_NOT_ACCEPTED`，同样即使存在诊断；
   3. `absent` 或 `dcp-jcs-v1` **委托给 `dcp-jcs-v1` 路径**，诊断只是一个警告（D7）；
   4. 带诊断的 `dcp-jcs-v2` 以其类别被拒绝；
   5. 不带诊断的 `dcp-jcs-v2` 按以下顺序通过合成 bundle 的检查：其
      结构、`payload_hash`、`intent_hash`、`audit_chain`、`manifest_hash`。第一个失败为带有该详情的
      `COMMITMENT_MISMATCH`；否则该 bundle 被接受。
6. **扫描器不能遍历的 bundle**（有编码或语法诊断）：
   - 如果当前解析器失败，或读到 `dcp-jcs-v2` 或其他值，则为该诊断的类别；
   - 如果读到 `absent` 或 `dcp-jcs-v1`，则应用策略（不含 `dcp-jcs-v1` 时为 `PROFILE_NOT_ACCEPTED`），然后带警告委托。

<a id="7-profile-selection-and-policy"></a>

## 7. 配置文件选择与策略

**读取。**

- **确切路径。** 只有从单元根开始的 `bundle.manifest.canonicalization_profile` 起选择作用。同一
  字段出现在其他位置时只是数据：在根、在 `bundle`、在 `signature`、在载荷中，或在本身是
  数组的清单中。
- **重复项。** 当路径上的键重复时（`bundle`、`manifest`、该字段），读取**最后一个**
  值，与常见 JSON 解析器保留的一致。
- **解除转义后比较。** `"dcp-jcs-v\u0032"` 和 `"canonicalization\u005fprofile"` 都算数。
- **结果：** `absent`、`dcp-jcs-v1`、`dcp-jcs-v2` 或 `unknown`（任何其他字符串、大小写或
  空白的变体、`""`、`null`、数字、数组、对象，或含孤立代理项的字符串）。

**只有对扫描器无法遍历的单元**才会咨询当前解析器，并且只用于决定
`dcp-jcs-v1` 路径是否继续。解析器的修复绝不会接纳候选，拒绝类别在
所有地方都相同。

**委托。** `v1_path` 把单元原样交给当前的 `dcp-jcs-v1` 验证器。对于扫描器能遍历的单元，
扫描器像保留最后一个重复项的解析器那样读取该字段；对于它无法遍历的单元，
由当前解析器决定。`dcp-jcs-v1` 判定得以保留是一个**设计论据**，
依赖于解析器如何读取该路径；实验室的设计模型并不测量它。SDK 各阶段测量了什么
见第 16 至 18 节（例如第 16 节的解码器读取结果和第 18.1 节的矩阵）。

**策略。** `accepted_canonicalization_profiles` 是一个非空、无重复的已知标识符列表。
其他任何内容（空列表、裸字符串、`null`、非字符串条目如 `[[]]`、`[{}]`
或 `[1]`、重复项、未知标识符）都是 `POLICY_INVALID`，即配置错误，而不是对
数据的拒绝。策略只做限制；它从不做选择，其顺序也无关紧要。实验室工具没有
默认策略：每个用例声明自己的策略，候选只能显式启用
（`["dcp-jcs-v1", "dcp-jcs-v2"]`）。未来的生产默认值将是 `["dcp-jcs-v1"]`。

**不重试。** 一个配置文件，一条路径。候选路径的失败是最终的：不会用 `dcp-jcs-v1`
重新规范化任何内容，也绝不会从内容、请求头或参数推断配置文件。

<a id="8-signed-profile-inner-signatures-audit-chain-and-migration"></a>

## 8. 已签名的配置文件、内部签名、审计链与迁移

- **该字段是已签名的。** 它是清单的一部分，而 bundle 签名覆盖清单。在
  候选下没有重复项，因此承诺没有歧义。在 `dcp-jcs-v1` 下，重复字段中只有最后一个
  进入已签名的规范字节，因此放在已签名字段之前的重复字段
  不会破坏签名；候选消除了这一点，D7 可以标记它。
- **内部签名不带配置文件。** 在值域内，工件的字节在两种配置文件下
  相同，因此对候选的承诺只来自清单：仅凭内部签名
  无法知道是哪个配置文件生成了它。bundle 之外的工件仍使用 `dcp-jcs-v1`（D5）。
- **审计链从 `GENESIS` 开始。** 当前验证器要求第一个条目中
  `prev_hash == "GENESIS"`（[`verify-v2.ts`](../../../sdks/typescript/src/core/verify-v2.ts)）。被复制为候选 bundle
  第一个 `prev_hash` 的 `dcp-jcs-v1` 哈希不是跨配置文件的可验证链接：
  它会破坏链（用例 `mig-copied-v1-hash`）。候选证据开始自己的链；在载荷中引用
  先前的证据可以标识它，但不能验证它（`mig-reference-is-data`）。
  跨配置文件的单条链的连续性需要一种此处未设计的机制。
- **重新标注。** 被重新标注为候选的 `dcp-jcs-v1` 会在清单哈希上失败，且不会用
  `dcp-jcs-v1` 重试（`mig-relabel-v1-to-v2`）。被重新标注为 `dcp-jcs-v1` 或删除了该字段的
  候选会委托给 `dcp-jcs-v1`，其验证器随后会对生产方未签名的清单进行哈希；
  实验室工具不计算该判定。候选 bundle 中值域之外的字面量会在
  输入时被拒绝，即使 binary64 读取者会看到一个匹配的值：没有回退。
- **不会自动重新标注或重新签名任何内容。** 候选下的证据是带有新签名的新证据；
  应当归档的是收到的字节，而不是重新序列化的对象。

<a id="9-phases-and-acceptance-gates"></a>

## 9. 阶段与验收关卡

此处没有启用任何内容。只实现了实验性的单元输入（第 15 节）、路由器（第 16 节）、字节验证器（第 17 节）和生产方（第 18 节）。进入后续阶段需要在本文档之外
作出的明确决定，而更改默认值需要其自身的决定。

**阶段。**

1. 提案、语料库和设计模型（本文档）。
2. 能在显式选项后验证候选的验证器，生产方仍使用
   `dcp-jcs-v1`。
3. 在下面的交叉签名矩阵通过后，带显式选项的生产方。
4. 在之后的周期中更改默认值，并附弃用说明。

`dcp-jcs-v1` 验证始终为历史证据保留：引入候选不会
使任何 `dcp-jcs-v1` 证据不再通过验证或开始通过验证。`dcp-jcs-v1` 的安全修复
单独评估。

**进入第 2 或第 3 阶段之前的关卡**（要求；其状态见第 18.4 节的台账）：

1. **语料库一致。** 确定输入行为的用例是 87 个原始基线用例和适用的设计
   用例。在这些用例上，所有 SDK 和 WASM 通过字节 API，在接受用例上给出相同的
   `canonical_sha256`，在拒绝用例上给出相同的类别以及第 6 节的优先级和偏移。
   评估已废弃的 v0.3 深度规则（`depth_scope: "transport"`）的用例用于演示模型，不是
   验收要求。合成 bundle 用例必须变成带显式预期的真实已签名 bundle，
   其 `historical` 参数必须替换为对每个 SDK 解析器的真实观察；
   它从来不是证据。
2. **对象 API 的范围。** 接收已解析对象的 API 会拒绝标记为
   `needs_original_bytes: false` 的拒绝用例，并说明标记为 `true` 的拒绝用例不在其能力范围内。
3. **值上的输出等价。** 对值域中的每个精确值，无论直接构造还是通过
   候选输入（绝不通过从字面量出发的 `dcp-jcs-v1` 解析器）构造，两个规范化器在
   每个 SDK 中都给出相同的字节。
4. **从字节出发的输入一致。** 每个 SDK 都从接受用例中得到相同的值和字节。
5. **历史读取仍属诊断。** 对字面量的读取不同于其精确值的历史解析器是
   `dcp-jcs-v1` 的问题，需要其自身的兼容性分析，而不是一道关卡。
6. **交叉签名矩阵。** 每个生产方用边界载荷签名候选 bundle（`±(2^53-1)`、
   含 U+E000 和 U+1F600 的键、字符串开头的 U+FEFF、U+FFFD、U+2028、`\u0000`、嵌套到
   深度 64 的单元），每个验证器都接受它们；现有的 `dcp-jcs-v1` 互操作矩阵保持通过。
7. **阴性矩阵。** 在一个有效的候选 bundle 中以字节级注入每个类别的一个缺陷，会在检查
   签名之前以该类别被拒绝；同一缺陷出现在 `dcp-jcs-v1` bundle 中时
   保持当前判定。
8. **选择、优先级与策略。** 第 6 节和第 7 节的测试在每个 SDK 中运行，并通过插桩
   检查每次验证只使用一个配置文件和一条路径。
9. **历史。** 安装新的输入检查后，`dcp-jcs-v1` 路径在每个 SDK 中对现有
   向量和一致性测试套件给出当前判定。
10. **成本。** 在前后都进行测量，且不放宽任何东西来弥补。

<a id="10-corpus-and-lab-tool"></a>

## 10. 语料库与实验室工具

| 文件 | 内容 |
|---|---|
| [`baseline-corpus.json`](baseline-corpus.json) | 87 个单缺陷用例（42 个接受、45 个拒绝，其中 6 个为非 UTF-8 字节）、10 个配置文件选择用例和 3 个策略用例。已批准修订版 2 的副本：只有 `proposal` 和一个 `provenance` 字段不同。其 `domain.max_depth_scope` 保留了历史措辞（在整个输入上计算深度，包括封装）；I4 取代了它（从单元根计算深度），正如 `corpus.json` 在 `scope_revisions` 中所记录。没有用例改变：每个基线用例都是不加封装的单元 |
| [`corpus.json`](corpus.json) | 187 个设计用例：多缺陷排列（54）、精确数字（20）、有无封装的深度（12）、传输（19）和传输阶段（12）、选择（23）、输入（3）、历史解析器（8）、策略（5）、配置（9）、迁移（9），以及基于合成 bundle 的 10 + 3 个基线选择和策略用例。它按 ID 和输入哈希引用 87 个基线用例 |
| [`tools/canonicalization-lab/model.py`](../../../tools/canonicalization-lab/model.py) | 设计模型：传输提取、带第 6 节优先级的迭代式字节扫描器、N4、输出规则、选择与策略，以及一条合成 bundle 路径，其哈希检查代替载荷哈希、审计链和清单签名。其可执行行为即已批准模型的行为（已批准文件的 SHA-256 为 `ab172c5f…`）；其 docstring 澄清了公开路径和假定的最后重复规则。它为合成承诺计算 SHA-256，不签名也不验证任何内容 |
| [`tools/canonicalization-lab/generate_corpus.py`](../../../tools/canonicalization-lab/generate_corpus.py) | 写出 `corpus.json`。预期结果连同各自适用的规则（`why`）一起手工编写；它从不导入模型 |
| [`tools/canonicalization-lab/run.py`](../../../tools/canonicalization-lab/run.py) | 检查完整性、新鲜度、有效性和覆盖率，在全部 274 个用例上运行模型，并运行 24 个阴性对照 |

**bundle 用例**使用最小的合成 schema（清单、`intent`、`audit_entries` 和
`signature.manifest_hash`），其中 `manifest_hash` 代替复合签名。对于扫描器无法遍历的
单元，SDK 当前解析器的行为是每个用例的一个参数（`historical`），而不是
测量结果。

**运行器检查**基线哈希及其 87 个用例引用、每个用例的输入哈希、
语料库能逐字节重新生成、有效的状态和类别、唯一的 ID（也相对于基线）、
没有未声明的重复输入、值层 20 个有序对的覆盖、每个类别和组的覆盖，以及
每个基线选择和策略用例的覆盖。每个实际结果都会在语料库运行和每个对照中被校验（状态、类别、格式和
模式）；模型失败报告为 `MODEL_ERROR`，绝不作为
拒绝。

**阴性对照**（必须全部被捕获）：三个被修改的预期；14 个数据损坏，各自由
其自身规则捕获；一个过时的语料库；一个在每个用例上都失败的模型；四个设计变异体（以类别顺序
代替偏移、值层先于语法、回退到 `dcp-jcs-v1`、在封装上计算深度），每个
恰好破坏它自己的用例；两个只在变异下注入的失败，以及一个以未知类别恰好
破坏预期用例的变异体，这三者都必须使整轮测试无效，而不是
算作被捕获。

<a id="11-reproduce"></a>

## 11. 复现

在 Linux 或 macOS 上使用 Python 3.9 或更高版本（运行器使用 `signal.SIGALRM` 和 `pathlib.Path.is_relative_to`；
不支持 Windows），仅用标准库。命令从检出代码的根目录运行；从
其他目录运行时，请为脚本提供绝对路径。输出写入一个新的临时目录，因此
不会覆盖任何内容：运行器也会拒绝已存在的输出路径，生成器则写到
指定的位置。

```bash
out=$(mktemp -d)
python3 -I tools/canonicalization-lab/generate_corpus.py "$out/corpus.json"
cmp "$out/corpus.json" docs/proposals/canonicalization-candidate/corpus.json
python3 tools/canonicalization-lab/run.py --out "$out/run.json"
python3 tools/canonicalization-lab/run.py --controls --out "$out/controls.json"
```

预期结果：`274/274 cases as expected (87 r2 + 187 design)`，每个对照都为 `CAUGHT`，退出码为 0。
退出码 1 表示某个用例、结果或对照不一致；2 表示数据无效。

<a id="12-what-this-shows-and-what-it-does-not"></a>

## 12. 这能说明什么，不能说明什么

| 由设计模型展示 | 未完成 |
|---|---|
| 在 54 个多缺陷文档和 12 个多缺陷封装上带偏移的完整优先级 | 阶段或默认值的更改：第 18 节的生产方是实验性的、需显式启用 |
| 单元、传输以及与封装无关 | 集成或服务器中的字节 API |
| 在合成 bundle 上的选择、策略和不重试 | 在整个值域上的输出等价证明（第 18.4 节关卡 3 只在样本上展示） |
| 候选路径不依赖解析器的修复 | 超出所测单元的历史读取：`tests/interop/candidate/phase2-adapter-expectations.json` 记录了由历史适配器决定时真实解码器的 160 次读取（16 个单元 × 10 个适配器）；这只是这些单元的证据 |
| 合成 bundle 的哈希检查 | `dcp-jcs-v1` bundle 的按类别阴性矩阵（第 18.4 节，关卡 7） |
| | 委托在第 16 节和第 17 节的用例之外保持每个 SDK 的 `dcp-jcs-v1` 判定 |

<a id="13-open-questions"></a>

## 13. 未决问题

- `dcp-jcs-v1` 判定能否保留取决于历史解析器是否以最后重复规则读取配置文件路径；
  必须在实现之前在每个实际的验证器入口路径上测量。
  有类型的构造解码器不一定是验证器使用的解码器。对于对象 API，
  调用方或集成的字节到对象解码器是该路径的一部分：它可能丢弃 BOM、
  修复无效 UTF-8、丢失重复成员，或在验证之前拒绝请求体。适配器必须显式保留该
  现有路径；用一个通用解码器替换它并不能建立与历史的一致。
- 字节级传输契约会改变歧义封装的结果，需要其自身的
  兼容性说明。
- 跨配置文件的审计链连续性、没有清单的工件的配置文件以及 A2A 仍
  在本设计范围之外。

<a id="14-references"></a>

## 14. 参考资料

- [RFC 8259](https://www.rfc-editor.org/rfc/rfc8259) §4（唯一名称）、§6（可互操作的数字范围）、§8.1（BOM）、§8.2（孤立代理项）。
- [RFC 7493](https://www.rfc-editor.org/rfc/rfc7493)（I-JSON）§2.1–§2.3。
- [RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) §3.1、§3.2.2 和 §3.2.3（按 UTF-16 的键顺序，本配置文件不使用）。
- [`spec/CANONICALIZATION_PROFILE.md`](../../../spec/CANONICALIZATION_PROFILE.md)（`dcp-jcs-v1`，未改变）。

<a id="15-experimental-sdk-ingress-phase-1"></a>

## 15. SDK 中的实验性输入（第 1 阶段）

SDK 实现计划的第 1 阶段（不是第 9 节的阶段）为每个 SDK 添加了一个实验性、需显式启用的单元
输入检查。它不具规范效力，没有任何现有路径或默认路径调用它：只有显式启用的调用方才会调用。
它不改变任何 `dcp-jcs-v1` 函数、默认值、签名器或验证器。输入检查本身不读取
配置文件（由第 16 节的路由器读取），也不输出任何内容；生产方在第 4 阶段（第 18 节）加入。

| SDK | API |
|---|---|
| TypeScript | `experimentalCandidateIngress(bytes: Uint8Array)`，由 `@dcp-ai/sdk` 导出 |
| Python | `dcp_ai.v2.experimental_candidate_ingress.experimental_candidate_ingress(data)`，未由 `dcp_ai.v2` 重新导出 |
| Go | `v2.ExperimentalCandidateIngress(input []byte)` |
| Rust | `dcp_ai::v2::experimental_candidate_ingress::experimental_candidate_ingress(&[u8])` |
| WASM | Rust 绑定中的 `wasm_experimental_candidate_ingress`，以及 `@dcp-ai/wasm` 中的 `DcpWasm.experimentalCandidateIngress(bytes)` |

**它做什么。** 它接收一个单元的原始字节，并以第 6.1–6.2 节的优先级和偏移应用
第 3.1–3.3 节。接受时，它返回精确值、其规范字节（§3.4）及其
SHA-256；WASM 包装器返回字节和哈希，不返回值。拒绝是一种结果，带有
其类别和字节偏移。参数类型错误和内部错误会单独报告，绝不作为
拒绝。

**它不做什么：**

- 从传输中提取单元（§5、§6.3）；
- 选择配置文件或应用策略（§6.4 第 1、5、6 步；§7）；
- 委托给 `dcp-jcs-v1`；
- 验证、签名或准入任何内容。

**测试。** 四个 SDK（TypeScript、Python、Go 和 Rust）各自针对存储的
预期（类别和偏移，或规范哈希）运行这些用例：

- 87 个基线单元；
- `corpus.json` 中 81 个不加封装的文档用例。

四个 SDK 还各自检查其 `dcp-jcs-v1` 规范化器对每个已接受的值给出相同的字节，
并加入针对性的示例：无效 UTF-8、BOM、通过转义形成的重复项、
`__proto__`、长的和饱和的数字字面量、代理项对，以及有无较晚语法错误的
两万层嵌套。

WASM 测试通过 `@dcp-ai/wasm` 包装器在同样的 168 个用例上运行真实的 Rust 绑定，
比较类别和偏移或规范字节和哈希；它得不到值，因此不做 `dcp-jcs-v1`
比较。它还检查 JS/WASM 边界：

- 字节原样到达 Rust（无效字节、BOM、NUL 转义、更大缓冲区的视图）；
- 两万层的单元能够返回；
- 不是 `Uint8Array` 的参数为 `TypeError`。

在每个 SDK 中，77 个 bundle 用例和 29 个封装用例（其中包括已废弃的深度规则）属于
后续阶段：只计数，不运行。

**关卡。** 这只是针对单元用例、朝向第 9 节关卡 1、3 和 4 的证据。十道关卡没有一道
因此达成，候选仍未启用。

<a id="16-experimental-sdk-router-phase-2"></a>

## 16. SDK 中的实验性路由器（第 2 阶段）

SDK 实现计划的第 2 阶段为每个 SDK 添加了一个实验性、需显式启用的路由器。它提取单元
（§5、§6.3），读取配置文件（§7），并应用 §6.4 直到作出决定：拒绝、委托给 `dcp-jcs-v1`，或
选择候选路径。它不具规范效力，没有任何现有路径或默认路径调用它：只有显式启用的调用方
才会调用。`dcp-jcs-v1`、其验证器和所有默认值都不变。`candidate` 绝不是接受：要由第 3 阶段来验证它。没有任何东西验证或签名
候选。

| SDK | API |
|---|---|
| TypeScript | `createExperimentalCandidateRouter(config).route(bytes)`、`experimentalCandidateExtractUnit`、`experimentalHistoricalAdapters` |
| Python | `dcp_ai.v2.experimental_candidate_router`：`create_router`、`extract_unit`、`JSON_LOADS_BYTES`、`JSON_LOADS_STRICT_DECODE` |
| Go | `NewExperimentalCandidateRouter(cfg)` 和 `Route`、`ExperimentalCandidateExtractUnit`、`ExperimentalHistoricalEncodingJSON` |
| Rust | `v2::experimental_candidate_router`：`CandidateRouter::new` 和 `route`、`extract_unit`、`HistoricalAdapter::serde_json_from_slice` |
| WASM | 基于绑定 `wasm_experimental_candidate_route` 和 `_resume` 的 `DcpWasm.createExperimentalCandidateRouter`，以及 `experimentalWasmHistoricalAdapters` |

**配置。** 传输（`bare` 或 `envelope`）、接受的配置文件和历史适配器
都是必需的；都没有默认值。

- 在创建路由器时、在任何输入之前，以严格类型对它们进行校验。
- 无效的配置是配置错误（`POLICY_INVALID` 或 `CONFIG_INVALID`），绝不是
  对数据的拒绝。
- 路由器保存一份私有快照，因此之后修改调用方的对象不会改变任何东西。

**结果。**

- **`reject`：** 类别（传输类别、扫描器类别、`PROFILE_UNKNOWN` 或 `PROFILE_NOT_ACCEPTED`）
  及其偏移。`offset` 相对于单元；`transport_offset` 位于输入中。
- **`v1_path`：** 单元、警告（D7）以及历史适配器返回的内容。
  - 其配置文件始终是 `dcp-jcs-v1`：没有该字段的清单是在 `dcp-jcs-v1` 下生成的。
  - `profile_source` 说明原因：`field`、`absent`，或扫描器无法遍历的单元为 `historical`。
- **`candidate`：** 单元、其值和其规范字节。与第 1 阶段一样，WASM 包装器返回规范字节
  及其哈希，但不返回值。

各 SDK 的名称按各语言的风格对应：TypeScript 和 WASM 包装器中为 `profileSource`、`transportOffset` 和
`canonicalSha256`；Python、Rust 和 WASM 绑定中为 `profile_source`、`transport_offset` 和
`canonical_sha256`；Go 中为 `ProfileSource`、`TransportOffset` 和
`CanonicalSHA256`。

**历史适配器。** 适配器复现一个真实的解码器，路由器最多咨询它一次，且只在
§6.4 需要时：

- 对扫描器无法遍历的单元作出决定；
- 生成委托的值。

它的读取结果绝不会选择候选，其结果是真实解码器返回的内容，不经候选规则
清理：NaN、无穷大和孤立代理项只在该解码器保留它们的地方保留。
`json.loads` 接受 NaN 和 1e999，`JSON.parse` 对 1e999 给出 Infinity，两者都保留孤立代理项。
`encoding/json` 和 `serde_json` 拒绝 1e999。在 WASM 的 `w1` 路径上，`JSON.stringify` 把 Infinity 变成
`null` 并再次转义孤立代理项，随后 `serde_json` 拒绝它们。以拒绝数据以外的方式失败的适配器
是适配器错误，而不是拒绝。

WASM 包装器复现两条不同的路径，分别测量，不假定二者等价：

- **`w1`：** 对象经 `JSON.stringify` 传给 Rust；
- **`w2`：** 文本传给绑定。

其绑定没有状态。`resume` 根据自己的参数重新计算决策点，只能以拒绝或委托
结束。

**测试。** 每个 SDK 和 WASM 运行这些用例：

- 9 个配置用例；
- 28 个文档封装用例；
- 58 个可遍历的 bundle 用例，其中 `accept_v2` 和 `COMMITMENT_MISMATCH` 只作为 `candidate` 检查；
- 公开测试数据 `tests/interop/candidate/phase2-adapter-expectations.json`。对于 9 个扫描器无法遍历的单元
  和 7 个合成单元，它记录每个真实解码器返回的内容，通过实际运行测得；语料库的
  `historical` 参数不作为证据使用。

它们还检查：

- 无差异的 v1 一致性：不加封装、`["dcp-jcs-v1"]`、每个内置适配器，在公开的已签名
  bundle 及由其生成的变体上；
- 语法遍历器与第 1 阶段扫描器的对比；
- 惰性、适配器契约和字节所有权。

**关卡。** 这是朝向第 9 节关卡 1、8 和 9 的证据，仅限于选择和委托。十道关卡没有一道
因此达成，候选仍未启用。

<a id="17-experimental-sdk-verifier-phase-3"></a>

## 17. SDK 中的实验性验证器（第 3 阶段）

SDK 实现计划的第 3 阶段为每个 SDK 添加了一个实验性、需显式启用的原始字节验证器。
它用第 16 节的路由器对字节路由一次，并最多运行一个验证器：

- 拒绝时不运行任何验证器；
- 对 `v1_path`，运行当前的 V2 验证器，输入恰好是当前调用方会交给它的内容；
- 对 `candidate`，运行当前的 V2 验证器，在清单中恰好接受 `dcp-jcs-v2`。

不会在另一个配置文件下进行第二次尝试。它不具规范效力，没有任何现有路径或默认路径调用
它。`dcp-jcs-v1`、现有验证器及其默认值都不变，它们的对象和文本 API
仍然拒绝 `dcp-jcs-v2`。生产方在第 4 阶段（第 18 节）加入；下面的向量由仅用于测试的
生成器签名。通过验证的候选 bundle 不授予信任或
准入，也不授权任何东西。

| SDK | API |
|---|---|
| TypeScript | `createExperimentalCandidateVerifier(config).verify(bytes, registry, policy?, options?)` |
| Python | `dcp_ai.v2.experimental_candidate_verify`：`create_verifier(...)` 和 `await verifier.verify(data, registry, policy=None, now_ms=None)` |
| Go | `NewExperimentalCandidateVerifier(ExperimentalCandidateVerifierConfig)` 和 `VerifyAt(registry, input, policy, now)` |
| Rust | `v2::experimental_candidate_verify`：`CandidateVerifier::new(config)` 和 `verify_at(input, policy, now_ms)` |
| WASM | 基于绑定 `wasm_experimental_candidate_verify` 的 `DcpWasm.createExperimentalCandidateVerifier(config).verify(bytes, policy?)` |

**配置和参数。** 配置与路由器相同（§16）：传输、接受的配置文件
和历史适配器，全部必需，都没有默认值。

- Go 用封闭的名称 `encoding_json` 指定其适配器，并自行构建该解码器，因此修改
  导出的 `ExperimentalHistoricalEncodingJSON` 不会改变任何东西。
- 验证参数是每个 SDK 的 V2 验证器的参数，默认值相同，包括
  可选的密码学策略。

**结果。** 路由、`entered`（`none`、`dcp-jcs-v1` 或 `dcp-jcs-v2`）以及验证器的原样结果，
未运行任何验证器时为 `null`。`entered` 指明已开始的验证路径，包括其策略
校验。它并不表明运行了任何密码学检查：验证器可能先在策略、结构、
哈希或会话检查处停止，其结果会说明这一点。

**候选路径。** 它是只做了一处改动的当前验证器，即它接受的清单配置文件；每个哈希、
签名和辅助函数都是当前的。在候选接受的精确值上，`dcp-jcs-v1` 规范化器
给出候选的字节（§3.4）。

- TypeScript、Python 和 Rust 验证精确值。
- Go 验证候选的规范字节，因此其解析器永远不会读到候选已规范化的字面量。

**委托。** 它把当前调用方会给出的输入原样交给当前验证器。

- **TypeScript、Python 和 Rust：** 适配器解码出的值。
  - 解码出的 `null` 是数据，会被委托。
  - 解码器拒绝了数据时没有值，什么也不运行（`entered: none`）。
- **Go：** 单元字节交给 `VerifySignedBundleV2At`，由它自行解析。
- **WASM：** 一次 `wasm_experimental_candidate_verify` 调用。
  - 需要解码器时只咨询一次，而从不验证的 `resume` 以
    拒绝或委托结束。
  - 委托把解码器自己的字符串，连同 `verifyBundle` 发送的策略 JSON，一起交给
    `wasm_verify_signed_bundle_v2`：在 `w1` 上是解码对象的 `JSON.stringify`；在 `w2` 上是文本。
  - 拒绝了数据的解码器不会留下字符串。
  - 绑定保持其 V1 行为：V1 bundle 在没有策略时通过验证，有策略时被拒绝。

**向量。** [`tests/interop/candidate/phase3-signed-vectors.json`](../../../tests/interop/candidate/phase3-signed-vectors.json)
有 18 个冻结的基础和 57 个用例。

- **基础：** 16 个已签名 bundle、V1 一致性 bundle 和 `null`。
  - 15 个由 TypeScript SDK 中仅用于测试的生成器签名（不是生产方 API）。
  - 第 16 个是 `B-reordered`：与 `B-v2` 相同的已签名 bundle，但成员顺序相反并加了
    空白。
- **用例：** 一个用例是一个基础加上字节编辑。
- **预期：** 手工编写：路由、适配器调用、`entered`、判定以及每个 SDK 的错误
  子串，在解码器不同之处按适配器覆盖。

| 组 | 用例 |
|---|---|
| 阳性 | 16 个：混合签名和纯经典签名；写作 `1.0`、`1e2`、`-0` 以及 1 后跟 800、801 或 5000 个十进制零的整数；±(2^53-1)；转义；成员顺序和空白；深度 64；清单之外的诱饵配置文件；与 v1 引用并存的新链；一个 PQ 检查点；名为 `__proto__` 的键 |
| 在任何验证器之前的拒绝 | 17 |
| 候选的失败 | 14 个，各自在其指明的步骤失败 |
| 委托 | 10 |

生成器的 `--check` 校验两件事：冻结的基础（其哈希、载荷和清单哈希，
以及声明的配置文件），以及每个用例和预期。TypeScript 测试用复合原语验证 16 个已签名基础的 81 个签名，
包括语义上无效的基础。

**测试。** 每个 SDK 和 WASM 运行：

- 在任何用例之前，检查向量恰好包含 57 个已批准的用例 ID，各出现一次；ID
  缺失、重复或未知都会使其失败；
- 用每个内置适配器运行 57 个用例；
- 每次委托与直接调用的一致性；
- 一个插桩检查，确认最多只运行一个验证器。它使用仅用于测试的探针或计数绑定；没有
  公开 API 会跳过验证；
- 阳性用例中每个已承诺值的规范字节：单元、清单、四个载荷、
  审计条目和检查点。候选输入检查接受其中每一个的 `dcp-jcs-v1` 规范字节，
  得到相同的精确值和相同的字节；
- 配置；
- 被修改的缓冲区；
- 当前 API 仍然拒绝 `dcp-jcs-v2`。

**与设计模型对照。**

| 设计模型 | 第 3 阶段 |
|---|---|
| `accept_v2` | 一条候选路由，带 `verified: true` 和真实的清单哈希 |
| `COMMITMENT_MISMATCH` | `verified: false`，带验证器自己的错误。它可能报告多个，其顺序不具规范性 |
| 拒绝 | 第 16 节的路由 |
| 委托 | 记录当前判定，模型不计算该判定 |
| — | 密码学失败（签名、策略、密钥有效性、会话和检查点）：新的预期，在模型中没有对应项 |

**关卡。** 在第 3 阶段，第 9 节的十道关卡没有一道被宣布达成；台账见第 18.4 节，候选
仍未启用。

- **朝向以下关卡的证据：**
  - 关卡 1：合成 bundle 用例，重新表述为真实的已签名 bundle；
  - 关卡 3：在阳性用例的已承诺值上；
  - 关卡 7：注入到已签名候选 bundle 中的缺陷在任何验证器之前被拒绝，而在
    `dcp-jcs-v1` bundle 中，委托的判定是当前判定；
  - 关卡 8：一个经插桩的验证器。
- **未达成：**
  - 关卡 6，交叉签名矩阵，它需要生产方；这里的每个已签名 bundle 都来自同一个测试
    生成器；
  - 关卡 2、9 和 10，它们需要各自的运行。

<a id="18-experimental-sdk-producers-phase-4"></a>

## 18. SDK 中的实验性生产方（第 4 阶段）

SDK 实现计划的第 4 阶段为每个 SDK 和 WASM 添加了实验性、需显式启用的生产方。它们
生成**新的**证据：像当前一样签名的工件，以及其新清单签名了
`canonicalization_profile: "dcp-jcs-v2"` 的 bundle。它不具规范效力，没有任何现有路径或默认路径调用它们。
`dcp-jcs-v1`、其构建器、签名器和验证器以及所有默认值都不变；该配置文件仍
保持实验性且需显式启用，npm SDK 2.2.0 和 WASM 2.1.0 也是如此。它们生成的 bundle 不授予信任或准入，也不授权任何东西。

| SDK | API |
|---|---|
| TypeScript | `experimentalCandidateSignPayload(registry, context, input, keys)` 和 `experimentalCandidateSignBundle(registry, parts, signer, options)` |
| Python | `dcp_ai.v2.experimental_candidate_produce`：`sign_payload(registry, context, input, keys)` 和 `sign_bundle(registry, parts, signer, options)`，在调用时检查并复制，返回一个 awaitable |
| Go | `ExperimentalCandidateSignPayload(registry, context, input, keys)` 和 `ExperimentalCandidateSignBundle(registry, parts, signer, options)`，输入为 `ExperimentalCandidateBytes` 和 `ExperimentalCandidateHostValue` |
| Rust | `v2::experimental_candidate_produce`：`sign_payload(context, input, keys)` 和 `sign_bundle(parts, signer, options)`，使用 `CandidateInput::{Bytes, Value}` |
| WASM | `DcpWasm.experimentalCandidateSignPayload(context, input, keys)` 和 `experimentalCandidateSignBundle(parts, signer, options)`，基于只接收字节的绑定 `wasm_experimental_candidate_sign_payload` 和 `wasm_experimental_candidate_sign_bundle` |

**输入。** 每一部分是以下之一：

- **字节：** 原始字节，在任何东西解析它们之前由第 1 阶段的输入检查（§15）检查。这是
  处理从别处收到的 JSON 的方式：只有字节能保留解析器会修复或丢失的内容；
- **宿主值：** 通过对语言精确类型的严格遍历进行检查，并在检查之后编码。
  值无法显示它是从哪个字面量解析而来，因此无法检测已被解析器修复过的值。

值域之外的宿主值会以 `NUMBER_NOT_FINITE`、`NUMBER_NOT_INTEGER`、
`NUMBER_OUT_OF_RANGE`、`SURROGATE_UNPAIRED`、`UTF8_INVALID`（Go）、`DEPTH_EXCEEDED`、`TYPE_UNSUPPORTED` 或
`KEY_NOT_STRING`（Python）被拒绝。整数值的浮点数、`-0`，以及在 TypeScript 和 WASM 中的 BigInt，会被规范化为
整数。getter 和 `toJSON` 从不被调用。结构体和外来类型会被拒绝，绝不转换。

**`signPayload`** 在 DCP 上下文下、不带配置文件地签名一个工件 `{payload, payload_hash, composite_sig}`。
载荷最多 63 层，使工件最多 64 层。输入检查接受
输出字节并原样返回。

**`signBundle`** 在精确值之上组装 bundle。各部分是工件、审计条目和可选的 PQ
检查点，每一项都可以是字节或值。

- 它不认识的成员会被保留。位于载荷、条目、检查点或清单之外的成员不会被
  签名，因此不声称其完整性。
- 收到的证据绝不会被重新标注或重新计算。`payload_hash` 不是其载荷哈希的工件
  会被拒绝（`COMMITMENT_MISMATCH`），链必须从 `GENESIS` 开始并相互链接（`CHAIN_NOT_GENESIS`、
  `CHAIN_BREAK`）。
- 签名者必须是负责的委托人（`SIGNER_MISMATCH`）。
- 会话开始时间绝不从时钟取得。有过期时间时，`session_issued_at` 是必需的
  （`SESSION_ISSUED_AT_REQUIRED`），日期必须有效（`SESSION_INVALID`）。
- 空的审计轨迹给出 `audit_count: 0` 和 64 个零的根。
- `dualHash`（默认关闭）添加 SHA3-256 根和 `hash_alg: sha256+sha3-256`。
- `created_at` 位于所有签名之外，不受保护。
- 在任何签名之前，检查整个单元最多 64 层。
- 第 16 节的路由器将输出路由为 `candidate`，其 `canonical_sha256` 等于输出
  字节的 SHA-256。

**错误。** 对本契约的拒绝带有其类别、所属部分以及 JSON Pointer 或字节偏移，并在
调用任何签名器之前抛出（测试统计到零次签名器调用）。API 的误用是用法错误：
`TypeError`、`ErrExperimentalCandidateUsage` 或 `ProduceError::Usage`。密钥、注册表或
提供方的错误保持不变。

**与当前构建器的对照。** 这些是新的 API，不是 `dcp-jcs-v1` 构建器的选项，并且有意
不同：显式的日期、在所有地方相同的 `dualHash` 默认值（Go、Rust 和 WASM 的 v1 构建器默认添加
二级根），以及在精确值之上的组装。

<a id="181-cross-matrix-testsinteropcandidatephase4"></a>

### 18.1 交叉矩阵（`tests/interop/candidate/phase4/`）

五个生产方（TypeScript、Python、Go、Rust 和 WASM）用各自公开的显式启用 API 签名相同的输入字节。
每个消费方用第 17 节的验证器验证每个输出。运行器及其规格位于
[`tests/interop/candidate/phase4/`](../../../tests/interop/candidate/phase4/)；合成密钥在每次
运行时生成，绝不写到运行目录之外。

- **阳性：** bytes 和 value 两种模式下的 12 个规格（`S01`–`S12`），外加一个环：用下一个生产方签名的
  工件组装的 `S01`。共 115 个单元，每个由 5 个消费方验证：575 个结果。
  它们涵盖：
  - 混合签名和纯经典签名、双哈希、一个 PQ 检查点；
  - ±(2^53−1)；
  - 含 U+E000 和 U+1F600 的键；
  - 字符串开头的 U+FEFF、U+FFFD、U+2028 和 `\u0000`；
  - 深度 64；
  - 未签名的扩展成员；
  - 名为 `__proto__`、`constructor` 和 `toJSON` 的成员；
  - 用 800 和 5000 个十进制零写出的整数（字节）；
  - `1.0` 和 `-0.0`（值）。
- **阴性：** 对每个生产方新生成的输出做 16 处字节级编辑，由每个消费方验证：400 个结果。
  - 在任何验证器之前：BOM、无效 UTF-8、语法错误、孤立代理项、重复项、小数、
    超出范围的数字、深度 65、传输错误、未知配置文件和不被接受的配置文件。
  - 在候选路径上并在那里失败：被修改的载荷、被修改的清单，以及被翻转的经典或
    PQ 签名。
- **运行器的检查：**
  - 975 个结果、步骤和字段的确切集合；
  - 新鲜度：运行 ID、日期和文件时间；
  - 每个消费方观察到的解码器调用（BOM、UTF-8 和语法为 1，其他为 0）；
  - 对每个规格，所有生产方给出相同的 `manifest_hash`，以及除 ML-DSA 签名值
    （随机化）之外相同的单元，只在其已知位置遮蔽；
  - 每个 SDK 推导出相同的密钥 ID；
  - 一个会终止整个进程组的期限；
  - `--self-test` 检查上述每一种拒绝。

<a id="182-host-values-gate-2"></a>

### 18.2 宿主值（关卡 2）

每个语料库 ID 按语言分类为：

- **R：** 被精确表示，带有字节的类别；
- **T：** 只能表示为已经变换过的值，其类别可能改变；
- **P：** 先被解析器拒绝；
- **N：** 无法表示。

每个 R 和 T 单元格都在其 SDK 中测试，P 和 N 则予以记录。标记 `needs_original_bytes: false`
只表示解析器已经可以拒绝该用例。

| ID | 字节 | TS / WASM | Python | Go | Rust |
|---|---|---|---|---|---|
| `n-two53`, `n-1e20`, `n-1e21`, `n-fraction`, `s-depth-65`, `s-depth-129` | 与语料库相同 | R | R | R | R（深度直接构造） |
| `n-two53-plus-one`, `n-neg-two53-plus-one`, `n-int64-max`, `n-sci-over` | `NUMBER_OUT_OF_RANGE` | 用 BigInt 为 R；用 number 为 T（被舍入，仍超出范围） | R（int） | R（int64） | R（i64） |
| `n-overflow` (`1e400`) | `NUMBER_OUT_OF_RANGE` | 用 BigInt 为 R；用 number 为 T（`Infinity`：`NUMBER_NOT_FINITE`） | R（int）；用 float 为 T（`inf`） | 作为整数为 N；作为 `json.Number` 字面量为 R；用 float64 为 T（`+Inf`） | N |
| `n-huge-exponent`（5000 位的指数） | `NUMBER_OUT_OF_RANGE` | 作为整数为 N（无法具体化）；T（`Infinity`） | N；T（`inf`） | 作为 `json.Number` 字面量为 R，不构造该数字即被拒绝；T（`+Inf`） | N |
| `n-nan`, `n-negative-infinity` | `SYNTAX` | T（`NUMBER_NOT_FINITE`） | T | T | N |
| 9 个语法 ID（前导零、加号、单独的小数点、未转义的控制字符、末尾逗号或数据、两个值、空输入、NBSP） | `SYNTAX` | P | P | P | P |

`n-huge-exponent` 的 T 单元格使用更短的字面量（`1e99999`），解析器同样会把它变成无穷大。
标记为 `true` 的 22 个用例仍在值的能力范围之外；对它们来说，途径是字节。

<a id="183-cost-gate-10"></a>

### 18.3 成本（关卡 10）

成本在每个平台的一对等价组合上测量。两侧使用相同的密钥、载荷、会话和
审计条目，运行器在测量之前在输出上检查这一点：相同的四个 `payload_hash`、
相同的 nonce 和会话日期，以及相同的条目。v1 bundle 来自每个 SDK 的构建器和签名器，
候选来自生产方。

每个操作在 3 次预热后运行 20 次，每个平台最多 60 秒，构建单独
计时。用 `node tests/interop/candidate/phase4/run.mjs --cost` 运行。以下是在一台
机器上运行一次的中位数，单位为毫秒（Apple M5 Pro；Node 22.15、Python 3.12、Go 1.26、Rust 1.93 release）：

| 平台 | 生成 v1 | 生成候选 | 当前验证 | 验证 v1（`v1_path`） | 验证候选 |
|---|---|---|---|---|---|
| TypeScript | 40.3 | 48.1 | 20.2 | 20.7 | 32.0 |
| Python | 22.8 | 27.6 | 3.5 | 7.7 | 7.7 |
| Go | 3.2 | 7.0 | 2.1 | 2.9 | 2.5 |
| Rust | 2.3 | 3.0 | 0.7 | 0.9 | 0.8 |
| WASM | 4.1 | 4.8 | 1.5 | 2.1 | 1.4 |

**局限。** 这些时间并不是单独对规范化的测量，既不表明改进
也不表明退步：

- **输出不同。** v1 字节是各 SDK 的 JSON 序列化（Python 的带空格），而
  候选的字节是规范的。
- **构建器不同。** Go、Rust 和 WASM 的 v1 构建器添加二级根，而此处的候选
  不添加。
- **Go 的条目。** v1 构建器接收有类型的条目，因此其 `AuditEvidenceV2` 会丢弃 null 成员。Go 这一对的
  两侧签名的是经由它重建的相同条目。
- **“当前验证”包含什么。** 在 API 接收对象或值的地方，它包含对字节的解码
  （`JSON.parse`、`json.loads`、`serde_json::from_slice`）。Go 的 API 接收字节并自行解析。
- **波动。** 在同一台机器上，中位数在不同运行之间有所变化。例如，TypeScript 的候选
  验证在之前的一次运行中约为 22 毫秒。

没有 SLA，也没有为弥补而放宽任何东西。

<a id="184-ledger-of-the-ten-gates-9"></a>

### 18.4 十道关卡的台账（§9）

本台账记录证据；它不启用任何东西。阶段或默认值的更改需要其自身的决定。

| # | 关卡 | 状态 | 证据 | 局限 |
|---|---|---|---|---|
| 1 | 语料库一致 | 已达成 | 第 15 节：四个 SDK 中的 87 个基线单元和 81 个不加封装的设计用例，以及 WASM 中同样的 168 个用例。第 17 节：作为真实已签名 bundle 的合成 bundle 用例。第 16 节：用真实解码器的读取结果代替 `historical` 参数 | v0.3 深度规则用例用于演示模型，不是要求 |
| 2 | 对象 API 的范围 | 已达成，范围见第 18.2 节 | 第 18.2 节：按语言测试的每个 R 和 T 单元格，每一个都在签名前以其类别被拒绝。TypeScript、Python、Go 和 WASM 对每个单元格统计到零次签名器调用。Rust 的单元格使用无法签名的密钥，因此一旦调用签名器就会表现为提供方错误；其统计到的零次调用见其针对性的单元测试 | 标记为 `true` 的 22 个用例以及 P 和 N 单元格在值的能力范围之外 |
| 3 | 值上的输出等价 | 在样本上达成 | 第 15 节：在已接受的值上与 `dcp-jcs-v1` 的比较。第 17 节：阳性用例的已承诺值。第 18.1 节：五个生产方之间相同的 115 个单元。第 18.3 节：v1 签名器和生产方给出相同的载荷哈希 | 在语料库、向量和矩阵上展示，并未在整个值域上证明 |
| 4 | 从字节出发的输入一致 | 已达成 | 第 15 节，在四个 SDK 和 WASM 中 | 单元用例 |
| 5 | 历史读取 | 不是关卡 | 第 16 节将其记录为诊断 | — |
| 6 | 交叉签名矩阵 | 已达成 | 第 18.1 节：5 × 5 加上环，975 个结果全部符合，包含该关卡的所有边界载荷。`dcp-jcs-v1` 互操作矩阵（`tools/interop-matrix`，两个场景）在收尾时通过 | 在一台机器上的本地运行；工作流在每次更改时重新运行 |
| 7 | 阴性矩阵 | 部分 | 第 18.1 节：语料库的每个类别，以及传输和配置文件类别，都在任何验证器之前被拒绝，5 × 5。候选路径上的候选失败。第 17 节：`dcp-jcs-v1` bundle 的委托保持当前判定 | `dcp-jcs-v1` 一侧依赖第 17 节的委托和第 16 节的读取；此处没有按类别重复 |
| 8 | 选择、优先级与策略 | 已达成 | 第 16 节和第 17 节，用一个经插桩的验证器 | — |
| 9 | 历史 | 已达成 | 在收尾时、新代码就位的情况下：一致性（V1 和 V2，包括准入用例）、每个 SDK 的完整测试套件、WASM 测试（包括 bundle 向量和 V1 验证）以及 `dcp-jcs-v1` 互操作和准入矩阵，全部通过。第 1 至 3 阶段的测试轮次没有重复 | 在一台机器上的本地运行 |
| 10 | 成本 | 已达成 | 第 18.3 节 | 一台机器，没有 SLA，第 18.3 节的局限 |
