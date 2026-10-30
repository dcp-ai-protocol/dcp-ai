<sub>[English](../../../keys/README.md) · [Español](../../es/keys/README.md) · [Português](../../pt-BR/keys/README.md) · [日本語](../../ja/keys/README.md) · **中文**</sub>

<a id="dcp-key-storage"></a>

# DCP 密钥存储

> 本文是[英文版本](../../../keys/README.md)的参考译文，更新于2026年10月25日。如有差异，以英文原文为准。标识符和代码块（包括注释）均保留原文。

此目录存储 DCP 协议工具使用的密码学密钥。

<a id="structure"></a>

## 目录结构

```
keys/
├── README.md               # This file
├── public_key.txt          # Ed25519 public key (base64) — safe to share
├── secret_key.txt          # Ed25519 secret key (base64) — NEVER commit
├── agent_public_key.txt    # Agent-specific public key (optional)
└── agent_secret_key.txt    # Agent-specific secret key (optional, NEVER commit)
```

<a id="key-generation"></a>

## 生成密钥

`dcp` 是检出副本中的参考 CLI（`node bin/dcp.js`）。不指定目录时，它会写入 `keys/`；**在检出副本中，这会覆盖 `keys/public_key.txt`，而该密钥用于验证一致性示例**（`npm run conformance` 和 CI 都会使用它）。请指定其他目录：

```bash
# Ed25519 (V1): public_key.txt and secret_key.txt
node bin/dcp.js keygen my-keys

# Hybrid V2 (Ed25519 + ML-DSA-65): ed25519_public_key.txt, ed25519_secret_key.txt, ed25519_kid.txt,
# ml_dsa_65_public_key.txt, ml_dsa_65_secret_key.txt, ml_dsa_65_kid.txt
node bin/dcp.js keygen --hybrid my-keys
```

秘密密钥文件以 `0600` 模式写入。V1 命令以密钥文件为参数（`dcp sign-bundle <bundle.json> <secret_key.txt>`、`dcp verify-bundle <bundle.signed.json> <public_key.txt>`）。与 `keys/public_key.txt` 对应的秘密密钥不在仓库中。

<a id="security-policy"></a>

## 安全策略

- **私钥**（`secret_key.txt`、`*_secret*`、`*.pem`、`*.key`）通过 `.gitignore` 排除在版本控制之外。
- **公钥**可以提交到仓库，用于参考和验证。
- 在生产环境中，请将秘密密钥保存在硬件安全模块（HSM）或密钥管理服务中，而不是文件系统中。本仓库不提供 HSM 集成：这种密钥托管能力来自你自己的基础设施。
- V2 混合密钥中的 ML-DSA-65 秘密密钥材料遵循相同的排除策略。

<a id="key-formats"></a>

## 密钥格式

| 密钥类型 | 编码 | 大小（字节） |
|----------|----------|-------------|
| Ed25519 公钥 | Base64 | 32 |
| Ed25519 秘密密钥 | Base64 | 64（种子后接公钥） |
| ML-DSA-65 公钥 | Base64 | 1952 |
| ML-DSA-65 秘密密钥 | Base64 | 4032 |

<a id="deterministic-key-id-kid"></a>

## 确定性密钥 ID（kid）

V2 密钥使用从算法和原始公钥字节派生的确定性 `kid`：

```
kid = hex(SHA-256(UTF8(alg) || 0x00 || raw_public_key))[0:32]
```

这确保同一个密钥在所有 DCP 实现中始终生成同一个 `kid`（使用 `dcp kid <public_key_file> --alg <algorithm>` 计算）。
