<sub>[English](../../../cli/README.md) · **中文** · [Español](../../es/cli/README.md) · [日本語](../../ja/cli/README.md) · [Português](../../pt-BR/cli/README.md)</sub>

# @dcp-ai/cli

> 本文是[英文版](../../../cli/README.md)的参考译文，更新于 09/11/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

面向 AI 智能体的 Digital Citizenship Protocol（DCP-AI）命令行工具。`dcp-ai verify` 检查 bundle 文件的签名和结构，`dcp-init` 为智能体准备一个目录。需要 Node.js 18 或更高版本。

<a id="installation"></a>

## 安装

```bash
npm install -g @dcp-ai/cli@^2.2.0
dcp-ai --version
```

2.2.0 版本要求 `@dcp-ai/sdk` `^2.4.0`，npm 会一并安装。注册表中可用的版本见[已发布版本](../../../docs/README.md#published-versions)。

<a id="commands"></a>

## 命令

| 命令 | 作用 |
|---|---|
| `dcp-ai verify <bundle.json>` | 验证 bundle 文件：V2 bundle 使用 `@dcp-ai/sdk` 的规范 V2 验证器，V1 文件使用其对规范化 bundle 的 Ed25519 签名 |
| `dcp-ai init` | 在当前目录运行 `dcp-init` 向导 |
| `dcp-ai status` | 显示在 `.dcp/` 中找到的配置 |
| `dcp-ai sign <bundle.json>` | 用 `.dcp/` 中的密钥为 bundle 签名 |
| `dcp-ai info` | 显示协议版本和能力 |
| `dcp-ai --version` | 打印 CLI 版本和协议版本 |

<a id="verification-and-exit-codes"></a>

## 验证与退出码

bundle 为 VALID 时，`dcp-ai verify` 以 0 退出。bundle 为 INVALID、文件无法读取或解析，以及遇到规范之前的 V2 封装时，以 1 退出。它在当前目录及其各级上级目录中查找 `.dcp/` 目录：`.dcp/keys/ed25519_public.key` 中的密钥固定预期的签名者；没有它时，密钥取自 bundle 本身。

VALID 只是关于签名和结构的结果。它不表明委托人可信，不是基于信任集或配置文件的准入决定，也不授权任何操作；这些是应用的单独步骤（参见[ADMISSION.md](../docs/ADMISSION.md)）。

<a id="ed25519-p-ed-1-in-220"></a>

## 2.2.0 中的 Ed25519 P-ED-1

除 S ≥ L 的签名外，`dcp-ai verify` 还会拒绝公钥或 R 不是规范编码、或是阶整除 8 的点的 Ed25519 签名：打印 INVALID 并以 1 退出。请保持验证失败的证据原样；密钥符合 P-ED-1 时用同一密钥重新签名，轮换非规范公钥，替换小阶密钥。参见[变更日志](../../../CHANGELOG.md#unreleased)和[密码学配置文件](../spec/profiles/crypto/README.md)。

<a id="limits"></a>

## 限制

- CLI 不执行准入、委托书链或激活，也不授权任何操作。
- `dcp-ai init` 和 `dcp-ai sign` 将私钥保存在当前目录的 `.dcp/` 中。请让该目录不受版本控制，并远离共享位置。
- [TESTING.md](TESTING.md) 说明仓库如何针对从同一检出代码构建的 SDK 测试 CLI。
