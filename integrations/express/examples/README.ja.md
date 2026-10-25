<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · **日本語** · [Português](README.pt-BR.md)</sub>

<a id="examples"></a>

# 例

> [英語版](README.md)の参考訳です（25/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

どちらも、共有のアドミッションのベクター（`tests/interop/v2/admission_vectors.json`）を使ってオフラインで動きます。
合成した鍵とバンドル、オペレーターの信頼セットと `strict-v1` のプロファイル、そしてベクターの時刻に固定した時計です。

リポジトリのルートから、次のコマンドが引き続きそのルートから始まるよう、まずサブシェルでワークスペースの SDK をビルドします。

```bash
(cd sdks/typescript && npm install && npm run build)
cd integrations/express && npm install && npm run build
node examples/strict-v1-body.mjs      # the recommended transport, checked over real HTTP
node examples/strict-v1.mjs           # the shortest strict-v1 setup
```

<a id="strict-v1-bodymjs-the-bundle-in-the-json-body"></a>

## `strict-v1-body.mjs`：JSON のボディに入れたバンドル

`127.0.0.1` のサーバーに実際の HTTP リクエストを送り、各結果を確認してサーバーを閉じ、想定どおりでない結果があれば 1 で
終了します。`--report FILE` は結果を JSON として書き出します。

| リクエスト | 想定される結果 |
|---|---|
| ボディの `signed_bundle` に入れた、信頼するハイブリッドのバンドル | `200`。ルートは `req.dcpAgent.admission`、`actionAuthorized: false` で実行される |
| 未知のプリンシパルのバンドル | `403`、`TRUST_PRINCIPAL_UNKNOWN`。ルートは実行されない |
| 別の検証者に向けて署名されたバンドル | `403`、`PROFILE_AUDIENCE_MISMATCH` と `VERIFICATION_FAILED`。ルートは実行されない |
| 予算を超えるボディ | ボディのパーサーによる `413`。ミドルウェア、検証、信頼、失効は一切実行されない |
| `X-DCP-Bundle` に入れた同じハイブリッドのバンドル | Express がリクエストを見る前に Node が返す `431`（バンドルが `http.maxHeaderSize` を超える場合のみ） |

カウンターが各リクエストがどこまで進んだか（Express、ボディのパーサーの後、信頼のソース、失効のソース、ルート）を記録する
ため、`413` がルートの前だけでなく、検証の前に止まることが示されます。

アドミッションを通ったバンドルは**証拠**です。本物であり、あなたが信頼するプリンシパルのために署名されています。行動を
実行する許可ではありません。`actionAuthorized` は常に `false` で、リクエストに何を許すかはあなた自身の認可が決めます。

<a id="why-the-body"></a>

### なぜボディなのか

ハイブリッドの V2 のバンドルは、Ed25519 と ML-DSA-65 の鍵と署名を持ちます。ベクターの基本のバンドルは 32,996 バイト
（`{"signed_bundle": …}` では 33,014 バイト）です。Node のリクエストヘッダー全体の既定の上限は 16 KiB
（`http.maxHeaderSize`）なので、`X-DCP-Bundle` に入れたバンドルは、どのミドルウェアが動く前にも `431` で拒否されます。
プロキシやロードバランサーにもそれぞれヘッダーの上限があります。経路上のすべての上限に収まるバンドルについては、ヘッダーも
引き続きサポートされます。この例は `maxHeaderSize` を引き上げませんし、ハイブリッドのバンドルを収めるためにあなたも
そうすべきではありません。

<a id="the-body-budget"></a>

### ボディの予算

`BODY_BUDGET_BYTES`（64 KiB）はこの例での選択であり、プロトコルの上限ではありません。最大のバンドルのおよそ 2 倍です。
あなたのデプロイに合わせて設定してください。

- 受け付ける最大のバンドルを測定してください。監査証跡（ベクターのバンドルの各エントリは約 530 バイト）と PQ
  チェックポイントに応じて大きくなり、リクエストのボディのほかのフィールドもそれに加わります。
- `dcpVerify` の前に、予算をボディのパーサーに渡し（`express.json({ limit })`）、サーバーの前にあるすべてのプロキシで
  同じかそれ以上の上限を保ってください。
- 予算を超えるものはすべて、検証の前に `413` を受け取ります。予算が小さすぎると有効な証拠を拒否し、大きすぎると
  クライアントがサーバーに大きなボディを解析させられるようになります。
