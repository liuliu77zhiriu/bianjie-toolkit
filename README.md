# 便捷工具（Bianjie Toolkit）

> 一个常驻桌面的小工具箱：悬浮球唤起，蓝黑毛玻璃面板，截图 / 录屏 / 备忘录 / 计时器开箱即用，所有工具都是可编辑、可扩展的插件；还内置一个可视化 **UI 编辑器**，可以像 Unity 一样拖拽设计界面并导出 HTML / React / 应用内插件。

![主面板](docs/images/panel-home.png)


## 界面预览

| 主面板 | 截图 | 备忘录 |
| --- | --- | --- |
| ![主面板](docs/images/panel-home.png) | ![截图](docs/images/tool-screenshot.png) | ![备忘录](docs/images/tool-memo.png) |

| 计时器 | 录屏 | 设置 |
| --- | --- | --- |
| ![计时器](docs/images/tool-timer.png) | ![录屏](docs/images/tool-recorder.png) | ![设置](docs/images/settings.png) |

| 桌面毛玻璃 | 区域框选 | 计时器迷你窗 |
| --- | --- | --- |
| ![桌面](docs/images/desktop-acrylic.png) | ![框选](docs/images/overlay-select.png) | ![迷你窗](docs/images/timer-mini.png) |

| 独立设置窗口 | 个性化（主题 / 壁纸） | 面板壁纸效果 |
| --- | --- | --- |
| ![设置窗口](docs/images/settings-window.png) | ![个性化](docs/images/personalize.png) | ![壁纸](docs/images/panel-wallpaper.png) |

| 壁纸库 | 代码编辑器 |
| --- | --- |
| ![壁纸库](docs/images/personalize-wallpapers.png) | ![编辑器](docs/images/editor-window.png) |

| UI 编辑器 | 原型预览 | 导出独立 HTML |
| --- | --- | --- |
| ![UI 编辑器](docs/images/ui-editor.png) | ![原型预览](docs/images/ui-editor-preview.png) | ![导出 HTML](docs/images/ui-editor-export.png) |

| 流光搜索 | 下载队列 | 搜索结果 |
| --- | --- | --- |
| ![流光搜索](docs/images/search-home.png) | ![下载队列](docs/images/search-downloads.png) | ![搜索结果](docs/images/search-results.png) |

## 特性

- **流光搜索**：白色基底 + 实时珠光流体 + 玻璃 UI 的搜索引擎与下载器；Bing/DuckDuckGo 聚合、搜索建议、历史/书签、断点续传下载队列、实时进度与速度；入口在首页底部中间。详见 [流光搜索文档](docs/SEARCH.md)。
- **UI 编辑器**：一个独立的大窗口设计工作台——自由画布（网格/标尺/吸附/参考线/缩放/框选）、图层树、29 个内置组件、7 套完整页面模板、设计令牌、状态样式、交互原型、多页面、工程库；一键导出**自包含 HTML / React 组件 / 工程 JSON**，或发布为应用内工具。详见 [UI 编辑器文档](docs/UI_EDITOR.md)。
- **悬浮球**：72px 透明玻璃球，点击唤出面板；可拖动、贴边吸附、自动淡出；拖到屏幕左/右边缘会**半隐藏成一条亮边**，鼠标靠近自动弹出、移开重新藏回（可在外观设置关闭）。
- **轻量稳定**：Electron 38 + React 19，主进程模块化服务 + 插件隔离沙箱（iframe）；单个插件崩溃不影响外壳。
- **半透明黑玻璃 + 渐变边框**：中性炭黑底、1px 方向性渐变边、内高光与外环，hover 只提亮边框，层级由边框表达（见 [UI 设计说明](docs/UI_DESIGN.md)）。
- **独立设置窗口**：点击设置按钮 / 托盘「设置」会打开一个可缩放的独立窗口，侧边栏分类 + 宽内容区，不再挤在 452px 小面板里。
- **个性化**：内置 6 张 1920×1080 暗色壁纸可直接应用；支持导入本地图片、URL 下载、设为 Windows 桌面壁纸、壁纸可见度；6 套内置 UI 主题 + 自定义设计器（强调色 / 毛玻璃 / 透明度 / 动效 / 悬浮球 / Dock），可保存「我的主题」。
- **截图**：区域框选 / 全屏（多屏可选）/ 指定窗口，自动保存 + 剪贴板 + 预览，支持 PNG/JPG。
- **录屏**：屏幕或指定窗口录制，系统声音/麦克风混音，MP4（H.264）优先、WebM 兜底，倒计时、录制指示器小窗、一键停止。
- **备忘录**：快速记录、搜索、置顶、防抖自动保存，本地持久化。
- **计时器**：秒表（计次）+ 倒计时（预设/自定义），后端权威计时，开始时自动在桌面显示迷你窗，关面板继续计时。
- **设置**：通用 / 外观 / 个性化 / 快捷键 / 截图 / 录制 / 扩展 / 关于，全部真实生效。
- **插件与代码编辑**：所有工具（含内置）都可以在设置里查看源码、修改并热重载；覆盖层 + 自动备份 + 语法校验 + 失败回滚，支持新建/导入插件；编辑模式可**新建文件、删除文件（内置文件以可恢复墓碑隐藏）、恢复已删除文件**，支持全屏编辑与拖拽分栏。

