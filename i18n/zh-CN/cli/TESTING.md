<sub>[English](../../../cli/TESTING.md) · **中文** · [Español](../../es/cli/TESTING.md) · [日本語](../../ja/cli/TESTING.md) · [Português](../../pt-BR/cli/TESTING.md)</sub>

<a id="testing-dcp-aicli"></a>

# 测试 `@dcp-ai/cli`

> 本文是[英文版](../../../cli/TESTING.md)的参考译文，更新于 10/11/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

CLI 2.2.0 需要 `@dcp-ai/sdk` `^2.4.0`。本仓库测试有意使用从同一检出代码构建的 SDK，以在发布前覆盖源码变更。

```bash
cd sdks/typescript && npm install && npm run build
cd ../../cli
npm install --no-save --package-lock=false --ignore-scripts --install-links ../sdks/typescript
npm test                        # the four suites
npm run test:negative-control   # must print "failed as required"
```

`--install-links` 会把构建好的 SDK 复制到 `cli/node_modules` 中而不是创建链接，其他标志则保持 `package.json` 和锁文件不变，并且不运行安装脚本。CI 在 `.github/workflows/ci.yml` 的 `cli` 作业中以 Node 20 和 22 做同样的事。该作业不安装仓库根目录，因此不会有任何内容通过根目录的 `node_modules` 解析。

<a id="suites"></a>

## 测试套件

- `__tests__/verify-s-range.test.mjs`：V1 验证、Ed25519 的 S 范围（RFC 8032 §5.1.7）、退出码，以及对历史 V2 格式的拒绝。
- `__tests__/verify-ped1.test.mjs`：按冻结语料 `tests/interop/v2/ed25519_ped1_vectors.json` 在 Ed25519 P-ED-1 下进行 V1 验证。
- `__tests__/version.test.mjs`：从另一个工作目录运行时，`--version` 打印 `package.json` 中的版本。
- `__tests__/verify-v2-normative.test.mjs`：使用规范验证器的 V2 bundle（跨 SDK 向量、规范之前的封装、`.dcp` 密钥固定）、`lib/schemas/v2` 中的 schema 副本，以及单独运行的打包文件。其子进程在固定的 `Date.now` 下运行，因此结果不依赖日期。

每个用例都在一个新的临时目录中（其上层没有 `.dcp/`），以子进程运行 `bin/dcp-ai.js`。

<a id="negative-control"></a>

## 阴性对照

设置 `DCP_NEGATIVE_CONTROL=1` 时，每个套件会反转一个阳性用例。`__tests__/negative-control.mjs` 以这种方式运行四个套件。只有当运行以 1 退出、恰好这四个用例失败（各自因断言失败）、其他所有测试都通过且没有被取消或跳过时，它才会通过。任何其他结果都会使它失败，包括无法加载的套件。

参考验证器和 playground 有各自的 S 范围测试（`tools/crypto-s-range.test.mjs`、`tools/playground-s-range.test.mjs`），由 `conformance` 作业运行。

<a id="against-an-installed-package"></a>

## 针对已安装的包运行

设置 `DCP_CLI_ROOT` 后，同样的四个测试套件和阴性对照会针对已安装的 `@dcp-ai/cli` 运行，而不是本检出中的 `cli/`：

```bash
cd cli
DCP_CLI_ROOT="/path/to/consumer/node_modules/@dcp-ai/cli" npm test
DCP_CLI_ROOT="/path/to/consumer/node_modules/@dcp-ai/cli" npm run test:negative-control
```

此时，二进制文件、`lib/` 和依赖项都取自该已安装的包：`__tests__/cli-under-test.mjs` 从该包解析它们，并拒绝位于本检出内的路径或依赖项。测试夹具和预期结果仍使用本检出中的文件。有两个用例会相应调整：独立副本用例从该包所安装到的 `node_modules` 目录取得依赖项；打包测试改为检查这两个文件是否存在于已安装的包中，而不再查询 `npm pack --dry-run`，因为后者描述的是源码树。不设置该变量时，一切照旧。[发布验证](../../../tools/release-validation/README.md)即以这种方式针对已发布的包运行这些套件。
