/**
 * 交互面板（右侧「交互」页）
 *
 * - 交互设置：事件（点击/悬停/加载）→ 动作（无/跳转/链接/返回/切换变量/复制/命令）+ 过渡动画；
 * - 状态样式：hover / pressed / active / disabled 四个状态，可覆盖不透明度、填充、描边、
 *   位移、模糊与阴影；未覆盖字段继承默认样式；
 * - 可把当前交互复制到其它选中节点（一次历史）。
 */
import { useState, type CSSProperties } from 'react';
import type {
  UIInteraction,
  UINode,
  UINodeStateKey,
  UINodeStyle,
  UIScreen,
} from '@shared/uieditor';
import { gradientCss, radiusCss, shadowCss } from '@shared/uieditor-kit';
import { editorStore, selectedNodes, type EditorSnapshot } from '../store';
import {
  CheckField,
  ColorInput,
  EmptyState,
  FieldRow,
  Glyph,
  NumberInput,
  Section,
  Segmented,
  Select,
  SliderField,
  TextInput,
  percentLabel,
} from './controls';

const EVENT_OPTIONS: Array<{ value: UIInteraction['event']; label: string; title: string }> = [
  { value: 'click', label: '点击', title: '点击时触发' },
  { value: 'hover', label: '悬停', title: '悬停时触发' },
  { value: 'load', label: '加载', title: '页面加载时触发' },
];

const ACTION_OPTIONS: Array<{ value: UIInteraction['action']; label: string }> = [
  { value: 'none', label: '无' },
  { value: 'navigate', label: '跳转页面' },
  { value: 'url', label: '打开链接' },
  { value: 'back', label: '返回上一页' },
  { value: 'toggle', label: '切换变量' },
  { value: 'copy', label: '复制文本' },
  { value: 'command', label: '执行命令' },
];

const TRANSITION_OPTIONS: Array<{ value: NonNullable<UIInteraction['transition']>; label: string }> = [
  { value: 'none', label: '无' },
  { value: 'fade', label: '淡入淡出' },
  { value: 'slide-left', label: '左滑' },
  { value: 'slide-up', label: '上滑' },
  { value: 'scale', label: '缩放' },
];

const ACTION_LABELS: Record<UIInteraction['action'], string> = {
  none: '无',
  navigate: '跳转页面',
  url: '打开链接',
  back: '返回上一页',
  toggle: '切换变量',
  copy: '复制文本',
  command: '执行命令',
};

function defaultInteraction(): UIInteraction {
  return { event: 'click', action: 'none', transition: 'none' };
}

function normalize(interaction: UIInteraction | null | undefined): string {
  if (!interaction) return 'none';
  return JSON.stringify({
    event: interaction.event,
    action: interaction.action,
    screenId: interaction.screenId ?? '',
    url: interaction.url ?? '',
    command: interaction.command ?? '',
    target: interaction.target ?? '',
    transition: interaction.transition ?? 'none',
  });
}

function describe(interaction: UIInteraction, screens: UIScreen[]): string {
  const tail = interaction.transition && interaction.transition !== 'none' ? ` · ${interaction.transition}` : '';
  if (interaction.action === 'navigate') {
    const screen = screens.find((item) => item.id === interaction.screenId);
    return `跳转至「${screen?.name ?? '未选择页面'}」${tail}`;
  }
  if (interaction.action === 'url') return `打开 ${interaction.url || '未填写链接'}${tail}`;
  if (interaction.action === 'command') return `命令 ${interaction.command || '未填写'}${tail}`;
  if (interaction.action === 'toggle') return `切换变量 ${interaction.target || '未填写'}${tail}`;
  if (interaction.action === 'copy') return `复制 ${interaction.target || '未填写'}${tail}`;
  if (interaction.action === 'back') return `返回上一页${tail}`;
  return '无交互';
}