## 快捷键（默认，可在设置中修改）

| 动作 | 快捷键 |
| --- | --- |
| 显示 / 隐藏面板 | `Alt + Space` |
| 区域截图 | `Alt + A` |
| 全屏截图 | `Alt + S` |
| 开始 / 停止录制 | `Alt + R` |
| 打开备忘录 | `Alt + M` |

## 快速开始

**直接使用**：解压 `release/便捷工具-v1.0.0-win64.zip` 后运行 `便捷工具.exe`（绿色免安装，首次启动会在 `%APPDATA%\便捷工具` 建立数据目录）；也可以直接运行 `release/便捷工具-win32-x64/便捷工具.exe`。

**桌面快捷方式**：已创建桌面与开始菜单快捷方式「便捷工具」。如果移动了程序目录，运行下面命令重新创建：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/create-shortcut.ps1
# 或指定 exe：-Target "D:\Tools\便捷工具\便捷工具.exe"
```

**从源码运行**：

```powershell
npm install
npm run build
npm start
```

更多说明见 [用户手册](docs/USER_GUIDE.md)、[UI 编辑器文档](docs/UI_EDITOR.md)、[流光搜索文档](docs/SEARCH.md)、[架构文档](docs/ARCHITECTURE.md) 与 [UI 设计说明](docs/UI_DESIGN.md)。

## 开发

```powershell
npm install          # 安装依赖（Electron 使用本地缓存版本）
npm run build        # Vite 构建渲染层 + esbuild 打包 main/preload
npm start            # 启动应用
npm run typecheck    # TypeScript 检查
npm run smoke        # 真实应用冒烟/E2E（截图、录屏、插件、设置、热重载；产物在 artifacts/smoke）
npm run package      # 打包绿色版到 release/
```

插件开发规范见 [docs/PLUGIN_SDK.md](docs/PLUGIN_SDK.md)。每个工具都是 `resources/plugins/<id>/` 下的独立目录，用户修改写入覆盖层，不动内置文件。

## 目录结构

```
src/main      主进程：窗口、托盘、设置、插件宿主、截图/录屏媒体服务
src/preload   contextBridge 预加载脚本
src/renderer  React 外壳（悬浮球 / 面板 / 遮罩 / 录制页）+ 插件 iframe
resources     内置插件（screenshot/recorder/memo/timer）、UI SDK、图标
docs          架构、插件 SDK、用户手册
tests         单元测试（node --test）
scripts       构建 / 启动 / 冒烟测试 / 打包 / 图标生成
```

## 稳定性设计

- 所有数据写入使用「临时文件 + rename」原子替换，损坏时自动回退 `.bak`；
- 插件加载、IPC、窗口创建全部 try/catch 降级，插件错误只影响自身并在设置页展示；
- 录制分片直接落盘、不驻留内存，隐藏窗口可回退「屏幕外可见」方案保证有帧；
- 退出流程有 3 秒清理超时 + 5 秒强制结束兜底，避免进程残留；
- 单实例锁、只允许受控协议 `tk://`，插件 iframe 使用 `sandbox` 且无 Node 权限。

## 已知限制

- 仅支持 Windows（依赖 Windows Graphics Capture / DWM 毛玻璃；Windows 10 无 acrylic 时自动降级为 CSS 玻璃）。
- 录屏容器优先 MP4（Chromium 支持时），否则为 WebM；未内置转码器。
- 全局快捷键若被其它软件占用，会在设置中提示冲突，需手动更换。

## 许可

MIT





