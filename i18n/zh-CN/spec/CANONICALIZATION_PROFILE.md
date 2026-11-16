<sub>[English](../../../spec/CANONICALIZATION_PROFILE.md) · **中文** · [Español](../../es/spec/CANONICALIZATION_PROFILE.md) · [日本語](../../ja/spec/CANONICALIZATION_PROFILE.md) · [Português](../../pt-BR/spec/CANONICALIZATION_PROFILE.md)</sub>

<a id="dcp-ai-canonicalization-profile"></a>

# DCP-AI 规范化配置文件

> 本文是[英文规范](../../../spec/CANONICALIZATION_PROFILE.md)的参考译文，更新于 25/10/2026。**具有规范效力的是英文版**：本译文不具规范效力，如有出入，以英文版为准。标识符和代码块保持原文，不作翻译。

**配置文件标识符：** `dcp-jcs-v1`
**状态：** 已发布 — v2.0
**首次随附于：** Python 2.8.0、Rust 2.8.0、Go v2.8.0、TypeScript 2.1.0

本文档是 DCP-AI 中逐字节精确 JSON
规范化的规范性参考。它取代了原先在 `spec/DCP-AI-v2.0.md` § 15 中的五条要点摘要。
DCP 工件中的每个签名、每个哈希、
每个 Merkle 叶节点，都是对此处规定算法的输出计算的。

该配置文件**基于 RFC 8785（JCS）**。它把数字限制为
整数（规则 4），并对 JCS 留给实现决定的情况给出明确处理。它不是 JCS 的严格子集：规则 1 按
Unicode 码点对对象键排序，而 RFC 8785 §3.2.3 按
UTF-16 码元排序。只有当对象的键混合了辅助平面
字符（U+10000 及以上）和 U+E000..U+FFFF 中的字符时，两种顺序才会不同。声称符合该配置文件的 SDK 必须（MUST）
对第 3 节边界用例表产生逐字节相同的输出。

---

<a id="1-why-a-profile-and-not-just-jcs"></a>

## 1. 为什么需要配置文件，而不只是“JCS”

RFC 8785 规定了结构性规则——键排序、紧凑形式、字符串
转义、数字表示——但把一些决定留给生产方的
宿主语言：如何处理 `undefined`、恰好为整数值的
浮点数如何处理、是否规范化 `1e2`、
与 `null` 等价的宿主类型如何映射为 JSON `null`。在四个 SDK
（TypeScript、Python、Rust、Go）中，这些默认行为各不相同，会为同一个源对象产生
不同的字节。`dcp-jcs-v1` 固定了其中的每一个决定，使四个 SDK 产生相同的输出。

---

<a id="2-normative-rules"></a>

## 2. 规范性规则

实现 `dcp-jcs-v1` 的生产方必须（MUST）遵守规则 1 至 8。
使用 `dcp-jcs-v1` 的验证器应当（SHOULD）拒绝输出
偏离这些规则的工件。

<a id="rule-1--sorted-keys"></a>
<a id="rule-1-sorted-keys"></a>

### 规则 1 — 键排序

对象键按 Unicode 码点以升序进行字典序排序。
排序在每一层嵌套中进行。

```
input    → {"z": 1, "a": 2, "é": 3, "e": 4}
output   → {"a":2,"e":4,"z":1,"é":3}
```

<a id="rule-2--compact-form"></a>
<a id="rule-2-compact-form"></a>

### 规则 2 — 紧凑形式

字符串值之外不得有任何空白。成员分隔符为 `,`，
键值分隔符为 `:`。没有末尾逗号。

<a id="rule-3--string-escaping"></a>
<a id="rule-3-string-escaping"></a>

### 规则 3 — 字符串转义

