<sub>[English](../../../../../../tests/interop/candidate/phase4/README.md) · [中文](../../../../../zh-CN/tests/interop/candidate/phase4/README.md) · [Español](../../../../../es/tests/interop/candidate/phase4/README.md) · **日本語** · [Português](../../../../../pt-BR/tests/interop/candidate/phase4/README.md)</sub>

<a id="phase-4-matrix-candidate-producers--consumers"></a>
<a id="phase-4-matrix-candidate-producers-consumers"></a>

# フェーズ 4 のマトリクス：候補の生成側 × 利用側

> [英語版](../../../../../../tests/interop/candidate/phase4/README.md)の参考訳です（02/11/2026 更新）。内容が異なる場合は英語版が優先されます。識別子、コマンド、コードブロックは翻訳せずにそのまま掲載しています。

実験的で無効です。これらのテストは、
[候補の README の §18](../../../../../../docs/proposals/canonicalization-candidate/README.md#18-experimental-sdk-producers-phase-4) の証拠です。
`dcp-jcs-v2` を有効にすることも、既定値を変えることもありません。

<a id="files"></a>

## ファイル

| ファイル | 目的 |
|---|---|
| [`run.mjs`](../../../../../../tests/interop/candidate/phase4/run.mjs) | ランナー：マトリクス、`--cost`、`--self-test` |
| [`phase4-specs.json`](../../../../../../tests/interop/candidate/phase4/phase4-specs.json) | 12 の仕様、16 の陰性ケース、期待値 |
| `adapters/ts.mjs`, `adapters/wasm.mjs`, `adapters/py_adapter.py`, `adapters/common.mjs` | TypeScript、WASM、Python のアダプター |
| `sdks/go/dcp/v2/experimental_candidate_phase4_matrix_test.go` | Go のアダプター。ランナーのもとでだけ実行されるテスト |
| `sdks/rust/tests/experimental_candidate_phase4_matrix.rs` | Rust のアダプター。ランナーのもとでだけ実行されるテスト |

<a id="what-a-run-does"></a>

## 1 回の実行がすること

1. TypeScript のアダプターが実行の入力を書きます：
   - 新しい合成の鍵
   - 各仕様の入力の断片を JSON のテキストとして。すべての生成側で同じバイト列です。
2. 各生成側は、各仕様をその仕様が挙げるモード（`S01` から `S10` は bytes と value、`S11` は bytes
   のみ、`S12` は value のみ）で、公開されたオプトインの API を使って署名します。また、
   鍵の ID を導出し、比較のために書き出します。
3. 各生成側はリングを組み立てます。`S01` を、次の生成側が署名したアーティファクトから作ります（ts、py、go、rust、
   wasm、ts）。
4. ランナーは、各生成側の新しい出力から、バイトのレベルの陰性ケースを 16 個書きます。
5. 各利用側はフェーズ 3 の検証器ですべてを検証します。各項目について、経路、
   クラス、入った検証器、判定、過去のデコーダーに対して観測した呼び出しを報告します。

判定は全か無かです。次を期待します：

- ちょうど 975 の結果（115 単位 × 5 の利用側と、バイトレベルの陰性 16 × 5 × 5）：陽性 525 と陰性 450。陰性は
  バイトレベルの 400 と、V2-2 が拒否する `S09` の 50 の結果（下記）。V2-2 以前はすべての単位が陽性で、575 と 400 だった
- すべての手順と、この実行で新たに得た各結果
- 各仕様について、すべての生成側から同じ `manifest_hash`
- すべての生成側から同じ単位。ただし ML-DSA の署名の値は除き、それは既知の
  位置でだけマスクされる
- すべての SDK から同じ鍵の ID
- 実行が期限（`--deadline`、既定は 1800 秒）の前に終わること。期限に達すると、その手順のプロセスグループ全体が
  強制終了される。各手順は独自の POSIX のプロセスグループで切り離されて始まるため、Windows では
  これは約束されない。

<a id="s09-under-v2-2"></a>

### V2-2 のもとでの `S09`

V2-2 は各 SDK の検証器にあるスキーマ検証です。候補の経路では、パーサーとプロファイルのポリシーの後、検証器がペイロードの
ハッシュと署名を確認する前に実行されます。V2-2 は監査エントリー、チェックポイント、`SignedPayload` のエンベロープと
その `composite_sig` を閉じています。`S09` はそのそれぞれに生成側が知らないメンバーを置くため、その 50 の結果
（5 の生成側 × 2 のモード × 5 の利用側）は候補の経路で拒否されます。仕様とそのバイトは変わりません。期待はランナーにあります
（`run.mjs` の `V2_2_CLOSED_MEMBERS`）：

- 経路 `candidate`、検証器 `dcp-jcs-v2` に入る、`verified` は false、クラスなし、デコーダーの呼び出しなし
- すべての SDK が返す次の四つの診断（この順序）：
  - `schema: /bundle/audit_entries/1 additionalProperties x_entry_ext`
  - `schema: /bundle/intent additionalProperties x_artifact_ext`
  - `schema: /bundle/intent/composite_sig additionalProperties x_sig_ext`
  - `schema: /bundle/pq_checkpoints/0 additionalProperties x_checkpoint_ext`

  アダプターは結果の最初の三つのエラーだけを記録するため、マトリクスはその三つを厳密に比較します。各 SDK の生成側のテスト（バンドルの生成）が
  四つすべてを確認しています
- 各拒否は、同じ生成側と同じモードの `S04` の単位（それらのメンバーのないチェックポイント）を同じ利用側が検証した場合にだけ
  数えられる

`S09` が intent の target に加えるメンバーは開いており、診断を生みません。`S09` の結果が一つでも受け入れられるか別の形で拒否
された場合、または他の陽性が一つでも拒否された場合、実行は失敗します。

<a id="running-it"></a>

## 実行の仕方

まずビルドします：`sdks/typescript`（`npm run build`）と `sdks/wasm`（`npm run build:wasm` と `npm run build:ts`）。
Python には SDK の依存関係が必要で、Go と Cargo はインストールされたものを使います。チェックアウトのルートから：

```bash
node tests/interop/candidate/phase4/run.mjs --self-test
DCP_PHASE4_PYTHON=python3 node tests/interop/candidate/phase4/run.mjs --deadline 900
DCP_PHASE4_PYTHON=python3 node tests/interop/candidate/phase4/run.mjs --cost
```

各実行は、システムの一時ディレクトリの下、または `--out <dir>` の下に新しいディレクトリを書きます。そのディレクトリには
鍵、出力、結果、ログ、`summary.json`（または `cost-summary.json`）が入ります。それは実行する人だけの
ものです。鍵は合成のものですが、中のものはどれも公開を意図していません。終了コードは、0 がすべての確認が
通ったこと、1 が何かが失敗したこと、2 が無効な設定（正の数でない `--deadline`）を意味します。

`--cost` は、プラットフォームごとに 1 組の等価な組でゲート 10 を測ります。両側は同じ鍵、ペイロード、セッション、
監査エントリーを使い、それは出力で確認されます。各操作は 3 回のウォームアップの後に 20 回実行され、
プラットフォームごとに最大 60 秒です。Go と Rust のビルドは別に計時され、Rust は release のプロファイルで測られます。
これらの数値の限界は、候補の README の §18.3 にあります。
