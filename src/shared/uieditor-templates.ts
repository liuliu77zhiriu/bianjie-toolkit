/**
 * UI 编辑器 · 页面模板库
 *
 * 每个模板用 `createProject` 新建工程（自带「画板」根 frame），再把声明式节点树
 * 通过 `insertNodes` 挂到画板下。节点 id 全部由 insertNodes 重新分配，children / parentId
 * 保持一致；返回的工程可直接交给 store / 导出器。
 */
import type { UIEditorTemplate, UINode, UINodeStyle, UINodeType, UIProject } from './uieditor';
import type { CreateNodePatch } from './uieditor-kit';
import { createNode, createProject, insertNodes, touchProject } from './uieditor-kit';

export type { UIEditorTemplate };

/* ------------------------------------------------------------------ 调色板 */

const COL = {
  text: '#F1F3F8',
  text2: '#B6BCC9',
  muted: '#8A94A6',
  accent: '#4C8DFF',
  accent2: '#7FB0FF',
  accentSoft: 'rgba(76,141,255,0.16)',
  accentBorder: 'rgba(76,141,255,0.4)',
  surface: 'rgba(255,255,255,0.045)',
  surface2: 'rgba(255,255,255,0.08)',
  panel: 'rgba(15,17,24,0.82)',
  panelDeep: 'rgba(10,11,16,0.9)',
  border: 'rgba(255,255,255,0.12)',
  borderSoft: 'rgba(255,255,255,0.08)',
  success: '#3DDC97',
  warn: '#FFB454',
  danger: '#FF6B81',
  white: '#FFFFFF',
} as const;

/* ------------------------------------------------------------------ 节点工具 */

type ExtraPatch = Omit<CreateNodePatch, 'style' | 'children' | 'parentId' | 'id'>;

interface TreeNodeSpec {
  type: UINodeType;
  patch: CreateNodePatch;
  children?: TreeNodeSpec[];
}

function n(type: UINodeType, style: Partial<UINodeStyle>, extra: ExtraPatch = {}, children?: TreeNodeSpec[]): TreeNodeSpec {
  return { type, patch: { ...extra, style }, children };
}

function frame(
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  children: TreeNodeSpec[] = [],
  style: Partial<UINodeStyle> = {}
): TreeNodeSpec {
  return n('frame', { x, y, width, height, ...style }, { name }, children);
}

function panel(
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  children: TreeNodeSpec[] = [],
  style: Partial<UINodeStyle> = {}
): TreeNodeSpec {
  return frame(name, x, y, width, height, children, {
    fill: COL.panel,
    stroke: COL.border,
    strokeWidth: 1,
    radius: [16, 16, 16, 16],
    clip: true,
    ...style,
  });
}

function rectNode(name: string, x: number, y: number, width: number, height: number, style: Partial<UINodeStyle> = {}): TreeNodeSpec {
  return n('rect', { x, y, width, height, ...style }, { name });
}

function ellipseNode(
  name: string,
  x: number,
  y: number,
  width: number,
  height: number,
  style: Partial<UINodeStyle> = {}
): TreeNodeSpec {
  return n('ellipse', { x, y, width, height, ...style }, { name });
}

function textNode(
  value: string,
  x: number,
  y: number,
  width: number,
  height: number,
  style: Partial<UINodeStyle> = {},
  extra: ExtraPatch = {}
): TreeNodeSpec {
  return n(
    'text',
    {
      x,
      y,
      width,
      height,
      fill: 'rgba(0,0,0,0)',
      stroke: 'rgba(0,0,0,0)',
      strokeWidth: 0,
      radius: [0, 0, 0, 0],
      fontSize: 14,
      color: COL.text,
      ...style,
    },
    { text: value, ...extra }
  );
}

function iconNode(name: string, x: number, y: number, size: number, color: string = COL.text, style: Partial<UINodeStyle> = {}): TreeNodeSpec {
  return n(
    'icon',
    {
      x,
      y,
      width: size,
      height: size,
      fill: 'rgba(0,0,0,0)',
      stroke: 'rgba(0,0,0,0)',
      strokeWidth: 0,
      radius: [0, 0, 0, 0],
      ...style,
    },
    { name: `${name} 图标`, icon: { name, color } }
  );
}

function inputNode(
  placeholder: string,
  x: number,
  y: number,
  width: number,
  height: number,
  style: Partial<UINodeStyle> = {},
  extra: ExtraPatch = {}
): TreeNodeSpec {
  return n(
    'input',
    {
      x,
      y,
      width,
      height,
      fill: 'rgba(255,255,255,0.05)',
      stroke: COL.border,
      strokeWidth: 1,
      radius: [10, 10, 10, 10],
      color: COL.text,
      fontSize: 13,
      ...style,
    },
    { name: '输入框', placeholder, value: '', ...extra }
  );
}

function buttonNode(text: string, x: number, y: number, width: number, height: number, style: Partial<UINodeStyle> = {}): TreeNodeSpec {
  return n(
    'button',
    {
      x,
      y,
      width,
      height,
      fill: COL.accent,
      stroke: 'rgba(255,255,255,0.18)',
      strokeWidth: 1,
      radius: [10, 10, 10, 10],
      color: COL.white,
      fontSize: 13,
      fontWeight: 600,
      textAlign: 'center',
      ...style,
    },
    { name: '按钮', text }
  );
}

function badgeNode(label: string, x: number, y: number, width: number, height: number, style: Partial<UINodeStyle> = {}): TreeNodeSpec {
  return n(
    'badge',
    {
      x,
      y,
      width,
      height,
      fill: COL.accentSoft,
      stroke: COL.accentBorder,
      strokeWidth: 1,
      radius: [999, 999, 999, 999],
      color: COL.accent2,
      fontSize: 10,
      fontWeight: 600,
      textAlign: 'center',
      ...style,
    },
    { name: '徽标', label }
  );
}