字符串以 UTF-8 编码。转义遵循 RFC 8785 §3.2：只转义
JSON 要求转义的字符（控制字符 U+0000
至 U+001F、`"`、`\`）。正斜杠、非 ASCII
字符、表情符号、汉字等按其 UTF-8 字节序列原样输出。

```
input    → {"emoji": "🔑", "kanji": "鍵"}
output   → {"emoji":"🔑","kanji":"鍵"}
```

<a id="rule-4--numeric-values-integer-only"></a>
<a id="rule-4-numeric-values-integer-only"></a>

### 规则 4 — 数值：仅限整数

该格式只接受值为精确整数的数字。
“精确整数”在**解析之后**判定：

- JSON `Number` 有效当且仅当 (a) 它是有限的，且 (b) 其值没有
  小数部分（`floor(n) == n`）。
- 源字面量为 `1.0`、`1.00`、`1e2`、`100` 或
  `-0` 的 `Number` 是有效的，因为这些字面量在解析后都解码为整数值。
- 值为 `0.1`、`1.5`、`1e-1`、`NaN` 或 `±Infinity` 的 `Number`
  无效，规范化器必须（MUST）在产生任何输出之前抛出错误。

输出规范化：每个有效数字都以纯整数形式输出，
没有小数点、没有指数、没有前导零（`0` 除外），
也没有末尾零。

```
{"n": 1.0}    → {"n":1}
{"n": 1e2}    → {"n":100}
{"n": -0}     → {"n":0}
{"n": 0.1}    → ERROR
{"n": NaN}    → ERROR
```

正是这条规则让四个 SDK 达成一致：JavaScript 生产方
可以把 `1.0` 作为字面量传入（它没有整数类型），Python 生产方
可以传入 `int(100)`，Go 生产方可以传入从
JSON 解析得到的 `1e2`，四者都输出相同的字节。

<a id="rule-5--null-preservation"></a>
<a id="rule-5-null-preservation"></a>

### 规则 5 — 保留 null

JSON `null` 值必须（MUST）与其键一起保留：

```
input    → {"x": null, "y": 1}
output   → {"x":null,"y":1}
```

数组中的 null 保留其位置：

```
input    → [1, null, 3]
output   → [1,null,3]
```

<a id="rule-6--null-and-undefined-handling-cross-language"></a>
<a id="rule-6-null-and-undefined-handling-cross-language"></a>

### 规则 6 — null 与 undefined 的处理（跨语言）

JSON 只有一种表示缺失值的方式（`null`）。宿主语言则有更多。
TypeScript 是唯一区分 `undefined`
和 `null` 的宿主语言；Python、Go 和 Rust 不区分。规范化器必须（MUST）按如下方式处理
每个宿主值：

| 宿主语言 | 宿主值                                              | 在对象键中 | 在数组位置中 |
|---------------|-----------------------------------------------------|------------------|------------------|
| TypeScript    | `undefined`                                         | **省略该键** | 输出 `null`      |
| TypeScript    | `null`                                              | 输出 `null`      | 输出 `null`      |
| Python        | 缺失的键                                            | **省略该键** | n/a              |
| Python        | `None`                                              | 输出 `null`      | 输出 `null`      |
| Go            | 缺失的 map 条目                                     | **省略该键** | n/a              |
| Go            | `nil` 接口 / 显式 JSON null                          | 输出 `null`      | 输出 `null`      |
| Rust          | 带 `skip_serializing_if=None` 的缺失结构体字段       | **省略该键** | n/a              |
| Rust          | 不带 skip 序列化的 `Option::None`                    | 输出 `null`      | 输出 `null`      |
| Rust          | `Value::Null`                                       | 输出 `null`      | 输出 `null`      |

```
input    → { a: 1, b: undefined, c: 3 }   (TS)
output   → {"a":1,"c":3}

input    → [1, undefined, 3]              (TS)
output   → [1,null,3]

input    → {"a": 1, "b": None, "c": 3}    (Python)
output   → {"a":1,"b":null,"c":3}
```

这种不对称是有意的：在 TypeScript 中，缺少某个键的对象和带有
`b: undefined` 的对象产生相同的输出，
这与 JSON 无法区分“缺失”与“值为 undefined”相一致。
在数组中位置是有意义的，因此
`undefined` 具体化为 `null`。

SDK 不得（MUST NOT）在宿主语言没有 `undefined` 的地方凭空造出这种通道。
Python 的 `None`、解析时产生 JSON null 的接口类型的 Go `nil`，
以及 Rust 的 `Value::Null` 都映射为 JSON `null`。

<a id="rule-7--booleans"></a>
<a id="rule-7-booleans"></a>

### 规则 7 — 布尔值

布尔值输出为字面量 `true` 和 `false`。

```
input    → {"t": true, "f": false}
output   → {"f":false,"t":true}
```

<a id="rule-8--empty-containers"></a>
<a id="rule-8-empty-containers"></a>

### 规则 8 — 空容器

空对象输出 `{}`。空数组输出 `[]`。两者都不会
被省略。

```
input    → {}
output   → {}

