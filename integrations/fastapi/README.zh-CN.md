<sub>[English](README.md) · **中文** · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="dcp_aifastapi--fastapi-middleware"></a>
<a id="dcp_aifastapi-fastapi-middleware"></a>

# dcp_ai.fastapi — FastAPI 中间件

> 本文是[英文版](README.md)的参考译文，更新于 26/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

用于 FastAPI 的 DCP 验证中间件。它会自动验证 Signed Bundle，并为受保护的路由提供依赖注入。

<a id="supported-dcp-specifications"></a>

## 支持的 DCP 规范

DCP-01 至 DCP-09，部分支持：下文描述的 bundle 验证和准入，以及 DCP-05 和 DCP-09 的少数字段（`lifecycle_state`、`mandate_id`）。它并不是这些规范的完整实现。

<a id="installation"></a>

## 安装

**已发布到 PyPI（26/10/2026）。** `dcp-ai` 2.10.0 包含本文描述的实现。请从 2.9.0 升级并更新环境或锁定文件。见 [Python 发布说明](../../docs/PYTHON_RELEASE.md)。

2.9.0 不验证 V2 签名，请勿用于 V2 验证。2.10.0 包含修复后的验证器、委托人信任、`strict-v1`、正文预算、信任/吊销来源监管及断开连接处理。准入不授权任何操作。

```bash
pip install "dcp-ai[fastapi]>=2.10.0,<3"
```

源码开发：

```bash
git clone https://github.com/dcp-ai-protocol/dcp-ai.git
pip install -e "/path/to/dcp-ai/sdks/python[fastapi]"
```

<a id="quickstart"></a>

## 快速开始

```python
from fastapi import FastAPI, Depends
from dcp_ai.fastapi import DCPVerifyMiddleware, require_dcp, DCPAgentContext

app = FastAPI()

# Add verification middleware
app.add_middleware(DCPVerifyMiddleware, require_bundle=False)

# Public route (no bundle required)
@app.get("/health")
async def health():
    return {"ok": True}

# Protected route (requires a verified bundle)
@app.post("/api/action")
async def agent_action(agent: DCPAgentContext = Depends(require_dcp)):
    return {
        "agent_id": agent.agent_id,
        "human_id": agent.human_id,
        "capabilities": agent.capabilities,
        "risk_tier": agent.risk_tier,
    }
```

<a id="sending-a-bundle"></a>

### 发送 bundle

混合 V2 bundle 约为 33 KB，超过了大多数服务器和代理的请求头限制，因此请在 JSON 请求体中发送。请求头适用于能满足路径上所有限制的 bundle。下面带请求体的请求是模板：`{...}` 代表一个真实的已签名 bundle。

```bash
# Via header
curl -X POST http://localhost:8000/api/action \
  -H "Content-Type: application/json" \
  -H "x-dcp-bundle: $(cat signed_bundle.json)" \
  -d '{}'

# Via JSON body
curl -X POST http://localhost:8000/api/action \
  -H "Content-Type: application/json" \
  -d '{"signed_bundle": {...}}'
```

<a id="api-reference"></a>

## API 参考

### `DCPVerifyMiddleware`

拦截请求并验证 DCP bundle 的 Starlette/FastAPI 中间件。

```python
app.add_middleware(
    DCPVerifyMiddleware,
    require_bundle=False,       # If True, rejects requests without a bundle
    header_name="x-dcp-bundle", # Header where the bundle is sent
    verifier_policy={"default_mode": "hybrid_required"},  # Optional, over DEFAULT_VERIFIER_POLICY
)
```

<a id="constructor-parameters"></a>

#### 构造函数参数

