/**
 * UI 编辑器 · 数据模型
 *
 * 设计原则：
 * - 节点树规范化（nodes map + children 顺序），便于撤销/重做与局部更新；
 * - 节点几何尺寸使用画板像素，渲染时统一乘 zoom，导出时输出 CSS 像素；
 * - 视觉属性扁平化，检查器与导出器共用同一份定义；
 * - 交互/状态/设计令牌从第一天就进入 schema，避免后期破坏性升级。
 */

export type UINodeType =
  | 'frame'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'text'
  | 'image'
  | 'icon'
  | 'button'
  | 'input'
  | 'textarea'
  | 'toggle'
  | 'slider'
  | 'progress'
  | 'badge'
  | 'avatar'
  | 'divider'
  | 'tabs'
  | 'list'
  | 'spacer';

export type UILayoutMode = 'free' | 'row' | 'column';
export type UIAlign = 'start' | 'center' | 'end' | 'stretch';
export type UIJustify = 'start' | 'center' | 'end' | 'space-between';
export type UITextAlign = 'left' | 'center' | 'right' | 'justify';
export type UIFit = 'cover' | 'contain' | 'fill';

export interface UIGradient {
  from: string;
  to: string;
  angle: number;
}

export interface UIShadow {
  x: number;
  y: number;
  blur: number;
  spread: number;
  color: string;
}

export interface UINodeStyle {
  /* 布局（相对父节点 / 画板） */
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  clip: boolean;
  layout: UILayoutMode;
  gap: number;
  padding: number;
  align: UIAlign;
  justify: UIJustify;

  /* 填充与描边 */
  fill: string;
  gradient: UIGradient | null;
  stroke: string;
  strokeWidth: number;
  radius: [number, number, number, number];
  shadow: UIShadow | null;
  blur: number;
  backgroundImage: string;

  /* 文本 */
  color: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing: number;
  textAlign: UITextAlign;
  textTransform: 'none' | 'uppercase' | 'lowercase';
  textDecoration: 'none' | 'underline' | 'line-through';
}

export interface UIInteraction {
  /** 触发方式 */
  event: 'click' | 'hover' | 'load';
  /** 动作 */
  action: 'none' | 'navigate' | 'url' | 'back' | 'toggle' | 'copy' | 'command';
  /** 目标屏幕（navigate） */
  screenId?: string;
  /** 外部链接（url） */
  url?: string;
  /** 便捷工具命令（command） */
  command?: string;
  /** 切换变量的键（toggle） */
  target?: string;
  /** 过渡动画 */
  transition?: 'none' | 'fade' | 'slide-left' | 'slide-up' | 'scale';
}

export type UINodeStateKey = 'hover' | 'pressed' | 'active' | 'disabled';

export interface UINode {
  id: string;
  type: UINodeType;
  name: string;
  parentId: string | null;
  children: string[];
  style: UINodeStyle;
  text?: string;
  image?: { src: string; fit: UIFit; alt: string };
  icon?: { name: string; color: string };
  placeholder?: string;
  value?: string;
  checked?: boolean;
  /** 进度 / 滑杆数值 0~100 */
  percent?: number;
  /** 徽标 / 标签 / Tab 文案 */
  label?: string;
  /** Tabs 数据 */
  items?: string[];
  /** 状态样式（用于交互/预览） */
  states?: Partial<Record<UINodeStateKey, Partial<UINodeStyle>>>;
  interaction?: UIInteraction;
  /** 是否作为组件实例（组件库生成） */
  component?: string;
}

export interface UIScreen {
  id: string;
  name: string;
  width: number;
  height: number;
  background: string;
  /** 画板根节点（多个根节点时按顺序层叠） */
  rootIds: string[];
}

export interface UIColorToken {
  id: string;
  name: string;
  value: string;
}

export interface UISpacingToken {
  id: string;
  name: string;
  value: number;
}

export interface UITextToken {
  id: string;
  name: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  lineHeight: number;
}

export interface UIDesignTokens {
  colors: UIColorToken[];
  spacing: UISpacingToken[];
  radii: UISpacingToken[];
  text: UITextToken[];
}

export interface UIProjectSettings {
  showGrid: boolean;
  gridSize: number;
  snapToGrid: boolean;
  snapToGuides: boolean;
  showRulers: boolean;
}

export interface UIProject {
  schemaVersion: 1;
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  screens: UIScreen[];
  nodes: Record<string, UINode>;
  tokens: UIDesignTokens;
  settings: UIProjectSettings;
}

export interface UIEditorProjectSummary {
  id: string;
  name: string;
  description: string;
  updatedAt: string;
  screenCount: number;
  nodeCount: number;
  accent: string;
}

export interface UIEditorTemplate {
  id: string;
  name: string;
  description: string;
  category: 'page' | 'layout' | 'component';
  accent: string;
  tags: string[];
  create: () => UIProject;
}

export type UIEditorTool =
  | 'select'
  | 'hand'
  | 'frame'
  | 'rect'
  | 'ellipse'
  | 'line'
  | 'text'
  | 'image'
  | 'icon'
  | 'button'
  | 'input'
  | 'toggle'
  | 'slider'
  | 'progress'
  | 'badge'
  | 'divider'
  | 'tabs'
  | 'list';

export interface UIEditorViewState {
  tool: UIEditorTool;
  zoom: number;
  pan: { x: number; y: number };
  activeScreenId: string;
  selection: string[];
  hoverId: string | null;
  mode: 'design' | 'prototype' | 'preview';
}

/* ------------------------------------------------------------------ 设置窗口 IPC 契约 */

export interface UIEditorWindowState {
  open: boolean;
  projectId: string | null;
}

export interface UIEditorOpenOptions {
  projectId?: string;
  templateId?: string;
  /** 新建项目（不传 projectId/templateId 时使用 blank） */
  create?: boolean;
}

export interface UIEditorExportResult {
  ok: boolean;
  path?: string;
  error?: string;
}

export interface UIEditorPublishResult {
  ok: boolean;
  pluginId?: string;
  path?: string;
  error?: string;
}
