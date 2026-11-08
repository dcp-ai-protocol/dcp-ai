<sub>[English](../../../../tools/enterprise-rehearsal/README.md) · **中文** · [Español](../../../es/tools/enterprise-rehearsal/README.md) · [日本語](../../../ja/tools/enterprise-rehearsal/README.md) · [Português](../../../pt-BR/tools/enterprise-rehearsal/README.md)</sub>

<a id="enterprise-integration-rehearsal"></a>

# 企业集成演练

> 本文是[英文版](../../../../tools/enterprise-rehearsal/README.md)的参考译文，更新于 08/11/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

这个可选的合成应用使用已安装的软件包和真实的回环 HTTP 来运行 DCP。它位于协议核心、SDK 和生产适配器之外。**验证、准入、委托激活和应用授权是相互独立的决定。** 有效的签名不会授权任何操作，也不保证只执行一次。

本演练使用 TypeScript/Express 和 Python/FastAPI。直接准入使用已安装的适配器；委托准入和激活则在应用中使用 SDK 的公开 API。本演练并不声称适配器实现了委托组合。Go/Rust 的互操作性属于[符合性套件](../conformance/README.md)的范围；WASM 不提供组合后的委托链。

<a id="prerequisites"></a>

## 前提条件

已在 macOS arm64 上使用 Node 22.15.0、npm 11.3.0 和 CPython 3.12.2 测试。需要 Git、Python 的 venv 支持、POSIX 进程组、`/bin/ps`，以及对公开 npm/PyPI 注册表的访问。其他平台需要另行验证。不需要账户凭据、真实的主体数据、正在运行的服务或已发布的开发版软件包。

请使用包含本套件及所需 SDK API 的检出副本。软件包源代码不得有已跟踪的修改。经过审查的软件包源代码是提交 `b3d41bd062ce035b537f8d3acd3e96e5b2ce310c`；本套件是额外交付的源代码。仅凭版本号无法识别这些构建：请记录源代码提交和制品哈希。不要假定已发布的版本包含此处测试的更改。

<a id="prepare-and-install"></a>

## 准备与安装

请在仓库根目录下，于同一个 shell 中运行以下代码块。每个输出子目录都必须是新的。临时父目录会解析为物理路径，以避开 `/tmp` 这类平台别名。

```sh
MP05_ROOT="$(pwd -P)"
MP05_TMP="$(mktemp -d)"
MP05_TMP="$(cd "$MP05_TMP" && pwd -P)"
python3 tools/enterprise-rehearsal/prepare.py \
  --source "$MP05_ROOT" --revision "$(git rev-parse HEAD)" \
  --work "$MP05_TMP/build"
python3 tools/enterprise-rehearsal/install.py \
  --manifest "$MP05_TMP/build/artifacts.json" \
  --work "$MP05_TMP/consumer"
```

`prepare.py` 从 Git 导出三个软件包目录，构建 TypeScript 和 Express 的 tarball 以及 Python 的 wheel/sdist，并记录源代码、工具、命令和哈希。它不会修改软件包源代码，也不发布任何内容。Express 的锁文件会先下载其依赖的已发布 SDK 2.2.0；脚本随后将其替换为本地 SDK tarball，并在**编译之前**检查其内容。打包时保留软件包原有的清单和锁文件。

`install.py` 创建隔离的使用方环境。Node 第三方包由套件的锁文件固定；只有本地 tarball 的完整性值会改变。Python 第三方包和构建工具有版本/哈希锁；DCP 从本地 wheel 以 `--no-deps` 安装。锁文件包含注册表 wheel 的哈希，但在其他平台上能否获取仍需验证。不使用可编辑安装，也不从检出副本导入 SDK。

<a id="run-the-rehearsal"></a>

## 运行演练

```sh
node tools/enterprise-rehearsal/node/rehearse.mjs \
  --manifest "$MP05_TMP/build/artifacts.json" \
  --consumer "$MP05_TMP/consumer" --work "$MP05_TMP/run"
```

启动器首先运行离线的安装防护检查：制品/内容哈希、锁文件、导入解析、嵌套的 SDK 副本、Python 路径/发行版以及所需的 API。然后它把套件复制到 Node 使用方环境中，并在 `STAGED.json` 中记录哈希清单。Python 使用使用方环境的解释器，并带上 `-I`。服务器会检查该清单、SDK 来源和防护检查的记录；它们不会在每个请求上重复完整的安装审计。这些检查并不是对所有第三方依赖的审计。