input    → []
output   → []
```

<a id="rule-9--unicode-normalization-is-out-of-scope"></a>
<a id="rule-9-unicode-normalization-is-out-of-scope"></a>

### 规则 9 — Unicode 规范化不在范围内

字符串按照规则 3 的转义规则以其 UTF-8 字节序列输出，
**不做**任何 Unicode 规范化（NFC、NFD、
NFKC、NFKD）。提供预组合字符串 `"é"`
（U+00E9）的生产方与提供分解序列
`"e"` + `U+0301` 的生产方会产生**不同的字节**，尽管这两个字符串显示相同，
并且在规范等价下相等。

这是刻意不作决定：在规范化层要求一种规范化形式，
会迫使每个 SDK 引入相当于 ICU 或 Unicode 表的依赖，
而且仍然无法决定
哪种形式（NFC 还是 NFKC）胜出。关心
同形字攻击防护的应用必须（MUST）在把值交给规范化器**之前**规范化其字符串
（NFC 是线上 JSON 交换的惯例选择 — RFC 8259 § 8.1）。

未来的配置文件（`dcp-jcs-v2` 或更高版本）可以（MAY）固定一种规范化形式；
该决定将放在其自己的配置文件文档中。

> 关于 `NaN` / `±Infinity` 的说明：这些值不属于 RFC 8259 的 JSON
> 格式。大多数 JSON 解析器在解析时就会拒绝它们，因此
> 规范化器永远看不到它们。在接受它们的解析器中
> （例如默认就接受它们的 Python `json.loads("NaN")`，或在 JavaScript 中手工构造的
> 值），规则 4 仍会在解析后拒绝它们。互操作测试数据
> 刻意没有提供 NaN/Infinity 向量，因为没有任何可移植的 JSON 语法能表达它们；
> 拒绝行为由各 SDK 的单元测试验证（例如 `sdks/rust/src/v2/canonicalize.rs` 的 `test_rejects_non_finite`）。

---

<a id="3-edge-case-acceptance-table"></a>

## 3. 边界用例接受表

这些是在配置文件正式确定之前各 SDK 之间存在分歧的用例。
符合该配置文件的 SDK 必须（MUST）与此表的每个单元格一致。

| 输入（JSON 字面量） | 输出 | 说明 |
|---|---|---|
| `null` | `null` | 规则 5 |
| `true` | `true` | 规则 7 |
| `false` | `false` | 规则 7 |
| `0` | `0` | 规则 4 |
| `-0` | `0` | 规则 4，符号规范化 |
| `1` | `1` | 规则 4 |
| `1.0` | `1` | 规则 4，整数值的浮点数 |
| `1.00` | `1` | 规则 4，末尾零 |
| `1e2` | `100` | 规则 4，整数值的科学记数法 |
| `100` | `100` | 规则 4 |
| `-42` | `-42` | 规则 4 |
| `0.1` | ERROR | 规则 4，小数值 |
| `1.5` | ERROR | 规则 4，小数值 |
| `1.0e-1` | ERROR | 规则 4，小数值 |
| `NaN` | ERROR | 规则 4，非有限值 |
| `Infinity` | ERROR | 规则 4，非有限值 |
| `{}` | `{}` | 规则 8 |
| `[]` | `[]` | 规则 8 |
| `{"x": null, "y": 1}` | `{"x":null,"y":1}` | 规则 5 |
| `[1, null, 3]` | `[1,null,3]` | 规则 5 |
| `{"é": 1, "e": 2, "z": 3}` | `{"e":2,"z":3,"é":1}` | 规则 1，码点排序 |
| `{"a": {"b": {"c": 42}}}` | `{"a":{"b":{"c":42}}}` | 规则 1，递归 |
| `{"ﬁ": 1, "😀": 2, "a": 3}` | `{"a":3,"ﬁ":1,"😀":2}` | 规则 1，码点排序：U+FB01 < U+1F600（按 UTF-16 码元排序会把表情符号放在前面） |
| `{"s": "<a href='/x?y=1&z=2'>"}` | `{"s":"<a href='/x?y=1&z=2'>"}` | 规则 3，`<`、`>` 和 `&` 不转义 |
| `{"s": "a b c"}` | `{"s":"a` U+2028 `b` U+2029 `c"}`，以未转义的 UTF-8 形式 | 规则 3，行分隔符和段落分隔符不转义 |
| `{"s": "\u0000\u0008\t\n\u000b\f\r\u001f\"\\"}` | `{"s":"\u0000\b\t\n\u000b\f\r\u001f\"\\"}` | 规则 3，RFC 8785 §3.2 的短转义，其他 C0 控制字符使用小写的 `\u00xx` |

---

<a id="4-bundle-manifest-declaration"></a>

## 4. bundle 清单中的声明

在本配置文件下生成的 bundle 应当（SHOULD）在清单中包含一个顶层
`canonicalization_profile` 字段：

```json
{
  "manifest": {
    "canonicalization_profile": "dcp-jcs-v1",
    "session_nonce": "...",
    "rpr_hash": "sha256:...",
    ...
  }
}
```

为了与该配置文件发布之前生成的 bundle 保持向后兼容，该字段是可选的。遇到
没有该字段的 bundle 的验证器必须（MUST）假定为 `dcp-jcs-v1`（因为目前还没有其他
配置文件）。当未来的配置文件（`dcp-jcs-v2` 等）发布时，该字段将
变为必需，以便消除歧义。

该字段已加入 `schemas/v2/bundle_manifest.schema.json`：

```json
"canonicalization_profile": {
  "type": "string",
  "const": "dcp-jcs-v1",
  "description": "Identifier of the canonicalization profile under which this bundle was produced."
}
```

---

<a id="5-versioning"></a>

## 5. 版本管理

本文档定义的配置文件 `dcp-jcs-v1` 已**冻结**：对上述规则的任何
更改都需要新的配置文件标识符。新增配置文件的
治理规则：

- 接受新输入或以不同方式规范化的更改 → 新的
  配置文件（例如 `dcp-jcs-v2`）。
- 只收紧校验（拒绝以前接受的输入）的更改 → 考虑下游验证器能否
  同步升级；如果不能，则需要新的配置文件。
- 只记录现有行为而不改变它的澄清
  → 原地更新，并以相同的配置文件标识记录在 CHANGELOG 中。

当未来的配置文件发布时：

1. 新的配置文件在 `spec/` 中有其自己的文档
   （例如 `CANONICALIZATION_PROFILE_V2.md`）。
2. 各 SDK 在其 README 中发布支持矩阵。
3. bundle 清单的 `canonicalization_profile` 变为必需
   字段，验证器根据其值路由到相应的规范化器。

---

<a id="6-conformance-vectors"></a>

## 6. 一致性向量

共享的 `tests/interop/v2/interop_vectors.json` 文件包含一个
`canonicalization.edge_cases` 块，把第 3 节具体化为一组
测试数据。四个 SDK（TypeScript、Python、Rust、Go）都必须（MUST）通过
该块，才能声称符合该配置文件。

这些向量由各 SDK 的互操作测试使用：

- `sdks/typescript/src/__tests__/interop.test.ts`
- `sdks/python/tests/test_interop.py`
- `sdks/rust/tests/interop.rs`
- `sdks/go/dcp/interop_test.go`

CI 在每个 PR 上并行运行这四者。SDK 之间的分歧
会阻止发布。

---

<a id="7-references"></a>

## 7. 参考资料

- RFC 8785 — JSON Canonicalization Scheme（JCS）— 基础规范。
- RFC 8259 — JSON Data Interchange Format — 线路层语法。
- `spec/DCP-AI-v2.0.md` § 15 — 协议层摘要。
- `schemas/v2/bundle_manifest.schema.json` — 清单字段声明。
- `tests/interop/v2/interop_vectors.json#canonicalization.edge_cases` — 测试数据。

