<sub>[English](README.md) · [中文](README.zh-CN.md) · [Español](README.es.md) · **日本語** · [Português](README.pt-BR.md)</sub>

<a id="canonicalization-lab"></a>

# 正規化のラボ

> [英語版](README.md)の参考訳です（25/10/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

規範的ではない候補 `dcp-jcs-v2` の実行可能な**設計モデル**と、そのコーパスの生成器と
ランナーです。SDK でも、検証器でも、適合性の確認でもありません。合成のコミットメントのために SHA-256 を計算しますが、
何にも署名せず、どの署名も検証しません。そして `dcp-jcs-v1` は、唯一の規範的かつ既定の正規化のプロファイルのままです
（SDK の候補の API は実験的でオプトインです。[CI](#ci) を参照）。
設計、規則、そしてモデルが示すことと示さないことは [`docs/proposals/canonicalization-candidate/README.md`](../../docs/proposals/canonicalization-candidate/README.md) にあります。

| ファイル | 役割 |
|---|---|
| `model.py` | 設計モデル（`run.py` だけがインポートする）。実行時の動作は承認されたモデルのもので、docstring は公開の経路と、想定する最後の重複の規則を明確にする |
| `generate_corpus.py` | `docs/proposals/canonicalization-candidate/corpus.json` を書く。期待値は手で書かれ、モデルを決してインポートしない |
| `run.py` | 完全性、新しさ、妥当性、網羅性の確認、274 のケース、24 のネガティブコントロール |

Linux または macOS 上の Python 3.9 以降（Windows はサポートしません）で、標準ライブラリだけを使います。コマンドは
チェックアウトのルートから実行します。ほかのディレクトリからは、スクリプトに絶対パスを与えてください。出力は
新しい一時ディレクトリに出ます。ランナーは既存の出力のパスも拒否します。

```bash
out=$(mktemp -d)
python3 -I tools/canonicalization-lab/generate_corpus.py "$out/corpus.json"
cmp "$out/corpus.json" docs/proposals/canonicalization-candidate/corpus.json
python3 tools/canonicalization-lab/run.py --out "$out/run.json"
python3 tools/canonicalization-lab/run.py --controls --out "$out/controls.json"
```

## CI

[`.github/workflows/canonicalization-lab.yml`](../../.github/workflows/canonicalization-lab.yml) は、同じ
コマンドを、Ubuntu 上で Python 3.9（文書化された最低バージョン）と 3.12 により、標準ライブラリだけで、`main` への
プッシュと、ワークフロー、このディレクトリ、または `docs/proposals/canonicalization-candidate/` を変更するプルリクエストで
実行します。各ジョブは新しい一時ディレクトリに書き、コーパスを再生成してバイト単位で比較し、
274 のケースと 24 のネガティブコントロールを実行し、両方の件数を確認します。どの失敗もジョブを失敗させます。

確認するのは**設計モデル**だけです。SDK の適合性ではありません。SDK のオプトインの候補の API（未公開）は、
それぞれのテストスイートと[フェーズ 4 のマトリクス](../../tests/interop/candidate/phase4/README.md)でテストされます。どの
プロファイルも既定の検証器も候補を実行せず、`dcp-jcs-v1` は変わりません。緑の実行は、
モデル、コーパス、その期待値が一致していることを示すだけで、どの実装についても何も示しません。
