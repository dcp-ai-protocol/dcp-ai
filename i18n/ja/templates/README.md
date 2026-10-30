<sub>[English](../../../templates/README.md) · [中文](../../zh-CN/templates/README.md) · [Español](../../es/templates/README.md) · **日本語** · [Português](../../pt-BR/templates/README.md)</sub>

<a id="templates"></a>

# テンプレート

> [英語版](../../../templates/README.md)の参考訳です（25/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

一般的な AI のフレームワークと Web サーバーの中で DCP がどこに入るかを順にたどる、スターターのテンプレートです。アイデンティティ、意図の宣言、ポリシーによる制御、監査の記録、バンドルの封印を扱います。

> **署名するものではなく、手順の説明です。** テンプレートはプレースホルダーの鍵と署名（`«generated»`、`«sig»`）を使います。鍵を生成せず、何にも署名せず、そのバンドルは検証を通りません。Express のテンプレートのミドルウェアはバンドルの構造だけを確認し、署名は確認しません。本当の鍵、署名、検証には、[docs/](../../../docs/README.md) のクイックスタートに従ってください。同じテンプレートは `npm create @dcp-ai/<name>`（`packages/create-*`）としても配布されています。

<a id="available-templates"></a>

## 利用できるテンプレート

| テンプレート | 言語 | 説明 |
|----------|----------|-------------|
| [express/](../../../templates/express/) | Node.js | DCP の構造の確認（署名の検証なし）と発見のエンドポイントを持つ Express のサーバー |
| [openai/](../../../templates/openai/) | Node.js | DCP の意図/ポリシー/監査で包んだ OpenAI の関数呼び出し |
| [langchain/](../../../templates/langchain/) | Node.js | DCP の流れで包んだ LangChain.js 0.3 の呼び出し |
| [crewai/](../../../templates/crewai/) | Python | DCP のパスポートと監査証跡を持つマルチエージェントのクルーのシミュレーション |

<a id="quick-start"></a>

## クイックスタート

各テンプレートは、リポジトリのルートから個別に実行できます（各コマンドはサブシェルで実行されるため、次のコマンドは
再びルートから始まります）。Express のサーバーはフォアグラウンドに留まります。次を実行する前に Ctrl+C で止めてください。

```bash
# Express
(cd templates/express && npm install && npm start)

# OpenAI (requires OPENAI_API_KEY for live calls, simulates without it)
(cd templates/openai && npm install && npm start)

# LangChain (requires OPENAI_API_KEY for live calls, simulates without it)
(cd templates/langchain && npm install && npm start)

# CrewAI (standalone Python)
(cd templates/crewai && python main.py)
```

<a id="dcp-lifecycle"></a>

## DCP のライフサイクル

テンプレート全体で、この概念上の DCP v2.0 の流れを示します。各テンプレートが扱うのはその一部だけです（たとえば Express の
テンプレートは、アイデンティティを作らず、バンドルを封印せず、行動も実行しません）：

1. **セッションの開始** — 256 ビットのセッションの nonce を生成する。二重の鍵ペア（Ed25519 + ML-DSA-65）はプレースホルダー
2. **RPR の作成** — AI エージェントを責任を負う人のプリンシパルに結び付ける
3. **パスポートの発行** — エージェントの能力とリスクティアを宣言する
4. **意図の宣言** — 各行動の前に、エージェントが何をしたいかを宣言する
5. **ポリシーによる制御** — リスクスコアを評価し、approve/escalate/block の判断を得る。テンプレートではこの手順は
   常に `approve` を返すスタブで、Express のテンプレートにはポリシーの手順がなく、バンドルが自己申告した能力だけを
   確認する
6. **行動の実行** — ポリシーが承認した場合にだけ進む
7. **監査の記録** — 行動をハッシュチェーンの監査証跡に記録する
8. **バンドルの封印** — すべてのアーティファクトを、プレースホルダーの複合署名とともに Citizenship Bundle にまとめる

<a id="see-also"></a>

## 関連項目

- [クイックスタートガイド](../../../docs/QUICKSTART.md)
- [API リファレンス](../../../docs/API_REFERENCE.md)
- [移行ガイド（V1 から V2）](../../../docs/MIGRATION_V1_V2.md)
