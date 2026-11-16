<sub>[English](../../../../../integrations/express/examples/README.md) · **中文** · [Español](../../../../es/integrations/express/examples/README.md) · [日本語](../../../../ja/integrations/express/examples/README.md) · [Português](../../../../pt-BR/integrations/express/examples/README.md)</sub>

<a id="examples"></a>

# 示例

> 本文是[英文版](../../../../../integrations/express/examples/README.md)的参考译文，更新于 25/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

两个示例都使用共享的准入向量（`tests/interop/v2/admission_vectors.json`）离线运行：合成的密钥和 bundle、运营方的信任集和
`strict-v1` 配置，以及固定在向量时间的时钟。

从仓库根目录开始，先在子 shell 中构建工作区 SDK，这样接下来的命令仍从该根目录开始：

```bash
(cd sdks/typescript && npm install && npm run build)
cd integrations/express && npm install && npm run build
node examples/strict-v1-body.mjs      # the recommended transport, checked over real HTTP
node examples/strict-v1.mjs           # the shortest strict-v1 setup
```

<a id="strict-v1-bodymjs-the-bundle-in-the-json-body"></a>

## `strict-v1-body.mjs`：放在 JSON 请求体中的 bundle

向 `127.0.0.1` 上的服务器发送真实的 HTTP 请求，检查每个结果，关闭服务器，如果有任何结果不符合预期则以 1 退出。
`--report FILE` 把结果写成 JSON。

| 请求 | 预期结果 |
|---|---|
| 请求体 `signed_bundle` 中受信任的混合 bundle | `200`；路由以 `req.dcpAgent.admission`、`actionAuthorized: false` 运行 |
| 未知委托人的 bundle | `403`、`TRUST_PRINCIPAL_UNKNOWN`；路由不运行 |
| 为另一个验证者签名的 bundle | `403`、`PROFILE_AUDIENCE_MISMATCH` 和 `VERIFICATION_FAILED`；路由不运行 |
| 超出预算的请求体 | 由请求体解析器返回 `413`：中间件、验证、信任和撤销都不会运行 |
| 放在 `X-DCP-Bundle` 中的同一个混合 bundle | 在 Express 看到请求之前由 Node 返回 `431`（仅当 bundle 超过 `http.maxHeaderSize` 时） |

计数器记录每个请求走到了哪一步（Express、请求体解析器之后、信任来源、撤销来源、路由），因此可以表明 `413` 在验证之前就已
停止，而不只是在路由之前。

被准入的 bundle 是**证据**：真实的，并为你信任的委托人签名。它不是执行该行为的许可；`actionAuthorized` 始终为
`false`，请求可以做什么由你自己的授权决定。

<a id="why-the-body"></a>

### 为什么用请求体

混合 V2 bundle 携带 Ed25519 和 ML-DSA-65 的密钥与签名：向量中的基础 bundle 为 32,996 字节（放在
`{"signed_bundle": …}` 中为 33,014 字节）。Node 对一个请求所有请求头合计的默认上限是 16 KiB（`http.maxHeaderSize`），因此
放在 `X-DCP-Bundle` 中的 bundle 会在任何中间件运行之前以 `431` 被拒绝。代理和负载均衡器也有各自的请求头上限。对于能满足
路径上所有上限的 bundle，请求头仍受支持；本示例不会调大 `maxHeaderSize`，你也不应为了容纳混合 bundle 而调大它。

<a id="the-body-budget"></a>

### 请求体预算

`BODY_BUDGET_BYTES`（64 KiB）是本示例的选择，而不是协议的限制：约为其最大 bundle 的两倍。请为你的部署设定自己的预算：

- 测量你接受的最大 bundle。它会随审计轨迹（向量 bundle 中每条条目约 530 字节）和 PQ 检查点增长，请求体中的其他字段也会
  叠加上去。
- 在 `dcpVerify` 之前把预算传给请求体解析器（`express.json({ limit })`），并在服务器前面的每个代理上保持相同或更大的
  上限。
- 任何超出预算的内容都会在验证之前得到 `413`。预算太小会拒绝有效的证据；太大则会让客户端能够迫使服务器解析大的请求体。
