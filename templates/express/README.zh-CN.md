<sub>[English](README.md) · **中文** · [Español](README.es.md) · [日本語](README.ja.md) · [Português](README.pt-BR.md)</sub>

<a id="dcp-ai--express-api-server-template"></a>
<a id="dcp-ai-express-api-server-template"></a>

# DCP-AI + Express API 服务器模板

> 本文是[英文版](README.md)的参考译文，更新于 25/10/2026。如有出入，以英文版为准。标识符、命令和代码块保持原文，不作翻译。

一个 Express API，展示 DCP bundle 检查在服务器中的位置。

> **它不验证签名。** 模板的 `verifyBundle` 只检查 bundle 的结构（版本、清单字段、是否存在复合签名、会话 nonce）。它不验证任何签名，因此伪造或被篡改的 bundle 会通过。请用它来查看路由和流程，而不要把它当作验证器。要验证 bundle，请像 [docs/QUICKSTART_EXPRESS.md](https://github.com/dcp-ai-protocol/dcp-ai/blob/main/docs/QUICKSTART_EXPRESS.md) 那样使用 [`@dcp-ai/express`](https://github.com/dcp-ai-protocol/dcp-ai/blob/main/integrations/express/README.md)（在其下一个版本发布前从检出的代码使用）或 SDK 的 `verifySignedBundleV2`。

<a id="quick-start"></a>

## 快速开始

1. 安装依赖项：
   ```bash
   npm install
   ```

2. 启动服务器：
   ```bash
   node index.js
   ```

模板不读取 `.dcp/`，因此不需要 `npx @dcp-ai/cli init`（而且该向导只是演示：[代理创建](https://github.com/dcp-ai-protocol/dcp-ai/blob/main/docs/AGENT_CREATION_AND_CERTIFICATION.md#cli-wizard-demo-only)）。

<a id="what-this-template-does"></a>

## 此模板做什么

- 运行一个 Express API 服务器，其 DCP 中间件检查 bundle 的**结构**（见上文）
- 代理出示 Citizenship Bundle 以访问受保护的路由
- 对公开路由和受保护路由进行限流
- 在内存中保存一个注册表，记录通过结构检查的 bundle 所声称的代理：它们的 `agent_id` 和
  能力是自行声明且未经验证的，注册表在重启后会丢失
- `/agents/action` 不执行任何操作：它把操作与 bundle 自行声明的能力进行比对，并返回
  一个 `action_id`
- 提供 `/verify`、`/health`、`/agents/*` 和 `/.well-known/dcp-capabilities.json`

<a id="endpoints"></a>

## 端点

| 方法 | 路径               | 认证     | 说明                               |
|--------|--------------------|----------|------------------------------------|
| GET    | `/health`          | 无       | 健康检查                           |
| POST   | `/verify`          | 无       | DCP bundle 的结构检查（不验证签名） |
| POST   | `/agents/action`   | DCP      | 模拟确认：仅对照 bundle 检查能力，不执行任何操作（需要 bundle） |
| GET    | `/agents/registry` | DCP      | 列出已注册的代理                   |
| GET    | `/.well-known/dcp-capabilities.json` | 无 | 能力发现 |

<a id="files"></a>

## 文件

- `index.js` — 带 DCP 中间件的 Express 服务器
- `package.json` — 依赖项
