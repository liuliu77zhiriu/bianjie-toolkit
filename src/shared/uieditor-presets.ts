/**
 * UI 编辑器 · 组件预设库
 *
 * 预设返回一组「相对节点」：根节点 parentId = null，子节点 parentId 指向根（或中间容器），
 * children 顺序即层叠顺序；根节点 style.width / height 与预设声明的 width / height 一致。
 * 组件库面板可直接用 `instantiatePreset(id)` 拿到重新生成 id 的副本，再 `insertNodes` 进工程。
 */
import type { UINode, UINodeStyle, UINodeType } from './uieditor';
import type { CreateNodePatch } from './uieditor-kit';
import { createNode, newId, structuredCloneSafe } from './uieditor-kit';

export type UIComponentCategory = '基础' | '布局' | '表单' | '数据' | '导航' | '媒体';

export const UI_COMPONENT_CATEGORIES: UIComponentCategory[] = ['基础', '布局', '表单', '数据', '导航', '媒体'];

export interface UIComponentPreset {
  id: string;
  name: string;
  category: UIComponentCategory;
  icon: string;
  description?: string;
  width: number;
  height: number;
  create: () => UINode[];
}

/* ------------------------------------------------------------------ 调色板 */

const COL = {
  text: '#E8ECF4',
  text2: '#B6BCC9',
  muted: '#8A94A6',
  accent: '#4C8DFF',
  accent2: '#7FB0FF',
  accentSoft: 'rgba(76,141,255,0.16)',
  accentBorder: 'rgba(76,141,255,0.4)',
  surface: 'rgba(255,255,255,0.045)',
  surface2: 'rgba(255,255,255,0.08)',
  panel: 'rgba(15,17,24,0.82)',
  border: 'rgba(255,255,255,0.12)',
  borderSoft: 'rgba(255,255,255,0.08)',
  success: '#3DDC97',
  warn: '#FFB454',
  danger: '#FF6B81',
  white: '#FFFFFF',
} as const;

