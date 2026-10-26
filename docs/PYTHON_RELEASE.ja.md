<a id="published-python-package"></a>

# 公開済み Python パッケージ

**Go の公開 (26/10/2026).** Go SDK `v2.11.0` はモジュールタグ `sdks/go/v2.11.0` から利用でき、検証器の修正、受け入れ、実験的なオプトイン API を含みます。Rust の公開は別です。参照： [Go v2.11.0](GO_RELEASE.md).

> [英語版](PYTHON_RELEASE.md)の参考訳。26/10/2026 更新。相違がある場合は英語版が優先されます。

26/10/2026 確認：[`dcp-ai` 2.10.0](https://pypi.org/project/dcp-ai/2.10.0/) は PyPI で公開済みです。Python パッケージのバージョンは DCP のワイヤー形式・仕様バージョンとは独立しています。今回 Go、Rust、npm パッケージ、コンテナーは公開していません。

<a id="install"></a>

## インストール

Python 3.10 以降が必要です。環境またはロックファイルを更新してください。任意の統合 extras はプロトコルのコアから分離されています。

```bash
pip install --upgrade "dcp-ai>=2.10.0,<3"
pip install "dcp-ai[fastapi]>=2.10.0,<3"
pip install "dcp-ai[langchain]>=2.10.0,<3"
pip install "dcp-ai[openai]>=2.10.0,<3"
pip install "dcp-ai[crewai]>=2.10.0,<3"
pip install "dcp-ai[otlp]>=2.10.0,<3"
```

<a id="what-changed"></a>

## 変更点

V2 検証器の修正、プリンシパルの信頼と `strict-v1`、オプトインのソース期限・容量、FastAPI の本文予算と切断処理、ブリッジ検証の修正、実験的な正規化 API を含みます。また Python 3.10 の失効リスト worker 待機におけるキャンセル競合を修正します。リクエストをキャンセルしても worker が終了する前に枠を解放してはいけません。

2.9.0 の FastAPI は署名を検証せず構造が正しい V2 バンドルを受け入れます。V2 検証に使う前に 2.10.0 に更新してください。[SECURITY](../SECURITY.md)、[受け入れ判定](ADMISSION.md)、[Python SDK README](../sdks/python/README.md) を参照してください。

<a id="compatibility-and-verification"></a>

## 互換性と検証

`dcp-jcs-v1` が唯一の規範的な既定値です。`dcp-jcs-v2` は引き続き実験的・非規範的で、明示的なオプトインが必要です。検証、信頼、受け入れ、認可は別であり、インストールだけで信頼ポリシーは設定されません。厳密化により 2.9.0 が受け入れた証拠を拒否する場合があります。過去の証拠は書き換えず保存してください。

インストール済み wheel は Python 3.12 で 1,866 件、ソース配布は Python 3.10 で 1,863 件のテストに合格しました。後者の 3 件のスキップは Python 3.12 専用タスクファクトリーです。両配布はメタデータ検査に合格し、59 個すべての Python ソースモジュールが一致しました。CI は Python 3.10 と 3.12 を対象にします。

ML-DSA 依存関係は、回数制限のある署名試行を使い切ると `ValueError` を返す場合があります。CI fixture が署名生成時にこのエラーに遭遇しましたが、検証を迂回したわけではありません。呼び出し側は失敗をエラーとして扱い、署名済み証拠として扱ってはいけません。
