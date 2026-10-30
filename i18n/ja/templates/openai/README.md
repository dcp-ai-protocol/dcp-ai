<sub>[English](../../../../templates/openai/README.md) · [中文](../../../zh-CN/templates/openai/README.md) · [Español](../../../es/templates/openai/README.md) · **日本語** · [Português](../../../pt-BR/templates/openai/README.md)</sub>

<a id="dcp-ai--openai-function-calling-template"></a>
<a id="dcp-ai-openai-function-calling-template"></a>

# DCP-AI + OpenAI の関数呼び出しのテンプレート

> [英語版](../../../../templates/openai/README.md)の参考訳です（25/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

OpenAI の関数呼び出しの周りの DCP の流れを順にたどります。

> **署名するものではなく、手順の説明です。** `index.js` の鍵と署名はプレースホルダー（`«generated»`、`«sig»`）です。テンプレートは DCP v2.0 の流れの形を示しますが、鍵を生成せず、何にも署名せず、そのバンドルは検証を通りません。`.dcp/` からは何も読みません。本当の鍵と署名には、[docs/QUICKSTART_OPENAI.md](https://github.com/dcp-ai-protocol/dcp-ai/blob/main/docs/QUICKSTART_OPENAI.md) に従ってください。

<a id="quick-start"></a>

## クイックスタート

1. 依存関係をインストールします：
   ```bash
   npm install
   ```

2. 実行します。`OPENAI_API_KEY` があれば、テンプレートは OpenAI の API を呼びます（OpenAI から課金されます）。その最初の呼び出しが何らかの理由（キーがない、ネットワーク、クォータ、モデル）で失敗すると、シミュレートした関数呼び出しに切り替わります。キーがないという出力メッセージは原因を診断するものではありません。キーはコマンドではなく環境に設定してください：
   ```bash
   node index.js
   ```

<a id="what-this-template-does"></a>

## このテンプレートがすること

- DCP を意識したツールを OpenAI の関数として登録する
- 各関数呼び出しは実行の前に DCP の Intent を作る。ポリシーの手順は常に `approve`
  （リスク 120）を返すスタブなので、"blocked by policy" の分岐には到達しない
- ツール（`lookupWeather`、`sendEmail`、`searchWeb`）は、モデルを実際に呼んだ場合でも常に模擬のデータを返す。
  その結果と監査エントリーは、外部の行動が行われたことを示さない
- すべての応答に、直前のものとハッシュチェーンでつながった監査エントリーが付く
- 会話の後に、プレースホルダーの署名を持つ Citizenship Bundle が出力される

<a id="files"></a>

## ファイル

- `index.js` — DCP の流れを伴う OpenAI の関数呼び出し
- `package.json` — 依存関係
