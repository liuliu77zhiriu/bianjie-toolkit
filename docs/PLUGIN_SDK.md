# 插件开发 SDK · 便捷工具

一个工具（插件）就是一个目录，包含：

```
resources/plugins/<id>/          内置插件目录（只读）
  plugin.json                    清单
  main.js                        后端模块（ESM，运行在主进程）
  index.html                     主面板内嵌 UI（沙箱 iframe）
  app.js  style.css  icon.svg    可选静态资源
  mini.html                      可选：独立小窗 UI（如计时器桌面悬浮窗）
```

用户安装/编辑的插件在 `%APPDATA%/便捷工具/plugins/<id>/`，用户对内置插件的修改保存在
`%APPDATA%/便捷工具/overrides/<id>/`，加载优先级：overrides > plugins(用户) > resources(内置)。

编辑器里删除内置文件时不会改动只读目录，而是在 `overrides/<id>/.deleted.json` 写入**墓碑**
（相对路径数组）；`resolveFile` 会跳过墓碑，重新创建/写入同名文件会自动清墓碑。覆盖层文件
（包括新建文件）优先于基座；删除覆盖文件 = 恢复内置原版。插件清单 `plugin.json` 被墓碑删除时
插件进入错误态但仍保留在列表，可进入编辑器恢复。

## UI 编辑器快捷入口

插件后端可通过 `ctx.uieditor.open(projectId?)` 打开应用内置的 UI 编辑器工作台（不传 projectId 时打开最近工程/新建）。适合做一个"打开设计器"的入口插件：

```js
ctx.commands.register({
  id: 'studio',
  label: '打开 UI 编辑器',
  run: () => ctx.uieditor.open(),
});
```

> 禁止直接 `require`/`import` npm 包或 Node 内置模块。插件后端只能使用 `ctx` 暴露的能力
> 与 `ctx.electron`（Electron 原生 API）。所有 UI 只能通过 `window.toolkit` 与后端通信。

---

## 1. plugin.json

```json
{
  "id": "screenshot",
  "name": "截图",
  "description": "区域 / 全屏 / 指定窗口截图",
  "version": "1.0.0",
  "icon": "camera",              // 内置图标名，或目录下 icon.svg 自动优先
  "accent": "#4C8DFF",
  "order": 10,                   // 主面板排序
  "entry": "main.js",
  "ui": "index.html",
  "builtin": true,
  "hidden": false
}
```

`id` 必须匹配 `^[a-z][a-z0-9-]{1,31}$`。

---

## 2. 后端：main.js

```js
export default {
  activate(ctx) {
    ctx.log('activated');
    ctx.ipc.handle('ping', async (args) => ({ pong: args?.value ?? null }));
  },
  deactivate() {
    // 清理定时器、窗口、监听器
  }
};
```

### 2.1 ctx 完整 API

```ts
ctx.plugin        // { id, name, version, dir（生效目录）, dataDir（用户数据目录） }
ctx.log/warn/error(...args)   // 写入日志文件（主进程日志）
ctx.paths         // { userData, screenshots, recordings, logs, plugins, overrides, backups }
ctx.store         // 持久化 KV（每个插件独立 JSON，原子写入）
  .get(key, fallback?) / .set(key, value) / .delete(key) / .all() / .clear()
ctx.ipc.handle(method, handler)      // handler(args, meta) → 可序列化数据；抛错自动转成错误
ctx.ipc.unhandle(method)
ctx.events.broadcast(topic, payload) // → 该插件全部 UI（面板 iframe / 插件窗口）toolkit.on
ctx.events.on(topic, handler)        // ← UI toolkit.send(topic, payload)
ctx.commands.register({ id, label, description?, defaultAccelerator?, run }) => dispose
ctx.commands.run(id, args?)          // 主动触发命令
ctx.windows.open(opts) => Promise<PluginWindowHandle>
ctx.windows.close(key) / .send(key, topic, payload) / .exists(key) / .list()
ctx.windows.show(key) / .hide(key)          // 显隐已存在的插件窗口（hideOnClose 场景常用）
ctx.overlay.pickRegion({ hint? })    // → { displayId, rect:{x,y,width,height}, scaleFactor } | null
ctx.panel.show(pluginId?) / ctx.panel.close() / ctx.panel.isOpen()
ctx.dialogs.save(opts) / .open(opts) / .directory(title?)
ctx.shell.openPath(path) / .showItemInFolder(path) / .openExternal(url)
ctx.clipboard.writeText(text) / .writeImage(path)
ctx.notifications.show({ title, body, icon? })
ctx.app            // { version, name, locale, platform, isPackaged }
ctx.app.quit() / .relaunch() / .setLoginItem(enabled)
ctx.electron       // 原始 Electron 模块（app/BrowserWindow/desktopCapturer/screen/...）
ctx.media          // 截图 / 录屏能力，见 2.3
ctx.settings       // 只读快照 + get()；修改请走设置页或 ctx.panel.show('settings')
```

