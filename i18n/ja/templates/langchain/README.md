<sub>[English](../../../../templates/langchain/README.md) · [中文](../../../zh-CN/templates/langchain/README.md) · [Español](../../../es/templates/langchain/README.md) · **日本語** · [Português](../../../pt-BR/templates/langchain/README.md)</sub>

<a id="dcp-ai--langchain-template"></a>
<a id="dcp-ai-langchain-template"></a>

# DCP-AI + LangChain のテンプレート

> [英語版](../../../../templates/langchain/README.md)の参考訳です（25/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

LangChain の呼び出しの周りの DCP の流れを順にたどります。

> **署名するものではなく、手順の説明です。** `index.js` の鍵と署名はプレースホルダー（`«generated»`、`«sig»`）です。テンプレートは DCP v2.0 の流れの形を示しますが、鍵を生成せず、何にも署名せず、そのバンドルは検証を通りません。`.dcp/` からは何も読みません。本当の鍵と署名には、[docs/QUICKSTART_LANGCHAIN.md](https://github.com/dcp-ai-protocol/dcp-ai/blob/main/docs/QUICKSTART_LANGCHAIN.md) に従ってください。

テンプレートは LangChain.js 0.3（`langchain` と `@langchain/openai` `^0.3.0`）に固定しています。ガイドは現在の LangChain.js v1 の API を示します。

<a id="quick-start"></a>

## クイックスタート

1. 依存関係をインストールします：
   ```bash
   npm install
   ```

2. 実行します。`OPENAI_API_KEY` があれば、テンプレートは OpenAI の API を呼びます（OpenAI から課金されます）。呼び出しが何らかの理由（キーがない、ネットワーク、クォータ、モデル）で失敗すると、模擬の応答を表示し、それでも `outcome: "success"` を記録するため、監査エントリーは呼び出しが成功したことを示しません。キーは環境に設定してください：
   ```bash
   node index.js
   ```

<a id="what-this-template-does"></a>

## このテンプレートがすること

- LangChain の呼び出しを DCP の流れで包む
- すべての行動は Intent として宣言される。ポリシーの手順は常に `approve`（リスク 50）を返すスタブなので、
  エスカレートとブロックの分岐は流れを示すだけで、到達しない
- すべての応答に監査エントリーが付く
- エージェントの Citizenship Bundle はプレースホルダーの署名を持つ

<a id="files"></a>

## ファイル

- `index.js` — DCP の流れを伴う LangChain の呼び出し
- `package.json` — 依存関係
