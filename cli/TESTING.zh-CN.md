<sub>[English](TESTING.md) · **中文** · [Español](TESTING.es.md) · [日本語](TESTING.ja.md) · [Português](TESTING.pt-BR.md)</sub>

<a id="testing-dcp-aicli"></a>

# 测试 `@dcp-ai/cli`

> 本文是[英文版](TESTING.md)的参考译文，更新于 25/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

CLI 需要 `@dcp-ai/sdk` 2.2.0，而它尚未发布到 npm，因此要针对本仓库中构建的 SDK 进行测试。

```bash
cd sdks/typescript && npm install && npm run build
cd ../../cli
npm install --no-save --package-lock=false --ignore-scripts --install-links ../sdks/typescript
npm test                        # both suites
npm run test:negative-control   # must print "failed as required"
```

`--install-links` 会把构建好的 SDK 复制到 `cli/node_modules` 中而不是创建链接，其他标志则保持 `package.json` 和锁文件不变，并且不运行安装脚本。CI 在 `.github/workflows/ci.yml` 的 `cli` 作业中以 Node 20 和 22 做同样的事。该作业不安装仓库根目录，因此不会有任何内容通过根目录的 `node_modules` 解析。

<a id="suites"></a>

## 测试套件

- `__tests__/verify-s-range.test.mjs`：V1 验证、Ed25519 的 S 范围（RFC 8032 §5.1.7）、退出码，以及对历史 V2 格式的拒绝。
- `__tests__/verify-v2-normative.test.mjs`：使用规范验证器的 V2 bundle（跨 SDK 向量、规范之前的封装、`.dcp` 密钥固定）、`lib/schemas/v2` 中的 schema 副本，以及单独运行的打包文件。其子进程在固定的 `Date.now` 下运行，因此结果不依赖日期。

每个用例都在一个新的临时目录中（其上层没有 `.dcp/`），以子进程运行 `bin/dcp-ai.js`。

<a id="negative-control"></a>

## 阴性对照

设置 `DCP_NEGATIVE_CONTROL=1` 时，每个套件会反转一个阳性用例。`__tests__/negative-control.mjs` 以这种方式运行两个套件。只有当运行以 1 退出、恰好这两个用例失败（各自因断言失败）、其他所有测试都通过且没有被取消或跳过时，它才会通过。任何其他结果都会使它失败，包括无法加载的套件。

参考验证器和 playground 有各自的 S 范围测试（`tools/crypto-s-range.test.mjs`、`tools/playground-s-range.test.mjs`），由 `conformance` 作业运行。