| 参数 | 类型 | 默认值 | 说明 |
|-----------|------|---------|-------------|
| `app` | `Any` | （必需） | ASGI 应用 |
| `require_bundle` | `bool` | `False` | 以 403 拒绝没有 bundle 的请求 |
| `header_name` | `str` | `"x-dcp-bundle"` | HTTP 请求头名称 |
| `verifier_policy` | `dict \| VerifierPolicy \| None` | `None` | 验证器策略。dict 在 `DEFAULT_VERIFIER_POLICY` 之上设置 `VerifierPolicy` 的字段：不带 `risk_overrides` 的 `default_mode` 适用于所有风险等级，`risk_overrides` dict 优先设置其中的等级，`risk_overrides=None` 保留默认等级。`VerifierPolicy` 会被再次校验，其 `risk_overrides` 未包含的风险等级（为 `None` 时则是所有等级）取其 `default_mode`，与 V2 验证器的解析方式相同。未知的字段、风险等级或模式会在构建中间件时抛出异常。 |
| `dcp_version` | `str` | `"2.0"` | 会被保存但不强制执行。是否接受 V1 bundle 取决于 `verifier_policy`（见下文），`require_dcp_v2` 将路由限制为 V2。 |
| `trusted_principals` | `dict \| callable \| None` | `None` | 仅限关键字。你信任的委托人及其密钥：一个信任集（`schemas/v2/principal_trust_set.schema.json`，在构建中间件时校验），或每个请求调用一次的 `(tenant) -> trust set`（同步或异步）。使用它时，只有通过准入的 V2 bundle 才能到达路由，并且需要 `require_bundle=True`（见[受信任的委托人与 strict-v1](#trusted-principals-and-strict-v1)）。 |
| `profile` | `dict \| None` | `None` | 仅限关键字。strict-v1 配置文件（`schemas/v2/admission_profile.schema.json`），在构建中间件时加载。它需要 `trusted_principals` 和 `revocation_source`，并自行设置验证器策略。 |
| `revocation_source` | `callable \| None` | `None` | 仅限关键字，与 `profile` 一起使用。`(subjects, tenant) -> revocation snapshot \| None`，同步（在工作线程中运行）或异步，每次准入已验证的 bundle 时调用。可用 `deny_list_revocation_source(url)` 创建。 |
| `revocation_timeout` | `float` | `5.0` | 仅限关键字。等待吊销来源响应的秒数。在 `{"revocation": True}` 下它是受监督的期限，大于 0 且不超过 2147483.647。 |
| `tenant` | `callable \| None` | `None` | 仅限关键字。`(request) -> str`，同步或异步，是你自己的代码（例如身份验证在 `request.state` 中设置的调用方租户）。它会被传给信任和吊销的可调用对象。默认始终为 `""`。 |
| `clock` | `callable \| None` | `None` | 仅限关键字，用于测试：自纪元以来的毫秒数。默认为系统时钟。 |
| `source_supervisor` | `SourceSupervisor \| None` | `None` | 仅限关键字，与 `supervise` 一起使用。见[监督信任来源](#supervising-the-trust-source)。 |
| `supervise` | `dict \| None` | `None` | 仅限关键字：对异步 `trusted_principals` 使用 `{"trust_timeout": seconds}`（大于 0 且不超过 2147483.647），对异步 `revocation_source` 使用 `{"revocation": True}`（在 `revocation_timeout` 下），或两者同时使用。见[监督吊销来源](#supervising-the-revocation-source)。 |
| `cancel_on_disconnect` | `bool` | `False` | 仅限关键字。当客户端在准入过程中确实离开时，取消其受监督的来源调用；其响应以服务器不会送达的空 499 结束。需要 `max_body_bytes`。见[离开的客户端](#a-client-that-leaves)。 |
| `max_body_bytes` | `int \| None` | `None` | 仅限关键字。正整数（不接受 `bool`、`float`、字符串、`0` 或负数），即中间件接受的请求体字节数。需要 Starlette 0.28.0 或更高版本。默认与以前一样，没有预算。见[请求体预算](#body-budget)。 |

<a id="behavior"></a>

#### 行为

0. 使用 `max_body_bytes` 时，先在预算内读取请求体（见[请求体预算](#body-budget)）。
1. 从请求头或 JSON 请求体（`signed_bundle`）中提取已签名的 bundle。不是 JSON 的请求头、包含超过 Python 4300 位上限的整数的请求头，或嵌套过深的请求头，都被视为没有 bundle（在 `require_bundle=True` 下为 `403`），绝不会变成 `500`。
2. 用 Python SDK 进行验证：
   - **V2**（`bundle.dcp_bundle_version: "2.0"`）：使用 `dcp_ai.v2` 的 `await verify_signed_bundle_v2(signed_bundle, registry, policy)`，配合 Ed25519 / ML-DSA-65 / SLH-DSA-192f 注册表和上述策略。它检查载荷哈希和清单、会话绑定和到期、bundle 及每个工件的复合签名、验证模式（护照风险等级的策略模式与意图安全等级两者中更严格的一个）、审计哈希链（SHA-256 那条：它不重新计算 V2-11 的二级 SHA3-256 链或根）以及密钥的有效性。`composite_sig_valid` 是验证器对 bundle 签名的结果。
   - **V1**（`bundle.responsible_principal_record.dcp_version: "1.0"`）：V1 bundle 没有后量子签名，因此仅当 VERIFICATION.md 的 V2-10 接受纯经典 bundle 时才使用 `verify_signed_bundle()`：即 `allow_v1_bundles` 为真值，策略接受 ed25519（在 `accepted_classical_algs` 中且不在 `advisory_rejected_algs` 中），不要求受众绑定、会话到期或会话最长时长（V1 bundle 没有 `intended_verifier`，也没有会话时长），bundle 的 `responsible_principal_record`、`agent_passport`、`intent` 和 `policy_decision` 是对象且其 `audit_entries` 是对象列表，护照的 `agent_id` 和 RPR 的 `human_id` 是字符串（护照的 `public_key` 和 `status` 若存在则为字符串，其 `capabilities` 为字符串列表：它们会进入代理上下文），并且 V1 护照 `risk_tier` 的策略模式（没有时为 `default_mode`）与 V1 意图及策略决定的安全等级模式（V1 的 `risk_score` 在 0 到 1 之间，乘以 1000；缺失时按 `elevated` 处理）两者中更严格的一个是 `classical_only` 或 `hybrid_preferred`。在 `DEFAULT_VERIFIER_POLICY` 下，routine 或 standard 的 V1 意图可以通过；支付、敏感数据、高预估影响或不低于 0.5 的风险评分会被拒绝。
   - 无法识别版本的 bundle 会被拒绝。
3. 如果有效：将 `DCPAgentContext` 连同验证器的 `warnings` 一起保存到 `request.state.dcp_agent`
4. 如果失败：以 `403` 和验证器的 `errors`（V2 还有 `warnings`）响应：各最多 20 条，每条最多 500 个字符，bundle 提供的文本中的控制字符和格式字符会被转义。上下文中的 `warnings` 也受同样的限制。
5. 如果没有 bundle 且 `require_bundle=False`：不经验证继续

<a id="body-budget"></a>

#### 请求体预算

`max_body_bytes` 需要显式启用。没有它时，中间件与以前一样读取请求体，没有自己的上限。使用它时，中间件会先于其他一切（在 bundle 请求头、JSON 解析、租户和信任集、验证、吊销以及路由之前）读取整个请求体，即使 bundle 通过请求头到达或 `require_bundle=False` 也是如此：

- 超出预算的 `Content-Length` 会在收到任何请求体字节之前得到 `413` `{"verified": false, "errors": ["Request body exceeds max_body_bytes"]}`。
- 实际收到的字节也会被计数，因此没有 `Content-Length` 的请求、分块请求体或过小的 `Content-Length`，会在超出预算的第一条 ASGI 消息时得到同样的 `413`（该消息已经到达），此后不再接收任何内容。
- 不是单一一串 ASCII 数字的 `Content-Length`（符号、小数点、空白、列表）或出现两次的，得到 `400` `["Invalid Content-Length"]`；在发送请求体时断开的客户端得到 `400` `["Request body could not be read"]`。两者都不会到达路由。
- 预算内的请求体，包括空的或格式错误的，处理方式与没有此选项时完全相同，路由照常读取它（`request.body()`、`request.json()`、`request.stream()`）：自 Starlette 0.28.0 起，Starlette 的 `BaseHTTPMiddleware` 会转交在中间件中读取的请求体。
- 因此此选项需要 Starlette 0.28.0 或更高版本。在更早的 Starlette 上，或无法读取版本的 Starlette 上，`max_body_bytes` 会在构建中间件时抛出 `AdmissionConfigError`（`CONFIG_INVALID_VALUE`）：请升级 FastAPI/Starlette 或不设置它。没有此选项时不检查任何内容，软件包本身的最低版本也不变。

这是你的部署设置的、对接收的请求体字节数的上限，不是 DCP 协议的一部分。它不限制解压缩（它计数的是 ASGI 服务器交付的字节）、JSON 深度、时间或读取之后的断开：请与服务器自身的限制一起设置。

<a id="supervising-the-trust-source"></a>

#### 监督信任来源

没有这些选项时，异步或同步的 `trusted_principals` 与以前一样没有期限地运行。使用它们时，**异步**的那个会获得期限和容量槽位：

```python
from dcp_ai.fastapi import DCPVerifyMiddleware, SourceSupervisor

supervisor = SourceSupervisor(max_in_flight=64, max_in_flight_per_tenant=8)  # one per event loop / worker

async def trust_set_for(tenant):
    return await load_trust_set(tenant)

app.add_middleware(DCPVerifyMiddleware, require_bundle=True, trusted_principals=trust_set_for,
                   source_supervisor=supervisor, supervise={"trust_timeout": 2.0})
```

- **期限。** 来源作为监督者拥有的 Task 运行。在 `trust_timeout` 之后到达的信任集不会被使用，这在到达时和使用时都以 `loop.time()` 测量。请求得到与失败来源相同的 `503`，并请求取消该 Task：不等待任何协作。
- **容量。** 最多同时运行 `max_in_flight` 个来源调用，没有队列。`max_in_flight_per_tenant` 限制单个租户；没有它，一个租户可以占用全部容量。没有空闲槽位的调用会立即得到 `503`，不调用来源。**槽位只有在来源的 Task 真正结束时才会释放**，而不是在请求得到响应时：忽略取消的来源会一直占用其槽位。如果以这种方式占满所有槽位，在这些来源结束或进程重启之前，所有请求都会得到 `503`。
- **失败。** 自行取消的来源、被取消的调用方（其来源会占用槽位直到结束）以及无效的信任集都会失败关闭。将这些选项与静态或同步的 `trusted_principals` 一起使用会抛出 `AdmissionConfigError`：同步的那个会在事件循环上运行，在那里任何期限都无法遵守。
- **范围。** 容量按 `SourceSupervisor` 对象计算，由传入它的中间件共享。它绑定到第一个使用它的事件循环，因此请为每个工作进程或每个循环提供单独的一个；来自其他循环或线程的调用会失败关闭，来自其他循环的 `close()` 会抛出 `RuntimeError` 而不改变任何内容。
- **`await supervisor.close(drain_timeout=0)`** 拒绝新的调用，以 `503` 响应待处理的调用，请求取消所有来源 Task，并最多等待 `drain_timeout` 秒。它返回 `{"in_flight": n}`：这些槽位保持占用，且无法重新打开。
- **`supervisor.stats()`** 返回不含租户的计数器：`open`、`in_flight`、`tenants`、`timeouts`、`saturated`、`closed`、`wrong_loop`、`late_results`、`late_errors`。它们在 2**53 - 1 处停止。
- **它不做的事。** 它不会停止忽略取消的工作，不限制来源自行启动的工作，也不隔离 CPU：阻塞事件循环的 `async def` 会推迟所有期限。正在关闭的服务器或 `asyncio.run` 可能会一直等待忽略取消的来源 Task。没有 `{"revocation": True}` 时，吊销与以前一样使用 `revocation_timeout`。对信任来源的查询与以前一样，在验证 bundle 之前进行。

<a id="supervising-the-revocation-source"></a>

#### 监督吊销来源

在 strict-v1 配置文件下，`supervise={"revocation": True}` 会将**异步**的 `revocation_source` 作为同类监督者的 Task 运行，以 `revocation_timeout` 为期限：

```python
app.add_middleware(DCPVerifyMiddleware, require_bundle=True, trusted_principals=TRUST_SET,  # static, or async with trust_timeout
                   profile={"profile": "strict-v1", "verifier_id": "verifier:acme-api"},
                   revocation_source=deny_list_revocation_source("https://revocations.example.com/.well-known/dcp-revocations.json"),
                   revocation_timeout=2.0, source_supervisor=supervisor,
                   supervise={"revocation": True})  # or {"trust_timeout": 2.0, "revocation": True}
```

- **显式启用。** `supervise` 接受 `trust_timeout`、`"revocation": True` 或两者。`"revocation": True` 需要异步的 `revocation_source`（`async def`、带异步 `__call__` 的对象，或包裹其中任一者的 `functools.partial`），并且也适用于静态信任集；同步的那个会抛出 `AdmissionConfigError`，因为它会在监督者不拥有的工作线程中运行。没有此选项时没有任何变化：同步来源继续在 `asyncio.wait_for` 下于工作线程中运行。
- **相同的响应。** 每个答案都给出与不监督时相同的响应。快照的评估与以前相同；`None`、异常、超时、自行取消的来源、没有空闲槽位、已关闭的监督者或绑定到其他循环的监督者都会给出带 `codes: ["REVOCATION_UNAVAILABLE"]` 的 `403`，绝不会被视为未吊销。`code` 为 `REVOCATION_INVALID` 的异常只有在期限之前到达时才给出 `REVOCATION_INVALID`。
- **变化之处。** 没有此选项时，`asyncio.wait_for` 会等待抑制自身取消的来源，并使用它当时返回的快照；使用此选项时，请求在期限时刻得到 `REVOCATION_UNAVAILABLE`，那个迟到的快照永远不会被使用。
- **同一份容量。** 信任和吊销调用使用同一监督者的槽位，每个都保持到其 Task 真正结束为止。
- **`deny_list_revocation_source` 的限制。** 默认情况下它用 `asyncio.to_thread` 下载：取消该 Task 会使 Task 结束并释放其槽位，但不会释放工作线程。该线程会保持连接，直到 urllib 返回。监督者不限制这些线程，也不取消其 I/O；要限制它们，请为来源提供一个 `DenyListWorkers` 预算（见[限制拒绝列表下载](#bounding-deny-list-downloads)）。

<a id="a-client-that-leaves"></a>

#### 离开的客户端

使用 `cancel_on_disconnect=True` 时，在请求准入过程中离开的客户端会停止该请求的工作：

- **如何检测。** 中间件先读取整个请求体：此选项需要 `max_body_bytes`，因此需要 Starlette 0.28 或更高版本。之后，在请求准入期间，它持有一个待处理的 `receive()`。读完请求体后，服务器只能在那里发送 `http.disconnect`。
- **当客户端离开时：**
  - 准入被取消，其受监督的调用也被取消。`SourceSupervisor` 取消 Task 而不等待它，槽位保持占用，直到 Task 真正结束；`DenyListWorkers` 的线程也同样占用其槽位。
  - 不运行任何路由，该准入的任何内容都不会公开到 `request.state` 中。其 `dcp_agent` 只有在确认客户端仍在时才会设置；你自己的代码设置的值不会被改变。
  - 该请求的 ASGI 响应以带 `Content-Length: 0` 和 `Cache-Control: no-store` 的空 `499`（nginx 的“client closed request”：不是注册状态码，也不是 DCP 状态）结束。这是 DCP 响应发送给其外层的两条 ASGI 消息，而不是给客户端的答复：它们只在收到 `http.disconnect` 后发送，绝不会发给仍在的客户端，并让 DCP 外层等待响应的 `BaseHTTPMiddleware` 能够正常结束。因此 DCP 在中间件的**任何顺序**下都能工作。
  - 网络上实际到达什么取决于服务器。Uvicorn 对已不存在的连接什么也不写、什么也不记录，也不发送 `500`（以 uvicorn 0.54 和 h11 测量）。根据 ASGI 规范，其他服务器在已关闭的连接上发送响应时可能抛出 `OSError` 的子类。
  - DCP 的外层会看到那个 499：日志层记录的是客户端关闭了请求，而不是成功。转换或违反 ASGI 的层可能改变它，这超出了此保证的范围；任何层的真实错误仍会继续传播。
  - 在请求体中途离开的客户端，会以同样的 499 结束，而不是没有此选项时发送的 400。
- **它不会从路由拿走任何东西。** 路由读取同样的请求体，其待处理的 `receive()` 会转交给下一个读取者（路由、`request.is_disconnected()` 或 Starlette），既不会被读两次，也不会丢失。只有在准入期间发生的读取才会被解释：服务器在完整响应之后发送的 `http.disconnect` 不被视为客户端离开。
- **要求。** 在构建中间件时检查：
  - `max_body_bytes`
  - 所有受监督来源的可调用对象（可调用的 `trusted_principals` 需要 `trust_timeout`，`revocation_source` 需要 `{"revocation": True}`）
  - 同步的 `tenant` 可调用对象，因为异步的那个可能让已经离开的请求继续等待

  否则为 `AdmissionConfigError`（`CONFIG_PROFILE_CONTRADICTION`）。使用此选项时，返回 awaitable 的 `tenant` 可调用对象会得到无法解析租户的 `503`，且不会被等待。没有此选项时没有任何变化。
- **它不做的事。** 它不会中断 bundle 验证或租户可调用对象，也不会停止忽略取消的来源：它只跳过在看到断开之后才开始的阶段。在外层之后，断开会在几次循环之后才到达，因此来源可能已经开始（届时它会被取消，并占用槽位直到结束）。仅适用于 asyncio。需要在连接丢失时发送 `http.disconnect` 的服务器：uvicorn 会发送；进程内的 httpx 传输只在响应完成时才发送。

<a id="what-verified-means"></a>

#### “已验证”意味着什么

已验证的 bundle 在内部一致，并由它自己列出的密钥（护照密钥和 RPR 绑定密钥）签名。它不能证明委托人是谁：任何人都可以生成密钥并创建一个声称任意 `human_id` 的 RPR。为此请设置 `trusted_principals`（下一节）。已验证的 bundle 也可能在会话过期前被重放：`verifier_policy={"require_audience_binding": True, "verifier_id": "my-service"}`（bundle 的 `manifest.intended_verifier` 必须指向此验证器）、`require_session_expiry` 和 `max_session_duration_seconds` 会限制这一点，strict-v1 配置文件也会；但它们都不会使 bundle 只能使用一次。如果你需要这一点，请自己保存已用 nonce 的记录。

<a id="trusted-principals-and-strict-v1"></a>

### 受信任的委托人与 strict-v1

使用 `trusted_principals` 时，请求只有在其 bundle **通过准入**时才会到达路由（`docs/ADMISSION.md`、`spec/profiles/admission`）：即一个 V2 bundle，其委托人签名（RPR 和 bundle 清单，经典和后量子）由你的信任集为其 `human_id` 列出的、有效且在有效期内的密钥生成。使用 `profile` 时，还会应用 strict-v1 的要求：所有风险等级都使用混合签名，签名的 `intended_verifier` 等于你的 `verifier_id`，签名的会话最长 300 秒，以及一份最多 300 秒前的吊销快照，报告代理和所有签名密钥均未被吊销。

```python
import os

from dcp_ai.fastapi import DCPVerifyMiddleware, deny_list_revocation_source

app.add_middleware(
    DCPVerifyMiddleware,
    require_bundle=True,
    trusted_principals=trust_set,  # or a callable: lambda tenant: trust_sets[tenant]
    profile={"profile": "strict-v1", "verifier_id": "api.acme.example"},
    revocation_source=deny_list_revocation_source(
        "https://revocation.acme.example/.well-known/dcp-revocations.json",
        headers={"Authorization": f"Bearer {os.environ['REVOCATION_TOKEN']}"},
    ),
    tenant=lambda request: request.state.tenant,  # set by your own authentication
)
```

- **被拒绝的请求**会得到带 `{"verified", "admitted": false, "principal_trust", "profile", "profile_compliance", "codes", "errors"}` 的 `403`（`codes` 已排序，`errors` 形如 `"CODE: message"`，有限制且已转义），并且不会到达路由。V1 bundle 会被拒绝：它们没有可锚定的委托人签名。如果租户可调用对象或信任集来源失败或返回无效内容，请求会得到 `503`，同样不会到达路由。
- **通过准入的请求**得到与上文相同的 `request.state.dcp_agent`，其中包含 `admitted=True`、`principal_trust`、`profile`、`profile_compliance`、`recorded_decision`（bundle 的 `approve`、`escalate` 或 `block`）和 `trust_set_version`。`action_authorized` 始终为 `False`：准入表明证据真实且来自受信任的委托人，而不是可以执行该行动。
- **每个请求都会重新评估**。信任可调用对象和吊销来源在每次准入时都会被调用，因此从信任集中移除的委托人、在其中被标记为 `revoked` 的密钥，或来源列出的吊销，都会在下一个请求中拒绝同一个 bundle。
- **吊销失败关闭。** 抛出异常、超时（`revocation_timeout`）或返回 `None` 的来源给出 `REVOCATION_UNAVAILABLE`；`code` 为 `REVOCATION_INVALID` 的异常或不符合 `schemas/v2/revocation_snapshot.schema.json` 的快照给出 `REVOCATION_INVALID`。都不会被视为未吊销。
- **`deny_list_revocation_source(url, *, headers=None, timeout=5.0, workers=None)`** 用标准库读取参考吊销服务的 `/.well-known/dcp-revocations.json` 格式（`updated_at`、`revocations[].agent_id`、`kid_revocations[].revoked_kid`）的完整拒绝列表。快照的 `checked_at` 为 `updated_at`；列出的代理或密钥被吊销，其他所有主体未被吊销。网络错误、超时或非 2xx 响应为 `REVOCATION_UNAVAILABLE`；其他形式的响应体为 `REVOCATION_INVALID`。它不跟随重定向（你的请求头只会发往你的 URL），HTTPS 需要 TLS 1.2 或更高版本。请使用 `https`，并将凭据保存在环境变量或 vault 中。`timeout` 限制每次套接字操作、响应体读取和调用等待的时间，但不限制 DNS 解析或逐渐到达的状态行和响应头。`workers` 见下文。
- **配置只来自你的代码。** 信任集、配置文件、策略、吊销来源和租户永远不会从请求的请求头、查询或请求体中读取：声称属于其他租户的请求不会改变任何东西。
- **配置错误**会在构建中间件时抛出（带 `code` 的）`AdmissionConfigError`：没有 `require_bundle=True` 的 `trusted_principals` 或 `profile`、没有 `trusted_principals` 或 `revocation_source` 的配置文件，或带有 `verifier_policy` 的配置文件（`CONFIG_PROFILE_CONTRADICTION`）、无效的信任集或配置文件（各自的代码）、类型错误的参数，以及没有 `profile` 的 `revocation_source`（`CONFIG_INVALID_VALUE`）。Starlette 在第一个请求时构建中间件栈，而不是在 `add_middleware` 时，因此这样的错误首先表现为每个请求的 `500`（永远不会到达路由）。要在启动时失败，请自己加载信任集和配置文件（`create_principal_trust_store`、`resolve_strict_v1_profile`）并传入加载后的对象。
- **同步吊销来源**在工作线程中运行：超时时请求会立即被拒绝，但线程会继续运行直到来源返回。请选择异步来源，或像 `deny_list_revocation_source(url, timeout=...)` 那样有自己超时的来源，它不使用环境代理，不跟随重定向，并拒绝超过 16 MiB 的列表；它的 `timeout` 限制每次套接字操作和响应体读取，但不限制 DNS 解析或逐渐到达的状态行。

可以用共享的准入向量离线运行：`python integrations/fastapi/examples/strict_v1.py`。

<a id="bounding-deny-list-downloads"></a>

#### 限制拒绝列表下载

默认情况下，`deny_list_revocation_source` 的每次调用都用 `asyncio.to_thread` 下载，在调用停止等待之后，没有任何东西计数这些线程。使用 `DenyListWorkers` 预算时，它们会被计数：

```python
from dcp_ai.v2 import DenyListWorkers, deny_list_revocation_source

workers = DenyListWorkers(max_workers=8, max_workers_per_tenant=2)  # one per process
source = deny_list_revocation_source(
    "https://revocations.example.com/.well-known/dcp-revocations.json",
    timeout=5.0,
    workers=workers,
)
```

- **容量。** 最多同时运行 `max_workers`（1 到 64 的整数）个下载，单个租户最多 `max_workers_per_tenant` 个；没有它，一个租户可以用掉全部。
  - 每个下载都在一个专用线程中运行，该线程只在预留槽位之后才启动。
  - 没有空闲槽位的调用会立即得到 `REVOCATION_UNAVAILABLE`，不进行连接：没有队列。
  - 容量按对象计算：请将同一个对象提供给所有应共享它的来源。
- **槽位一直保持到下载真正结束。** 而不是在调用停止等待时：超时、被取消的请求、C3 监督者的期限或已关闭的事件循环都不会释放它。
  - 预算计数的是进行中的下载。刚完成下载的线程在交出结果并退出之前，仍会短暂存在。
- **相同的答案。**
  - 下载是同样的 GET，遵循同样的 TLS、代理、重定向和大小规则。
  - 响应体仍在事件循环上检查和解析。
  - 错误与没有此选项时相同。
  - 在 `timeout` 之后到达或被使用的结果都是 `REVOCATION_UNAVAILABLE`，即使事件循环繁忙而无法运行其计时器也是如此。
- **`workers.close()`** 拒绝新的下载并返回 `{"in_flight": n}`。它既不等待也不停止正在运行的下载：它们的槽位保持占用直到结束，且无法重新打开。
- **`workers.stats()`** 返回不含 URL、租户或请求头的计数器：`open`、`in_flight`、`tenants`、`saturated`、`closed`、`start_failed`、`late_results`、`dropped`。
- **进程退出会等待。** 这些线程不是守护线程，因此进程退出时，解释器会等待仍在运行的下载。这在 `asyncio.to_thread` 下已经如此，并且可能需要很长时间：这里没有任何东西能停止 DNS、TLS 或 urllib，取消调用只是停止等待它。要结束一直等待的进程，请依靠进程管理器在宽限期之后强制终止。
- **每个进程一个。** 在创建它之后 fork 出的进程中，`stats()` 和 `close()` 会抛出 `RuntimeError`，来源会返回 `REVOCATION_UNAVAILABLE` 而不触及父进程的锁或计数器。请为每个工作进程创建一个。
- **它不做的事。** 它限制运行的下载数量，而不是单个下载所需的时间：响应体期限在阻塞读取之间检查，因此已在进行中的读取可能超过它。

### `require_dcp(request)`

要求已验证 DCP 代理的 FastAPI 依赖项。

```python
from fastapi import Depends
from dcp_ai.fastapi import require_dcp, DCPAgentContext

@app.post("/protected")
async def protected_route(agent: DCPAgentContext = Depends(require_dcp)):
    return {"agent_id": agent.agent_id}
```

- **返回：** `DCPAgentContext`
- **抛出：** 如果没有已验证的代理，则抛出 `HTTPException(403)`

### `DCPAgentContext`

包含已验证代理数据的数据类。

```python
@dataclass
class DCPAgentContext:
    dcp_version: str = "1.0"
    agent_id: str = ""
    human_id: str = ""
    session_nonce: str = ""                # V2: verified session nonce
    public_key: str = ""
    capabilities: list[str] = field(default_factory=list)
    risk_tier: str = "medium"
    status: str = "active"
    passport: dict[str, Any] = field(default_factory=dict)
    rpr: dict[str, Any] = field(default_factory=dict)
    intent: dict[str, Any] = field(default_factory=dict)
    policy_decision: dict[str, Any] = field(default_factory=dict)
    composite_sig_valid: bool = False      # V2: the bundle signature verified
    session_binding_valid: bool = False    # V2: session binding verified
    blinded_rpr: bool = False
    lifecycle_state: str = "active"        # DCP-05
    mandate_id: str = ""                   # DCP-09
    mandate_valid: bool = False            # DCP-09
    warnings: list[str] = field(default_factory=list)  # V2: verifier warnings
    # Admission: set only with trusted_principals (admitted stays False otherwise)
    admitted: bool = False
    principal_trust: str = "not_evaluated" # "trusted" when admitted with trusted_principals
    profile: str | None = None             # "strict-v1" under the profile
    profile_compliance: str = "not_evaluated"
    recorded_decision: str | None = None   # approve, escalate or block
    trust_set_version: str | None = None
    action_authorized: bool = False        # always False
```

### `require_dcp_commissioned(request)`

拒绝 `lifecycle_state` 为 `decommissioned` 的代理的 FastAPI 依赖项。中间件根据护照的 `status` 设置 `lifecycle_state`，不读取 DCP-05 的启用证书或生命周期记录。

```python
@app.post("/active-only")
async def active_only(agent: DCPAgentContext = Depends(require_dcp_commissioned)):
    return {"agent_id": agent.agent_id}
```

### `require_dcp_mandated(request)`

要求委托授权（DCP-09 §3.1）的 FastAPI 依赖项，但它只检查 `mandate_id` 非空：它不获取授权、不验证其签名，也不检查 `mandate_valid`。中间件不会自行设置 `mandate_id`，因此除非你自己的代码设置了它，否则每个请求都会得到 `403`（如果设置了，检查授权是你的责任）。

```python
@app.post("/delegated")
async def delegated(agent: DCPAgentContext = Depends(require_dcp_mandated)):
    return {"agent_id": agent.agent_id, "mandate_id": agent.mandate_id}
```

<a id="advanced-example--global-middleware--selective-routes"></a>
<a id="advanced-example-global-middleware-selective-routes"></a>

## 高级示例 — 全局中间件 + 选择性路由

```python
from fastapi import FastAPI, Depends, HTTPException, Request
from dcp_ai.fastapi import DCPVerifyMiddleware, require_dcp, DCPAgentContext

app = FastAPI()

# Global middleware (non-blocking, only verifies if a bundle is present)
app.add_middleware(DCPVerifyMiddleware, require_bundle=False)

# Public route
@app.get("/health")
async def health():
    return {"ok": True}

# Route that REQUIRES a verified agent
@app.post("/agent/execute")
async def execute(agent: DCPAgentContext = Depends(require_dcp)):
    if "api_call" not in agent.capabilities:
        raise HTTPException(403, "Capability 'api_call' required")
    return {"executed_by": agent.agent_id, "risk": agent.risk_tier}

# Route that uses the agent if available
@app.get("/info")
async def info(request: Request):
    agent = getattr(request.state, "dcp_agent", None)
    if agent:
        return {"mode": "verified", "agent": agent.agent_id}
    return {"mode": "anonymous"}
```

<a id="development"></a>

## 开发

从检出的代码：

```bash
cd sdks/python
pip install -e ".[fastapi,dev]"
pytest tests/test_fastapi_*.py -v
```

<a id="dependencies"></a>

### 依赖项

- `dcp-ai` — DCP 验证 SDK
- `fastapi` — Web 框架
- `starlette` — ASGI 工具包（随 FastAPI 一起提供）

<a id="license"></a>

## 许可证

Apache-2.0
