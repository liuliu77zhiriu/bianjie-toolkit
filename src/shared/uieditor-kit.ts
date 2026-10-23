/** UI 编辑器 · 节点/工程工厂与通用工具（主进程、渲染层、导出器共用） */
import type {
  UIAlign,
  UIDesignTokens,
  UIEditorProjectSummary,
  UIGradient,
  UIInteraction,
  UIJustify,
  UINode,
  UINodeStyle,
  UINodeType,
  UIProject,
  UIProjectSettings,
  UIScreen,
  UIShadow,
  UITextAlign,
} from './uieditor';

let idSeed = 0;
export function newId(prefix = 'n'): string {
  idSeed = (idSeed + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${idSeed.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export const DEFAULT_STYLE: UINodeStyle = {
  x: 0,
  y: 0,
  width: 120,
  height: 40,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  clip: false,
  layout: 'free',
  gap: 8,
  padding: 0,
  align: 'stretch',
  justify: 'start',
  fill: 'rgba(255,255,255,0.05)',
  gradient: null,
  stroke: 'rgba(255,255,255,0.12)',
  strokeWidth: 1,
  radius: [10, 10, 10, 10],
  shadow: null,
  blur: 0,
  backgroundImage: '',
  color: '#e8ecf4',
  fontFamily: 'system-ui',
  fontSize: 14,
  fontWeight: 400,
  lineHeight: 1.4,
  letterSpacing: 0,
  textAlign: 'left',
  textTransform: 'none',
  textDecoration: 'none',
};

export const DEFAULT_PROJECT_SETTINGS: UIProjectSettings = {
  showGrid: true,
  gridSize: 8,
  snapToGrid: true,
  snapToGuides: true,
  showRulers: true,
};

export const DEFAULT_TOKENS: UIDesignTokens = {
  colors: [
    { id: 'c-accent', name: '强调色', value: '#4C8DFF' },
    { id: 'c-accent-2', name: '强调色亮', value: '#7FB0FF' },
    { id: 'c-text', name: '主文字', value: '#E8ECF4' },
    { id: 'c-muted', name: '次级文字', value: '#8A94A6' },
    { id: 'c-surface', name: '面板', value: 'rgba(16,18,26,0.86)' },
    { id: 'c-surface-2', name: '浮层', value: 'rgba(255,255,255,0.055)' },
    { id: 'c-border', name: '边框', value: 'rgba(255,255,255,0.12)' },
    { id: 'c-success', name: '成功', value: '#3DDC97' },
    { id: 'c-warning', name: '警告', value: '#FFB454' },
    { id: 'c-danger', name: '危险', value: '#FF6B81' },
    { id: 'c-black', name: '纯黑', value: '#05060A' },
    { id: 'c-white', name: '纯白', value: '#FFFFFF' },
  ],
  spacing: [
    { id: 's-1', name: '4', value: 4 },
    { id: 's-2', name: '8', value: 8 },
    { id: 's-3', name: '12', value: 12 },
    { id: 's-4', name: '16', value: 16 },
    { id: 's-5', name: '24', value: 24 },
    { id: 's-6', name: '32', value: 32 },
  ],
  radii: [
    { id: 'r-1', name: '小', value: 6 },
    { id: 'r-2', name: '中', value: 10 },
    { id: 'r-3', name: '大', value: 14 },
    { id: 'r-4', name: '胶囊', value: 999 },
  ],
  text: [
    { id: 't-display', name: '大标题', fontSize: 30, fontWeight: 600, color: '#F5F7FB', lineHeight: 1.25 },
    { id: 't-title', name: '标题', fontSize: 20, fontWeight: 600, color: '#E8ECF4', lineHeight: 1.3 },
    { id: 't-body', name: '正文', fontSize: 14, fontWeight: 400, color: '#C8D0DE', lineHeight: 1.5 },
    { id: 't-caption', name: '说明', fontSize: 12, fontWeight: 400, color: '#8A94A6', lineHeight: 1.4 },
    { id: 't-mono', name: '等宽', fontSize: 12, fontWeight: 500, color: '#A9D5FF', lineHeight: 1.4 },
  ],
};

export const NODE_TYPE_LABELS: Record<UINodeType, string> = {
  frame: '容器',
  rect: '矩形',
  ellipse: '圆形',
  line: '线段',
  text: '文本',
  image: '图片',
  icon: '图标',
  button: '按钮',
  input: '输入框',
  textarea: '文本域',
  toggle: '开关',
  slider: '滑杆',
  progress: '进度条',
  badge: '徽标',
  avatar: '头像',
  divider: '分割线',
  tabs: '选项卡',
  list: '列表',
  spacer: '占位',
};

export function accentRgb(hex: string): string {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!match) return '76, 141, 255';
  const value = parseInt(match[1], 16);
  return `${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}`;
}

export function gradientCss(gradient: UIGradient | null | undefined): string | null {
  if (!gradient) return null;
  return `linear-gradient(${gradient.angle}deg, ${gradient.from}, ${gradient.to})`;
}

export function shadowCss(shadow: UIShadow | null | undefined): string | null {
  if (!shadow) return null;
  return `${shadow.x}px ${shadow.y}px ${shadow.blur}px ${shadow.spread}px ${shadow.color}`;
}

export function radiusCss(radius: [number, number, number, number]): string {
  const [tl, tr, br, bl] = radius;
  return `${tl}px ${tr}px ${br}px ${bl}px`;
}

export interface CreateNodePatch extends Omit<Partial<UINode>, 'style'> {
  style?: Partial<UINodeStyle>;
  locked?: boolean;
  hidden?: boolean;
}

export function createNode(type: UINodeType, patch: CreateNodePatch = {}): UINode {
  const style: UINodeStyle = { ...DEFAULT_STYLE, ...stylePreset(type), ...(patch.style ?? {}) };
  const base: UINode = {
    id: patch.id ?? newId(type),
    type,
    name: patch.name ?? NODE_TYPE_LABELS[type],
    parentId: patch.parentId ?? null,
    children: patch.children ? [...patch.children] : [],
    style,
  };
  if (patch.text !== undefined) base.text = patch.text;
  if (patch.image !== undefined) base.image = patch.image;
  if (patch.icon !== undefined) base.icon = patch.icon;
  if (patch.placeholder !== undefined) base.placeholder = patch.placeholder;
  if (patch.value !== undefined) base.value = patch.value;
  if (patch.checked !== undefined) base.checked = patch.checked;
  if (patch.percent !== undefined) base.percent = patch.percent;
  if (patch.label !== undefined) base.label = patch.label;
  if (patch.items !== undefined) base.items = [...patch.items];
  if (patch.states !== undefined) base.states = patch.states;
  if (patch.interaction !== undefined) base.interaction = patch.interaction;
  if (patch.locked !== undefined) base.style.locked = patch.locked;
  if (patch.hidden !== undefined) base.style.visible = !patch.hidden;
  if (patch.component !== undefined) base.component = patch.component;
  return base;
}

function stylePreset(type: UINodeType): Partial<UINodeStyle> {
  switch (type) {
    case 'frame':
      return { width: 320, height: 220, fill: 'rgba(255,255,255,0.035)', stroke: 'rgba(255,255,255,0.1)', radius: [14, 14, 14, 14], clip: true };
    case 'rect':
      return { width: 160, height: 100, fill: 'rgba(76,141,255,0.16)', stroke: 'rgba(76,141,255,0.4)' };
    case 'ellipse':
      return { width: 64, height: 64, fill: 'rgba(76,141,255,0.2)', stroke: 'rgba(76,141,255,0.45)', radius: [999, 999, 999, 999] };
    case 'line':
      return { width: 160, height: 1, fill: 'rgba(255,255,255,0.16)', stroke: 'rgba(255,255,255,0)', strokeWidth: 0, radius: [0, 0, 0, 0] };
    case 'text':
      return {
        width: 160,
        height: 24,
        fill: 'rgba(0,0,0,0)',
        stroke: 'rgba(255,255,255,0)',
        strokeWidth: 0,
        fontSize: 14,
        color: '#E8ECF4',
        radius: [0, 0, 0, 0],
      };
    case 'image':
      return { width: 240, height: 160, fill: 'rgba(255,255,255,0.06)', stroke: 'rgba(255,255,255,0.1)', radius: [12, 12, 12, 12], clip: true };
    case 'icon':
      return { width: 24, height: 24, fill: 'rgba(0,0,0,0)', stroke: 'rgba(255,255,255,0)', strokeWidth: 0, radius: [0, 0, 0, 0] };
    case 'button':
      return {
        width: 120,
        height: 38,
        fill: '#4C8DFF',
        stroke: 'rgba(255,255,255,0.2)',
        strokeWidth: 1,
        radius: [10, 10, 10, 10],
        color: '#FFFFFF',
        fontSize: 13,
        fontWeight: 600,
        textAlign: 'center',
      };
    case 'input':
      return {
        width: 220,
        height: 40,
        fill: 'rgba(255,255,255,0.045)',
        stroke: 'rgba(255,255,255,0.12)',
        radius: [10, 10, 10, 10],
        color: '#E8ECF4',
        fontSize: 13,
      };
    case 'textarea':
      return {
        width: 220,
        height: 92,
        fill: 'rgba(255,255,255,0.045)',
        stroke: 'rgba(255,255,255,0.12)',
        radius: [10, 10, 10, 10],
        color: '#E8ECF4',
        fontSize: 13,
      };
    case 'toggle':
      return { width: 44, height: 24, fill: 'rgba(255,255,255,0.1)', stroke: 'rgba(255,255,255,0.14)', radius: [999, 999, 999, 999] };
    case 'slider':
      return { width: 200, height: 24, fill: 'rgba(255,255,255,0.08)', stroke: 'rgba(255,255,255,0)', strokeWidth: 0, radius: [999, 999, 999, 999] };
    case 'progress':
      return { width: 200, height: 8, fill: 'rgba(255,255,255,0.08)', stroke: 'rgba(255,255,255,0)', strokeWidth: 0, radius: [999, 999, 999, 999] };
    case 'badge':
      return { width: 56, height: 22, fill: 'rgba(76,141,255,0.2)', stroke: 'rgba(76,141,255,0.4)', radius: [999, 999, 999, 999], color: '#7FB0FF', fontSize: 11, fontWeight: 600, textAlign: 'center' };
    case 'avatar':
      return { width: 40, height: 40, fill: 'rgba(76,141,255,0.35)', stroke: 'rgba(255,255,255,0.18)', radius: [999, 999, 999, 999] };
    case 'divider':
      return { width: 200, height: 1, fill: 'rgba(255,255,255,0.12)', stroke: 'rgba(255,255,255,0)', strokeWidth: 0, radius: [0, 0, 0, 0] };
    case 'tabs':
      return { width: 280, height: 38, fill: 'rgba(255,255,255,0.045)', stroke: 'rgba(255,255,255,0.1)', radius: [10, 10, 10, 10], fontSize: 12 };
    case 'list':
      return { width: 300, height: 180, fill: 'rgba(255,255,255,0.035)', stroke: 'rgba(255,255,255,0.1)', radius: [12, 12, 12, 12], clip: true };
    case 'spacer':
    default:
      return { width: 24, height: 24, fill: 'rgba(0,0,0,0)', stroke: 'rgba(255,255,255,0)', strokeWidth: 0, radius: [0, 0, 0, 0] };
  }
}

export function createProject(name = '未命名设计', width = 960, height = 640): UIProject {
  const now = new Date().toISOString();
  const project: UIProject = {
    schemaVersion: 1,
    id: newId('proj'),
    name,
    description: '',
    createdAt: now,
    updatedAt: now,
    screens: [],
    nodes: {},
    tokens: structuredCloneSafe(DEFAULT_TOKENS),
    settings: { ...DEFAULT_PROJECT_SETTINGS },
  };
  const screen = createScreen(project, '主页面', width, height, '#07090F');
  ensureScreenRoot(project, screen.id);
  return project;
}

export function createScreen(
  project: UIProject,
  name: string,
  width = 960,
  height = 640,
  background = '#07090F'
): UIScreen {
  const screen: UIScreen = {
    id: newId('screen'),
    name,
    width,
    height,
    background,
    rootIds: [],
  };
  project.screens.push(screen);
  return screen;
}

/** 返回当前屏幕用于放置根节点的容器节点（自动创建"画板"frame） */
export function ensureScreenRoot(project: UIProject, screenId: string): UINode {
  const screen = project.screens.find((item) => item.id === screenId);
  if (!screen) throw new Error(`屏幕不存在：${screenId}`);
  const existing = screen.rootIds.map((id) => project.nodes[id]).find((node) => node && node.type === 'frame' && node.name === '画板');
  if (existing) return existing;
  const root = createNode('frame', {
    name: '画板',
    style: {
      x: 0,
      y: 0,
      width: screen.width,
      height: screen.height,
      fill: 'rgba(0,0,0,0)',
      stroke: 'rgba(255,255,255,0)',
      strokeWidth: 0,
      radius: [0, 0, 0, 0],
      clip: true,
    },
  });
  root.parentId = null;
  project.nodes[root.id] = root;
  screen.rootIds.unshift(root.id);
  return root;
}

export interface InsertedNodes {
  rootId: string;
  nodeIds: string[];
}

/**
 * 把一段相对节点（parentId null 为根）插入到指定屏幕/父节点。
 * 返回新根节点 id 和全部新节点 id。
 */
export function insertNodes(
  project: UIProject,
  screenId: string,
  nodes: UINode[],
  parentId: string | null,
  offset?: { x?: number; y?: number }
): InsertedNodes {
  const parent = parentId ? project.nodes[parentId] : ensureScreenRoot(project, screenId);
  if (!parent) throw new Error(`父节点不存在：${parentId}`);
  const idMap = new Map<string, string>();
  for (const node of nodes) if (!idMap.has(node.id)) idMap.set(node.id, newId(node.type));
  const roots = nodes.filter((node) => !node.parentId || !nodes.some((item) => item.id === node.parentId));
  if (!roots.length) throw new Error('插入内容为空');
  for (const original of nodes) {
    const clone = cloneNodeWithMap(original, idMap, parent.id);
    clone.children = original.children.map((childId) => idMap.get(childId)!).filter(Boolean);
    if (roots.includes(original)) {
      clone.parentId = parent.id;
      clone.style.x += offset?.x ?? 0;
      clone.style.y += offset?.y ?? 0;
    } else {
      clone.parentId = idMap.get(original.parentId ?? '') ?? parent.id;
    }
    project.nodes[clone.id] = clone;
  }
  for (const root of roots) parent.children.push(idMap.get(root.id)!);
  const rootId = idMap.get(roots[0].id)!;
  return { rootId, nodeIds: [...idMap.values()] };
}

export function cloneNodeWithMap(node: UINode, idMap: Map<string, string>, parentId: string | null): UINode {
  return {
    ...structuredCloneSafe(node),
    id: idMap.get(node.id)!,
    parentId,
    children: node.children.map((child) => idMap.get(child) ?? child),
    style: { ...node.style, radius: [...node.style.radius] as [number, number, number, number] },
  };
}

/** 深拷贝节点子树（用于复制/粘贴/组件预设），自动重新生成 id */
export function cloneNodeSubtree(
  project: UIProject,
  screenId: string,
  nodeId: string,
  parentId?: string | null
): InsertedNodes {
  const root = project.nodes[nodeId];
  if (!root) throw new Error(`节点不存在：${nodeId}`);
  const nodes: UINode[] = [];
  const visit = (id: string) => {
    const node = project.nodes[id];
    if (!node) return;
    nodes.push(node);
    for (const child of node.children) visit(child);
  };
  visit(nodeId);
  const cloneNodesDeep = nodes.map((node) => structuredCloneSafe(node));
  const target = nodes[0];
  target.parentId = parentId ?? null;
  target.style.x += 16;
  target.style.y += 16;
  return insertNodes(project, screenId, cloneNodesDeep, root.parentId ? (parentId ?? root.parentId) : null);
}

export function findScreenOfNode(project: UIProject, nodeId: string): UIScreen | null {
  let current: UINode | undefined = project.nodes[nodeId];
  while (current) {
    if (!current.parentId) {
      return project.screens.find((screen) => screen.rootIds.includes(current!.id)) ?? null;
    }
    current = project.nodes[current.parentId];
  }
  return null;
}

export function screenNodeIds(project: UIProject, screenId: string): string[] {
  const screen = project.screens.find((item) => item.id === screenId);
  if (!screen) return [];
  const ids: string[] = [];
  const visit = (id: string) => {
    ids.push(id);
    const node = project.nodes[id];
    if (node) for (const child of node.children) visit(child);
  };
  for (const id of screen.rootIds) visit(id);
  return ids;
}

export function projectSummary(project: UIProject): UIEditorProjectSummary {
  const accent = project.tokens.colors.find((color) => color.id === 'c-accent')?.value ?? '#4C8DFF';
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    updatedAt: project.updatedAt,
    screenCount: project.screens.length,
    nodeCount: Object.keys(project.nodes).length,
    accent,
  };
}

export function structuredCloneSafe<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

export function touchProject(project: UIProject): UIProject {
  project.updatedAt = new Date().toISOString();
  return project;
}

export function makeStyle(patch: Partial<UINodeStyle> = {}): UINodeStyle {
  return { ...DEFAULT_STYLE, ...patch };
}

export const TEXT_ALIGN_OPTIONS: Array<{ value: UITextAlign; label: string }> = [
  { value: 'left', label: '左对齐' },
  { value: 'center', label: '居中' },
  { value: 'right', label: '右对齐' },
  { value: 'justify', label: '两端对齐' },
];

export const ALIGN_OPTIONS: Array<{ value: UIAlign; label: string }> = [
  { value: 'start', label: '起始' },
  { value: 'center', label: '居中' },
  { value: 'end', label: '结束' },
  { value: 'stretch', label: '拉伸' },
];

export const JUSTIFY_OPTIONS: Array<{ value: UIJustify; label: string }> = [
  { value: 'start', label: '起始' },
  { value: 'center', label: '居中' },
  { value: 'end', label: '结束' },
  { value: 'space-between', label: '两端' },
];

export type { UIInteraction };