启动器通过 IPC 掌管运行器和服务器，因此被阻塞的运行器无法妨碍受管的清理。服务器只在 `127.0.0.1` 的临时端口上监听。运行器有 900 秒的期限，每个请求有 10 秒超时，每组结束后还有 60 秒的耗时检查；组检查**不是**强制取消的期限。演练期间不会连接任何远程应用端点。

退出码 `0` 要求所选计划全部完成、结果符合预期、机密扫描成功并且干净关闭。出现错误、缺失观测、意外代码、额外效果、残留进程或清理失败，都会使命令失败。每次调用都需要新的工作目录；旧的成功报告不能满足新的运行。`--lanes node` 或 `--lanes python` 只选择用于诊断的子集，而不是完整的双通道验收运行。

<a id="scenarios-and-expected-decisions"></a>

## 场景与预期决定

完整计划每个通道 100 步，共 200 步。预期结果在发出请求之前写好，包括 HTTP 状态、DCP/应用代码、经过认证的租户、真实的 DCP 结果、对来源的调用、预留和效果。每一组都包含正向和反向对照。

| 组 | 测试内容 |
|---|---|
| G1 | 使用带外提供的指纹登记主体；错误的指纹和被篡改的密钥文档会被拒绝 |
| G2 | 直接准入、会话过期、受众、应用操作和已签名的参数 |
| G3 | 从合成 bearer 推导出的租户；其他租户、缺少信任、伪造的请求头和信封中的多余字段 |
| G4 | 不重启即撤回并恢复信任 |
| G5 | 被撤销的智能体/密钥、不可用或确实过期的拒绝列表、格式错误的日期以及恢复 |
| G6 | 主体/智能体密钥的轮换、重叠和停用；重新签发的授权书和确认 |
| G7 | 委托的组合与激活、授权书的撤销/有效时间窗、缺失或错误的确认、授权书列表单独失效 |
| G8 | 与每份授权书取交集的应用策略；操作、域、数据类别、限额和已签名的参数 |
| G9 | 本地一次性预留、使用不同请求 ID/序列化的重放，以及 8 个并发 HTTP 请求 |
| G10 | 两条路由上的原始字节入口检查：多层深度的重复键、数字形式、Unicode/UTF-8、声明的和流式的请求体预算 |

对于已准入/已激活的证据，真实的 DCP 结果仍然是 `action_authorized=false`。应用另行返回 `application_authorized` 并记录其效果。缺少确认时，证据可能已被准入但委托未激活；此时不会产生效果。旧列表以其原始日期提供，绝不会在接收时被悄悄刷新。运营方会显式发布新的快照。

应用认证租户，通过带外方式选择其信任集，并且只接受 JSON 请求体中的 bundle。它拒绝 `X-DCP-Bundle`，以免授权一个与通过请求头准入的证据不同的请求体。这是本套件的决定，并不是从适配器中移除对请求头的支持。未知的信封字段会在调用来源之前被拒绝；这种拒绝本身并不能证明 SDK 中存在信任失败。

<a id="evidence-and-retention"></a>

## 证据与保留

请保留 `build/artifacts.json`、`consumer/installed.json`，以及 `run/verify.json`、`stage.json`、`supervision.json` 和新生成的 `run-*/report.json`/`plan.json`。每个通道的证据记录观测、对来源的查询、预留和效果。报告包含本地文件系统路径。请将套件源代码或其文件哈希与软件包提交一起保存；制品版本可能与注册表中的版本相同，但源代码不同。

测试夹具会在受限目录中生成 **TEST ONLY** 的私钥和 bearer 令牌。运行器会在证据中扫描已知的字节/hex/base64 表示形式，然后删除其机密目录。外部监督器也会在它自己的新工作目录内，扫描并删除被强制终止的运行器留下的机密。它保留证据，并拒绝通过指向该目录之外的链接进行删除。该扫描器并不是通用的 DLP。切勿用真实的密钥、令牌或个人数据替换它们。

受管的超时和中断都已覆盖；对启动器本身发送 `SIGKILL`、断电以及并发的文件系统篡改，都无法保证清理。发生此类中断后，请检查工作目录，并按照你的保留策略处置剩余的合成机密。HTTP 演练会删除其机密目录。下方的针对性测试会在 `$MP05_TMP/helper-tests` 中保留 TEST ONLY 材料，直到运行最后一条清理命令。