function toggleNode(x: number, y: number, checked: boolean, style: Partial<UINodeStyle> = {}): TreeNodeSpec {
  return n(
    'toggle',
    {
      x,
      y,
      width: 44,
      height: 24,
      fill: checked ? COL.accent : COL.surface2,
      stroke: 'rgba(255,255,255,0.22)',
      strokeWidth: 1,
      radius: [999, 999, 999, 999],
      ...style,
    },
    { name: '开关', checked, interaction: { event: 'click', action: 'toggle' } }
  );
}

function avatarNode(x: number, y: number, size: number, style: Partial<UINodeStyle> = {}, extra: ExtraPatch = {}): TreeNodeSpec {
  return n(
    'avatar',
    {
      x,
      y,
      width: size,
      height: size,
      fill: 'rgba(76,141,255,0.4)',
      stroke: 'rgba(255,255,255,0.2)',
      strokeWidth: 1,
      radius: [999, 999, 999, 999],
      clip: true,
      ...style,
    },
    { name: '头像', image: { src: '', fit: 'cover', alt: '头像' }, ...extra }
  );
}

/* ------------------------------------------------------------------ 工程装配 */

function makeProject(name: string, width: number, height: number, screenName: string): UIProject {
  const project = createProject(name, width, height);
  const screen = project.screens[0];
  screen.name = screenName;
  screen.background = '#07090F';
  return project;
}

/** 把声明式节点树挂到屏幕画板下，返回工程（自动 touch updatedAt）。 */
function mount(project: UIProject, specs: TreeNodeSpec[]): UIProject {
  const screen = project.screens[0];
  if (!screen) throw new Error('模板缺少屏幕');
  const flat: UINode[] = [];
  const walk = (spec: TreeNodeSpec, parentId: string | null): string => {
    const node = createNode(spec.type, { ...spec.patch, parentId });
    flat.push(node);
    if (spec.children && spec.children.length) {
      node.children = spec.children.map((child) => walk(child, node.id));
    }
    return node.id;
  };
  for (const spec of specs) walk(spec, null);
  if (flat.length) insertNodes(project, screen.id, flat, null);
  return touchProject(project);
}

/** 看板列标题旁的状态圆点。 */
function statusDot(color: string): TreeNodeSpec {
  return ellipseNode('状态点', 194, 22, 8, 8, {
    fill: color,
    stroke: 'rgba(0,0,0,0)',
    strokeWidth: 0,
    radius: [999, 999, 999, 999],
  });
}

/* ------------------------------------------------------------------ 模板定义 */

