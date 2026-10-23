/**
 * UI 编辑器 · 节点渲染器
 *
 * 画布与预览共用：
 * - 视觉全部来自 @shared/uieditor-render 的 nodeCss / nodeTextCss / iconSvg，导出与设计态保持一致；
 * - React.memo + 订阅 project.updatedAt：只有数据变化才重绘，选择/悬停/缩放等视图态不触发节点树重绘；
 * - 递归渲染子节点，children 顺序即层级（后绘制在上）；
 * - preview/interactive 模式下支持 node.states（hover/pressed）状态样式。
 */
import { memo, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { UILayoutMode, UINode, UINodeStateKey } from '@shared/uieditor';
import { iconSvg, nodeCss, nodeTextCss } from '@shared/uieditor-render';
import { editorStore, useEditor } from '../store';
import './canvas.css';

export interface NodeViewProps {
  node: UINode;
  /** 预览态：不显示空文本提示等设计态辅助信息 */
  preview?: boolean;
  /** 交互态：启用 hover/pressed 状态样式与指针手型 */
  interactive?: boolean;
  /** 自定义节点表（独立预览/导出复用）；缺省读取编辑器 store */
  nodes?: Record<string, UINode>;
  /** 父节点布局模式：free 绝对定位，row/column 流式布局 */
  parentLayout?: UILayoutMode;
  /** 递归深度保护 */
  depth?: number;
}

const MAX_DEPTH = 32;

const DEFAULT_TABS = ['选项一', '选项二', '选项三'];

function clampPercent(value: number | undefined, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(100, Math.max(0, n));
}

function asStyle(css: Record<string, string | number>): CSSProperties {
  return css as CSSProperties;
}

/** 当前状态样式（hover/pressed）与基础样式的合并结果 */
function mergeStateStyle(node: UINode, state: UINodeStateKey | null): UINode {
  if (!state || !node.states) return node;
  const patch = node.states[state];
  if (!patch) return node;
  const style = { ...node.style, ...patch };
  if (!patch.radius) style.radius = node.style.radius;
  return { ...node, style };
}

export const NodeView = memo(function NodeView({
  node: incoming,
  preview = false,
  interactive = false,
  nodes: nodesProp,
  parentLayout = 'free',
  depth = 0,
}: NodeViewProps) {
  // 数据版本：任何写入都会 touchProject，从而触发重绘；视图态（选择/缩放/平移）不会。
  useEditor((snapshot) => snapshot.project.updatedAt);
  const [stateKey, setStateKey] = useState<UINodeStateKey | null>(null);

  if (depth > MAX_DEPTH) return null;
  if (!incoming || !incoming.style || incoming.style.visible === false) return null;

  const nodes = nodesProp ?? editorStore.getProject().nodes;
  const node = mergeStateStyle(incoming, interactive ? stateKey : null);
  const style = node.style;
  const isFreeChild = parentLayout === 'free';

  // 关键：free 布局必须 position:absolute + left/top（nodeCss 默认行为）；
  // row/column 父节点的子节点才走流式布局（去掉 left/top，position:relative）。
  // 注意不能给 free 子节点传 absolute:false —— nodeCss 会把 position 改成 relative，
  // 导致元素进入父容器普通流并被 left/top 二次偏移（嵌套节点错位/被裁剪）。
  const css = isFreeChild ? nodeCss(node) : nodeCss(node, { includePosition: false, absolute: false });

  const interactiveProps = interactive
    ? {
        onPointerEnter: () => {
          setStateKey((current) => (current === 'pressed' ? current : node.states?.hover ? 'hover' : current));
        },
        onPointerLeave: () => setStateKey(null),
        onPointerDown: (event: ReactPointerEvent) => {
          if (!node.states?.pressed) return;
          if (event.button !== 0) return;
          setStateKey('pressed');
        },
        onPointerUp: () => setStateKey(node.states?.hover ? 'hover' : null),
      }
    : undefined;

  const childIds = node.children;
  const children =
    childIds.length > 0
      ? childIds.map((childId) => {
          const child = nodes[childId];
          if (!child) return null;
          return (
            <NodeView
              key={childId}
              node={child}
              preview={preview}
              interactive={interactive}
              nodes={nodesProp}
              parentLayout={style.layout}
              depth={depth + 1}
            />
          );
        })
      : null;

  return (
    <div
      className={`uc-node uc-node--${node.type}`}
      data-node-id={node.id}
      data-node-type={node.type}
      style={{ ...asStyle(css), cursor: interactive && isInteractiveType(node.type) ? 'pointer' : undefined }}
      {...interactiveProps}
    >
      {renderContent(node, preview, interactive)}
      {children}
    </div>
  );
});

function isInteractiveType(type: UINode['type']): boolean {
  return type === 'button' || type === 'toggle' || type === 'slider' || type === 'input' || type === 'tabs';
}

function renderContent(node: UINode, preview: boolean, interactive: boolean) {
  const style = node.style;
  const textStyle = asStyle(nodeTextCss(node));

  switch (node.type) {
    case 'text': {
      const text = node.text ?? '';
      if (!text && !preview && !interactive) {
        return (
          <span className="uc-text uc-text--empty" style={textStyle}>
            双击输入文字
          </span>
        );
      }
      return (
        <span className="uc-text" style={textStyle}>
          {text}
        </span>
      );
    }
    case 'button':
      return (
        <span className="uc-text" style={textStyle}>
          {node.text || '按钮'}
        </span>
      );
    case 'badge':
      return (
        <span className="uc-text" style={textStyle}>
          {node.label || node.text || 'NEW'}
        </span>
      );
    case 'input':
    case 'textarea': {
      const value = node.value ?? '';
      const placeholder = node.placeholder || '请输入内容';
      return (
        <span
          className={`uc-field-text${node.type === 'textarea' ? ' uc-field-text--area' : ''}${value ? '' : ' uc-field-text--placeholder'}`}
          style={textStyle}
        >
          {value || placeholder}
        </span>
      );
    }
    case 'icon': {
      const name = node.icon?.name || 'sparkle';
      const color = node.icon?.color || style.color || '#E8ECF4';
      return <span className="uc-icon" dangerouslySetInnerHTML={{ __html: iconSvg(name, color) }} />;
    }
    case 'image': {
      const image = node.image;
      if (image?.src) {
        const size = image.fit === 'contain' ? 'contain' : image.fit === 'fill' ? '100% 100%' : 'cover';
        return (
          <span
            className="uc-image"
            style={{ backgroundImage: `url("${image.src}")`, backgroundSize: size, backgroundPosition: 'center', backgroundRepeat: 'no-repeat' }}
          />
        );
      }
      return (
        <span className="uc-image uc-image--empty">
          <span className="uc-image-empty-icon" dangerouslySetInnerHTML={{ __html: iconSvg('image', 'rgba(255,255,255,0.4)') }} />
          {!preview && !interactive ? <span className="uc-image-empty-hint">双击选择图片</span> : null}
        </span>
      );
    }
    case 'toggle': {
      const height = Math.max(8, style.height);
      const knob = Math.max(6, Math.round(height * 0.72));
      const pad = Math.max(2, Math.round((height - knob) / 2));
      const checked = node.checked !== false;
      return (
        <span className="uc-toggle">
          <span
            className={`uc-toggle-fill${checked ? ' is-on' : ''}`}
            style={{ backgroundColor: checked ? 'rgba(76,141,255,0.95)' : 'transparent' }}
          />
          <span
            className="uc-toggle-knob"
            style={{
              width: knob,
              height: knob,
              top: pad,
              left: checked ? `calc(100% - ${knob + pad}px)` : pad,
            }}
          />
        </span>
      );
    }
    case 'slider': {
      const percent = clampPercent(node.percent, 40);
      return (
        <span className="uc-slider">
          <span className="uc-slider-track" />
          <span className="uc-slider-fill" style={{ width: `${percent}%` }} />
          <span className="uc-slider-knob" style={{ left: `${percent}%` }} />
        </span>
      );
    }
    case 'progress': {
      const percent = clampPercent(node.percent, 60);
      return (
        <span className="uc-progress">
          <span className="uc-progress-fill" style={{ width: `${percent}%` }} />
        </span>
      );
    }
    case 'avatar':
      return (
        <span className="uc-avatar">
          {node.label ? (
            <span className="uc-avatar-label" style={textStyle}>
              {node.label}
            </span>
          ) : (
            <span className="uc-avatar-icon" dangerouslySetInnerHTML={{ __html: iconSvg('user', 'rgba(255,255,255,0.8)') }} />
          )}
        </span>
      );
    case 'tabs': {
      const items = node.items?.length ? node.items : DEFAULT_TABS;
      const active = 0;
      return (
        <span className="uc-tabs">
          {items.map((item, index) => (
            <span key={`${item}-${index}`} className={`uc-tab${index === active ? ' is-active' : ''}`} style={textStyle}>
              {item}
            </span>
          ))}
        </span>
      );
    }
    case 'list': {
      const items = node.items?.length ? node.items : null;
      const rows = items ? items.slice(0, 8) : [0, 1, 2, 3];
      return (
        <span className="uc-list">
          {rows.map((row, index) => (
            <span key={index} className="uc-list-row">
              <span className="uc-list-dot" />
              {items ? (
                <span className="uc-list-label" style={textStyle}>
                  {items[index]}
                </span>
              ) : (
                <span className="uc-list-lines">
                  <span className="uc-list-line" />
                  <span className="uc-list-line uc-list-line--short" />
                </span>
              )}
            </span>
          ))}
        </span>
      );
    }
    case 'divider':
    case 'line':
    case 'frame':
    case 'rect':
    case 'ellipse':
    case 'spacer':
    default:
      return null;
  }
}
