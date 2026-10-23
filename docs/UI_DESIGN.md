# UI 设计说明 · 半透明黑玻璃与边框体系

本轮 UI 优化目标：**半透明黑色背景** + **以边框为核心的层级表达**。在半透明毛玻璃的基础上，把「边框」从普通的 1px 色块升级为一套有方向、有冷暖、有高光层次的描边系统。

## 参考的 GitHub UI Skills（已下载到本地）

按「官方 / 高关注度优先」筛选，并实际下载了 skill 文档到本地参考（未随包分发）：

| 来源 | 内容 | 下载位置 |
| --- | --- | --- |
| [anthropics/skills](https://github.com/anthropics/skills)（Anthropic 官方技能仓库，star-history 显示十万级关注） | `frontend-design`：有意图的视觉层级、克制装饰、边框即结构、自评与质量底线 | `vendor/ui-skills/anthropics-skills/skills/frontend-design` |
| [MengTo/Skills](https://github.com/MengTo/Skills)（Design+Code 作者 MengTo 的 Agent Skills 仓库） | `glass-dark-ui`：dark glass tokens、伪元素遮罩渐变边框、对比度清单；`dark-glass-clean-layout`：近黑底、细亮边、低戏剧化 hover | `vendor/ui-skills/refs/mengto-*.md` |
| [ezra-y/awesome-claude-ui-armory](https://github.com/ezra-y/awesome-claude-ui-armory) | 高星 UI skills 索引，用于筛选和交叉验证方向 | `vendor/ui-skills/awesome-claude-ui-armory` |
| [anthropics/skills · theme-factory](https://github.com/anthropics/skills/tree/main/skills/theme-factory) | `midnight-galaxy` 等深色主题配色思路 | `vendor/ui-skills/anthropics-skills/skills/theme-factory` |

> 下载内容仅作设计参考，保存在本地 `vendor/`（已加入 .gitignore，不进入安装包）。上游 LICENSE 见各仓库。

## 采用的视觉原则

1. **背景退后，结构前置**：面板底色改为中性炭黑半透明（去掉大面积蓝色雾），内容层级主要靠表面的明度差与 1px 边框表达，蓝色只保留给强调色、状态点和边缘冷光。
2. **边框是信息，不是装饰**：面板 → 分组 → 卡片 → 控件，四级边框依次减弱；hover 只提升边框/内高光，不做大面积颜色翻转。
3. **三层描边**：外层 1px 渐变边（左上亮、右下冷、底边收暗）+ 1px 内高光 + 1px 黑色外环，让黑玻璃在桌面背景上有明确边界。
4. **克制的玻璃高光**：面板只有一层低透明度斜向反光，不再叠加彩色光斑；阴影更深、更柔，避免「发光卡片」感。
5. **可访问性底线**：正文保持高对比亮灰；次级文字不低于 `#b6bcc9`；焦点态使用强调色描边 + 3px 低透明光晕。

## 设计令牌（`theme/glass-borders.css`）

| Token | 值 | 用途 |
| --- | --- | --- |
| `--tk-bg` | `#05060a` | 近黑中性底 |
| `--tk-surface` | `rgba(12,13,18,.66)` | 黑玻璃表面 |
| `--tk-surface-2/3` | `rgba(18,20,26,.58)` / `rgba(26,29,36,.52)` | 浮起层 / 控件层 |
| `--tk-border` | `rgba(255,255,255,.10)` | 常规发丝边 |
| `--tk-border-strong` | `rgba(255,255,255,.22)` | hover / 选中边 |
| `--tk-text` / `-2` / `-3` | `#f1f3f8` / `#b6bcc9` / `#767e8d` | 三级文字 |
| `--tk-hairline-top` | `inset 0 1px 0 rgba(255,255,255,.06)` | 顶部内高光 |

默认面板不透明度从 0.86 调整为 **0.84**，配合 Win11 acrylic 保持「能看到桌面、但读得清内容」的半透明黑。

## 边框实现（三种模式）

### 1. 面板 / 卡片 / Dock：`background-clip` 渐变边框

```css
border: 1px solid transparent;
background-image:
  /* 内部填充层（padding-box） */
  linear-gradient(158deg, rgba(13,14,19,.84), rgba(2,3,6,.91)),
  /* 边框层（border-box，仅 1px 可见） */
  linear-gradient(148deg,
    rgba(255,255,255,.40) 0%,
    rgba(140,180,255,.34) 13%,
    rgba(255,255,255,.07) 36%,
    rgba(255,255,255,.025) 56%,
    rgba(140,180,255,.22) 84%,
    rgba(255,255,255,.30) 100%);
background-origin: border-box;
background-clip: padding-box, border-box;
box-shadow: 0 0 0 1px rgba(0,0,0,.6), 0 30px 84px rgba(0,0,0,.68),
            inset 0 1px 0 rgba(255,255,255,.06);
```

### 2. hover 边框：伪元素遮罩渐变

参考 `glass-dark-ui` 的 mask 技法，鼠标悬停时用伪元素叠加一圈强调色渐变边，避免布局重绘：

```css
.tool-card::after {
  content: ""; position: absolute; inset: 0; border-radius: inherit; padding: 1px;
  background: linear-gradient(148deg, rgba(255,255,255,.5), rgba(var(--card-accent),.55) 34%, rgba(255,255,255,.24));
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  opacity: 0; transition: opacity .24s;
}
.tool-card:hover::after { opacity: 1; }
```

### 3. 分隔与控件边

- 顶栏底部的渐隐细线（两端透明）。
- 设置分组、列表行、输入框、开关、徽标统一使用 `rgba(255,255,255,.08~.12)` 发丝边 + 内高光。
- 插件 UI 通过 `theme.css` 顶部 `@import "tk://plugin-sdk/glass-borders.css"` 自动继承同一套黑玻璃边框，第三方插件无需改代码。

### 4. 独立设置窗口与个性化

- 设置窗口不再复用 452px 面板布局，而是 920×720 可缩放窗口：左侧 206px 侧边栏（图标 + 标签 + 当前项强调色光条），右侧宽内容区（页面标题/描述 + 可滚动内容）。
- 玻璃卡片使用同一套渐变边框；窗口本身带 18px 圆角、1px 方向渐变边与外阴影，标题栏可拖动，右上角最小化/关闭为自绘按钮。
- 个性化页使用卡片网格：主题卡带壁纸缩略背景 + 强调色圆点 + 「使用中」徽标；壁纸卡 2~3 列，hover 浮出「应用 / 设为桌面 / 删除」；设计器复用 Slider/Switch/Segmented 控件。
- 壁纸层：主面板与设置窗口内部各有一层 `.panel-wallpaper` / `.settings-wallpaper`（`background-size: cover`，可见度由 `wallpaperOpacity` 控制），位于黑玻璃背景与内容之间，保证文字对比度。
- 窗口放大时内容最大宽度 900px，避免超宽行；≤820px 时侧边栏收窄到 168px。

### 5. UI 编辑器工作台

- 独立深色专业工作台：顶栏（工程名 / 菜单 / 模式切换 / 导出 / 窗口控制）+ 页面 tabs + 工具栏 + 左/中/右三栏 + 状态栏；默认最大化，关闭只隐藏。
- 左 246px、右 310px，由 `--ue-left/--ue-right` 控制；中栏点阵网格、白色标尺、画板阴影，画板内容按用户设计渲染；选中框/手柄/参考线/尺寸标签用蓝色强调，缩放/平移通过 `translate3d + scale`。
- 右侧检查器独立实现 Slider/Switch/Segmented 等控件；设计令牌与交互状态用标签页切换；组件/模板以缩略卡片网格呈现；工程库为居中模态，显示主色缩略图、页面/节点数与更新时间。
- 预览为沉浸式全屏：暗色背景 + 居中画板 + 顶部屏幕切换；与导出的独立 HTML 视觉一致。
- 性能：节点 `React.memo`，缩放/选择/悬浮不重绘节点树；拖拽 rAF 合并；面板输入防抖；工程 900ms 自动保存。

## 变更文件

| 文件 | 内容 |
| --- | --- |
| `src/renderer/src/theme/glass-borders.css` | 新增：外壳黑玻璃令牌、面板/卡片/Dock/设置/Toast 渐变边框与内高光 |
| `resources/plugin-sdk/glass-borders.css` | 新增：插件侧同款黑玻璃边框 |
| `resources/plugin-sdk/theme.css` | 顶部引入插件黑玻璃边框层 |
| `src/renderer/src/main.tsx` | 在 shell.css 之后加载 glass-borders.css |
| `src/renderer/src/theme/shell.css` | 首页间距压缩，默认视图完整显示；滚动条弱化 |
| `src/shared/defaults.ts` | 面板默认不透明度 0.86 → 0.84 |
| `docs/images/*.png` | 更新为新的黑玻璃界面截图 |
| `src/renderer/src/editor/styles/editor.css` | 新增：UI 编辑器工作台（顶栏/工具栏/三栏/状态栏/预览/工程库） |
| `src/renderer/src/editor/canvas/canvas.css` | 新增：画布、节点、选择框、标尺、网格样式 |
| `src/renderer/src/editor/panels/panels.css` | 新增：图层/组件/模板/检查器/令牌/交互面板样式 |
| `docs/images/ui-editor*.png` | 新增：UI 编辑器、预览、HTML 导出截图 |

## 验证

- `npm run smoke`：21/21 通过（含截图、录屏、插件、独立设置窗口、个性化主题壁纸、编辑器文件增删恢复、UI 编辑器工作台/预览/HTML 导出/发布插件、overlay、热重载）。
- 真机截图复核：主面板、截图、备忘录、计时器、录屏、独立设置窗口、个性化、壁纸效果、编辑器、overlay 均正常；插件卡片与设置分组边框在黑底上可辨。
- 对比度抽查：正文/次级文字在近黑底上 ≥ 7:1 / 4.5:1；强调色蓝保持可读。
- 无新增依赖；构建产物仅增加约 8KB CSS。


