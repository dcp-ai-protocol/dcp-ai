<sub>[English](../../../docs/OPERATIONAL_LIMITS.md) · **中文** · [Español](../../es/docs/OPERATIONAL_LIMITS.md) · [日本語](../../ja/docs/OPERATIONAL_LIMITS.md) · [Português](../../pt-BR/docs/OPERATIONAL_LIMITS.md)</sub>

<a id="operational-limits"></a>

# 运行限制

> 本文是[英文版](../../../docs/OPERATIONAL_LIMITS.md)的参考译文，更新于 08/11/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

本文说明 TypeScript、Python、Go 和 Rust SDK 以及 Express 和 FastAPI 适配器中，什么在限制输入、信任来源与撤销来源、并发、客户端断开和判定缓存，以及你作为运营方需要设置什么。本文描述的是本仓库中的源码；已发布的软件包包含其自身版本所包含的内容（参见[已发布的版本](../../../docs/README.md#published-versions)）。

本页不改变线格式、`dcp-jcs-v1`、任何配置或签名。设定限制的有四层，彼此分开：

- **协议**规定每个字段的长度以及 strict-v1 的新鲜度窗口。
- **SDK** 负责验证、准入与组合。这些 API 不接受截止时间，也不接受取消信号；Python 的拒绝列表辅助函数有自己的下载截止时间，与密码学处理分开。
- **适配器**增加预算、截止时间、容量和取消，全部为可选启用（opt-in）。
- **你**选择这些值、租户、速率限制以及部署在它们前面的基础设施。

文末的[示例配置](#a-sample-configuration)只是一个起点，既不是默认值，也不是规则。

<a id="who-sets-what"></a>

## 谁设定什么

| 限制 | 来源 |
|---|---|
| strict-v1 的会话时长和撤销快照的时效：最多 300 秒 | [准入配置](../../../docs/ADMISSION.md#the-strict-v1-profile)（规范性） |
| `sig_b64` 最多 66 476 个字符，公钥最多 3456 个，`intended_verifier` 最多 256 个 | V2 模式（规范性，按字段） |
| 审计条目、PQ 检查点、密钥、受信任的委托人、拒绝列表条目、链中的授权书、委托方 bundle 的数量 | 模式和 SDK 都没有上限：只受你允许进入的内容限制。验证成本随它们增长 |
| 嵌套深度 | 没有统一的预算。各运行时的解析器和调用栈在各自的层级拒绝；可选启用的 `admitSignedBundleV2FromBytes` 拒绝超过 64 层的输入 |
| 请求体 | Express：你的请求体解析器的 `limit`。FastAPI：`max_body_bytes`，可选启用，默认不设置。参考服务器：1 MiB |
| 放在请求头中的 bundle | 你的服务器以及每个代理的请求头限制（Node 默认 16 KiB）；`max_body_bytes` 不覆盖请求头 |
| 拒绝列表的下载 | 拒绝列表辅助函数：最多 16 MiB，不跟随重定向，截止时间由你设定 |
| 来源的截止时间和容量 | 来源监管器，可选启用，没有默认容量 |
| Express 的判定缓存 | 默认关闭（`cacheTtlSeconds` 为 0）；开启时最多 `cacheMaxEntries` 条（默认 1000） |
| 租户 | 你自己的身份认证，绝不能是客户端选择的请求头 |
| 请求速率 | 由你决定（Express 示例使用 `express-rate-limit`） |

<a id="inputs"></a>

## 输入

- **请在请求体中发送 bundle**，并设置一个在解析前检查的请求体预算。一个带有混合签名的典型 V2 bundle 超过 Node 默认的请求头限制。
- **请求体预算是由你设定的输入预算。** 每个签名、审计条目和 PQ 检查点都会增加工作量，而模式并不限制它们的数量。它与你接受的数量、你的验证策略以及你在适配器之外允许的 CPU 和并发一起，限制单个请求能带来的工作量。它不是 CPU 截止时间，也不限制你的代码用在 HTTP 之外构造的对象去调用的 API。请按你预期的 bundle 来确定它，而不是按最大可能的 bundle。
- **深度。** 在当前代码以及维护者的本地样本中，嵌套深度超过运行时能处理的请求体被拒绝而未被准入，但两个适配器拒绝的位置不同：Express 报告验证失败（`Malformed signed bundle: Maximum call stack size exceeded`）；FastAPI 因为无法把请求体读成 JSON，返回 403 `Missing DCP signed bundle`。深度限制因运行时而异，不属于协议。

<a id="trust-and-revocation-sources"></a>

## 信任来源与撤销来源

当某个来源很慢或一直不响应时，有四种彼此不同的动作。适配器能做前三种；只有来源自己能做第四种。

1. **停止等待。** 请求得到一个失败的响应。
2. **拒绝迟到的结果。** 在截止时间之后到达的值永远不会被使用。
3. **请求取消。** 中止 `AbortSignal`（Express），或取消任务（FastAPI）。
4. **停止工作。** 只有配合的来源才会这样做。

**使用来源监管器时**（`sourceSupervisor` 和 `supervise`，或 `source_supervisor` 和 `supervise`）：

- 未及时响应的信任来源得到 503，撤销来源得到 403 `REVOCATION_UNAVAILABLE`。
- 迟到的结果永远不会被使用。
- 截止时间用单调时钟计量，但只有在事件循环空闲时才会触发：CPU 繁忙或来源阻塞了事件循环，都会推迟响应。
- 监管器会统计它所拥有的调用，直到该调用真正结束。忽略取消的来源在响应之后仍然占用它的槽位，直到它结束。
- 来源自行启动的工作（线程、进程、它不返回的任务）不会被适配器统计或限制。

**不使用监管器时：**

| 来源 | Express | FastAPI |
|---|---|---|
| 信任 | 没有截止时间：请求会一直等待来源 | 没有截止时间。同步来源在事件循环上运行并阻塞它 |
| 撤销 | `revocationTimeoutMs`：响应会发出，来源继续运行且不被统计 | `revocation_timeout` 使用 `asyncio.wait_for`，它会等待来源完成取消。压制取消的来源会推迟响应，并且它迟到的快照会被使用。同步来源会在自己的线程中继续运行 |

在生产环境中请使用监管器。Express 较早的 `checkRevocation` 选项没有截止时间，也没有大小限制，strict-v1 会拒绝它，它不在本指南的范围内。

**拒绝列表：**

- **TypeScript。** Express 的辅助函数 `denyListRevocationSource` 会在其截止时间到达时，或收到监管器的信号时中止下载，读取响应体的过程中也是如此。
- **Python。** 辅助函数 `deny_list_revocation_source` 在两次读取之间检查截止时间，因此不限制 DNS 解析，也不限制缓慢发送的状态行和响应头。请给它一个 `DenyListWorkers` 预算：它限制下载线程，这是与监管器槽位分开的另一份预留。`DenyListWorkers` 统计一次下载，直到它的 fetch 返回；之后它的线程可能还要片刻才能结束。
- **Go 和 Rust** 没有拒绝列表来源：由你构建撤销快照并把它传给准入。

拒绝列表辅助函数每次被调用都会重新下载列表（在撤销阶段之前就被拒绝的请求不会下载）。一个大列表被许多请求同时下载时，会为每个请求占用缓冲区和对象：请保持列表很小。如果你从自己的缓存中提供快照，请按租户分开，并保持在配置的新鲜度窗口之内：准入规则不会改变。

<a id="concurrency-and-tenants"></a>

## 并发与租户

- **容量属于监管器对象，而不是进程。** 共享同一个监管器才能共享同一份容量。同一个请求的信任来源和撤销来源从同一个监管器中占用槽位。
- **哪个阶段先拒绝，取决于监管了什么。** 当 `trustedPrincipals` 函数处于监管之下时（例如同时监管两个来源的示例配置），请求首先需要一个信任槽位：只要槽位被信任调用或撤销调用占满，新请求就会在调用任何来源之前，于信任阶段以 503 被拒绝。如果信任集是静态的，且只监管撤销来源，就没有信任槽位可占，没有空闲槽位的请求会在撤销阶段以 403 `REVOCATION_UNAVAILABLE` 被拒绝。
- **没有 `maxInFlightPerTenant` / `max_in_flight_per_tenant`，租户之间就没有隔离：** 一个租户可以占满所有槽位。
- **租户必须来自你的身份认证。** 绝不能从客户端设置的请求头中获取。
- **验证会占用 CPU。** 在 TypeScript 和 Python 中它运行在事件循环上；在 Go 和 Rust 中，运行在调用方的线程中。有并发时，请求会排队等待验证。容量限制的是来源，而不是 CPU 或 HTTP 并发：请用你的速率限制、工作进程和基础设施来限制它们。

<a id="client-disconnection"></a>

## 客户端断开

使用 `cancelOnDisconnect`（Express）或 `cancel_on_disconnect`（FastAPI，还需要 `max_body_bytes`）时：

- **什么算离开。** 当响应在发送之前被关闭，或上传被中途切断时，客户端才算真正离开。Express 不会把请求在接收完请求体之后自身的 `close` 当作离开。
- **会发生什么。** 只有该请求被监管的来源调用会被取消。不会再为该请求做任何事：没有处理函数，没有缓存写入，没有 `onFailure`，也没有响应。
- **不会做什么。** 已经在运行的验证不会被中断。忽略取消的来源会一直占用它的槽位，直到它结束。

<a id="no-cancellation-in-the-sdks"></a>

## SDK 中没有取消

SDK 的任何验证、准入或组合 API（包括委托准入和激活）都不接受截止时间、`AbortSignal` 或 `context.Context`。Python 拒绝列表辅助函数的下载截止时间是另外一回事，不适用于密码学处理：

- TypeScript 和 Python 在事件循环上进行验证。
- Go 和 Rust 是同步的。
- WASM 是同步的。

验证一旦开始就会运行到结束。请用输入预算限制它的成本，并在 SDK 之外限制它的并发。

<a id="the-verdict-cache-express"></a>

## 判定缓存（Express）

- **默认关闭。** 除非你自己的测量证明有必要，否则请保持关闭。
- **准入路径上保存的内容**（`trustedPrincipals`，无论是否使用 strict-v1）：只保存密码学验证的结果，键为哈希；不保存 bundle、快照或任何授权。无论是否命中缓存，每个请求都会评估委托人信任；配置了 `profile` 检查和撤销来源时，它们也会在每个请求上评估。未配置 `profile` 的信任集不会因此获得 strict-v1 的撤销检查。
- **仅验证的路径上**（没有 `trustedPrincipals`），它还会保存提取出的代理及其密钥 ID。信任检查和 `profile` 检查需要准入路径，而那样就不再是仅验证的路径；如果设置了 `checkRevocation`，它会在每个请求上评估。
- **键。** 覆盖规范化后的 bundle、验证策略和租户。
- **过期与淘汰。** 条目随其 TTL、bundle 的会话或其密钥一起过期。缓存满时，淘汰最久未使用的条目。
- **内存。** 进程的内存不只是缓存，bundle 的大小也不会直接变成条目的大小。
- **其他适配器和 SDK。** FastAPI 没有缓存。TypeScript SDK 的 `VerificationCache` 是一个独立的工具，适配器不使用它。

<a id="delegation-in-the-adapters"></a>

## 适配器中的委托

- **委托准入在哪里。** TypeScript、Python、Go 和 Rust SDK 提供委托准入（`admitDelegatedBundleV2` 及其对应 API）、激活（`evaluateDelegationActivationV2`）以及从字节准入（`admitSignedBundleV2FromBytes`）。
- **哪里没有。** WASM 不公开这些 API，两个适配器也都不调用它们。
- **`mandateId` 与 `require_dcp_mandated`。** Express 的 `req.dcpAgent.mandateId` 是从 bundle 的清单中复制的，不验证任何授权链。FastAPI 的 `require_dcp_mandated` 只检查一个中间件对 V2 bundle 从不填写的 `mandate_id`，同样不验证任何授权链。
- **你的应用程序要做什么。** 自己调用 SDK 的 API，限制它接受的证据（链的长度、委托方 bundle 的数量、字节数），并决定授权和重放。

<a id="other-surfaces"></a>

## 其他部分

| 部分 | 限制 |
|---|---|
| OpenClaw（`@dcp-ai/openclaw`） | 与 Express 相同的截止时间、容量和拒绝列表辅助函数。它的输入是宿主已经解析好的对象，没有自己的预算，也没有 `cancelOnDisconnect` |
| 参考服务器（`/v2/admit`） | 请求体最多 1 MiB。套接字空闲 30 秒的超时会返回 408，但不取消正在进行的工作。撤销默认在 5000 毫秒内完成，并中止下载。每次准入都会读取信任文件。状态保存在内存中，只有一个实例。用于复现，而非生产 |
| CLI（`dcp-ai`） | 每个进程调用一次，没有自己的截止时间和预算：必须由调用方施加 |

<a id="a-sample-configuration"></a>

## 示例配置

这是用于试运行适配器的一个试点起点。**它不是默认值，不是对所有部署的建议，也不是协议的一部分。** 请根据你的 bundle、来源和硬件确定每个值。

| 设置 | 示例值 |
|---|---|
| 请求体预算 | 64 KiB（Express 中为解析器的 `limit`；FastAPI 中为 `max_body_bytes=65536`） |
| 传输 | 请求体，而非请求头 |
| 监管器 | 同时 32 个调用，每个租户 8 个 |
| 信任截止时间 | Express：`supervise.trustTimeoutMs: 2000`（毫秒）。FastAPI：`supervise={"trust_timeout": 2.0}`（秒） |
| 撤销截止时间（受监管） | Express：`revocationTimeoutMs: 2000`，并设置 `supervise.revocation: true`。FastAPI：`revocation_timeout=2.0`，并设置 `supervise={"revocation": True}` |
| 拒绝列表下载 | Express 辅助函数：`timeoutMs: 1500`。Python 辅助函数：`timeout=1.5`。位于撤销截止时间之内：它要求下载更早结束，但不保证其工作会结束 |
| Python 同时下载数 | `DenyListWorkers(max_workers=8, max_workers_per_tenant=2)`：统计的是进行中的下载，而不是线程的确切数量 |
| 客户端断开 | 开启 |
| Express 判定缓存 | 关闭 |
| 委托证据（你的应用程序） | 一条链中最多 4 个授权书，每个 bundle 都在请求体预算之内 |

**本页不主张的内容：**

- 你的部署中的容量、延迟或内存数字。
- 不存在内存泄漏。
- 超出各 API 文档范围的证据接受。

请在你自己的环境中进行测量。
