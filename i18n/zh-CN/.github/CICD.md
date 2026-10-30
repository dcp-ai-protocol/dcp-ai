<sub>[English](../../../.github/CICD.md) · **中文** · [Español](../../es/.github/CICD.md) · [日本語](../../ja/.github/CICD.md) · [Português](../../pt-BR/.github/CICD.md)</sub>

<a id="github-actions--ci"></a>

# GitHub Actions 与 CI

> 本文是[英文版](../../../.github/CICD.md)的参考译文，更新于 25/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

本仓库的 GitHub Actions 和 CI 工作流：`.github/actions/` 中的两个组合 action，以及 `ci.yml` 工作流。

> **本仓库的工作流并没有使用这些 action**（2026 年 10 月 25 日），也没有从其他仓库测试过它们。两者都运行本仓库检出代码中的代码：`verify-bundle` 加载 `lib/verify.js`，后者需要先构建工作区中的 SDK（`sdks/typescript`）；`conformance-test` 运行工作区中的 `tools/conformance.js`，因此只能在本仓库的检出代码中工作。要在你自己的流水线中验证 bundle，请参见[在你的项目中验证 bundle](#verifying-bundles-in-your-project)。

<a id="available-actions"></a>

## 可用的 action

### `verify-bundle`

在 GitHub Actions 工作流中用参考验证器（`lib/verify.js`）验证 DCP Signed Bundle。V1 bundle 会经过 schema、Ed25519 签名、审计链和 Merkle 检查。规范性的 V2 bundle（`schemas/v2/signed_bundle.schema.json`）先经过 schema 校验，再由 `@dcp-ai/sdk` 验证：清单、Ed25519 + ML-DSA-65 复合签名、会话绑定和审计链。

它会安装其运行所在检出代码的根包（`npm install --production`，忽略安装错误），但不会构建工作区中的 SDK，因此请在之前的步骤中构建 `sdks/typescript`。它使用默认策略进行验证：没有策略输入。

只使用可信的字面路径输入：该 action 会把它们插入到 shell 和用 `eval` 求值的 JavaScript 中，而不是作为数据传递。路径中的引号或 shell 语法可能改变命令。不要从不受信任的拉取请求、issue 或构件名称派生这些输入。下面的参考 CLI 示例则把路径作为参数传递。

```yaml
- uses: ./.github/actions/verify-bundle
  with:
    bundle-path: "path/to/signed_bundle.json"
    public-key-path: "keys/public_key.txt"  # Optional
    fail-on-invalid: "true"
    node-version: "20"
```

<a id="inputs"></a>

#### 输入

| 输入 | 必填 | 默认值 | 说明 |
|-------|----------|---------|-------------|
| `bundle-path` | 是 | — | 已签名 bundle 的 JSON 文件路径 |
| `public-key-path` | 否 | — | 预期的 Ed25519 公钥路径。V1：用它验证（否则使用 bundle 中内嵌的密钥）。V2：固定 bundle 的经典签名者 |
| `fail-on-invalid` | 否 | `"true"` | 如果 bundle 无效，则让该步骤失败 |
| `node-version` | 否 | `"20"` | Node.js 版本 |

<a id="outputs"></a>

#### 输出

| 输出 | 说明 |
|--------|-------------|
| `verified` | `"true"` 或 `"false"` |
| `errors` | 验证错误（如有） |

<a id="usage-example"></a>

#### 用法示例

一份面向本仓库检出代码的示意（编写本页时没有运行）：action 和 `lib/verify.js` 来自检出代码，`agent/citizenship_bundle.signed.json`
和 `agent/public_key.txt` 代表由运营方提供的文件。

```yaml
name: Verify Agent Bundle
on: [push]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Build the workspace SDK (the action does not)
        run: (cd sdks/typescript && npm ci && npm run build)

      - name: Verify DCP Bundle
        id: verify
        uses: ./.github/actions/verify-bundle
        with:
          bundle-path: "agent/citizenship_bundle.signed.json"
          public-key-path: "agent/public_key.txt"

      - name: Check result
        run: echo "Verified: ${{ steps.verify.outputs.verified }}"
```

### `conformance-test`

在工作区中运行 `node tools/conformance.js`：即本仓库针对其自身示例的 V1 + V2 符合性测试套件。它只能在本仓库的检出代码中工作，其 `test-dir` 输入不会被使用。

```yaml
- uses: ./.github/actions/conformance-test
  with:
    node-version: "20"
    test-dir: "tests/conformance/examples"
```

<a id="inputs-1"></a>
<a id="inputs_1"></a>

#### 输入

| 输入 | 必填 | 默认值 | 说明 |
|-------|----------|---------|-------------|
| `node-version` | 否 | `"20"` | Node.js 版本 |
| `test-dir` | 否 | `"tests/conformance/examples"` | 该 action 不使用此输入 |

<a id="outputs-1"></a>
<a id="outputs_1"></a>

#### 输出

| 输出 | 说明 |
|--------|-------------|
| `passed` | 是否所有测试都通过 |
| `summary` | 测试摘要 |

<a id="usage-example-1"></a>
<a id="usage-example_1"></a>

#### 用法示例

一份面向本仓库检出代码的示意（编写本页时没有运行）。`tools/conformance.js` 会导入 `@dcp-ai/sdk`，因此要先构建工作区中的
SDK：

```yaml
name: DCP Conformance
on: [push]

jobs:
  conformance:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "20"

      - name: Build the workspace SDK (the action does not)
        run: (cd sdks/typescript && npm ci && npm run build)

      - name: Run Conformance Tests
        id: conform
        uses: ./.github/actions/conformance-test

      - name: Results
        run: echo "${{ steps.conform.outputs.summary }}"
```

<a id="ci-workflow"></a>

## CI 工作流

`ci.yml` 工作流在推送到 `main` 以及针对任何基础分支的拉取请求上运行。一个 `changes` 作业会检测哪些部分发生了变化（`dorny/paths-filter`），然后针对这些部分运行下面的作业：

| 作业 | 运行内容 |
|-----|--------------|
| `conformance` | Node.js 20 和 22：`npm install`、`npm run conformance`、`tools/crypto.js` 和 playground 的 标量 S 的范围测试、`npm run examples:generate:v2`、对 V1 和 V2 示例运行 `dcp verify-bundle`（V2 使用 `hybrid_required`），以及 `dcp integrity` |
| `typescript-sdk` | `sdks/typescript`：`npm install`、`npx tsc --noEmit`、`npm run build`、`npm run test`、覆盖率 |
| `integrations` | `anthropic-mcp`、`express`、`google-a2a`、`openclaw`：构建工作区 SDK、`npm ci`、构建、`vitest run` |
| `cli` | Node.js 20 和 22：构建工作区 SDK、把它安装到 `cli/` 中、CLI 测试及其负向对照，以及对打包文件的检查 |
| `python-sdk` | Python 3.12：`pip install -e ".[dev]"`、带覆盖率的 `pytest` |
| `go-sdk` | 按 `sdks/go/go.mod` 的 Go：`go build ./...`、带覆盖率的 `go test` |
| `rust-sdk` | Rust stable：`cargo build`、`cargo build --features otlp`、覆盖率、`cargo test --all-features`、面向 `wasm32-unknown-unknown` 的测试构建 |
| `wasm-sdk` | Rust stable 和 `wasm-pack`：在 `sdks/wasm` 中运行 `npm run build:wasm`、`npm test` |

其他工作流涵盖规范化候选的矩阵和实验室、合约、差分模糊测试、互操作矩阵、标签以及发布（npm、PyPI、Docker 镜像、集成、模板）。有两个工作流涉及文档，而且都不会自动翻译任何内容：`i18n-sync.yml`（“Documentation and i18n”）在涉及 Markdown 或文档工具的拉取请求和推送到 `main` 时，检查五种语言的覆盖情况、已审阅哈希、结构和链接，运行该关卡的正向和负向对照，并以五种语言构建站点；`docs.yml` 在 `main` 上构建同一站点并部署到 GitHub Pages。

要在本地运行同样的文档检查，请参见 CONTRIBUTING.md 中的 [Documentation and translations](../../../CONTRIBUTING.md#documentation-and-translations)：

```bash
pip install 'mkdocs==1.6.*' 'mkdocs-material==9.5.*' 'pymdown-extensions==10.*'
python3 scripts/docs_i18n.py check
python3 -m unittest discover -s scripts -p 'test_docs*.py' -v
bash scripts/build-docs-site.sh
```

<a id="verifying-bundles-in-your-project"></a>

## 在你的项目中验证 bundle

一份用固定检出代码中的参考 CLI 验证 bundle 的示意（编写本页时没有运行）。`dcp verify-bundle` 在 bundle 验证通过时以 0 退出，否则以非零值退出，并且只读取当前目录下的文件：

```yaml
# .github/workflows/dcp.yml
name: DCP Verification
on: [push, pull_request]

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/checkout@v4
        with:
          repository: dcp-ai-protocol/dcp-ai
          ref: <full commit SHA you have reviewed>
          path: dcp-ai

      - uses: actions/setup-node@v4
        with:
          node-version: "22"

      - name: Build the reference verifier
        run: |
          (cd dcp-ai/sdks/typescript && npm ci && npm run build)
          (cd dcp-ai && npm install)

      - name: Verify the agent's bundle
        run: node dcp-ai/bin/dcp.js verify-bundle --policy hybrid_required my-agent/bundle.signed.json
```

已验证的 bundle 是完整的，并由其列出的密钥签名；如果只想接受来自你所信任的委托人的 bundle，请使用准入（`dcp admit-bundle`，参见 [docs/ADMISSION.md](../../../docs/ADMISSION.md)）。

<a id="license"></a>

## 许可证

Apache-2.0
