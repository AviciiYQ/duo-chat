# 插件格式

插件是一个 **ES 模块**，默认导出一个函数。页面加载它时会把 `api` 传进来。

```js
export default function (api) {
  api.addCommand('export', '导出当前会话为 Markdown', () => {
    const s = api.session();
    // ...做事情
  });
}
```

## api 提供什么

| 方法 | 说明 |
|---|---|
| `api.getState()` | 整个应用状态（含 providers、sessions、params） |
| `api.session()` | 当前打开的会话 |
| `api.toast(msg)` | 底部弹一条提示 |
| `api.addCommand(id, title, fn)` | 注册一个命令，装好后出现在「插件 → 可用命令」里 |

命令是异步安全的：`fn` 返回 Promise 也会被等待，抛错会弹提示，不会把页面搞崩。

## 清单文件 manifest.json

从网址安装时，可以直接给 `.json` 或直接给 `.js`。

```json
{
  "id": "export-md",
  "name": "导出会话为 Markdown",
  "version": "1.0.0",
  "author": "你的名字",
  "description": "把当前会话导出成 .md 文件",
  "code": "export default function (api) { ... }"
}
```

`code` 里直接放源码（用 `\n` 转义换行）。也可以拆成两个文件：

```json
{
  "id": "export-md",
  "name": "导出会话为 Markdown",
  "version": "1.0.0",
  "author": "你的名字",
  "description": "把当前会话导出成 .md 文件",
  "codeUrl": "https://raw.githubusercontent.com/你/仓库/main/plugins/export-md/index.js"
}
```

`codeUrl` 相对于清单地址解析，所以写相对路径也行。

## 从哪装

「插件」→ 粘贴地址 → 「从网址安装」。

地址可以是：

```
https://raw.githubusercontent.com/你/仓库/main/plugins/export-md/manifest.json
https://raw.githubusercontent.com/你/仓库/main/plugins/export-md/index.js
```

必须是 **raw 直链**（`raw.githubusercontent.com`），不能是 GitHub 的网页地址（`github.com/.../blob/...`，那个返回的是 HTML）。

## 做一个自己的插件

1. 在 GitHub 建一个仓库（或者用现成的）
2. 建目录 `plugins/我的插件/`
3. 放 `index.js`（源码）和 `manifest.json`（清单）
4. 把 manifest 的 raw 地址给人，或者贴进「从网址安装」

## 写成什么样算好插件

- 一个插件只干一件事，命令标题写成人话
- 不要静默改用户数据，删除类操作必须先 `confirm()`
- 不要发网络请求，除非这确实是它存在的理由（比如同步到云盘），并且要说清
- 报错用 `throw new Error('人话')`，页面会显示出来

## 安全

**插件和页面同源，能读到 localStorage，也就是能读到 API 密钥。**

这不是缺陷，是所有浏览器插件模型的共同性质。正规产品靠签名和审核缓解，这个项目没有那套东西，所以：

- 只装你自己写的、或者逐行看过代码的
- 装完不放心就「停用」或「卸载」
- 别在线上的公共页面里装陌生插件

页面在安装时会弹一次警告，那句话不是走过场。