### 2.2 插件窗口

```js
const win = await ctx.windows.open({
  key: 'mini',                 // 唯一键，重复调用会聚焦已有窗口
  page: 'mini.html',           // 相对插件目录
  width: 240, height: 72,
  frame: false, transparent: true,
  alwaysOnTop: true, skipTaskbar: true, resizable: false, focusable: true,
  position: 'top-right',       // 'center' | 'top-right' | 'bottom-right' | {x,y}
  draggable: true,             // 注入 -webkit-app-region: drag 的 header 样式开关（页面自定义）
  hideOnClose: false           // true 时关闭只隐藏，下次 open 复用
});
ctx.windows.send('mini', 'tick', { remain: 12 });
```

窗口页面里加载同一份 SDK（相对路径写 `tk://plugin-sdk/sdk.js`），`toolkit.env.host.kind === 'window'`，
`toolkit.env.windowKey === 'mini'`。可用 `toolkit.closeWindow()`。

### 2.3 ctx.media（核心能力，无需自行实现）

```ts
listSources({ kinds?: ('screen'|'window')[], thumbnailWidth?: number }): Promise<Source[]>
// Source = { id, name, kind, displayId?, thumbnail(data:image/png;base64), appIcon? }

captureFullscreen({ displayId?, copy? }): Promise<CaptureResult>
captureWindow({ sourceId, copy? }): Promise<CaptureResult>
captureRegion({ displayId?, rect, copy? }): Promise<CaptureResult>
// CaptureResult = { path, width, height, copied, preview(dataURL, 最大宽 480), format }

startRecording(opts): Promise<{ id: string }>
// opts = { sourceId, kind:'screen'|'window', displayId?, fps?, quality?(1-100),
//          audio?:'none'|'system'|'mic'|'system+mic', countdown?: seconds }
stopRecording(id): Promise<{ path, durationMs, sizeBytes, format:'mp4'|'webm' }>
cancelRecording(id): Promise<void>
getRecordingState(id): Promise<{ id, phase, startedAt, durationMs, path? }>
onState(cb): () => void   // main 进程内订阅：cb({ id, phase, durationMs, path? })
```

媒体文件命名、保存目录、自动复制剪贴板等由设置驱动，插件不处理路径。
`preview` 可直接用于 `<img src>`；本地文件也可用 `toolkit.fileUrl(path)` 生成 `tk://file/...`。

区域框选：`const region = await ctx.overlay.pickRegion();` 返回 DIP 坐标矩形，取消返回 `null`。
调用前先 `ctx.panel.close()`（或由 UI 用 `toolkit.closePanel()` 触发），否则面板会被截进去。

---

## 3. UI：index.html

最小骨架（主面板 iframe 尺寸约 420×520，自带滚动）：

```html
<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'self' tk:; img-src 'self' tk: data: blob:; style-src 'self' 'unsafe-inline' tk:; script-src 'self' tk:;" />
  <link rel="stylesheet" href="tk://plugin-sdk/theme.css" />
  <style>/* 插件私有样式 */</style>
</head>
<body>
  <div class="tk-page tk-scroll">
    <div class="tk-header">
      <div>
        <h2 class="tk-title">截图</h2>
        <p class="tk-sub">区域 / 全屏 / 指定窗口</p>
      </div>
    </div>
    <div class="tk-grid">…</div>
  </div>
  <script src="tk://plugin-sdk/sdk.js"></script>
  <script src="app.js" type="module"></script>
</body>
</html>
```

### 3.1 window.toolkit

