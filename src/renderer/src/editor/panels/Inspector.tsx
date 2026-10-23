/**
 * 属性检查器（右侧「属性」页）
 *
 * - 无选中：画板 / 项目属性；
 * - 有选中：节点头部、几何、布局、外观、文字、类型专属属性；
 * - 多选：混合值显示「混合」，修改批量写入（一次历史）；
 * - 连续输入（拾色器 / 滑块）使用 useLiveGesture 合并历史。
 */
import { useMemo, useState } from 'react';
import type {
  UIAlign,
  UIFit,
  UIGradient,
  UIJustify,
  UILayoutMode,
  UINode,
  UINodeStyle,
  UINodeType,
  UIShadow,
  UITextAlign,
} from '@shared/uieditor';
import {
  ALIGN_OPTIONS,
  JUSTIFY_OPTIONS,
  NODE_TYPE_LABELS,
  gradientCss,
  radiusCss,
  shadowCss,
} from '@shared/uieditor-kit';
import { ICON_LIBRARY } from '@shared/uieditor-render';
import { editorStore, selectedNodes, type EditorSnapshot } from '../store';
import { isArtboardNode } from './LayerTree';
import {
  ColorInput,
  EmptyState,
  FieldRow,
  Glyph,
  NodeGlyph,
  NumberInput,
  Section,
  Segmented,
  Select,
  SliderField,
  Switch,
  TextArea,
  TextInput,
  applyNodePatch,
  applyStylePatch,
  percentLabel,
  pickNode,
  pickStyle,
  useLiveGesture,
} from './controls';

const TEXT_TYPES: ReadonlySet<UINodeType> = new Set<UINodeType>([
  'text',
  'button',
  'input',
  'textarea',
  'badge',
  'tabs',
]);

const FONT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'system-ui', label: '系统默认' },
  { value: '"Microsoft YaHei UI", "Segoe UI", system-ui, sans-serif', label: '微软雅黑' },
  { value: '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif', label: 'Segoe UI' },
  { value: '"PingFang SC", "HarmonyOS Sans SC", "Microsoft YaHei UI", sans-serif', label: '苹方 / 鸿蒙' },
  { value: 'Georgia, "Times New Roman", serif', label: '衬线 Georgia' },
  { value: '"Cascadia Code", "Consolas", monospace', label: '等宽' },
];

const WEIGHT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '300', label: '300 细' },
  { value: '400', label: '400 常规' },
  { value: '500', label: '500 中等' },
  { value: '600', label: '600 半粗' },
  { value: '700', label: '700 粗体' },
  { value: '800', label: '800 特粗' },
];

const TEXT_ALIGN_SHORT: Array<{ value: UITextAlign; label: string; title: string }> = [
  { value: 'left', label: '左', title: '左对齐' },
  { value: 'center', label: '中', title: '居中' },
  { value: 'right', label: '右', title: '右对齐' },
  { value: 'justify', label: '两', title: '两端对齐' },
];

const LAYOUT_OPTIONS: Array<{ value: UILayoutMode; label: string; title: string }> = [
  { value: 'free', label: '自由', title: '自由定位' },
  { value: 'row', label: '横向', title: '横向排列（Flex Row）' },
  { value: 'column', label: '纵向', title: '纵向排列（Flex Column）' },
];

const FIT_OPTIONS: Array<{ value: UIFit; label: string }> = [
  { value: 'cover', label: '填充' },
  { value: 'contain', label: '完整' },
  { value: 'fill', label: '拉伸' },
];

interface SectionProps {
  nodes: UINode[];
  primary: UINode;
  applyStyle: (patch: Partial<UINodeStyle>, history?: boolean) => void;
  applyNode: (patch: Partial<UINode>, history?: boolean) => void;
  liveStyle: (patch: Partial<UINodeStyle>) => void;
}

/* ------------------------------------------------------------------ 入口 */

export function Inspector({ snapshot }: { snapshot: EditorSnapshot }) {
  const nodes = selectedNodes(snapshot);
  if (!nodes.length) return <ArtboardInspector snapshot={snapshot} />;
  return <NodeInspector snapshot={snapshot} nodes={nodes} />;
}

