# 插件

学校相关的功能以插件形式提供，Outflow 本身不包含任何学校的数据。

## 安装

把插件仓库克隆到本目录（`plugins/<name>`），然后重新执行 `pnpm install`（或 `pnpm plugins`）生成插件注册表，再构建、部署即可。本地开发时也可以用软链接；Docker 构建时这里必须是真实目录。

卸载：删除对应目录后重新执行 `pnpm plugins`。插件存储的数据保留在数据库中。

## 编写插件

插件是一个带 `outflow.plugin.json` 和 `package.json`（必须声明 `"type": "module"`，且不能有 `dependencies`）的目录：

```json
{
  "id": "example",
  "name": "示例插件",
  "nav": [{ "label": "示例", "href": "/example" }],
  "server": "src/server.ts",
  "web": "src/web.tsx",
  "public": "public"
}
```

| 字段 | 说明 |
|---|---|
| `id` | 小写字母、数字和连字符。API 挂载在 `/api/plugins/<id>`，静态资源在 `/plugins/<id>/` |
| `nav` | 顶栏入口 |
| `server` | 服务端入口，默认导出 `ServerPlugin`（见 `server/src/plugins/sdk.ts`） |
| `web` | 前端入口，默认导出 `WebPlugin`（见 `web/src/plugins.ts`） |
| `public` | 静态资源目录，构建时复制到站点的 `/plugins/<id>/` |

约定：

- 插件**不能有自己的 npm 依赖**。前端只能使用宿主提供的 React 和 `@outflow/sdk/web`；服务端只能 `import type` 自 `@outflow/sdk/server`，运行时能力（权限、存储、文档访问）由宿主作为参数传入
- 插件不自带数据库迁移，数据存在宿主提供的键值存储里（`host.get(c).store(kind)`）
- 读取文档前必须通过 `docs.access` / `docs.readable` 检查权限
- 类型检查随宿主的 `pnpm typecheck` 一起进行
