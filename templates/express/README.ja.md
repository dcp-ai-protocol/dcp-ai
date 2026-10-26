<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · **日本語** · [Português](README.pt-BR.md)</sub>

<a id="dcp-ai--express-api-server-template"></a>
<a id="dcp-ai-express-api-server-template"></a>

# DCP-AI + Express の API サーバーのテンプレート

> [英語版](README.md)の参考訳です（25/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

サーバーの中で DCP のバンドルの確認がどこに入るかを示す Express の API です。

> **署名は検証しません。** テンプレートの `verifyBundle` はバンドルの構造（バージョン、マニフェストのフィールド、複合署名の有無、セッションの nonce）だけを確認します。署名は 1 つも検証しないため、偽造または改変されたバンドルが通ってしまいます。ルートと流れを見るために使い、検証器としては使わないでください。バンドルを検証するには、[`@dcp-ai/express`](https://github.com/dcp-ai-protocol/dcp-ai/blob/main/integrations/express/README.md) 2.1.0か SDK の `verifySignedBundleV2` を、[docs/QUICKSTART_EXPRESS.md](https://github.com/dcp-ai-protocol/dcp-ai/blob/main/docs/QUICKSTART_EXPRESS.md) のように使ってください。

<a id="quick-start"></a>

## クイックスタート

1. 依存関係をインストールします：
   ```bash
   npm install
   ```

2. サーバーを起動します：
   ```bash
   node index.js
   ```

テンプレートは `.dcp/` を読まないため、`npx @dcp-ai/cli init` は不要です（また、そのウィザードはデモです：[エージェントの作成](https://github.com/dcp-ai-protocol/dcp-ai/blob/main/docs/AGENT_CREATION_AND_CERTIFICATION.md#cli-wizard-demo-only)）。

<a id="what-this-template-does"></a>

## このテンプレートがすること

- バンドルの**構造**を確認する DCP のミドルウェアを持つ Express の API サーバーを実行する（上記参照）
- エージェントは保護されたルートに届くために Citizenship Bundle を提示する
- 公開のルートと保護されたルートのレートを制限する
- 構造の確認を通ったバンドルが名乗るエージェントを、メモリー上のレジストリに保持する。その `agent_id` と
  能力は自己申告で検証されておらず、レジストリは再起動で失われる
- `/agents/action` は何も実行しない。行動をバンドルが自己申告した能力と照らし合わせ、
  `action_id` を返す
- `/verify`、`/health`、`/agents/*`、`/.well-known/dcp-capabilities.json` を提供する

<a id="endpoints"></a>

## エンドポイント

| メソッド | パス               | 認証     | 説明                               |
|--------|--------------------|----------|------------------------------------|
| GET    | `/health`          | なし     | ヘルスチェック                     |
| POST   | `/verify`          | なし     | DCP のバンドルの構造の確認（署名の検証なし） |
| POST   | `/agents/action`   | DCP      | 模擬的な受領確認：バンドルに対する能力の確認のみで、行動は実行しない（バンドルが必要） |
| GET    | `/agents/registry` | DCP      | 登録されたエージェントを一覧する   |
| GET    | `/.well-known/dcp-capabilities.json` | なし | 能力の発見 |

<a id="files"></a>

## ファイル

- `index.js` — DCP のミドルウェアを持つ Express のサーバー
- `package.json` — 依存関係
