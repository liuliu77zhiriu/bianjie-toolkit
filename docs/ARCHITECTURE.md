# 便捷工具 · 架构与协作约定

> 技术栈：Electron 38（Chromium 140 / Node 22）+ React 19 + Vite 7 + TypeScript。
> 目标：稳定、轻量、可扩展。主进程负责所有“后端服务”，渲染进程只做展示与交互。

## 目录结构

```
package.json
scripts/                 构建 / 启动 / 冒烟测试 / 打包脚本（Lead）
src/
  shared/                主进程与渲染进程共享的 TS 类型（Lead）
  main/                  主进程（Electron 后端）
    index.ts             入口：app 生命周期、窗口、托盘、快捷键装配
    core/
      paths.ts           路径与目录管理
      store.ts           原子化 JSON 存储
      settings.ts        设置服务（schema / 校验 / 应用 / 广播）
      windows/           悬浮球、主面板、迷你窗、插件子窗口管理
      ipc.ts             IPC 路由（tk:call / tk:plugin-call / tk:plugin-event）
      plugin-host.ts     插件发现、加载、热重载、ctx 注入、编辑覆盖层 + 文件墓碑
      overlay.ts         区域截图遮罩窗口（多屏）
      settings-window.ts 独立设置窗口（单实例、侧边栏布局、可缩放）
      wallpapers.ts      壁纸服务（内置/导入/URL 下载/应用/删除/设为桌面壁纸）
      themes.ts          UI 主题服务（内置预设 + 自定义主题持久化）
      tray.ts            托盘与菜单
      shortcuts.ts       全局快捷键
      commands.ts        插件命令注册表（托盘 / 快捷键 / 快捷操作共用）
      media/             ★ 截图 / 录屏能力（capture-dev 负责，Lead 注入 ctx.media）
      updater.ts         预留：更新检查
    testing/             测试模式脚本（Lead）
  preload/               预加载脚本（contextBridge，只暴露受控 API）
    panel.ts  ball.ts  overlay.ts  plugin-window.ts  recorder.ts  settings.ts
  renderer/              渲染进程（React 外壳 + 插件 UI 沙箱页）
    index.html           主面板
    ball.html            悬浮球
    overlay.html         区域截图遮罩
    recorder.html        隐藏录制页（capture-dev）
    settings.html        独立设置窗口
    src/
      shell/             外壳：路由、页面动效、弹层、Toast、悬浮球 UI（Lead）
      settings/          ★ 独立设置窗口：侧边栏 + 宽内容区 + 编辑器视图（Lead）
      ui/                设计系统基础组件（Lead）
      pages/settings/    ★ 设置 / 个性化 / 插件管理 / 代码编辑器
      theme/             设计令牌 + 全局样式 + glass-borders 黑玻璃边框 + settings-window.css
      lib/               bridge（window.tk 封装）、spring、smooth scroll（Lead）
      recorder/          ★ 录制页逻辑（capture-dev）
resources/
  plugin-sdk/sdk.js      插件 UI 通信 SDK（tk://plugin-sdk/sdk.js）
  plugin-sdk/theme.css   插件 UI 主题样式（tk://plugin-sdk/theme.css）
  plugin-sdk/glass-borders.css  插件黑玻璃边框层（由 theme.css @import）
  wallpapers/            内置壁纸（manifest.json + 6 张 1920×1080 JPEG，Lead/个性化）
  plugins/               内置插件（每个插件一个目录，独立归属）
    screenshot/          ★ capture-dev
    recorder/            ★ capture-dev
    memo/                ★ productivity-dev
    timer/               ★ productivity-dev
  icons/                 应用图标 / 托盘图标
tests/                   自动化测试（Lead 装配，插件作者补充各自用例）
docs/                    文档（架构 / 插件 SDK / 用户手册 / UI 设计说明）
```

★ = 由对应 teammate 独占写入；其余由 Lead 维护。禁止跨区修改，需要契约变更时先联系 Lead。

## 运行与验证

```powershell
npm run build      # Vite 构建渲染层 + esbuild 打包 main/preload（约 3~5s）
npm start          # 构建并启动应用
npm run typecheck  # tsc 检查
npm run smoke      # 自动冒烟测试：启动应用、截图、跑 IPC、校验输出，报告在 artifacts/
npm run package    # 打包绿色版（复制本地 Electron 运行时 + resedit 写图标/版本）到 release/
```

插件目录不参与编译：改完直接 `npm start` 重启即可生效；设置里的“重新加载插件”可热重载。

## 进程与窗口模型

| 窗口 | 说明 |
| --- | --- |
| ball | 72×72 透明无边框常驻悬浮球，可拖动、可隐藏，点击开关主面板 |
| panel | 452×652 透明无边框主面板（Win11 acrylic 毛玻璃 + CSS 玻璃层），页面切换为弹簧动效 |
| settings | 独立设置窗口（默认 920×720，可缩放），侧边栏分类 + 宽内容区；关闭只隐藏，单实例复用 |
| overlay | 每个显示器一块全屏透明遮罩，用于框选区域截图 |
| mini-* | 插件通过 `ctx.windows.open()` 创建的持久小窗（如计时器桌面悬浮窗） |
| recorder | 隐藏窗口，持有 `getDisplayMedia`/MediaRecorder，负责把录制数据流回主进程落盘 |
| plugin-* | 插件 UI 独立窗口（如计时器 mini），通过 preload 桥接，与主面板同源 SDK |

