<sub>[English](../../../keys/README.md) · [Español](../../es/keys/README.md) · [Português](../../pt-BR/keys/README.md) · **日本語** · [中文](../../zh-CN/keys/README.md)</sub>

<a id="dcp-key-storage"></a>

# DCP の鍵保管

> [英語版](../../../keys/README.md)の参考訳です。更新日：2026年10月25日。相違がある場合は英語の原文が優先されます。識別子とコードブロック（コメントを含む）は原文のままです。

このディレクトリには、DCP プロトコルのツールが使用する暗号鍵を保存します。

<a id="structure"></a>

## 構成

```
keys/
├── README.md               # This file
├── public_key.txt          # Ed25519 public key (base64) — safe to share
├── secret_key.txt          # Ed25519 secret key (base64) — NEVER commit
├── agent_public_key.txt    # Agent-specific public key (optional)
└── agent_secret_key.txt    # Agent-specific secret key (optional, NEVER commit)
```

<a id="key-generation"></a>

## 鍵の生成

`dcp` はチェックアウトに含まれる参照 CLI（`node bin/dcp.js`）です。ディレクトリを指定しないと `keys/` に書き込みます。**チェックアウトでは、適合性サンプルの検証に使う鍵 `keys/public_key.txt` が上書きされます**（`npm run conformance` と CI がこの鍵を使用します）。別のディレクトリを指定してください。

```bash
# Ed25519 (V1): public_key.txt and secret_key.txt
node bin/dcp.js keygen my-keys

# Hybrid V2 (Ed25519 + ML-DSA-65): ed25519_public_key.txt, ed25519_secret_key.txt, ed25519_kid.txt,
# ml_dsa_65_public_key.txt, ml_dsa_65_secret_key.txt, ml_dsa_65_kid.txt
node bin/dcp.js keygen --hybrid my-keys
```

秘密鍵ファイルはモード `0600` で書き込まれます。V1 コマンドは鍵ファイルを引数として受け取ります（`dcp sign-bundle <bundle.json> <secret_key.txt>`、`dcp verify-bundle <bundle.signed.json> <public_key.txt>`）。`keys/public_key.txt` に対応する秘密鍵はリポジトリに含まれていません。

<a id="security-policy"></a>

## セキュリティポリシー

- **秘密鍵**（`secret_key.txt`、`*_secret*`、`*.pem`、`*.key`）は `.gitignore` によってバージョン管理から除外されます。
- **公開鍵**は参照や検証のためにコミットできます。
- 本番環境では、秘密鍵をファイルシステムではなくハードウェアセキュリティモジュール（HSM）または鍵管理サービスで保管してください。このリポジトリは HSM 連携を提供しません。その保管機能は利用者自身のインフラで用意します。
- V2 ハイブリッド鍵の ML-DSA-65 秘密鍵素材にも同じ除外方針が適用されます。

<a id="key-formats"></a>

## 鍵の形式

| 鍵の種類 | エンコード | サイズ（バイト） |
|----------|----------|-------------|
| Ed25519 公開鍵 | Base64 | 32 |
| Ed25519 秘密鍵 | Base64 | 64（シードの後に公開鍵が続く） |
| ML-DSA-65 公開鍵 | Base64 | 1952 |
| ML-DSA-65 秘密鍵 | Base64 | 4032 |

<a id="deterministic-key-id-kid"></a>

## 決定的な鍵 ID（kid）

V2 の鍵は、アルゴリズムと公開鍵の生バイト列から導出した決定的な `kid` を使用します。

```
kid = hex(SHA-256(UTF8(alg) || 0x00 || raw_public_key))[0:32]
```

これにより、すべての DCP 実装で同じ鍵から常に同じ `kid` が生成されます（`dcp kid <public_key_file> --alg <algorithm>` で計算できます）。