<a id="implementation-notes-informative"></a>

## 实现说明（参考性）

> **2026 年 10 月 25 日添加。非规范性。** 这些说明不增加任何要求，也不改变上文任何内容：它们描述 `main` 上的参考代码
> 与本文的关系。两者不一致时，以上文的规范性文本为准。

- `dcp-jcs-v1` 保持冻结（第 5 节），并且仍是唯一具有规范效力的规范化配置文件和默认配置。
  标识符 `dcp-jcs-v2` 指的是 [docs/proposals/canonicalization-candidate](../../../docs/proposals/canonicalization-candidate/README.md) 中描述的
  非规范候选，带有实验性、需显式启用的 SDK API，没有任何默认路径调用它们。清单 schema 仍把
  `canonicalization_profile` 固定为 `dcp-jcs-v1`，现有的 V2 验证器会拒绝候选标识符。
- 规则 4 是在解析后的值上判定的，因此生产方或验证器规范化的内容取决于其 JSON 解析器。
  对于本配置文件未固定的输入，解析器的行为各不相同：重复的成员名、孤立代理项转义、开头的字节
  顺序标记，以及被 binary64 解析器舍入的数字字面量（例如 `1.0000000000000001` 被读作 `1`）。
  因此，两个解析器可能对同一文本作出不同的规范化；候选提案记录了这些情况。
- 规则 9 下说明中的示例已于 2026 年 10 月 25 日更正：`json.loads` 没有 `allow_nan` 参数（它默认就接受
  `NaN`）；`allow_nan` 属于 `json.dumps`。没有任何规则改变。