/* ------------------------------------------------------------------ 节点树构建 */

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
  style: Partial<UINodeStyle> = {},
  children?: TreeNodeSpec[]
): TreeNodeSpec {
  return n('frame', { x, y, width, height, ...style }, { name }, children);
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

/** 把声明式节点树物化为扁平 UINode 数组（父在前、子在后的顺序）。 */
function buildTree(root: TreeNodeSpec): UINode[] {
  const out: UINode[] = [];
  const walk = (spec: TreeNodeSpec, parentId: string | null): UINode => {
    const node = createNode(spec.type, { ...spec.patch, parentId });
    out.push(node);
    if (spec.children && spec.children.length) {
      node.children = spec.children.map((child) => walk(child, node.id).id);
    }
    return node;
  };
  walk(root, null);
  return out;
}

function preset(
  id: string,
  name: string,
  category: UIComponentCategory,
  icon: string,
  width: number,
  height: number,
  description: string,
  create: () => UINode[]
): UIComponentPreset {
  return { id, name, category, icon, description, width, height, create };
}

/* ------------------------------------------------------------------ 预设定义 */

export const UI_COMPONENT_PRESETS: UIComponentPreset[] = [
  /* ---------------------------------------------------------- 基础 */
  preset('rect', '矩形', '基础', 'grid', 160, 100, '基础矩形，可作色块、底板或占位。', () =>
    buildTree(
      n('rect', { x: 0, y: 0, width: 160, height: 100, fill: COL.accentSoft, stroke: COL.accentBorder, strokeWidth: 1, radius: [12, 12, 12, 12] }, { name: '矩形' })
    )
  ),
  preset('ellipse', '圆形', '基础', 'heart', 72, 72, '圆形 / 椭圆，适合头像底、状态点与装饰光斑。', () =>
    buildTree(
      n(
        'ellipse',
        { x: 0, y: 0, width: 72, height: 72, fill: 'rgba(127,176,255,0.22)', stroke: COL.accentBorder, strokeWidth: 1, radius: [999, 999, 999, 999] },
        { name: '圆形' }
      )
    )
  ),
  preset('text', '文本', '基础', 'menu', 220, 56, '可编辑文本，默认大标题样式。', () =>
    buildTree(
      textNode('标题文本', 0, 0, 220, 56, {
        fontSize: 30,
        fontWeight: 700,
        lineHeight: 1.25,
        color: COL.text,
      })
    )
  ),
  preset('image', '图片', '基础', 'image', 240, 160, '图片占位，支持 DataURL / 本地图片。', () =>
    buildTree(
      n(
        'image',
        { x: 0, y: 0, width: 240, height: 160, fill: 'rgba(255,255,255,0.06)', stroke: COL.border, strokeWidth: 1, radius: [12, 12, 12, 12], clip: true },
        { name: '图片', image: { src: '', fit: 'cover', alt: '图片' } }
      )
    )
  ),
  preset('icon', '图标', '基础', 'star', 28, 28, '内置线性图标，可换图、改色、旋转。', () =>
    buildTree(iconNode('home', 0, 0, 28, COL.text))
  ),
  preset('divider', '分割线', '基础', 'more', 240, 1, '1px 发丝分割线。', () =>
    buildTree(
      n('divider', { x: 0, y: 0, width: 240, height: 1, fill: COL.border, stroke: 'rgba(0,0,0,0)', strokeWidth: 0, radius: [0, 0, 0, 0] }, { name: '分割线' })
    )
  ),

  /* ---------------------------------------------------------- 布局 */
  preset('frame', '容器 / Frame', '布局', 'layout', 320, 220, '可容纳子节点的透明容器，用于分组与裁剪。', () =>
    buildTree(
      frame('容器', 0, 0, 320, 220, { fill: 'rgba(255,255,255,0.035)', stroke: COL.border, strokeWidth: 1, radius: [16, 16, 16, 16], clip: true }, [
        rectNode('占位块 A', 16, 16, 288, 78, { fill: 'rgba(255,255,255,0.05)', stroke: COL.borderSoft, strokeWidth: 1, radius: [10, 10, 10, 10] }),
        rectNode('占位块 B', 16, 110, 288, 94, { fill: 'rgba(76,141,255,0.10)', stroke: COL.accentBorder, strokeWidth: 1, radius: [10, 10, 10, 10] }),
      ])
    )
  ),
  preset('card', '卡片', '布局', 'folder', 320, 200, '标题 + 说明 + 按钮的标准玻璃卡片。', () =>
    buildTree(
      frame(
        '卡片',
        0,
        0,
        320,
        200,
        {
          fill: COL.panel,
          stroke: COL.border,
          strokeWidth: 1,
          radius: [16, 16, 16, 16],
          clip: true,
          shadow: { x: 0, y: 18, blur: 48, spread: -20, color: 'rgba(0,0,0,0.55)' },
        },
        [
          rectNode('图标底', 20, 20, 36, 36, { fill: COL.accentSoft, stroke: COL.accentBorder, strokeWidth: 1, radius: [10, 10, 10, 10] }),
          iconNode('sparkle', 28, 28, 20, COL.accent2),
          textNode('卡片标题', 68, 24, 220, 26, { fontSize: 16, fontWeight: 600 }),
          textNode('这里是卡片的说明文字，用来展示摘要与关键信息。', 20, 92, 280, 48, {
            fontSize: 13,
            lineHeight: 1.55,
            color: COL.text2,
          }),
          n(
            'button',
            { x: 20, y: 150, width: 104, height: 34, fill: COL.accent, stroke: 'rgba(255,255,255,0.16)', strokeWidth: 1, radius: [9, 9, 9, 9], fontSize: 12, fontWeight: 600, textAlign: 'center' },
            { name: '卡片按钮', text: '查看详情' }
          ),
        ]
      )
    )
  ),
  preset('flex-row', '弹性行', '布局', 'menu', 360, 96, '横向弹性布局，子元素等距排列。', () =>
    buildTree(
      frame(
        '弹性行',
        0,
        0,
        360,
        96,
        { fill: COL.surface, stroke: COL.border, strokeWidth: 1, radius: [14, 14, 14, 14], layout: 'row', gap: 12, padding: 16, align: 'center', justify: 'start' },
        [
          rectNode('子项 1', 16, 16, 102, 64, { fill: 'rgba(76,141,255,0.22)', stroke: COL.accentBorder, strokeWidth: 1, radius: [10, 10, 10, 10] }),
          rectNode('子项 2', 129, 16, 102, 64, { fill: 'rgba(127,176,255,0.16)', stroke: 'rgba(127,176,255,0.35)', strokeWidth: 1, radius: [10, 10, 10, 10] }),
          rectNode('子项 3', 242, 16, 102, 64, { fill: 'rgba(255,255,255,0.07)', stroke: COL.border, strokeWidth: 1, radius: [10, 10, 10, 10] }),
        ]
      )
    )
  ),
  preset('flex-column', '弹性列', '布局', 'menu', 280, 260, '纵向弹性布局，适合列表与表单分组。', () =>
    buildTree(
      frame(
        '弹性列',
        0,
        0,
        280,
        260,
        { fill: COL.surface, stroke: COL.border, strokeWidth: 1, radius: [14, 14, 14, 14], layout: 'column', gap: 12, padding: 16, align: 'stretch', justify: 'start' },
        [
          rectNode('子项 1', 16, 16, 248, 64, { fill: 'rgba(76,141,255,0.20)', stroke: COL.accentBorder, strokeWidth: 1, radius: [10, 10, 10, 10] }),
          rectNode('子项 2', 16, 92, 248, 64, { fill: 'rgba(127,176,255,0.14)', stroke: 'rgba(127,176,255,0.32)', strokeWidth: 1, radius: [10, 10, 10, 10] }),
          rectNode('子项 3', 16, 168, 248, 64, { fill: 'rgba(255,255,255,0.07)', stroke: COL.border, strokeWidth: 1, radius: [10, 10, 10, 10] }),
        ]
      )
    )
  ),
  preset('grid-2x2', '网格容器', '布局', 'grid', 320, 320, '2×2 自由摆放子块，可用网格/吸附对齐。', () =>
    buildTree(
      frame('网格容器', 0, 0, 320, 320, { fill: 'rgba(255,255,255,0.03)', stroke: COL.border, strokeWidth: 1, radius: [16, 16, 16, 16], clip: true }, [
        rectNode('网格 1', 16, 16, 136, 136, { fill: 'rgba(76,141,255,0.22)', stroke: COL.accentBorder, strokeWidth: 1, radius: [12, 12, 12, 12] }),
        rectNode('网格 2', 168, 16, 136, 136, { fill: 'rgba(127,176,255,0.14)', stroke: 'rgba(127,176,255,0.3)', strokeWidth: 1, radius: [12, 12, 12, 12] }),
        rectNode('网格 3', 16, 168, 136, 136, { fill: 'rgba(61,220,151,0.10)', stroke: 'rgba(61,220,151,0.3)', strokeWidth: 1, radius: [12, 12, 12, 12] }),
        rectNode('网格 4', 168, 168, 136, 136, { fill: 'rgba(255,180,84,0.10)', stroke: 'rgba(255,180,84,0.3)', strokeWidth: 1, radius: [12, 12, 12, 12] }),
      ])
    )
  ),

  /* ---------------------------------------------------------- 表单 */
  preset('button', '按钮', '表单', 'check', 132, 40, '主按钮，带 hover / pressed 状态。', () =>
    buildTree(
      n(
        'button',
        {
          x: 0,
          y: 0,
          width: 132,
          height: 40,
          fill: COL.accent,
          stroke: 'rgba(255,255,255,0.18)',
          strokeWidth: 1,
          radius: [10, 10, 10, 10],
          color: COL.white,
          fontSize: 13,
          fontWeight: 600,
          textAlign: 'center',
          shadow: { x: 0, y: 8, blur: 22, spread: -8, color: 'rgba(76,141,255,0.55)' },
        },
        {
          name: '按钮',
          text: '按钮',
          states: { hover: { fill: '#5C99FF' }, pressed: { fill: '#3F7BE6' } },
        }
      )
    )
  ),
  preset('input', '输入框', '表单', 'code', 260, 42, '单行输入框，支持值 / 占位文案。', () =>
    buildTree(
      n(
        'input',
        {
          x: 0,
          y: 0,
          width: 260,
          height: 42,
          fill: 'rgba(255,255,255,0.05)',
          stroke: COL.border,
          strokeWidth: 1,
          radius: [10, 10, 10, 10],
          color: COL.text,
          fontSize: 13,
        },
        { name: '输入框', placeholder: '请输入内容', value: '' }
      )
    )
  ),
  preset('textarea', '文本域', '表单', 'code', 280, 110, '多行文本域，适合备注、描述。', () =>
    buildTree(
      n(
        'textarea',
        {
          x: 0,
          y: 0,
          width: 280,
          height: 110,
          fill: 'rgba(255,255,255,0.05)',
          stroke: COL.border,
          strokeWidth: 1,
          radius: [10, 10, 10, 10],
          color: COL.text,
          fontSize: 13,
          lineHeight: 1.55,
        },
        { name: '文本域', placeholder: '请输入多行文本…', value: '' }
      )
    )
  ),
  preset('toggle', '开关', '表单', 'settings', 160, 26, '标签 + 开关，默认开启状态。', () =>
    buildTree(
      frame('开关', 0, 0, 160, 26, { fill: 'rgba(0,0,0,0)', stroke: 'rgba(0,0,0,0)', strokeWidth: 0, radius: [0, 0, 0, 0] }, [
        textNode('启用通知', 0, 3, 108, 20, { fontSize: 13, color: COL.text2 }),
        n(
          'toggle',
          {
            x: 116,
            y: 1,
            width: 44,
            height: 24,
            fill: COL.accent,
            stroke: 'rgba(255,255,255,0.22)',
            strokeWidth: 1,
            radius: [999, 999, 999, 999],
          },
          { name: '开关', checked: true }
        ),
      ])
    )
  ),
  preset('slider', '滑杆', '表单', 'move', 260, 44, '带标题与百分比的滑杆。', () =>
    buildTree(
      frame('滑杆', 0, 0, 260, 44, { fill: 'rgba(0,0,0,0)', stroke: 'rgba(0,0,0,0)', strokeWidth: 0, radius: [0, 0, 0, 0] }, [
        textNode('音量', 0, 0, 160, 18, { fontSize: 12, color: COL.muted }),
        textNode('60%', 180, 0, 80, 18, { fontSize: 12, color: COL.text2, textAlign: 'right' }),
        n(
          'slider',
          {
            x: 0,
            y: 24,
            width: 260,
            height: 16,
            fill: 'rgba(255,255,255,0.08)',
            stroke: 'rgba(0,0,0,0)',
            strokeWidth: 0,
            radius: [999, 999, 999, 999],
          },
          { name: '滑杆', percent: 60 }
        ),
      ])
    )
  ),
  preset('progress', '进度条', '表单', 'arrow', 260, 36, '带标题与百分比进度条。', () =>
    buildTree(
      frame('进度条', 0, 0, 260, 36, { fill: 'rgba(0,0,0,0)', stroke: 'rgba(0,0,0,0)', strokeWidth: 0, radius: [0, 0, 0, 0] }, [
        textNode('上传进度', 0, 0, 160, 18, { fontSize: 12, color: COL.muted }),
        textNode('64%', 200, 0, 60, 18, { fontSize: 12, color: COL.text2, textAlign: 'right' }),
        n(
          'progress',
          {
            x: 0,
            y: 24,
            width: 260,
            height: 8,
            fill: 'rgba(255,255,255,0.08)',
            stroke: 'rgba(0,0,0,0)',
            strokeWidth: 0,
            radius: [999, 999, 999, 999],
          },
          { name: '进度条', percent: 64 }
        ),
      ])
    )
  ),
  preset('tabs', '选项卡', '表单', 'folder', 320, 40, '三个等分 Tab，首项为激活态。', () =>
    buildTree(
      n(
        'tabs',
        {
          x: 0,
          y: 0,
          width: 320,
          height: 40,
          fill: 'rgba(255,255,255,0.045)',
          stroke: COL.border,
          strokeWidth: 1,
          radius: [10, 10, 10, 10],
          fontSize: 13,
          color: COL.text,
        },
        { name: '选项卡', items: ['概览', '数据', '设置'], value: '概览' }
      )
    )
  ),

  /* ---------------------------------------------------------- 数据 */
  preset('badge', '徽标', '数据', 'star', 64, 22, '状态 / 标签徽标。', () =>
    buildTree(
      n(
        'badge',
        {
          x: 0,
          y: 0,
          width: 64,
          height: 22,
          fill: COL.accentSoft,
          stroke: COL.accentBorder,
          strokeWidth: 1,
          radius: [999, 999, 999, 999],
          color: COL.accent2,
          fontSize: 11,
          fontWeight: 600,
          textAlign: 'center',
        },
        { name: '徽标', label: 'NEW' }
      )
    )
  ),
  preset('avatar', '头像', '数据', 'user', 44, 44, '圆形头像占位，支持图片。', () =>
    buildTree(
      n(
        'avatar',
        {
          x: 0,
          y: 0,
          width: 44,
          height: 44,
          fill: 'rgba(76,141,255,0.35)',
          stroke: 'rgba(255,255,255,0.18)',
          strokeWidth: 1,
          radius: [999, 999, 999, 999],
          clip: true,
        },
        { name: '头像', image: { src: '', fit: 'cover', alt: '头像' } }
      )
    )
  ),
  preset('data-card', '数据卡片', '数据', 'layout', 280, 148, '指标 + 趋势 + 迷你柱状图。', () =>
    buildTree(
      frame('数据卡片', 0, 0, 280, 148, { fill: COL.panel, stroke: COL.border, strokeWidth: 1, radius: [16, 16, 16, 16], clip: true }, [
        textNode('月活跃用户', 18, 16, 180, 20, { fontSize: 12, color: COL.muted }),
        textNode('12,480', 18, 40, 200, 36, { fontSize: 28, fontWeight: 700, lineHeight: 1.2 }),
        textNode('↑ 12.4% 较上月', 18, 88, 180, 18, { fontSize: 11, color: COL.success }),
        rectNode('迷你柱 1', 196, 100, 10, 18, { fill: 'rgba(76,141,255,0.35)', stroke: 'rgba(0,0,0,0)', strokeWidth: 0, radius: [3, 3, 0, 0] }),
        rectNode('迷你柱 2', 210, 92, 10, 26, { fill: 'rgba(76,141,255,0.5)', stroke: 'rgba(0,0,0,0)', strokeWidth: 0, radius: [3, 3, 0, 0] }),
        rectNode('迷你柱 3', 224, 82, 10, 36, { fill: 'rgba(76,141,255,0.65)', stroke: 'rgba(0,0,0,0)', strokeWidth: 0, radius: [3, 3, 0, 0] }),
        rectNode('迷你柱 4', 238, 72, 10, 46, { fill: COL.accent, stroke: 'rgba(0,0,0,0)', strokeWidth: 0, radius: [3, 3, 0, 0] }),
      ])
    )
  ),
  preset('list-item', '列表项', '数据', 'menu', 360, 64, '头像 + 标题 + 说明 + 箭头的列表行。', () =>
    buildTree(
      frame('列表项', 0, 0, 360, 64, { fill: COL.surface, stroke: COL.border, strokeWidth: 1, radius: [12, 12, 12, 12], clip: true }, [
        n(
          'avatar',
          { x: 14, y: 14, width: 36, height: 36, fill: 'rgba(76,141,255,0.35)', stroke: 'rgba(255,255,255,0.18)', strokeWidth: 1, radius: [999, 999, 999, 999], clip: true },
          { name: '头像', image: { src: '', fit: 'cover', alt: '头像' } }
        ),
        textNode('林晓', 62, 12, 200, 20, { fontSize: 14, fontWeight: 600 }),
        textNode('产品设计师 · 3 分钟前', 62, 34, 250, 18, { fontSize: 11, color: COL.muted }),
        iconNode('chevron', 328, 23, 18, COL.muted),
      ])
    )
  ),
  preset('stats', '统计块', '数据', 'grid', 300, 88, '三列核心指标 + 竖向分割。', () =>
    buildTree(
      frame('统计块', 0, 0, 300, 88, { fill: COL.panel, stroke: COL.border, strokeWidth: 1, radius: [14, 14, 14, 14], clip: true }, [
        textNode('12', 0, 18, 100, 30, { fontSize: 22, fontWeight: 700, textAlign: 'center' }),
        textNode('项目', 0, 50, 100, 18, { fontSize: 11, color: COL.muted, textAlign: 'center' }),
        textNode('48', 100, 18, 100, 30, { fontSize: 22, fontWeight: 700, textAlign: 'center' }),
        textNode('成员', 100, 50, 100, 18, { fontSize: 11, color: COL.muted, textAlign: 'center' }),
        textNode('96%', 200, 18, 100, 30, { fontSize: 22, fontWeight: 700, textAlign: 'center' }),
        textNode('完成率', 200, 50, 100, 18, { fontSize: 11, color: COL.muted, textAlign: 'center' }),
        rectNode('分割线 1', 100, 16, 1, 56, { fill: COL.border, stroke: 'rgba(0,0,0,0)', strokeWidth: 0, radius: [0, 0, 0, 0] }),
        rectNode('分割线 2', 200, 16, 1, 56, { fill: COL.border, stroke: 'rgba(0,0,0,0)', strokeWidth: 0, radius: [0, 0, 0, 0] }),
      ])
    )
  ),

  /* ---------------------------------------------------------- 导航 */
  preset('topbar', '顶栏', '导航', 'arrow', 480, 56, '返回 + 标题 + 更多操作的顶栏。', () =>
    buildTree(
      frame('顶栏', 0, 0, 480, 56, { fill: 'rgba(12,13,18,0.86)', stroke: COL.borderSoft, strokeWidth: 1, radius: [12, 12, 0, 0], clip: true }, [
        iconNode('arrow', 16, 18, 20, COL.text2, { rotation: 180 }),
        textNode('页面标题', 52, 16, 300, 24, { fontSize: 16, fontWeight: 600 }),
        iconNode('more', 436, 18, 20, COL.muted),
      ])
    )
  ),
  preset('tabbar', '底部 TabBar', '导航', 'home', 420, 64, '四项底部导航，首项激活。', () =>
    buildTree(
      frame('底部 TabBar', 0, 0, 420, 64, { fill: 'rgba(10,11,16,0.92)', stroke: COL.borderSoft, strokeWidth: 1, radius: [0, 0, 0, 0], clip: true }, [
        ...(['首页', '发现', '通知', '我的'] as const).flatMap((label, i) => {
          const icons = ['home', 'search', 'bell', 'user'];
          const active = i === 0;
          return [
            iconNode(icons[i], i * 105 + 42, 10, 22, active ? COL.accent2 : COL.muted),
            textNode(label, i * 105, 36, 105, 18, { fontSize: 10, color: active ? COL.accent2 : COL.muted, textAlign: 'center' }),
          ];
        }),
      ])
    )
  ),
  preset('sidebar', '侧边栏', '导航', 'menu', 220, 420, 'Logo + 5 个菜单项，首项选中。', () =>
    buildTree(
      frame('侧边栏', 0, 0, 220, 420, { fill: COL.panel, stroke: COL.border, strokeWidth: 1, radius: [16, 16, 16, 16], clip: true }, [
        ellipseNode('Logo 底', 18, 18, 30, 30, { fill: 'rgba(76,141,255,0.85)', stroke: 'rgba(255,255,255,0.28)', strokeWidth: 1, radius: [999, 999, 999, 999] }),
        iconNode('sparkle', 23, 23, 20, COL.white),
        textNode('便捷工具', 58, 21, 140, 24, { fontSize: 15, fontWeight: 600 }),
        rectNode('选中底', 12, 76, 196, 38, { fill: 'rgba(76,141,255,0.14)', stroke: 'rgba(76,141,255,0.28)', strokeWidth: 1, radius: [10, 10, 10, 10] }),
        ...(['概览', '项目', '组件库', '数据', '设置'] as const).flatMap((label, i) => {
          const icons = ['grid', 'folder', 'layout', 'arrow', 'settings'];
          return [
            iconNode(icons[i], 26, 84 + i * 46, 18, i === 0 ? COL.accent2 : COL.muted),
            textNode(label, 54, 83 + i * 46, 120, 20, { fontSize: 13, fontWeight: i === 0 ? 600 : 400, color: i === 0 ? COL.text : COL.text2 }),
          ];
        }),
      ])
    )
  ),
  preset('breadcrumb', '面包屑', '导航', 'chevron', 420, 24, '多级路径导航。', () =>
    buildTree(
      frame('面包屑', 0, 0, 420, 24, { fill: 'rgba(0,0,0,0)', stroke: 'rgba(0,0,0,0)', strokeWidth: 0, radius: [0, 0, 0, 0], layout: 'row', gap: 8, align: 'center' }, [
        textNode('首页', 0, 2, 40, 20, { fontSize: 12, color: COL.muted }),
        textNode('/', 44, 2, 12, 20, { fontSize: 12, color: 'rgba(255,255,255,0.28)' }),
        textNode('项目', 60, 2, 40, 20, { fontSize: 12, color: COL.muted }),
        textNode('/', 104, 2, 12, 20, { fontSize: 12, color: 'rgba(255,255,255,0.28)' }),
        textNode('设置', 120, 2, 60, 20, { fontSize: 12, color: COL.text2, fontWeight: 500 }),
      ])
    )
  ),

  /* ---------------------------------------------------------- 媒体 */
  preset('media-card', '媒体封面卡', '媒体', 'play', 260, 300, '封面 + 标题 + 副标题 + 播放按钮。', () =>
    buildTree(
      frame('媒体封面卡', 0, 0, 260, 300, { fill: COL.panel, stroke: COL.border, strokeWidth: 1, radius: [16, 16, 16, 16], clip: true }, [
        frame(
          '封面',
          0,
          0,
          260,
          180,
          {
            fill: 'rgba(0,0,0,0)',
            gradient: { from: '#1B3A6B', to: '#0B1220', angle: 160 },
            stroke: 'rgba(0,0,0,0)',
            strokeWidth: 0,
            radius: [16, 16, 0, 0],
            clip: true,
          },
          [
            ellipseNode('装饰光斑', 150, -30, 160, 160, { fill: 'rgba(76,141,255,0.22)', stroke: 'rgba(0,0,0,0)', strokeWidth: 0, blur: 20 }),
            ellipseNode('播放按钮底', 102, 62, 56, 56, { fill: 'rgba(255,255,255,0.16)', stroke: 'rgba(255,255,255,0.38)', strokeWidth: 1, radius: [999, 999, 999, 999] }),
            iconNode('play', 118, 78, 24, COL.white),
          ]
        ),
        textNode('夜航', 16, 196, 220, 24, { fontSize: 16, fontWeight: 600 }),
        textNode('林深 · 单曲', 16, 224, 220, 20, { fontSize: 12, color: COL.muted }),
        n(
          'badge',
          { x: 16, y: 256, width: 58, height: 20, fill: COL.accentSoft, stroke: COL.accentBorder, strokeWidth: 1, radius: [999, 999, 999, 999], color: COL.accent2, fontSize: 10, fontWeight: 600, textAlign: 'center' },
          { name: '音质徽标', label: '无损' }
        ),
      ])
    )
  ),
  preset('player-controls', '播放控制条', '媒体', 'volume', 460, 84, '上一首 / 播放 / 下一首 + 进度 + 时间。', () =>
    buildTree(
      frame('播放控制条', 0, 0, 460, 84, { fill: 'rgba(12,13,18,0.9)', stroke: COL.border, strokeWidth: 1, radius: [16, 16, 16, 16], clip: true }, [
        iconNode('more', 104, 27, 18, COL.muted),
        iconNode('arrow', 160, 24, 24, COL.text2, { rotation: 180 }),
        ellipseNode('播放按钮底', 204, 10, 52, 52, { fill: COL.accent, stroke: 'rgba(255,255,255,0.24)', strokeWidth: 1, radius: [999, 999, 999, 999] }),
        iconNode('play', 220, 26, 20, COL.white),
        iconNode('arrow', 276, 24, 24, COL.text2),
        iconNode('heart', 338, 27, 18, COL.muted),
        n(
          'progress',
          { x: 20, y: 58, width: 420, height: 4, fill: 'rgba(255,255,255,0.10)', stroke: 'rgba(0,0,0,0)', strokeWidth: 0, radius: [999, 999, 999, 999] },
          { name: '播放进度', percent: 38 }
        ),
        textNode('1:42', 20, 66, 60, 14, { fontSize: 10, color: COL.muted }),
        textNode('4:28', 380, 66, 60, 14, { fontSize: 10, color: COL.muted, textAlign: 'right' }),
      ])
    )
  ),
];

/* ------------------------------------------------------------------ 查询 / 实例化 */

export function findPreset(id: string): UIComponentPreset | undefined {
  return UI_COMPONENT_PRESETS.find((preset) => preset.id === id);
}

/**
 * 实例化组件预设：深拷贝并通过 id 映射重新生成全部节点 id，
 * 同步重映射 parentId / children，返回新的节点数组（根 parentId = null）。
 */
export function instantiatePreset(id: string): UINode[] {
  const preset = findPreset(id);
  if (!preset) return [];
  const nodes = preset.create();
  const idMap = new Map<string, string>();
  for (const node of nodes) {
    if (!idMap.has(node.id)) idMap.set(node.id, newId(node.type));
  }
  return nodes.map((node) => {
    const clone = structuredCloneSafe(node);
    clone.id = idMap.get(node.id)!;
    clone.parentId = node.parentId ? idMap.get(node.parentId) ?? null : null;
    clone.children = node.children
      .map((childId) => idMap.get(childId))
      .filter((value): value is string => Boolean(value));
    clone.style.radius = [...clone.style.radius] as [number, number, number, number];
    return clone;
  });
}