## IPC 契约

统一信封：`{ ok: true, data } | { ok: false, error: { code, message, detail? } }`

- 渲染层预加载暴露 `window.tk`（详见 `src/preload/panel.ts`）：
  - `tk.invoke(service, method, args?)`：通用调用，`service='core'` 走内核服务；插件 UI 由 SDK 转发到 `tk.plugin.call`。
  - `tk.on(topic, cb)`：订阅主进程广播（设置变化、插件事件等）。
  - 窗口级 API：`tk.ball.*`、`tk.panel.*`、`tk.overlay.*`、`tk.plugin.*`；设置窗口另有 `tk.settingsWindow.*`（ready/close/minimize）。
- 主进程通道：`tk:call`、`tk:plugin-call`、`tk:plugin-event`；窗口广播 `tk:event`。
- 设置窗口专用：`settings.openWindow({tab?})`、`settings.closeWindow`、`settings.minimizeWindow`、`settings.windowReady`；打开指定分类用 `settings:tab` 事件下发。
- 个性化：`wallpapers.list/current/import/download/apply/remove/setDesktop`、`themes.list/apply/save/delete`。
- 编辑器文件：`plugins.createFile`、`plugins.deleteFile`、`plugins.restoreDeleted`（`plugins.files` 返回 `deletedFiles`）。
- 插件后端 IPC：`ctx.ipc.handle(method, handler)`，对应 UI 的 `toolkit.invoke(method, args)`。
- 插件后端事件：`ctx.events.broadcast(topic, payload)` → 该插件所有 UI 的 `toolkit.on(topic, cb)`；
  UI → 后端：`toolkit.send(topic, payload)` → `ctx.events.on(topic, cb)`。

## 插件（工具模块）机制

- 每个工具 = 一个目录：`plugin.json`（清单）+ `main.js`（后端 ESM 模块）+ UI 静态文件。
- 内置插件位于 `resources/plugins/<id>`，**只读**；用户编辑写入覆盖层
  `%APPDATA%/便捷工具/overrides/<id>/...`，加载时优先读取覆盖文件。
- 启停 / 重载 / 编辑入口在设置页；编辑保存时：
  1. 语法校验（`node:vm` 编译 main.js、JSON 解析 plugin.json）；
  2. 自动备份当前覆盖层到 `backups/<id>/<time>/`；
  3. 写入覆盖层并热重载插件；失败自动回滚并回报错误；
  4. “恢复默认”删除覆盖层并重载。
- **文件墓碑**：编辑器里删除内置文件不会改动 `resources/plugins`，而是把相对路径写入 `overrides/<id>/.deleted.json`；`resolveFile/readManifest/files/readFile` 都会跳过墓碑，写入/新建同名文件会自动移除墓碑恢复。删除覆盖层文件则直接移除覆盖，露出内置原版。
- 新建文件：`createFile(id, relPath, content?)` 自动创建子目录、按扩展名给模板、备份并热重载；恢复：`restoreDeletedFile(id, relPath)`。若删除 `plugin.json` 导致插件失效，插件仍保留在列表中（错误态），可进入编辑器恢复。
- 新插件：设置 → 扩展 → 新建插件，生成用户插件目录模板（`%APPDATA%/便捷工具/plugins/<id>`）。
- 内置插件的 `plugin.json` 可声明 `commands`（托盘/快捷键命令），`ctx.commands.register` 注册后由内核统一派发。

## 设置项（核心 schema，变更需同步 `shared/types.ts` 与设置页）

`general`：开机自启、关闭主面板行为、显示悬浮球、记住面板尺寸。
`appearance`：强调色、面板不透明度、毛玻璃、动画强度（full/lite/off）、球尺寸/透明度/自动隐藏/贴边吸附/贴边半隐藏、窗口置顶、Dock、壁纸选择器（`'' | builtin:<id> | user:<file>`）与壁纸可见度。
`shortcuts`：开关面板、区域截图、全屏截图、开始/停止录制、备忘录。
`capture`：保存目录、格式、自动复制、完成后回到面板。
`recorder`：保存目录、帧率、清晰度、音频来源（系统/麦克风/两者）、倒计时、格式。
`data`：导出/导入/清理。

## 稳定性约定

1. 任何插件加载失败、IPC 异常、窗口创建失败都必须被捕获并降级，不能拖垮主进程。
2. 所有文件写入使用“临时文件 + rename”原子替换；数据损坏时自动回退到 `.bak`。
3. 主进程禁止同步阻塞长任务；录屏分片写入磁盘，不驻留内存。
4. 渲染层未捕获错误上报日志，不白屏；插件 iframe 崩溃只影响该 iframe。
5. 所有窗口遵守 CSP；插件 iframe `sandbox="allow-scripts allow-forms"`，无 Node 权限。

## 测试要求

- Lead 提供 `npm run smoke`：启动真实应用，跑 20 项检查（窗口/悬浮球贴边/截图/录屏/计时器/独立设置窗口/个性化主题壁纸/编辑器文件增删恢复/插件热重载），产出 `artifacts/` 截图与 `report.json`。
- teammate 只写自己模块的单元/集成用例到 `tests/<module>.test.mjs`（Node 原生 test runner，`node --test`），并保证 `npm run smoke` 相关断言通过。