```js
await toolkit.ready();                       // 等待宿主握手（必须）
toolkit.env                                  // { pluginId, host:{kind:'panel'|'window', windowKey?}, settings, platform, versions }
toolkit.invoke(method, args)                  // → Promise，对应 ctx.ipc.handle
toolkit.send(topic, payload)                  // 单向通知后端，对应 ctx.events.on
toolkit.on(topic, cb) / toolkit.once(topic, cb)  // → 取消订阅函数
toolkit.toast(message, type)                  // type: 'info'|'success'|'error'；主面板内展示
toolkit.openPanel(pluginId?)                  // 打开主面板（可指定进入某个工具）
toolkit.closePanel()
toolkit.closeWindow()                         // 独立小窗使用
toolkit.fileUrl(absPath)                      // → tk://file/<base64url>（仅允许用户数据/截图/录制目录）
toolkit.platform                             // 'win32'
```

事件：`settings:changed`、`appearance`、`plugin:will-reload`、`plugin:reloaded`，以及后端
`ctx.events.broadcast` 的任意 topic。面板关闭/隐藏时 iframe 会收到 `panel:hidden`，重新打开收到 `panel:shown`。

### 3.2 主题样式（theme.css 提供的 class）

`tk-page` 页面容器；`tk-scroll` 平滑弹性滚动；`tk-header/tk-title/tk-sub` 页头；
`tk-card` 玻璃卡片；`tk-grid` 自适应网格；`tk-list/tk-item` 列表；`tk-row` 横排；
`tk-btn`（可加 `primary` / `ghost` / `danger` / `sm`）；`tk-icon-btn`；`tk-input`；
`tk-switch`（`<button class="tk-switch" aria-checked="true">`）；`tk-badge`；`tk-chip`；
`tk-empty`；`tk-divider`；`tk-progress`；`tk-kbd`；`tk-label`；`tk-hint`；`tk-mono`。

设计规范：蓝黑简约，玻璃质感；强调色 `var(--tk-accent)`（跟随用户设置变化）；圆角卡片
`var(--tk-radius-md)`；动效 Q 弹但幅度小（`--tk-ease` / `--tk-ease-soft`）；
不要使用亮白大面积背景；字号 12/13/14/17/20，行高 1.5。

### 3.3 录制页 / 独立窗口

独立小窗页面同样引用 `tk://plugin-sdk/sdk.js`；窗口拖动可给元素加 `-webkit-app-region: drag`，
按钮加 `-webkit-app-region: no-drag`。透明窗口背景保持透明。

---

## 4. 命令（托盘 / 快捷键 / 快捷入口）

```js
ctx.commands.register({
  id: 'screenshot.region',        // 全局唯一，建议 `<插件id>.<动作>`
  label: '区域截图',
  description: '框选屏幕区域并保存',
  defaultAccelerator: 'Alt+A',    // 用户可在设置中修改；冲突时内核会跳过并记录
  run: async () => { /* 完成动作 */ }
});
```

主面板“首页”的卡片点击默认进入插件 UI；命令可在托盘菜单和设置页“快捷键”中看到。

## 5. 设置读取

插件通过 `toolkit.env.settings` 读取当前设置快照（如 `settings.capture`、`settings.recorder`），
设置变化时会收到 `settings:changed` 事件并更新快照。若需要新增设置项，联系 Lead 在核心 schema 中加字段。

## 6. 稳定性红线

- `activate` 内不能抛未捕获异常；异步初始化用 `try/catch` 并 `ctx.log.warn`。
- 所有 `setInterval`/`setTimeout`/窗口/IPC 监听必须在 `deactivate` 清理。
- 不允许同步读取大文件；录屏分片写盘。
- UI 中所有 DOM 事件都要容错；iframe 崩溃不允许影响外壳。
- 不修改 `resources/plugins/<其它插件>`，不写死本机路径。

## 7. 示例：完整最小插件

`plugin.json`

```json
{ "id": "hello", "name": "你好", "description": "最小示例", "version": "1.0.0", "order": 99, "entry": "main.js", "ui": "index.html" }
```

`main.js`

```js
export default {
  activate(ctx) {
    ctx.ipc.handle('greet', ({ name }) => `你好，${name || '世界'}`);
    ctx.commands.register({ id: 'hello.greet', label: '打个招呼', run: () => ctx.events.broadcast('greet', { at: Date.now() }) });
  },
  deactivate() {}
};
```

`index.html` 内：

```html
<button class="tk-btn primary" id="btn">打招呼</button>
<script src="tk://plugin-sdk/sdk.js"></script>
<script type="module">
  await toolkit.ready();
  document.getElementById('btn').onclick = async () => {
    toolkit.toast(await toolkit.invoke('greet', { name: '插件' }));
  };
  toolkit.on('greet', ({ at }) => console.log('broadcast', at));
</script>
```