function NodeInspector({ snapshot, nodes }: { snapshot: EditorSnapshot; nodes: UINode[] }) {
  const primary = nodes[0];
  const selection = nodes.map((node) => node.id);
  const live = useLiveGesture('调整样式');

  const applyStyle = (patch: Partial<UINodeStyle>, history = true) => applyStylePatch(selection, patch, history);
  const applyNode = (patch: Partial<UINode>, history = true) => applyNodePatch(selection, patch, history);
  const liveStyle = (patch: Partial<UINodeStyle>) => live.run(() => applyStyle(patch, false));

  const visible = pickStyle(nodes, (style) => style.visible);
  const locked = pickStyle(nodes, (style) => style.locked);

  return (
    <div className="up-inspector up-scroll">
      <div className="up-inspector-head">
        <span className="up-node-type" title={NODE_TYPE_LABELS[primary.type]}>
          <NodeGlyph type={primary.type} size={15} />
        </span>
        <NodeNameField node={primary} multi={nodes.length > 1} count={nodes.length} />
        <div className="up-node-toggles">
          <button
            type="button"
            className={`up-icon-btn${!visible.value ? ' active' : ''}${visible.mixed ? ' mixed' : ''}`}
            title={visible.mixed ? '显示状态混合，点击全部显示' : visible.value ? '隐藏节点' : '显示节点'}
            aria-label={visible.value ? '隐藏节点' : '显示节点'}
            aria-pressed={!visible.value}
            onClick={() => applyStyle({ visible: visible.mixed ? true : !visible.value })}
          >
            <Glyph name={visible.value || visible.mixed ? 'eye' : 'eye-off'} size={13} />
          </button>
          <button
            type="button"
            className={`up-icon-btn${locked.value ? ' active' : ''}${locked.mixed ? ' mixed' : ''}`}
            title={locked.mixed ? '锁定状态混合，点击全部锁定' : locked.value ? '解锁节点' : '锁定节点'}
            aria-label={locked.value ? '解锁节点' : '锁定节点'}
            aria-pressed={locked.value}
            onClick={() => applyStyle({ locked: locked.mixed ? true : !locked.value })}
          >
            <Glyph name={locked.value ? 'lock' : 'unlock'} size={13} />
          </button>
        </div>
      </div>

      {primary.style.locked ? (
        <div className="up-alert subtle">
          <Glyph name="lock" size={12} />
          <span>节点已锁定：画布上不可拖动，但仍可在面板中修改属性。</span>
        </div>
      ) : null}

      <GeometrySection nodes={nodes} primary={primary} applyStyle={applyStyle} applyNode={applyNode} liveStyle={liveStyle} />
      <LayoutSection nodes={nodes} primary={primary} applyStyle={applyStyle} applyNode={applyNode} liveStyle={liveStyle} />
      <AppearanceSection
        nodes={nodes}
        primary={primary}
        applyStyle={applyStyle}
        applyNode={applyNode}
        liveStyle={liveStyle}
      />
      {TEXT_TYPES.has(primary.type) ? (
        <TextSection nodes={nodes} primary={primary} applyStyle={applyStyle} applyNode={applyNode} liveStyle={liveStyle} />
      ) : null}
      <SpecificSection nodes={nodes} primary={primary} applyStyle={applyStyle} applyNode={applyNode} liveStyle={liveStyle} />
      <div className="up-inspector-tail">
        <span>ID</span>
        <code>{primary.id}</code>
      </div>
    </div>
  );
}

function NodeNameField({ node, multi, count }: { node: UINode; multi: boolean; count: number }) {
  const [draft, setDraft] = useState(node.name);
  const [editing, setEditing] = useState(false);
  const artboard = isArtboardNode(node);

  const display = editing ? draft : node.name;

  const commit = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== node.name) editorStore.renameNode(node.id, trimmed);
  };

  if (artboard) {
    return (
      <div className="up-node-main">
        <span className="up-node-name static" title="画板根节点不可重命名">
          画板
        </span>
        <span className="up-node-sub">根容器 · 由页面尺寸控制</span>
      </div>
    );
  }

  return (
    <div className="up-node-main">
      <input
        className="up-node-name"
        value={display}
        aria-label="节点名称"
        title={multi ? '多选时重命名第一个节点' : '重命名节点（回车确认）'}
        placeholder="节点名称"
        onFocus={() => {
          setEditing(true);
          setDraft(node.name);
        }}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit();
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            setEditing(false);
            event.currentTarget.blur();
          }
        }}
      />
      <span className="up-node-sub">
        {NODE_TYPE_LABELS[node.type]}
        {multi ? ` · 已选 ${count} 个节点` : ''}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ 画板属性 */