<a id="focused-tests"></a>

## 针对性测试

这些对照使用临时测试夹具和已安装的使用方环境。前两条命令覆盖准备失败和安装被篡改的情况；篡改只发生在一次性副本中。缺少 API 的合成 SDK 会在执行之前因其内容而被拒绝，而不仅仅是因为 API 检查。

```sh
python3 -B -m unittest discover -s tools/enterprise-rehearsal -p test_prepare.py -v
python3 tools/enterprise-rehearsal/negative_controls.py \
  --manifest "$MP05_TMP/build/artifacts.json" --work "$MP05_TMP/consumer"
node --test tools/enterprise-rehearsal/process.test.mjs tools/enterprise-rehearsal/secrets.test.mjs
REHEARSAL_PYTHON="$MP05_TMP/consumer/python/bin/python" \
REHEARSAL_WORK="$MP05_TMP/helper-tests" \
  node --test "$MP05_TMP/consumer/node/rehearsal/node/test/"*.test.mjs
"$MP05_TMP/consumer/python/bin/python" -I -m unittest discover \
  -s "$MP05_TMP/consumer/node/rehearsal/python" -p 'test_*.py' -v
rm -rf -- "$MP05_TMP/helper-tests"
```

原始入口语料也可以独立于 HTTP 运行。请把这些测试辅助文件复制到已安装的 Node 软件包旁边；不要针对检出副本中的 SDK 运行它们。

```sh
mkdir "$MP05_TMP/consumer/node/ingress-controls"
for name in ingress-node.mjs ingress_python.py ingress-cases.json test-ingress.mjs test_ingress.py; do
  cp "$MP05_ROOT/tools/enterprise-rehearsal/$name" "$MP05_TMP/consumer/node/ingress-controls/$name"
done
node "$MP05_TMP/consumer/node/ingress-controls/test-ingress.mjs" \
  "$MP05_TMP/consumer/node/ingress-controls/ingress-cases.json"
"$MP05_TMP/consumer/python/bin/python" -I \
  "$MP05_TMP/consumer/node/ingress-controls/test_ingress.py" \
  "$MP05_TMP/consumer/node/ingress-controls/ingress-cases.json"
```

运行器的对照会拒绝反转的预期、缺失的观测/组、重复项、基础设施错误以及对旧报告的重用。监督器的对照覆盖被阻塞或被突然终止的运行器、不配合的服务器、格式错误的请求、启动失败、进程表失败和残留的机密，同时还包括一次干净的正向运行。

<a id="boundaries-for-a-real-integration"></a>

## 真实集成的边界

- **协议：** 身份证据、验证、准入以及可选启用的激活。`dcp-jcs-v1` 不变。应用复用实验性扫描器作为其字节入口策略；它不会激活新的规范化配置文件。
- **适配器：** 直接的 strict-v1 准入，带有可选启用的请求体/来源预算、取消和按租户的监督。委托路由在应用中使用各自独立的有界 HTTP 来源；它们并不展示适配器针对组合链的来源配额。
- **应用：** 租户认证、信任管理、操作/参数策略以及本地账本。SKU、币种和 `max_amount` 的语义属于应用规则；授权书之间的收窄仍然是协议规则。
- **运营方：** 真实的接入、认证、TLS、密钥保管/HSM/KMS、撤销发布、保留和部署控制。合成的 bearer/指纹既不是 OIDC，也不是面向人的 PKI，更不能证明某个智能体在线。回环不是生产环境 TLS 的测试。
- **账本：** 本地的原子预留意味着最多一次尝试。它不保证恰好一次执行、与外部服务的事务、分布式协调，也不保证崩溃后的物理持久性。管理变更是串行执行的。8 个并发 HTTP 请求并不意味着 8 次并行的密码学验证；来源超时不会取消同步的密码学运算。

经过审查的演练在一个仅含公开内容的独立副本中通过了 200/200 步，四个服务器均干净退出，合成机密已被删除。其四个独立构建的软件包制品与第一次准备时的制品逐字节相同。这是可复现的集成证据，而不是生产就绪性的认证，也不是外部安全审计。关于支持的边界，请参阅[准入](../../docs/ADMISSION.md)和[运行限制](../../docs/OPERATIONAL_LIMITS.md)。发布软件包和验证试点部署是单独的步骤。
