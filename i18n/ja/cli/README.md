<sub>[English](../../../cli/README.md) · [中文](../../zh-CN/cli/README.md) · [Español](../../es/cli/README.md) · **日本語** · [Português](../../pt-BR/cli/README.md)</sub>

# @dcp-ai/cli

> [英語版](../../../cli/README.md)の参考訳です（09/11/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

AI エージェントのための Digital Citizenship Protocol（DCP-AI）のコマンドラインツールです。`dcp-ai verify` は bundle ファイルの署名と構造を確認し、`dcp-init` はエージェント用のディレクトリを準備します。Node.js 18 以降が必要です。

<a id="installation"></a>

## インストール

```bash
npm install -g @dcp-ai/cli@^2.2.0
dcp-ai --version
```

バージョン 2.2.0 は `@dcp-ai/sdk` `^2.4.0` を必要とし、npm が一緒にインストールします。レジストリで利用できるバージョンは[公開済みバージョン](../../../docs/README.md#published-versions)を参照してください。

<a id="commands"></a>

## コマンド

| コマンド | 内容 |
|---|---|
| `dcp-ai verify <bundle.json>` | bundle ファイルを検証します。V2 の bundle は `@dcp-ai/sdk` の規範的な V2 検証器で、V1 のファイルは正準化した bundle に対する Ed25519 署名で検証します |
| `dcp-ai init` | 現在のディレクトリで `dcp-init` ウィザードを実行します |
| `dcp-ai status` | `.dcp/` に見つかった設定を表示します |
| `dcp-ai sign <bundle.json>` | `.dcp/` の鍵で bundle に署名します |
| `dcp-ai info` | プロトコルのバージョンと機能を表示します |
| `dcp-ai --version` | CLI のバージョンとプロトコルのバージョンを表示します |

<a id="verification-and-exit-codes"></a>

## 検証と終了コード

`dcp-ai verify` は、bundle が VALID のとき 0 で終了します。bundle が INVALID のとき、ファイルを読めないか解析できないとき、および規範以前の V2 エンベロープでは 1 で終了します。現在のディレクトリ、続いて各親ディレクトリで `.dcp/` ディレクトリを探します。`.dcp/keys/ed25519_public.key` の鍵は期待する署名者を固定し、それがない場合、鍵は bundle 自身から取られます。

VALID は署名と構造だけについての結果です。プリンシパルが信頼できることを示すものではなく、信頼セットやプロファイルによるアドミッションの判断でもなく、どのアクションも認可しません。それらはアプリケーションの別の手順です（[ADMISSION.md](../docs/ADMISSION.md)を参照）。

<a id="ed25519-p-ed-1-in-220"></a>

## 2.2.0 における Ed25519 P-ED-1

`dcp-ai verify` は、S ≥ L の署名に加えて、公開鍵や R が正準なエンコーディングでない、または位数が 8 を割り切る点である Ed25519 署名も拒否し、INVALID を表示して 1 で終了します。失敗する証拠はそのまま保管してください。鍵が P-ED-1 を満たす場合は同じ鍵で署名し直し、正準でない公開鍵はローテーションし、小さい位数の鍵は置き換えてください。[変更履歴](../../../CHANGELOG.md#unreleased)と[暗号プロファイル](../spec/profiles/crypto/README.md)を参照してください。

<a id="limits"></a>

## 制限

- CLI はアドミッション、委任状チェーン、アクティベーションを実行せず、どのアクションも認可しません。
- `dcp-ai init` と `dcp-ai sign` は、現在のディレクトリの `.dcp/` に秘密鍵を保存します。このディレクトリはバージョン管理から外し、共有の場所に置かないでください。
- [TESTING.md](TESTING.md) は、リポジトリが同じチェックアウトからビルドした SDK に対して CLI をどうテストするかを説明しています。