export const UIEDITOR_TEMPLATES: UIEditorTemplate[] = [
  {
    id: 'blank',
    name: '空白画布',
    description: '960 × 640 深色画布，从零开始你的设计。',
    category: 'layout',
    accent: '#4C8DFF',
    tags: ['空白', '画布', '起点'],
    create: () => touchProject(createProject('空白画布', 960, 640)),
  },

  /* ---------------------------------------------------------- 登录页 */
  {
    id: 'login',
    name: '深色登录页',
    description: '左右分栏登录页：品牌区 + 玻璃登录卡片，含账号 / 密码 / 记住我。',
    category: 'page',
    accent: '#4C8DFF',
    tags: ['登录', '表单', '品牌'],
    create: () => {
      const project = makeProject('深色登录页', 960, 640, '登录');
      return mount(project, [
        ellipseNode('光斑 蓝', 60, 40, 340, 340, {
          fill: 'rgba(76,141,255,0.16)',
          stroke: 'rgba(0,0,0,0)',
          strokeWidth: 0,
          radius: [999, 999, 999, 999],
          blur: 42,
        }),
        ellipseNode('光斑 青', 690, 430, 280, 280, {
          fill: 'rgba(61,220,151,0.09)',
          stroke: 'rgba(0,0,0,0)',
          strokeWidth: 0,
          radius: [999, 999, 999, 999],
          blur: 36,
        }),
        frame('品牌区', 0, 0, 460, 640, [
          frame('品牌行', 48, 56, 320, 40, [
            ellipseNode('品牌图标底', 0, 2, 36, 36, {
              fill: 'rgba(76,141,255,0.9)',
              stroke: 'rgba(255,255,255,0.3)',
              strokeWidth: 1,
              radius: [999, 999, 999, 999],
            }),
            iconNode('sparkle', 8, 10, 20, COL.white),
            textNode('便捷工具', 48, 9, 220, 24, { fontSize: 16, fontWeight: 600 }),
          ]),
          textNode('把想法，\n变成界面', 48, 190, 380, 100, { fontSize: 38, fontWeight: 700, lineHeight: 1.2 }),
          textNode('无需代码，拖拽即可完成产品原型设计。\n从模板开始，几分钟就能搭出可交互的界面。', 48, 310, 350, 64, {
            fontSize: 14,
            lineHeight: 1.7,
            color: COL.text2,
          }),
          ...['组件预设与页面模板', '多屏幕导航与交互', '一键导出 HTML / React'].flatMap((label, index) =>
            frame(`特性 ${index + 1}`, 48, 410 + index * 38, 330, 28, [
              iconNode('check', 0, 5, 16, COL.accent2),
              textNode(label, 28, 4, 290, 20, { fontSize: 13, color: COL.text2 }),
            ])
          ),
          textNode('© 2026 便捷工具', 48, 580, 240, 18, { fontSize: 11, color: COL.muted }),
        ], { fill: 'rgba(76,141,255,0.05)', stroke: 'rgba(0,0,0,0)', strokeWidth: 0, radius: [0, 0, 0, 0] }),
        panel('登录卡片', 540, 90, 380, 460, [
          textNode('欢迎回来', 40, 40, 300, 34, { fontSize: 26, fontWeight: 600 }),
          textNode('登录以继续你的设计工作', 40, 80, 300, 20, { fontSize: 13, color: COL.muted }),
          textNode('账号', 40, 132, 300, 18, { fontSize: 12, color: COL.text2 }),
          inputNode('name@example.com', 40, 154, 300, 44),
          textNode('密码', 40, 214, 300, 18, { fontSize: 12, color: COL.text2 }),
          inputNode('••••••••', 40, 236, 300, 44),
          frame('记住我', 40, 300, 300, 24, [
            toggleNode(0, 1, true),
            textNode('30 天内记住我', 54, 3, 170, 20, { fontSize: 12, color: COL.text2 }),
            textNode('忘记密码？', 216, 3, 84, 20, { fontSize: 12, color: COL.accent2, textAlign: 'right' }),
          ]),
          buttonNode('登 录', 40, 344, 300, 46, { fontSize: 14 }),
          textNode('还没有账号？立即注册', 20, 408, 340, 20, { fontSize: 12, color: COL.muted, textAlign: 'center' }),
          textNode('登录即表示同意《服务条款》与《隐私政策》', 20, 434, 340, 18, { fontSize: 10, color: COL.muted, textAlign: 'center' }),
        ], {
          fill: 'rgba(15,17,24,0.88)',
          radius: [18, 18, 18, 18],
          shadow: { x: 0, y: 28, blur: 70, spread: -24, color: 'rgba(0,0,0,0.7)' },
        }),
        badgeNode('v1.0', 872, 40, 52, 22, { fill: 'rgba(255,255,255,0.06)', stroke: COL.borderSoft, color: COL.muted }),
      ]);
    },
  },

  /* ---------------------------------------------------------- 数据仪表盘 */
  {
    id: 'dashboard',
    name: '数据仪表盘',
    description: '1280 × 800 后台仪表盘：侧边栏、顶栏、指标卡、趋势图、活动流与项目表。',
    category: 'page',
    accent: '#4C8DFF',
    tags: ['仪表盘', '后台', '数据', '图表'],
    create: () => {
      const project = makeProject('数据仪表盘', 1280, 800, '仪表盘');

      const navItems = (['概览', '项目', '组件库', '数据', '设置', '帮助'] as const).map((label, index) => {
        const icons = ['grid', 'folder', 'layout', 'arrow', 'settings', 'star'];
        const active = index === 0;
        return frame(
          `菜单 ${label}`,
          20,
          96 + index * 46,
          180,
          38,
          [
            iconNode(icons[index], 12, 10, 18, active ? COL.accent2 : COL.muted),
            textNode(label, 42, 9, 120, 20, { fontSize: 13, fontWeight: active ? 600 : 400, color: active ? COL.text : COL.text2 }),
          ],
          active
            ? { fill: 'rgba(76,141,255,0.14)', stroke: 'rgba(76,141,255,0.3)', strokeWidth: 1, radius: [10, 10, 10, 10] }
            : { fill: 'rgba(0,0,0,0)', stroke: 'rgba(0,0,0,0)', strokeWidth: 0, radius: [10, 10, 10, 10] }
        );
      });

      const metrics = [
        { label: '总项目数', value: '1,284', trend: '↑ 12.4% 较上周', icon: 'folder', color: COL.success },
        { label: '活跃用户', value: '8,420', trend: '↑ 8.1% 较上周', icon: 'user', color: COL.success },
        { label: '转化率', value: '32.6%', trend: '↓ 1.2% 较上周', icon: 'arrow', color: COL.danger },
        { label: '平均时长', value: '24m 18s', trend: '↑ 3.6% 较上周', icon: 'clock', color: COL.success },
      ];

      const metricCards = metrics.map((metric, index) =>
        panel(`指标卡 ${index + 1}`, 244 + index * 257, 88, 241, 116, [
          textNode(metric.label, 18, 16, 180, 20, { fontSize: 12, color: COL.muted }),
          textNode(metric.value, 18, 40, 200, 36, { fontSize: 28, fontWeight: 700, lineHeight: 1.2 }),
          textNode(metric.trend, 18, 84, 200, 18, { fontSize: 11, color: metric.color }),
          iconNode(metric.icon, 200, 18, 18, index === 2 ? COL.warn : COL.accent2),
        ], { radius: [14, 14, 14, 14] })
      );

      const days = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
      const barHeights = [96, 132, 84, 168, 120, 196, 156];
      const bars = days.flatMap((day, index) => [
        rectNode(`柱 ${day}`, 40 + index * 88, 250 - barHeights[index], 48, barHeights[index], {
          fill: index === 5 ? COL.accent : 'rgba(76,141,255,0.5)',
          stroke: 'rgba(76,141,255,0)',
          strokeWidth: 0,
          radius: [8, 8, 2, 2],
        }),
        textNode(day, 40 + index * 88, 258, 48, 18, { fontSize: 11, color: COL.muted, textAlign: 'center' }),
      ]);

      const activities = [
        { name: '林晓', action: '更新了「数据仪表盘」', time: '2 分钟前' },
        { name: '周也', action: '新建了 3 个页面模板', time: '18 分钟前' },
        { name: '陈默', action: '导出了 React 组件', time: '1 小时前' },
        { name: '许言', action: '发布了 v1.2.0 版本', time: '3 小时前' },
      ];

      const activityRows = activities.map((item, index) =>
        frame(`活动 ${index + 1}`, 16, 60 + index * 62, 300, 52, [
          avatarNode(0, 6, 32),
          textNode(item.name, 44, 2, 180, 20, { fontSize: 13, fontWeight: 600 }),
          textNode(item.action, 44, 24, 210, 18, { fontSize: 11, color: COL.text2 }),
          textNode(item.time, 244, 2, 56, 16, { fontSize: 10, color: COL.muted, textAlign: 'right' }),
        ])
      );

      const projects = [
        { name: '设计系统 2.0', owner: '林晓', percent: 82, status: '进行中' },
        { name: '官网改版', owner: '周也', percent: 46, status: '待评审' },
        { name: '移动端 App', owner: '陈默', percent: 100, status: '已完成' },
      ];

      const projectRows = projects.flatMap((item, index) => {
        const y = 92 + index * 42;
        const statusColor = item.status === '已完成' ? COL.success : item.status === '待评审' ? COL.warn : COL.accent2;
        return [
          textNode(item.name, 20, y, 300, 22, { fontSize: 13 }),
          textNode(item.owner, 420, y, 150, 22, { fontSize: 12, color: COL.text2 }),
          n(
            'progress',
            { x: 620, y: y + 7, width: 150, height: 6, fill: 'rgba(255,255,255,0.08)', stroke: 'rgba(0,0,0,0)', strokeWidth: 0, radius: [999, 999, 999, 999] },
            { name: `${item.name} 进度`, percent: item.percent }
          ),
          textNode(`${item.percent}%`, 782, y, 56, 20, { fontSize: 11, color: COL.text2 }),
          badgeNode(item.status, 860, y - 2, 76, 22, {
            fill: 'rgba(255,255,255,0.05)',
            stroke: 'rgba(255,255,255,0.14)',
            color: statusColor,
          }),
        ];
      });

      return mount(project, [
        frame('侧边栏', 0, 0, 220, 800, [
          ellipseNode('Logo 底', 24, 24, 32, 32, {
            fill: 'rgba(76,141,255,0.9)',
            stroke: 'rgba(255,255,255,0.3)',
            strokeWidth: 1,
            radius: [999, 999, 999, 999],
          }),
          iconNode('sparkle', 31, 31, 18, COL.white),
          textNode('便捷工具', 68, 30, 130, 24, { fontSize: 15, fontWeight: 600 }),
          ...navItems,
          panel('用户卡', 20, 688, 180, 72, [
            avatarNode(12, 18, 36),
            textNode('林晓', 56, 16, 110, 20, { fontSize: 13, fontWeight: 600 }),
            textNode('产品设计师', 56, 38, 110, 18, { fontSize: 11, color: COL.muted }),
          ], { fill: 'rgba(255,255,255,0.045)', radius: [12, 12, 12, 12] }),
        ], { fill: COL.panelDeep, radius: [0, 0, 0, 0] }),

        frame('顶栏', 220, 0, 1060, 64, [
          textNode('数据概览', 24, 20, 300, 26, { fontSize: 18, fontWeight: 600 }),
          frame('搜索框', 620, 14, 240, 36, [
            iconNode('search', 12, 9, 18, COL.muted),
            textNode('搜索项目…', 38, 9, 180, 18, { fontSize: 12, color: COL.muted }),
          ], { fill: 'rgba(255,255,255,0.05)', stroke: COL.borderSoft, strokeWidth: 1, radius: [10, 10, 10, 10] }),
          iconNode('bell', 898, 22, 20, COL.text2),
          avatarNode(968, 14, 36),
          ellipseNode('在线点', 996, 14, 9, 9, {
            fill: COL.success,
            stroke: '#07090F',
            strokeWidth: 2,
            radius: [999, 999, 999, 999],
          }),
        ], { fill: 'rgba(8,10,16,0.9)', stroke: COL.borderSoft, strokeWidth: 1, radius: [0, 0, 0, 0] }),

        ...metricCards,

        panel('趋势图卡', 244, 224, 672, 320, [
          textNode('访问趋势', 20, 18, 300, 24, { fontSize: 15, fontWeight: 600 }),
          textNode('最近 7 天 · 全部渠道', 20, 44, 300, 18, { fontSize: 11, color: COL.muted }),
          ellipseNode('图例点 A', 448, 24, 7, 7, { fill: COL.accent, stroke: 'rgba(0,0,0,0)', strokeWidth: 0, radius: [999, 999, 999, 999] }),
          textNode('访问量', 461, 20, 56, 16, { fontSize: 11, color: COL.text2 }),
          ellipseNode('图例点 B', 530, 24, 7, 7, { fill: COL.success, stroke: 'rgba(0,0,0,0)', strokeWidth: 0, radius: [999, 999, 999, 999] }),
          textNode('转化', 543, 20, 56, 16, { fontSize: 11, color: COL.text2 }),
          rectNode('网格线 1', 20, 96, 632, 1, { fill: 'rgba(255,255,255,0.04)', stroke: 'rgba(0,0,0,0)', strokeWidth: 0, radius: [0, 0, 0, 0] }),
          rectNode('网格线 2', 20, 156, 632, 1, { fill: 'rgba(255,255,255,0.04)', stroke: 'rgba(0,0,0,0)', strokeWidth: 0, radius: [0, 0, 0, 0] }),
          rectNode('网格线 3', 20, 216, 632, 1, { fill: 'rgba(255,255,255,0.04)', stroke: 'rgba(0,0,0,0)', strokeWidth: 0, radius: [0, 0, 0, 0] }),
          rectNode('基线', 20, 250, 632, 1, { fill: COL.border, stroke: 'rgba(0,0,0,0)', strokeWidth: 0, radius: [0, 0, 0, 0] }),
          ...bars,
        ]),

        panel('活动卡', 924, 224, 332, 320, [
          textNode('最近活动', 20, 18, 200, 24, { fontSize: 15, fontWeight: 600 }),
          iconNode('more', 296, 20, 18, COL.muted),
          ...activityRows,
        ]),

        panel('项目表', 244, 560, 1012, 216, [
          textNode('项目进度', 20, 18, 300, 24, { fontSize: 15, fontWeight: 600 }),
          buttonNode('查看全部', 868, 16, 120, 32, { fill: 'rgba(255,255,255,0.06)', color: COL.text2, fontSize: 12, fontWeight: 500, stroke: COL.borderSoft }),
          textNode('项目', 20, 64, 300, 18, { fontSize: 11, color: COL.muted }),
          textNode('负责人', 420, 64, 150, 18, { fontSize: 11, color: COL.muted }),
          textNode('进度', 620, 64, 150, 18, { fontSize: 11, color: COL.muted }),
          textNode('状态', 860, 64, 100, 18, { fontSize: 11, color: COL.muted }),
          ...projectRows,
        ]),
      ]);
    },
  },

  /* ---------------------------------------------------------- 设置面板 */
  {
    id: 'settings',
    name: '设置面板',
    description: '960 × 640 设置页：左侧导航 + 外观 / 通知 / 高级分组，含开关、滑杆、输入与保存。',
    category: 'page',
    accent: '#7FB0FF',
    tags: ['设置', '表单', '开关', '导航'],
    create: () => {
      const project = makeProject('设置面板', 960, 640, '设置');

      const navItems = (['通用', '外观', '通知', '快捷键', '关于'] as const).map((label, index) => {
        const icons = ['settings', 'sparkle', 'bell', 'code', 'star'];
        const active = index === 0;
        return frame(
          `设置菜单 ${label}`,
          16,
          96 + index * 46,
          208,
          38,
          [
            iconNode(icons[index], 14, 10, 18, active ? COL.accent2 : COL.muted),
            textNode(label, 44, 9, 140, 20, { fontSize: 13, fontWeight: active ? 600 : 400, color: active ? COL.text : COL.text2 }),
          ],
          active
            ? { fill: 'rgba(76,141,255,0.14)', stroke: 'rgba(76,141,255,0.3)', strokeWidth: 1, radius: [10, 10, 10, 10] }
            : { fill: 'rgba(0,0,0,0)', stroke: 'rgba(0,0,0,0)', strokeWidth: 0, radius: [10, 10, 10, 10] }
        );
      });

      return mount(project, [
        frame('设置侧栏', 0, 0, 240, 640, [
          ellipseNode('Logo 底', 24, 26, 32, 32, {
            fill: 'rgba(76,141,255,0.9)',
            stroke: 'rgba(255,255,255,0.3)',
            strokeWidth: 1,
            radius: [999, 999, 999, 999],
          }),
          iconNode('sparkle', 31, 33, 18, COL.white),
          textNode('便捷工具', 68, 32, 140, 24, { fontSize: 15, fontWeight: 600 }),
          ...navItems,
          rectNode('分割线', 24, 356, 192, 1, { fill: COL.borderSoft, stroke: 'rgba(0,0,0,0)', strokeWidth: 0, radius: [0, 0, 0, 0] }),
          textNode('v1.0.0 · 本地优先', 24, 600, 200, 18, { fontSize: 10, color: COL.muted }),
        ], { fill: COL.panelDeep, radius: [0, 0, 0, 0] }),

        frame('内容区', 240, 0, 720, 640, [
          textNode('通用设置', 36, 40, 320, 32, { fontSize: 22, fontWeight: 600 }),
          textNode('管理便捷工具的基础行为与外观', 36, 76, 420, 20, { fontSize: 13, color: COL.muted }),

          panel('外观分组', 36, 116, 648, 150, [
            textNode('外观', 20, 16, 200, 22, { fontSize: 14, fontWeight: 600 }),
            textNode('主题模式', 20, 54, 180, 20, { fontSize: 13, color: COL.text2 }),
            textNode('当前：深色', 20, 76, 180, 16, { fontSize: 11, color: COL.muted }),
            frame('主题切换', 360, 50, 240, 36, [
              rectNode('激活底', 2, 2, 78, 32, { fill: COL.accent, stroke: 'rgba(0,0,0,0)', strokeWidth: 0, radius: [8, 8, 8, 8] }),
              textNode('深色', 0, 8, 80, 20, { fontSize: 12, fontWeight: 600, color: COL.white, textAlign: 'center' }),
              textNode('浅色', 80, 8, 80, 20, { fontSize: 12, color: COL.text2, textAlign: 'center' }),
              textNode('跟随系统', 160, 8, 80, 20, { fontSize: 12, color: COL.text2, textAlign: 'center' }),
            ], { fill: 'rgba(255,255,255,0.05)', stroke: COL.borderSoft, strokeWidth: 1, radius: [10, 10, 10, 10] }),
            textNode('强调色', 20, 104, 120, 20, { fontSize: 13, color: COL.text2 }),
            ellipseNode('色板 1', 150, 100, 22, 22, { fill: COL.accent, stroke: COL.white, strokeWidth: 2, radius: [999, 999, 999, 999] }),
            ellipseNode('色板 2', 180, 100, 22, 22, { fill: COL.accent2, stroke: 'rgba(255,255,255,0.25)', strokeWidth: 1, radius: [999, 999, 999, 999] }),
            ellipseNode('色板 3', 210, 100, 22, 22, { fill: COL.success, stroke: 'rgba(255,255,255,0.25)', strokeWidth: 1, radius: [999, 999, 999, 999] }),
            ellipseNode('色板 4', 240, 100, 22, 22, { fill: COL.warn, stroke: 'rgba(255,255,255,0.25)', strokeWidth: 1, radius: [999, 999, 999, 999] }),
            ellipseNode('色板 5', 270, 100, 22, 22, { fill: COL.danger, stroke: 'rgba(255,255,255,0.25)', strokeWidth: 1, radius: [999, 999, 999, 999] }),
          ]),

          panel('通知分组', 36, 286, 648, 150, [
            textNode('通知', 20, 16, 200, 22, { fontSize: 14, fontWeight: 600 }),
            textNode('启动提醒', 20, 52, 300, 20, { fontSize: 13, color: COL.text2 }),
            textNode('打开应用时显示今日待办', 20, 72, 300, 16, { fontSize: 11, color: COL.muted }),
            toggleNode(558, 50, true),
            textNode('更新提醒', 20, 104, 300, 20, { fontSize: 13, color: COL.text2 }),
            textNode('有新版本时通知我', 20, 124, 300, 16, { fontSize: 11, color: COL.muted }),
            toggleNode(558, 102, false),
          ]),

          panel('高级分组', 36, 456, 648, 120, [
            textNode('高级', 20, 16, 200, 22, { fontSize: 14, fontWeight: 600 }),
            textNode('界面缩放', 20, 52, 140, 20, { fontSize: 13, color: COL.text2 }),
            n(
              'slider',
              { x: 170, y: 55, width: 340, height: 16, fill: 'rgba(255,255,255,0.08)', stroke: 'rgba(0,0,0,0)', strokeWidth: 0, radius: [999, 999, 999, 999] },
              { name: '界面缩放滑杆', percent: 60 }
            ),
            textNode('60%', 524, 52, 80, 20, { fontSize: 12, color: COL.text2, textAlign: 'right' }),
            textNode('最大历史记录', 20, 84, 140, 20, { fontSize: 13, color: COL.text2 }),
            n(
              'input',
              { x: 170, y: 80, width: 120, height: 32, fill: 'rgba(255,255,255,0.05)', stroke: COL.border, strokeWidth: 1, radius: [8, 8, 8, 8], color: COL.text, fontSize: 12 },
              { name: '最大历史记录', placeholder: '100', value: '100' }
            ),
            textNode('条', 300, 84, 40, 20, { fontSize: 12, color: COL.muted }),
          ]),

          buttonNode('取消', 444, 584, 100, 40, { fill: 'rgba(255,255,255,0.06)', color: COL.text2, fontWeight: 500, stroke: COL.border }),
          buttonNode('保存设置', 560, 584, 100, 40, { fontSize: 13 }),
        ], { fill: 'rgba(0,0,0,0)', stroke: 'rgba(0,0,0,0)', strokeWidth: 0, radius: [0, 0, 0, 0] }),
      ]);
    },
  },

  /* ---------------------------------------------------------- 媒体播放器 */
  {
    id: 'media',
    name: '媒体播放器',
    description: '1100 × 700 深色播放器：专辑封面、播放控制、音量与播放列表。',
    category: 'page',
    accent: '#FFB454',
    tags: ['媒体', '播放器', '音乐'],
    create: () => {
      const project = makeProject('媒体播放器', 1100, 700, '播放器');

      const playlist = [
        { index: '01', title: '夜航', album: '海岸线', duration: '4:28' },
        { index: '02', title: '潮汐', album: '海岸线', duration: '3:52' },
        { index: '03', title: '灯塔', album: '海岸线', duration: '5:06' },
      ];

      return mount(project, [
        frame('专辑封面', 48, 64, 400, 400, [
          ellipseNode('封面光斑', 220, -70, 240, 240, {
            fill: 'rgba(76,141,255,0.3)',
            stroke: 'rgba(0,0,0,0)',
            strokeWidth: 0,
            radius: [999, 999, 999, 999],
            blur: 30,
          }),
          ellipseNode('封面光斑 2', 40, 250, 150, 150, {
            fill: 'rgba(61,220,151,0.14)',
            stroke: 'rgba(0,0,0,0)',
            strokeWidth: 0,
            radius: [999, 999, 999, 999],
            blur: 24,
          }),
          ellipseNode('播放按钮底', 172, 172, 56, 56, {
            fill: 'rgba(255,255,255,0.18)',
            stroke: 'rgba(255,255,255,0.4)',
            strokeWidth: 1,
            radius: [999, 999, 999, 999],
          }),
          iconNode('play', 188, 188, 24, COL.white),
        ], {
          fill: 'rgba(0,0,0,0)',
          gradient: { from: '#1B3A6B', to: '#0B1220', angle: 160 },
          stroke: COL.border,
          strokeWidth: 1,
          radius: [24, 24, 24, 24],
          clip: true,
          shadow: { x: 0, y: 24, blur: 60, spread: -20, color: 'rgba(0,0,0,0.65)' },
        }),

        textNode('夜航', 480, 80, 500, 44, { fontSize: 30, fontWeight: 700, lineHeight: 1.2 }),
        textNode('林深 · 专辑《海岸线》', 480, 128, 400, 24, { fontSize: 15, color: COL.text2 }),
        badgeNode('Hi-Res', 480, 168, 64, 22, { color: COL.warn, fill: 'rgba(255,180,84,0.12)', stroke: 'rgba(255,180,84,0.35)' }),

        n(
          'slider',
          { x: 480, y: 240, width: 520, height: 16, fill: 'rgba(255,255,255,0.08)', stroke: 'rgba(0,0,0,0)', strokeWidth: 0, radius: [999, 999, 999, 999] },
          { name: '播放进度', percent: 38 }
        ),
        textNode('1:42', 480, 266, 80, 18, { fontSize: 11, color: COL.muted }),
        textNode('4:28', 920, 266, 80, 18, { fontSize: 11, color: COL.muted, textAlign: 'right' }),

        frame('播放控制', 480, 300, 520, 96, [
          iconNode('more', 96, 38, 20, COL.muted),
          iconNode('arrow', 176, 34, 28, COL.text2, { rotation: 180 }),
          ellipseNode('播放按钮底', 234, 18, 60, 60, {
            fill: COL.accent,
            stroke: 'rgba(255,255,255,0.28)',
            strokeWidth: 1,
            radius: [999, 999, 999, 999],
            shadow: { x: 0, y: 10, blur: 28, spread: -8, color: 'rgba(76,141,255,0.6)' },
          }),
          iconNode('play', 252, 36, 24, COL.white),
          iconNode('arrow', 330, 34, 28, COL.text2),
          iconNode('heart', 408, 38, 20, COL.muted),
        ], { fill: 'rgba(0,0,0,0)', stroke: 'rgba(0,0,0,0)', strokeWidth: 0, radius: [0, 0, 0, 0] }),

        frame('音量', 480, 420, 520, 40, [
          iconNode('volume', 0, 9, 22, COL.muted),
          n(
            'slider',
            { x: 34, y: 13, width: 180, height: 14, fill: 'rgba(255,255,255,0.08)', stroke: 'rgba(0,0,0,0)', strokeWidth: 0, radius: [999, 999, 999, 999] },
            { name: '音量滑杆', percent: 70 }
          ),
          textNode('70%', 224, 9, 60, 18, { fontSize: 11, color: COL.muted }),
        ], { fill: 'rgba(0,0,0,0)', stroke: 'rgba(0,0,0,0)', strokeWidth: 0, radius: [0, 0, 0, 0] }),

        panel('播放列表', 48, 500, 1004, 160, [
          textNode('播放列表', 20, 16, 200, 22, { fontSize: 14, fontWeight: 600 }),
          textNode('3 首', 900, 18, 80, 18, { fontSize: 11, color: COL.muted, textAlign: 'right' }),
          ...playlist.flatMap((item, index) =>
            frame(`歌曲 ${index + 1}`, 16, 48 + index * 34, 972, 28, [
              textNode(item.index, 0, 5, 24, 18, { fontSize: 11, color: COL.muted }),
              textNode(item.title, 32, 5, 300, 18, { fontSize: 12, color: index === 0 ? COL.accent2 : COL.text2, fontWeight: index === 0 ? 600 : 400 }),
              textNode(item.album, 400, 5, 300, 18, { fontSize: 11, color: COL.muted }),
              textNode(item.duration, 922, 5, 50, 18, { fontSize: 11, color: COL.muted, textAlign: 'right' }),
            ])
          ),
        ]),
      ]);
    },
  },

  /* ---------------------------------------------------------- 移动端个人中心 */
  {
    id: 'mobile-profile',
    name: '移动端个人中心',
    description: '390 × 844 移动端个人主页：头像资料、数据统计、设置列表与底部 TabBar。',
    category: 'page',
    accent: '#3DDC97',
    tags: ['移动端', '个人中心', 'TabBar'],
    create: () => {
      const project = makeProject('移动端个人中心', 390, 844, '我的');

      const stats = [
        { value: '128', label: '作品' },
        { value: '2.4k', label: '关注' },
        { value: '86', label: '获赞' },
      ];

      const menu = [
        { label: '账号与安全', icon: 'lock' },
        { label: '通知设置', icon: 'bell' },
        { label: '主题外观', icon: 'sparkle' },
        { label: '存储空间', icon: 'folder' },
        { label: '关于便捷工具', icon: 'star' },
      ];

      return mount(project, [
        frame('状态栏', 0, 0, 390, 44, [
          textNode('9:41', 20, 14, 60, 18, { fontSize: 13, fontWeight: 600 }),
          iconNode('bell', 334, 12, 18, COL.text2),
          iconNode('volume', 360, 12, 18, COL.text2),
        ], { fill: 'rgba(0,0,0,0)', stroke: 'rgba(0,0,0,0)', strokeWidth: 0, radius: [0, 0, 0, 0] }),

        frame('个人信息', 0, 44, 390, 150, [
          avatarNode(24, 28, 72, { fill: 'rgba(76,141,255,0.45)' }),
          textNode('林晓', 112, 32, 180, 28, { fontSize: 20, fontWeight: 600 }),
          textNode('@linxiao · 产品设计师', 112, 62, 230, 20, { fontSize: 12, color: COL.muted }),
          n(
            'button',
            { x: 298, y: 38, width: 68, height: 30, fill: 'rgba(255,255,255,0.06)', stroke: COL.border, strokeWidth: 1, radius: [999, 999, 999, 999], color: COL.text2, fontSize: 12, fontWeight: 500, textAlign: 'center' },
            { name: '编辑资料', text: '编辑' }
          ),
        ], {
          fill: 'rgba(76,141,255,0.06)',
          stroke: 'rgba(0,0,0,0)',
          strokeWidth: 0,
          radius: [0, 0, 24, 24],
          gradient: { from: 'rgba(76,141,255,0.16)', to: 'rgba(76,141,255,0)', angle: 180 },
        }),

        panel('数据统计', 24, 210, 342, 86, [
          ...stats.flatMap((item, index) => [
            textNode(item.value, index * 114, 18, 114, 32, { fontSize: 20, fontWeight: 700, textAlign: 'center' }),
            textNode(item.label, index * 114, 54, 114, 18, { fontSize: 11, color: COL.muted, textAlign: 'center' }),
          ]),
          rectNode('统计分割 1', 114, 20, 1, 46, { fill: COL.borderSoft, stroke: 'rgba(0,0,0,0)', strokeWidth: 0, radius: [0, 0, 0, 0] }),
          rectNode('统计分割 2', 228, 20, 1, 46, { fill: COL.borderSoft, stroke: 'rgba(0,0,0,0)', strokeWidth: 0, radius: [0, 0, 0, 0] }),
        ], { radius: [14, 14, 14, 14] }),

        panel('设置列表', 24, 312, 342, 330, [
          ...menu.flatMap((item, index) => {
            const y = 10 + index * 62;
            const nodes: TreeNodeSpec[] = [
              iconNode(item.icon, 16, y + 17, 20, index === 0 ? COL.accent2 : COL.muted),
              textNode(item.label, 50, y + 16, 210, 22, { fontSize: 13 }),
              iconNode('chevron', 300, y + 18, 16, COL.muted),
            ];
            if (index < menu.length - 1) {
              nodes.push(
                rectNode(`列表分割 ${index + 1}`, 16, y + 57, 310, 1, {
                  fill: COL.borderSoft,
                  stroke: 'rgba(0,0,0,0)',
                  strokeWidth: 0,
                  radius: [0, 0, 0, 0],
                })
              );
            }
            return nodes;
          }),
        ]),

        n(
          'button',
          {
            x: 24,
            y: 664,
            width: 342,
            height: 44,
            fill: 'rgba(255,107,129,0.12)',
            stroke: 'rgba(255,107,129,0.4)',
            strokeWidth: 1,
            radius: [12, 12, 12, 12],
            color: COL.danger,
            fontSize: 13,
            fontWeight: 600,
            textAlign: 'center',
          },
          { name: '退出登录', text: '退出登录' }
        ),

        frame('底部 TabBar', 0, 764, 390, 80, [
          ...(['首页', '发现', '消息', '我的'] as const).flatMap((label, index) => {
            const icons = ['home', 'search', 'bell', 'user'];
            const active = index === 3;
            return [
              iconNode(icons[index], 38 + index * 97, 12, 22, active ? COL.accent2 : COL.muted),
              textNode(label, index * 97, 40, 97, 16, { fontSize: 10, color: active ? COL.accent2 : COL.muted, textAlign: 'center' }),
            ];
          }),
        ], { fill: 'rgba(10,11,16,0.94)', stroke: COL.borderSoft, strokeWidth: 1, radius: [0, 0, 0, 0] }),

        rectNode('Home 指示条', 145, 832, 100, 4, { fill: 'rgba(255,255,255,0.25)', stroke: 'rgba(0,0,0,0)', strokeWidth: 0, radius: [999, 999, 999, 999] }),
      ]);
    },
  },

  /* ---------------------------------------------------------- 团队看板 */
  {
    id: 'kanban',
    name: '团队看板',
    description: '1280 × 800 四列团队看板：待办 / 进行中 / 待评审 / 已完成，含卡片、标签与进度。',
    category: 'layout',
    accent: '#FFB454',
    tags: ['看板', '协作', '任务', '布局'],
    create: () => {
      const project = makeProject('团队看板', 1280, 800, '看板');

      const columns = [
        {
          title: '待办',
          color: COL.muted,
          tag: '设计',
          tagColor: COL.text2,
          cards: [
            { title: '梳理 2.0 设计系统信息架构', percent: 0 },
            { title: '移动端空状态插画补全', percent: 15 },
            { title: '整理组件库命名规范', percent: 0 },
          ],
        },
        {
          title: '进行中',
          color: COL.accent,
          tag: '开发',
          tagColor: COL.accent2,
          cards: [
            { title: '实现编辑器画布缩放与吸附', percent: 62 },
            { title: '接入导出器 HTML 运行时', percent: 48 },
            { title: '设置窗口玻璃边框细节走查', percent: 35 },
          ],
        },
        {
          title: '待评审',
          color: COL.warn,
          tag: '测试',
          tagColor: COL.warn,
          cards: [
            { title: '模板库 7 个页面视觉复核', percent: 90 },
            { title: '多屏幕导航交互回归', percent: 85 },
          ],
        },
        {
          title: '已完成',
          color: COL.success,
          tag: '发布',
          tagColor: COL.success,
          cards: [
            { title: '组件预设 29 个首批上线', percent: 100 },
            { title: '深色登录页模板交付', percent: 100 },
            { title: '导出 React 组件能力', percent: 100 },
          ],
        },
      ];

      const columnNodes = columns.map((column, columnIndex) => {
        const cardNodes = column.cards.flatMap((card, cardIndex) => {
          const cardY = 52 + cardIndex * 204;
          return [
            panel(`卡片 ${column.title} ${cardIndex + 1}`, 12, cardY, 269, 190, [
              badgeNode(column.tag, 12, 12, 56, 20, {
                fill: 'rgba(255,255,255,0.05)',
                stroke: 'rgba(255,255,255,0.14)',
                color: column.tagColor,
              }),
              textNode(card.title, 12, 42, 245, 42, { fontSize: 13, fontWeight: 600, lineHeight: 1.45 }),
              n(
                'progress',
                { x: 12, y: 120, width: 245, height: 4, fill: 'rgba(255,255,255,0.08)', stroke: 'rgba(0,0,0,0)', strokeWidth: 0, radius: [999, 999, 999, 999] },
                { name: '任务进度', percent: card.percent }
              ),
              avatarNode(12, 140, 20, { fill: 'rgba(76,141,255,0.4)' }),
              textNode('截止 10/28', 40, 140, 160, 18, { fontSize: 10, color: COL.muted }),
              iconNode('more', 240, 140, 16, COL.muted),
            ], { radius: [12, 12, 12, 12] }),
          ];
        });

        return frame(`看板列 ${column.title}`, 24 + columnIndex * 313, 96, 293, 680, [
          textNode(column.title, 16, 14, 170, 24, { fontSize: 15, fontWeight: 600 }),
          statusDot(column.color),
          badgeNode(String(column.cards.length), 236, 16, 36, 22, {
            fill: 'rgba(255,255,255,0.05)',
            stroke: 'rgba(255,255,255,0.14)',
            color: column.tagColor,
          }),
          iconNode('plus', 264, 18, 18, COL.muted),
          ...cardNodes,
        ], { fill: 'rgba(255,255,255,0.028)', stroke: COL.borderSoft, strokeWidth: 1, radius: [16, 16, 16, 16] });
      });

      return mount(project, [
        frame('看板顶栏', 0, 0, 1280, 72, [
          textNode('产品迭代 · Sprint 12', 32, 18, 600, 30, { fontSize: 20, fontWeight: 600 }),
          textNode('11 个任务 · 3 位成员 · 10 月 23 日', 32, 44, 500, 18, { fontSize: 11, color: COL.muted }),
          ellipseNode('成员 1', 1032, 20, 32, 32, { fill: 'rgba(76,141,255,0.5)', stroke: '#0A0B10', strokeWidth: 2, radius: [999, 999, 999, 999] }),
          ellipseNode('成员 2', 1054, 20, 32, 32, { fill: 'rgba(61,220,151,0.5)', stroke: '#0A0B10', strokeWidth: 2, radius: [999, 999, 999, 999] }),
          ellipseNode('成员 3', 1076, 20, 32, 32, { fill: 'rgba(255,180,84,0.5)', stroke: '#0A0B10', strokeWidth: 2, radius: [999, 999, 999, 999] }),
          buttonNode('新建任务', 1116, 18, 132, 36, { fontSize: 12 }),
        ], { fill: 'rgba(8,10,16,0.9)', stroke: COL.borderSoft, strokeWidth: 1, radius: [0, 0, 0, 0] }),
        ...columnNodes,
      ]);
    },
  },
];

/* ------------------------------------------------------------------ 查询 */

export function findTemplate(id: string): UIEditorTemplate | undefined {
  return UIEDITOR_TEMPLATES.find((template) => template.id === id);
}