function ArtboardInspector({ snapshot }: { snapshot: EditorSnapshot }) {
  const screen =
    snapshot.project.screens.find((item) => item.id === snapshot.activeScreenId) ??
    snapshot.project.screens[0] ??
    null;
  const backgroundGesture = useLiveGesture('画板背景');
  const { project } = snapshot;

  if (!screen) {
    return (
      <div className="up-scroll up-inspector">
        <EmptyState icon="screen" title="没有可编辑的页面" hint="在左侧「页面」标签中新建一个页面。" />
      </div>
    );
  }

  const nodeCount = Object.keys(project.nodes).length;
  const updated = project.updatedAt ? new Date(project.updatedAt) : null;

  return (
    <div className="up-inspector up-scroll">
      <div className="up-inspector-head">
        <span className="up-node-type">
          <Glyph name="grid" size={15} />
        </span>
        <div className="up-node-main">
          <span className="up-node-name static">画板</span>
          <span className="up-node-sub">{screen.name} · 未选中节点</span>
        </div>
      </div>

      <Section title="画板">
        <div className="up-grid2">
          <FieldRow label="宽">
            <NumberInput
              value={screen.width}
              min={120}
              max={4096}
              step={10}
              suffix="px"
              ariaLabel="画板宽度"
              onCommit={(width) => editorStore.setScreenSize(screen.id, width, screen.height)}
            />
          </FieldRow>
          <FieldRow label="高">
            <NumberInput
              value={screen.height}
              min={120}
              max={4096}
              step={10}
              suffix="px"
              ariaLabel="画板高度"
              onCommit={(height) => editorStore.setScreenSize(screen.id, screen.width, height)}
            />
          </FieldRow>
        </div>
        <FieldRow label="背景">
          <ColorInput
            value={screen.background}
            ariaLabel="画板背景"
            onChange={(value) => backgroundGesture.run(() => editorStore.setScreenBackground(screen.id, value))}
          />
        </FieldRow>
      </Section>

      <Section title="项目">
        <FieldRow label="名称">
          <TextInput
            value={project.name}
            ariaLabel="项目名称"
            onCommit={(name) => {
              if (name.trim()) editorStore.setProjectName(name);
            }}
          />
        </FieldRow>
        <div className="up-stats">
          <div className="up-stat">
            <span className="up-stat-value">{project.screens.length}</span>
            <span className="up-stat-label">页面</span>
          </div>
          <div className="up-stat">
            <span className="up-stat-value">{nodeCount}</span>
            <span className="up-stat-label">节点</span>
          </div>
          <div className="up-stat">
            <span className="up-stat-value">
              {updated && !Number.isNaN(updated.getTime())
                ? `${String(updated.getHours()).padStart(2, '0')}:${String(updated.getMinutes()).padStart(2, '0')}`
                : '—'}
            </span>
            <span className="up-stat-label">更新</span>
          </div>
        </div>
      </Section>

      <div className="up-inspector-hint">
        <Glyph name="info" size={12} />
        <span>在画布或图层中选中节点后，这里会显示完整属性。</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ 几何 */

function arrangeSelection(ids: string[], direction: 'front' | 'back' | 'forward' | 'backward') {
  const project = editorStore.getProject();
  const screen = editorStore.getActiveScreen();
  if (!screen) return;
  const targets = ids.filter((id) => {
    const node = project.nodes[id];
    return node && !isArtboardNode(node);
  });
  if (!targets.length) return;
  editorStore.beginGesture();
  try {
    for (const id of targets) {
      const node = project.nodes[id];
      if (!node) continue;
      const list = node.parentId ? project.nodes[node.parentId]?.children : screen.rootIds;
      if (!list) continue;
      const index = list.indexOf(id);
      if (index < 0) continue;
      list.splice(index, 1);
      if (direction === 'front') list.push(id);
      else if (direction === 'back') list.unshift(id);
      else if (direction === 'forward') list.splice(Math.min(list.length, index + 1), 0, id);
      else list.splice(Math.max(0, index - 1), 0, id);
    }
  } finally {
    editorStore.endGesture('调整层级');
  }
}

function GeometrySection({ nodes, applyStyle }: SectionProps) {
  const x = pickStyle(nodes, (style) => style.x);
  const y = pickStyle(nodes, (style) => style.y);
  const width = pickStyle(nodes, (style) => style.width);
  const height = pickStyle(nodes, (style) => style.height);
  const rotation = pickStyle(nodes, (style) => style.rotation);
  const opacity = pickStyle(nodes, (style) => style.opacity);
  const ids = nodes.map((node) => node.id);

  return (
    <Section
      title="位置与尺寸"
      actions={
        <span className="up-arrange">
          <button type="button" className="up-icon-btn" title="置顶" aria-label="置顶" onClick={() => arrangeSelection(ids, 'front')}>
            <Glyph name="top" size={12} />
          </button>
          <button type="button" className="up-icon-btn" title="上移一层" aria-label="上移一层" onClick={() => arrangeSelection(ids, 'forward')}>
            <Glyph name="up" size={12} />
          </button>
          <button type="button" className="up-icon-btn" title="下移一层" aria-label="下移一层" onClick={() => arrangeSelection(ids, 'backward')}>
            <Glyph name="down" size={12} />
          </button>
          <button type="button" className="up-icon-btn" title="置底" aria-label="置底" onClick={() => arrangeSelection(ids, 'back')}>
            <Glyph name="bottom" size={12} />
          </button>
        </span>
      }
    >
      <div className="up-grid2">
        <FieldRow label="X">
          <NumberInput value={x.value} mixed={x.mixed} ariaLabel="X 坐标" suffix="px" onCommit={(value) => applyStyle({ x: value })} />
        </FieldRow>
        <FieldRow label="Y">
          <NumberInput value={y.value} mixed={y.mixed} ariaLabel="Y 坐标" suffix="px" onCommit={(value) => applyStyle({ y: value })} />
        </FieldRow>
        <FieldRow label="W">
          <NumberInput
            value={width.value}
            mixed={width.mixed}
            min={1}
            ariaLabel="宽度"
            suffix="px"
            onCommit={(value) => applyStyle({ width: value })}
          />
        </FieldRow>
        <FieldRow label="H">
          <NumberInput
            value={height.value}
            mixed={height.mixed}
            min={1}
            ariaLabel="高度"
            suffix="px"
            onCommit={(value) => applyStyle({ height: value })}
          />
        </FieldRow>
      </div>
      <div className="up-grid2">
        <FieldRow label="旋转">
          <NumberInput
            value={rotation.value}
            mixed={rotation.mixed}
            min={-360}
            max={360}
            suffix="°"
            ariaLabel="旋转角度"
            onCommit={(value) => applyStyle({ rotation: value })}
          />
        </FieldRow>
        <FieldRow label="透明度">
          <SliderField
            value={opacity.value}
            min={0}
            max={1}
            step={0.01}
            format={percentLabel}
            ariaLabel="不透明度"
            onCommit={(value) => applyStyle({ opacity: Math.round(value * 100) / 100 })}
          />
        </FieldRow>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ 布局 */

function LayoutSection({ nodes, applyStyle }: SectionProps) {
  const layout = pickStyle(nodes, (style) => style.layout);
  const gap = pickStyle(nodes, (style) => style.gap);
  const padding = pickStyle(nodes, (style) => style.padding);
  const align = pickStyle(nodes, (style) => style.align);
  const justify = pickStyle(nodes, (style) => style.justify);
  const flexible = !layout.mixed && layout.value !== 'free';

  return (
    <Section title="布局">
      <FieldRow label="模式">
        <Segmented
          value={layout.value}
          mixed={layout.mixed}
          options={LAYOUT_OPTIONS}
          ariaLabel="布局模式"
          onChange={(value) => applyStyle({ layout: value })}
        />
      </FieldRow>
      <div className="up-grid2">
        <FieldRow label="间距">
          <NumberInput
            value={gap.value}
            mixed={gap.mixed}
            min={0}
            max={240}
            suffix="px"
            ariaLabel="子元素间距"
            onCommit={(value) => applyStyle({ gap: value })}
          />
        </FieldRow>
        <FieldRow label="内边距">
          <NumberInput
            value={padding.value}
            mixed={padding.mixed}
            min={0}
            max={240}
            suffix="px"
            ariaLabel="内边距"
            onCommit={(value) => applyStyle({ padding: value })}
          />
        </FieldRow>
      </div>
      {flexible ? (
        <div className="up-grid2">
          <FieldRow label="对齐">
            <Select<UIAlign>
              value={align.value}
              mixed={align.mixed}
              options={ALIGN_OPTIONS}
              ariaLabel="交叉轴对齐"
              onChange={(value) => applyStyle({ align: value })}
            />
          </FieldRow>
          <FieldRow label="分布">
            <Select<UIJustify>
              value={justify.value}
              mixed={justify.mixed}
              options={JUSTIFY_OPTIONS}
              ariaLabel="主轴分布"
              onChange={(value) => applyStyle({ justify: value })}
            />
          </FieldRow>
        </div>
      ) : null}
    </Section>
  );
}

/* ------------------------------------------------------------------ 外观 */

function AppearanceSection({ nodes, primary, applyStyle, liveStyle }: SectionProps) {
  const fill = pickStyle(nodes, (style) => style.fill);
  const stroke = pickStyle(nodes, (style) => style.stroke);
  const strokeWidth = pickStyle(nodes, (style) => style.strokeWidth);
  const blur = pickStyle(nodes, (style) => style.blur);
  const corners = [0, 1, 2, 3].map((index) =>
    pickStyle(nodes, (style) => style.radius[index] as number)
  );
  const unifiedRadius = pickStyle(nodes, (style) => style.radius[0]);
  const mixedCorners = nodes.some((node) => {
    const [tl, tr, br, bl] = node.style.radius;
    return tl !== tr || tr !== br || br !== bl;
  });

  const gradient = primary.style.gradient;
  const gradientMixed = pickStyle(nodes, (style) => !!style.gradient).mixed;
  const shadow = primary.style.shadow;
  const shadowMixed = pickStyle(nodes, (style) => !!style.shadow).mixed;
  const [advancedRadius, setAdvancedRadius] = useState(false);

  const patchGradient = (patch: Partial<UIGradient>) => {
    const base: UIGradient = gradient ?? { from: '#4C8DFF', to: '#7CB0FF', angle: 135 };
    liveStyle({ gradient: { ...base, ...patch } });
  };

  const patchShadow = (patch: Partial<UIShadow>) => {
    const base: UIShadow = shadow ?? { x: 0, y: 8, blur: 24, spread: -4, color: 'rgba(0,0,0,0.45)' };
    liveStyle({ shadow: { ...base, ...patch } });
  };

  const setCorner = (index: number, value: number) => {
    const current = corners.map((corner) => (corner.mixed ? (unifiedRadius.value ?? 0) : corner.value));
    current[index] = value;
    applyStyle({ radius: current as [number, number, number, number] });
  };

  return (
    <Section title="外观">
      <FieldRow label="填充" hint="填充色，支持 #hex / rgb() / rgba()">
        <ColorInput
          value={fill.value}
          mixed={fill.mixed}
          ariaLabel="填充色"
          onChange={(value) => liveStyle({ fill: value })}
        />
      </FieldRow>

      <div className="up-inline-row">
        <Switch
          checked={!!gradient}
          mixed={gradientMixed && !gradient}
          ariaLabel="启用渐变"
          title="渐变（覆盖填充）"
          onChange={(next) =>
            applyStyle({
              gradient: next ? gradient ?? { from: fill.value || '#4C8DFF', to: '#7CB0FF', angle: 135 } : null,
            })
          }
        />
        <span className="up-inline-label">渐变</span>
        {gradient ? (
          <span className="up-gradient-preview" style={{ backgroundImage: gradientCss(gradient) ?? undefined }} />
        ) : null}
      </div>
      {gradient ? (
        <>
          <FieldRow label="起色">
            <ColorInput
              value={gradient.from}
              ariaLabel="渐变起始色"
              onChange={(value) => patchGradient({ from: value })}
            />
          </FieldRow>
          <FieldRow label="止色">
            <ColorInput value={gradient.to} ariaLabel="渐变结束色" onChange={(value) => patchGradient({ to: value })} />
          </FieldRow>
          <FieldRow label="角度">
            <NumberInput
              value={gradient.angle}
              min={0}
              max={360}
              suffix="°"
              ariaLabel="渐变角度"
              onCommit={(value) => applyStyle({ gradient: { ...gradient, angle: value } })}
            />
          </FieldRow>
        </>
      ) : null}

      <FieldRow label="描边">
        <ColorInput
          value={stroke.value}
          mixed={stroke.mixed}
          ariaLabel="描边色"
          onChange={(value) => liveStyle({ stroke: value })}
        />
      </FieldRow>
      <FieldRow label="描边宽">
        <NumberInput
          value={strokeWidth.value}
          mixed={strokeWidth.mixed}
          min={0}
          max={40}
          step={0.5}
          precision={1}
          suffix="px"
          ariaLabel="描边宽度"
          onCommit={(value) => applyStyle({ strokeWidth: value })}
        />
      </FieldRow>

      <FieldRow label="圆角" hint="统一圆角，或展开分别设置四角">
        <div className="up-radius-row">
          <NumberInput
            value={unifiedRadius.value}
            mixed={unifiedRadius.mixed || mixedCorners}
            min={0}
            max={999}
            suffix="px"
            ariaLabel="统一圆角"
            disabled={advancedRadius}
            onCommit={(value) => applyStyle({ radius: [value, value, value, value] })}
          />
          <button
            type="button"
            className={`up-icon-btn${advancedRadius ? ' active' : ''}`}
            title={advancedRadius ? '收起四角设置' : '分别设置四角圆角'}
            aria-label="切换四角圆角设置"
            aria-pressed={advancedRadius}
            onClick={() => setAdvancedRadius((current) => !current)}
          >
            <Glyph name={advancedRadius ? 'chevron-up' : 'chevron-down'} size={12} />
          </button>
        </div>
      </FieldRow>
      {advancedRadius ? (
        <div className="up-grid2">
          {(['左上', '右上', '右下', '左下'] as const).map((label, index) => (
            <FieldRow key={label} label={label}>
              <NumberInput
                value={corners[index].value}
                mixed={corners[index].mixed}
                min={0}
                max={999}
                suffix="px"
                ariaLabel={`${label}圆角`}
                onCommit={(value) => setCorner(index, value)}
              />
            </FieldRow>
          ))}
        </div>
      ) : null}

      <div className="up-inline-row">
        <Switch
          checked={!!shadow}
          mixed={shadowMixed && !shadow}
          ariaLabel="启用阴影"
          title="阴影"
          onChange={(next) =>
            applyStyle({
              shadow: next ? shadow ?? { x: 0, y: 8, blur: 24, spread: -4, color: 'rgba(0,0,0,0.45)' } : null,
            })
          }
        />
        <span className="up-inline-label">阴影</span>
        {shadow ? (
          <span
            className="up-shadow-preview"
            style={{ boxShadow: shadowCss(shadow) ?? undefined, borderRadius: radiusCss(primary.style.radius) }}
          />
        ) : null}
      </div>
      {shadow ? (
        <>
          <div className="up-grid2">
            <FieldRow label="X">
              <NumberInput value={shadow.x} ariaLabel="阴影 X" suffix="px" onCommit={(value) => applyStyle({ shadow: { ...shadow, x: value } })} />
            </FieldRow>
            <FieldRow label="Y">
              <NumberInput value={shadow.y} ariaLabel="阴影 Y" suffix="px" onCommit={(value) => applyStyle({ shadow: { ...shadow, y: value } })} />
            </FieldRow>
            <FieldRow label="模糊">
              <NumberInput
                value={shadow.blur}
                min={0}
                max={200}
                suffix="px"
                ariaLabel="阴影模糊"
                onCommit={(value) => applyStyle({ shadow: { ...shadow, blur: value } })}
              />
            </FieldRow>
            <FieldRow label="扩散">
              <NumberInput
                value={shadow.spread}
                min={-100}
                max={200}
                suffix="px"
                ariaLabel="阴影扩散"
                onCommit={(value) => applyStyle({ shadow: { ...shadow, spread: value } })}
              />
            </FieldRow>
          </div>
          <FieldRow label="阴影色">
            <ColorInput value={shadow.color} ariaLabel="阴影颜色" onChange={(value) => patchShadow({ color: value })} />
          </FieldRow>
        </>
      ) : null}

      <FieldRow label="模糊">
        <NumberInput
          value={blur.value}
          mixed={blur.mixed}
          min={0}
          max={100}
          suffix="px"
          ariaLabel="模糊半径"
          onCommit={(value) => applyStyle({ blur: value })}
        />
      </FieldRow>
    </Section>
  );
}

/* ------------------------------------------------------------------ 文字 */

function TextSection({ nodes, applyStyle, applyNode }: SectionProps) {
  const text = pickNode(nodes, (node) => node.text ?? '');
  const color = pickStyle(nodes, (style) => style.color);
  const family = pickStyle(nodes, (style) => style.fontFamily);
  const size = pickStyle(nodes, (style) => style.fontSize);
  const weight = pickStyle(nodes, (style) => style.fontWeight);
  const lineHeight = pickStyle(nodes, (style) => style.lineHeight);
  const letterSpacing = pickStyle(nodes, (style) => style.letterSpacing);
  const align = pickStyle(nodes, (style) => style.textAlign);
  const transform = pickStyle(nodes, (style) => style.textTransform);
  const decoration = pickStyle(nodes, (style) => style.textDecoration);

  const fontOptions = useMemo(() => {
    const exists = FONT_OPTIONS.some((option) => option.value === family.value);
    return exists ? FONT_OPTIONS : [{ value: family.value, label: '自定义字体' }, ...FONT_OPTIONS];
  }, [family.value]);

  return (
    <Section title="文字">
      <FieldRow label="内容" hint="多选时会把内容写入全部选中节点">
        <TextArea
          value={text.value}
          placeholder="输入文字内容…"
          ariaLabel="文字内容"
          rows={2}
          onCommit={(value) => applyNode({ text: value })}
        />
      </FieldRow>
      <FieldRow label="字体">
        <Select value={family.value} mixed={family.mixed} options={fontOptions} ariaLabel="字体" onChange={(value) => applyStyle({ fontFamily: value })} />
      </FieldRow>
      <div className="up-grid2">
        <FieldRow label="字号">
          <NumberInput
            value={size.value}
            mixed={size.mixed}
            min={8}
            max={200}
            suffix="px"
            ariaLabel="字号"
            onCommit={(value) => applyStyle({ fontSize: value })}
          />
        </FieldRow>
        <FieldRow label="字重">
          <Select
            value={String(weight.value)}
            mixed={weight.mixed}
            options={WEIGHT_OPTIONS}
            ariaLabel="字重"
            onChange={(value) => applyStyle({ fontWeight: Number(value) })}
          />
        </FieldRow>
        <FieldRow label="行高">
          <NumberInput
            value={lineHeight.value}
            mixed={lineHeight.mixed}
            min={0.8}
            max={4}
            step={0.05}
            precision={2}
            ariaLabel="行高"
            onCommit={(value) => applyStyle({ lineHeight: value })}
          />
        </FieldRow>
        <FieldRow label="字距">
          <NumberInput
            value={letterSpacing.value}
            mixed={letterSpacing.mixed}
            min={-10}
            max={40}
            step={0.5}
            precision={1}
            suffix="px"
            ariaLabel="字距"
            onCommit={(value) => applyStyle({ letterSpacing: value })}
          />
        </FieldRow>
      </div>
      <FieldRow label="颜色">
        <ColorInput value={color.value} mixed={color.mixed} ariaLabel="文字颜色" onChange={(value) => applyStyle({ color: value })} />
      </FieldRow>
      <FieldRow label="对齐">
        <Segmented
          value={align.value}
          mixed={align.mixed}
          options={TEXT_ALIGN_SHORT}
          ariaLabel="文字对齐"
          onChange={(value) => applyStyle({ textAlign: value })}
        />
      </FieldRow>
      <FieldRow label="大小写">
        <Segmented
          value={transform.value}
          mixed={transform.mixed}
          options={[
            { value: 'none', label: '无' },
            { value: 'uppercase', label: '大写' },
            { value: 'lowercase', label: '小写' },
          ]}
          ariaLabel="大小写转换"
          onChange={(value) => applyStyle({ textTransform: value as UINodeStyle['textTransform'] })}
        />
      </FieldRow>
      <FieldRow label="装饰">
        <Segmented
          value={decoration.value}
          mixed={decoration.mixed}
          options={[
            { value: 'none', label: '无' },
            { value: 'underline', label: '下划线' },
            { value: 'line-through', label: '删除线' },
          ]}
          ariaLabel="文字装饰"
          onChange={(value) => applyStyle({ textDecoration: value as UINodeStyle['textDecoration'] })}
        />
      </FieldRow>
    </Section>
  );
}

/* ------------------------------------------------------------------ 类型专属 */

function SpecificSection({ nodes, primary, applyStyle, applyNode, liveStyle }: SectionProps) {
  const type = primary.type;

  if (type === 'image') {
    const image = primary.image;
    const fit = pickNode(nodes, (node) => node.image?.fit ?? 'cover');
    return (
      <Section title="图片">
        <FieldRow label="填充">
          <Segmented
            value={fit.value}
            mixed={fit.mixed}
            options={FIT_OPTIONS}
            ariaLabel="图片填充方式"
            onChange={(value) => applyNode({ image: { src: image?.src ?? '', fit: value, alt: image?.alt ?? '' } })}
          />
        </FieldRow>
        <FieldRow label="地址" hint="支持 https 链接或 dataURL；也可在「资源」标签中导入本地图片">
          <TextInput
            value={image?.src ?? ''}
            ariaLabel="图片地址"
            placeholder="https://… 或 data:image/…"
            mono
            onCommit={(value) => applyNode({ image: { src: value, fit: image?.fit ?? 'cover', alt: image?.alt ?? '' } })}
          />
        </FieldRow>
        <FieldRow label="替代文本">
          <TextInput
            value={image?.alt ?? ''}
            ariaLabel="图片替代文本"
            placeholder="图片说明"
            onCommit={(value) => applyNode({ image: { src: image?.src ?? '', fit: image?.fit ?? 'cover', alt: value } })}
          />
        </FieldRow>
        {image?.src ? (
          <div className="up-image-preview">
            <img src={image.src} alt={image.alt || '预览'} />
          </div>
        ) : null}
      </Section>
    );
  }

  if (type === 'icon') {
    const icon = primary.icon;
    return (
      <Section title="图标">
        <FieldRow label="图标">
          <Select
            value={icon?.name ?? 'sparkle'}
            options={ICON_LIBRARY.map((iconInfo) => ({ value: iconInfo.name, label: iconInfo.label }))}
            ariaLabel="图标名称"
            onChange={(value) => applyNode({ icon: { name: value, color: icon?.color ?? '#E8ECF4' } })}
          />
        </FieldRow>
        <FieldRow label="颜色">
          <ColorInput
            value={icon?.color ?? '#E8ECF4'}
            ariaLabel="图标颜色"
            onChange={(value) => liveStyle({ color: value })}
          />
        </FieldRow>
      </Section>
    );
  }

  if (type === 'input' || type === 'textarea') {
    return (
      <Section title="输入框">
        <FieldRow label="占位提示">
          <TextInput
            value={primary.placeholder ?? ''}
            ariaLabel="占位提示"
            placeholder="请输入…"
            onCommit={(value) => applyNode({ placeholder: value })}
          />
        </FieldRow>
        <FieldRow label="当前值">
          <TextInput
            value={primary.value ?? ''}
            ariaLabel="当前值"
            placeholder="（空）"
            onCommit={(value) => applyNode({ value })}
          />
        </FieldRow>
      </Section>
    );
  }

  if (type === 'toggle') {
    const checked = pickNode(nodes, (node) => !!node.checked);
    return (
      <Section title="开关">
        <div className="up-inline-row">
          <Switch
            checked={checked.value}
            mixed={checked.mixed}
            ariaLabel="开关状态"
            onChange={(next) => applyNode({ checked: next })}
          />
          <span className="up-inline-label">默认开启</span>
        </div>
      </Section>
    );
  }

  if (type === 'slider' || type === 'progress') {
    const percent = pickNode(nodes, (node) => node.percent ?? 50);
    return (
      <Section title={type === 'slider' ? '滑杆' : '进度条'}>
        <SliderField
          value={percent.value}
          min={0}
          max={100}
          step={1}
          unit="%"
          ariaLabel="数值百分比"
          onCommit={(value) => applyNode({ percent: Math.round(value) })}
        />
        <FieldRow label="数值">
          <NumberInput
            value={percent.value}
            mixed={percent.mixed}
            min={0}
            max={100}
            suffix="%"
            ariaLabel="百分比数值"
            onCommit={(value) => applyNode({ percent: Math.round(value) })}
          />
        </FieldRow>
      </Section>
    );
  }

  if (type === 'tabs') {
    return (
      <Section title="选项卡">
        <FieldRow label="选项" hint="用逗号分隔多个选项">
          <TextInput
            value={(primary.items ?? []).join(', ')}
            ariaLabel="选项卡选项"
            placeholder="选项 1, 选项 2"
            onCommit={(value) => {
              const items = value
                .split(/[,，]/)
                .map((item) => item.trim())
                .filter(Boolean);
              applyNode({ items });
            }}
          />
        </FieldRow>
      </Section>
    );
  }

  if (type === 'badge' || type === 'list' || type === 'avatar') {
    return (
      <Section title="内容">
        <FieldRow label="标签">
          <TextInput
            value={primary.label ?? ''}
            ariaLabel="标签文本"
            placeholder="标签文本"
            onCommit={(value) => applyNode({ label: value })}
          />
        </FieldRow>
      </Section>
    );
  }

  if (type === 'frame') {
    const clip = pickStyle(nodes, (style) => style.clip);
    return (
      <Section title="容器">
        <div className="up-inline-row">
          <Switch
            checked={clip.value}
            mixed={clip.mixed}
            ariaLabel="裁剪内容"
            onChange={(next) => applyStyle({ clip: next })}
          />
          <span className="up-inline-label">裁剪超出内容</span>
        </div>
      </Section>
    );
  }

  return null;
}