export function Interactions({ snapshot }: { snapshot: EditorSnapshot }) {
  const nodes = selectedNodes(snapshot);
  if (!nodes.length) {
    return (
      <div className="up-scroll up-inspector">
        <EmptyState icon="bolt" title="未选中节点" hint="选中画布节点后，可配置点击 / 悬停交互与状态样式。" />
      </div>
    );
  }
  const primary = nodes[0];
  const screens = snapshot.project.screens;
  const selectionIds = nodes.map((node) => node.id);

  return (
    <div className="up-inspector up-scroll">
      <InteractionEditor key={primary.id} node={primary} screens={screens} selectionIds={selectionIds} />
      <StateStyleSection key={`${primary.id}:states`} node={primary} />
      {nodes.length > 1 ? (
        <div className="up-form-hint">
          <Glyph name="info" size={12} />
          <span>状态样式仅编辑第一个选中节点；可用「复制到其他节点」批量复用交互。</span>
        </div>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ 交互 */

function InteractionEditor({
  node,
  screens,
  selectionIds,
}: {
  node: UINode;
  screens: UIScreen[];
  selectionIds: string[];
}) {
  const saved = node.interaction ?? null;
  const [draft, setDraft] = useState<UIInteraction>(() => ({ ...defaultInteraction(), ...saved }));
  const [notice, setNotice] = useState<string | null>(null);
  const dirty = normalize(draft) !== normalize(saved);

  const build = (): UIInteraction => {
    const next: UIInteraction = { event: draft.event, action: draft.action, transition: draft.transition ?? 'none' };
    if (draft.action === 'navigate') next.screenId = draft.screenId ?? screens[0]?.id ?? '';
    if (draft.action === 'url') next.url = (draft.url ?? '').trim();
    if (draft.action === 'command') next.command = (draft.command ?? '').trim();
    if (draft.action === 'toggle' || draft.action === 'copy') next.target = (draft.target ?? '').trim();
    return next;
  };

  const validate = (interaction: UIInteraction): string | null => {
    if (interaction.action === 'navigate' && !interaction.screenId) return '请选择目标页面';
    if (interaction.action === 'url' && !interaction.url) return '请填写链接地址';
    if (interaction.action === 'command' && !interaction.command) return '请填写要执行的命令';
    if ((interaction.action === 'toggle' || interaction.action === 'copy') && !interaction.target) return '请填写变量键';
    return null;
  };

  const save = () => {
    const next = build();
    const problem = validate(next);
    if (problem) {
      setNotice(problem);
      return;
    }
    setNotice(null);
    editorStore.setInteraction(node.id, next.action === 'none' ? null : next);
  };

  const clear = () => {
    editorStore.setInteraction(node.id, null);
    setDraft(defaultInteraction());
    setNotice(null);
  };

  const copyToOthers = () => {
    const others = selectionIds.filter((id) => id !== node.id);
    if (!others.length) return;
    const next = build();
    const problem = validate(next);
    if (problem) {
      setNotice(problem);
      return;
    }
    editorStore.updateNodes(others, (target) => {
      if (next.action === 'none') delete target.interaction;
      else target.interaction = { ...next };
    });
    setNotice(`已复制到另外 ${others.length} 个节点`);
  };

  return (
    <Section title="交互">
      <FieldRow label="事件">
        <Segmented
          value={draft.event}
          options={EVENT_OPTIONS}
          ariaLabel="交互事件"
          onChange={(value) => setDraft({ ...draft, event: value })}
        />
      </FieldRow>
      <FieldRow label="动作">
        <Select
          value={draft.action}
          options={ACTION_OPTIONS}
          ariaLabel="交互动作"
          onChange={(value) => setDraft({ ...draft, action: value })}
        />
      </FieldRow>

      {draft.action === 'navigate' ? (
        <FieldRow label="目标页">
          <Select
            value={draft.screenId ?? screens[0]?.id ?? ''}
            options={screens.map((screen) => ({ value: screen.id, label: screen.name }))}
            ariaLabel="目标页面"
            onChange={(value) => setDraft({ ...draft, screenId: value })}
          />
        </FieldRow>
      ) : null}
      {draft.action === 'url' ? (
        <FieldRow label="链接">
          <TextInput
            value={draft.url ?? ''}
            placeholder="https://…"
            mono
            ariaLabel="链接地址"
            onCommit={(value) => setDraft({ ...draft, url: value })}
          />
        </FieldRow>
      ) : null}
      {draft.action === 'command' ? (
        <FieldRow label="命令">
          <TextInput
            value={draft.command ?? ''}
            placeholder="工具/命令（如 settings.open）"
            mono
            ariaLabel="执行命令"
            onCommit={(value) => setDraft({ ...draft, command: value })}
          />
        </FieldRow>
      ) : null}
      {draft.action === 'toggle' || draft.action === 'copy' ? (
        <FieldRow label="变量键">
          <TextInput
            value={draft.target ?? ''}
            placeholder="如 sidebarOpen"
            mono
            ariaLabel="变量键"
            onCommit={(value) => setDraft({ ...draft, target: value })}
          />
        </FieldRow>
      ) : null}

      <FieldRow label="过渡">
        <Select
          value={draft.transition ?? 'none'}
          options={TRANSITION_OPTIONS}
          ariaLabel="过渡动画"
          onChange={(value) => setDraft({ ...draft, transition: value })}
        />
      </FieldRow>

      <div className="up-actions-row">
        <button type="button" className="up-btn sm primary" disabled={!dirty} title="保存交互设置" onClick={save}>
          <Glyph name="check" size={12} />
          <span>保存交互</span>
        </button>
        <button
          type="button"
          className="up-btn sm"
          disabled={!saved}
          title="清除交互"
          onClick={clear}
        >
          <Glyph name="close" size={12} />
          <span>清除</span>
        </button>
        {selectionIds.length > 1 ? (
          <button type="button" className="up-btn sm" title="把当前草稿交互应用到其它选中节点" onClick={copyToOthers}>
            <Glyph name="copy" size={12} />
            <span>复制到其他</span>
          </button>
        ) : null}
      </div>

      {notice ? <div className="up-form-hint warn">{notice}</div> : null}
      {saved ? (
        <div className="up-form-hint">
          <Glyph name="bolt" size={12} />
          <span>当前：{describe(saved, screens)}</span>
        </div>
      ) : (
        <div className="up-form-hint muted">
          <Glyph name="info" size={12} />
          <span>尚未设置交互。</span>
        </div>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ 状态样式 */

const STATE_TABS: Array<{ key: UINodeStateKey; label: string }> = [
  { key: 'hover', label: 'Hover' },
  { key: 'pressed', label: 'Pressed' },
  { key: 'active', label: 'Active' },
  { key: 'disabled', label: 'Disabled' },
];

const STATE_DEFAULT_SHADOW: UINodeStyle['shadow'] = { x: 0, y: 8, blur: 24, spread: -4, color: 'rgba(0,0,0,0.45)' };

function summarizeOverride(override: Partial<UINodeStyle>): string[] {
  const parts: string[] = [];
  if (override.opacity !== undefined) parts.push(`透明度 ${percentLabel(override.opacity)}`);
  if (override.fill !== undefined) parts.push(`填充 ${override.fill}`);
  if (override.stroke !== undefined) parts.push(`描边 ${override.stroke}`);
  if (override.x !== undefined || override.y !== undefined) parts.push(`位移 ${override.x ?? 0},${override.y ?? 0}`);
  if (override.blur !== undefined) parts.push(`模糊 ${override.blur}px`);
  if (override.shadow) parts.push('阴影');
  return parts;
}

function StateStyleSection({ node }: { node: UINode }) {
  const [active, setActive] = useState<UINodeStateKey>('hover');

  return (
    <Section title="状态样式">
      <div className="up-state-tabs" role="tablist" aria-label="状态样式">
        {STATE_TABS.map((tab) => {
          const hasOverride = !!node.states?.[tab.key] && Object.keys(node.states[tab.key] ?? {}).length > 0;
          return (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={active === tab.key}
              className={`up-state-tab${active === tab.key ? ' active' : ''}`}
              title={hasOverride ? `${tab.label}（已覆盖）` : `${tab.label}（继承默认）`}
              onClick={() => setActive(tab.key)}
            >
              <span>{tab.label}</span>
              {hasOverride ? <span className="up-state-dot" aria-label="已覆盖" /> : null}
            </button>
          );
        })}
      </div>
      <StateEditor key={`${node.id}:${active}`} node={node} stateKey={active} />
    </Section>
  );
}

function StateEditor({ node, stateKey }: { node: UINode; stateKey: UINodeStateKey }) {
  const base = node.style;
  const override: Partial<UINodeStyle> = node.states?.[stateKey] ?? {};
  const hasOverride = Object.keys(override).length > 0;

  const [opacityOn, setOpacityOn] = useState(override.opacity !== undefined);
  const [opacity, setOpacity] = useState(override.opacity ?? base.opacity);
  const [fillOn, setFillOn] = useState(override.fill !== undefined);
  const [fill, setFill] = useState(override.fill ?? base.fill);
  const [strokeOn, setStrokeOn] = useState(override.stroke !== undefined);
  const [stroke, setStroke] = useState(override.stroke ?? base.stroke);
  const [offsetX, setOffsetX] = useState(override.x ?? 0);
  const [offsetY, setOffsetY] = useState(override.y ?? 0);
  const [blur, setBlur] = useState(override.blur ?? 0);
  const [shadowOn, setShadowOn] = useState(override.shadow !== undefined);

  const buildPatch = (): Partial<UINodeStyle> => {
    const patch: Partial<UINodeStyle> = {};
    if (opacityOn) patch.opacity = Math.min(1, Math.max(0, opacity));
    if (fillOn) patch.fill = fill;
    if (strokeOn) patch.stroke = stroke;
    if (offsetX) patch.x = offsetX;
    if (offsetY) patch.y = offsetY;
    if (blur > 0) patch.blur = blur;
    if (shadowOn) patch.shadow = override.shadow ?? STATE_DEFAULT_SHADOW;
    return patch;
  };

  const save = () => {
    const patch = buildPatch();
    if (!Object.keys(patch).length) {
      editorStore.setNodeState(node.id, stateKey, null);
      return;
    }
    editorStore.setNodeState(node.id, stateKey, patch);
  };

  const clear = () => {
    editorStore.setNodeState(node.id, stateKey, null);
    setOpacityOn(false);
    setFillOn(false);
    setStrokeOn(false);
    setOffsetX(0);
    setOffsetY(0);
    setBlur(0);
    setShadowOn(false);
  };

  const previewBackground = (override.gradient ? gradientCss(override.gradient) : override.fill ?? base.fill) ?? 'transparent';
  const previewStyle: CSSProperties = {
    width: 66,
    height: 40,
    borderRadius: radiusCss(override.radius ?? base.radius),
    background: previewBackground,
    border: `${override.strokeWidth ?? base.strokeWidth}px solid ${override.stroke ?? base.stroke}`,
    opacity: override.opacity ?? base.opacity,
    boxShadow: shadowCss(override.shadow ?? base.shadow) ?? undefined,
    filter: (override.blur ?? base.blur) > 0 ? `blur(${Math.min(4, override.blur ?? base.blur)}px)` : undefined,
    transform: `translate(${Math.min(6, override.x ?? 0)}px, ${Math.min(6, override.y ?? 0)}px)`,
  };

  return (
    <div className="up-state-editor">
      <div className="up-state-head">
        <span className="up-state-preview" style={previewStyle} aria-hidden="true" />
        <div className="up-state-head-main">
          <span className={`up-state-badge${hasOverride ? '' : ' inherit'}`}>
            {hasOverride ? '已覆盖' : '继承默认'}
          </span>
          <span className="up-state-summary">{hasOverride ? summarizeOverride(override).join(' · ') : '未设置覆盖样式'}</span>
        </div>
      </div>

      <div className="up-state-fields">
        <div className="up-state-row">
          <CheckField label="不透明度" checked={opacityOn} onChange={setOpacityOn} />
          <div className="up-state-control">
            <SliderField
              value={opacity}
              min={0}
              max={1}
              step={0.01}
              disabled={!opacityOn}
              format={percentLabel}
              ariaLabel="状态不透明度"
              onCommit={(value) => setOpacity(Math.round(value * 100) / 100)}
            />
          </div>
        </div>

        <div className="up-state-row">
          <CheckField label="覆盖填充" checked={fillOn} onChange={setFillOn} />
          <div className="up-state-control">
            <ColorInput value={fill} ariaLabel="状态填充色" disabled={!fillOn} onChange={setFill} />
          </div>
        </div>

        <div className="up-state-row">
          <CheckField label="覆盖描边" checked={strokeOn} onChange={setStrokeOn} />
          <div className="up-state-control">
            <ColorInput value={stroke} ariaLabel="状态描边色" disabled={!strokeOn} onChange={setStroke} />
          </div>
        </div>

        <div className="up-state-row">
          <span className="up-check-label">位移</span>
          <div className="up-state-control up-state-offsets">
            <NumberInput value={offsetX} min={-200} max={200} suffix="x" ariaLabel="状态水平位移" onCommit={setOffsetX} />
            <NumberInput value={offsetY} min={-200} max={200} suffix="y" ariaLabel="状态垂直位移" onCommit={setOffsetY} />
          </div>
        </div>

        <div className="up-state-row">
          <span className="up-check-label">模糊</span>
          <div className="up-state-control">
            <NumberInput value={blur} min={0} max={40} suffix="px" ariaLabel="状态模糊" onCommit={setBlur} />
          </div>
        </div>

        <div className="up-state-row">
          <CheckField label="阴影" checked={shadowOn} onChange={setShadowOn} />
          <div className="up-state-control up-state-hint">使用默认投影效果</div>
        </div>
      </div>

      <div className="up-actions-row">
        <button type="button" className="up-btn sm primary" title="保存状态样式" onClick={save}>
          <Glyph name="check" size={12} />
          <span>保存状态</span>
        </button>
        <button type="button" className="up-btn sm" disabled={!hasOverride} title="清除状态样式（恢复继承默认）" onClick={clear}>
          <Glyph name="trash" size={12} />
          <span>清除</span>
        </button>
      </div>

      <div className="up-form-hint muted">
        <Glyph name="info" size={12} />
        <span>状态样式在原型预览 / 导出的运行时生效；画布编辑态保持默认样式。</span>
      </div>
    </div>
  );
}
