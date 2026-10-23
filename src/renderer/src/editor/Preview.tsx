import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { UIInteraction, UINode, UIProject } from '@shared/uieditor';
import { iconSvg } from '@shared/uieditor-render';
import { nodeCss, nodeTextCss } from '@shared/uieditor-render';
import { EditorIcon } from './icons';

interface Props {
  project: UIProject;
  initialScreenId: string;
  onClose: () => void;
}

interface PreviewState {
  screenId: string;
  history: string[];
  hoverId: string | null;
  pressedId: string | null;
  toggles: Record<string, boolean>;
}

export function PreviewOverlay({ project, initialScreenId, onClose }: Props) {
  const screen = project.screens.find((item) => item.id === initialScreenId) ?? project.screens[0];
  const [state, setState] = useState<PreviewState>({
    screenId: screen?.id ?? '',
    history: [],
    hoverId: null,
    pressedId: null,
    toggles: {},
  });
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(0.8);

  const current = project.screens.find((item) => item.id === state.screenId) ?? screen;

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !current) return;
    const update = () => {
      const rect = stage.getBoundingClientRect();
      const next = Math.min(1.25, Math.max(0.2, Math.min((rect.width - 120) / current.width, (rect.height - 120) / current.height)));
      setScale(Number(next.toFixed(3)));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [current]);

  const navigate = useCallback((screenId: string) => {
    setState((previous) => ({ ...previous, screenId, history: [...previous.history, previous.screenId] }));
  }, []);

  const runInteraction = useCallback(
    (interaction: UIInteraction | undefined) => {
      if (!interaction || interaction.action === 'none') return;
      switch (interaction.action) {
        case 'navigate':
          if (interaction.screenId) navigate(interaction.screenId);
          break;
        case 'url':
          if (interaction.url) window.open(interaction.url, '_blank');
          break;
        case 'back':
          setState((previous) => {
            const target = previous.history[previous.history.length - 1];
            if (!target) return previous;
            return { ...previous, screenId: target, history: previous.history.slice(0, -1) };
          });
          break;
        case 'toggle':
          if (interaction.target) {
            setState((previous) => ({
              ...previous,
              toggles: { ...previous.toggles, [interaction.target!]: !previous.toggles[interaction.target!] },
            }));
          }
          break;
        default:
          break;
      }
    },
    [navigate]
  );

  const close = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  if (!current) return null;

  return (
    <div className="ue-preview-overlay">
      <div className="ue-preview-toolbar">
        <div className="ue-preview-title">
          <EditorIcon name="play" size={14} />
          原型预览
          <span>{current.name}</span>
        </div>
        <div className="ue-preview-screens">
          {project.screens.map((item) => (
            <button
              key={item.id}
              className={`ue-preview-screen-btn${item.id === current.id ? ' active' : ''}`}
              onClick={() => setState((previous) => ({ ...previous, screenId: item.id, history: [] }))}
            >
              {item.name}
            </button>
          ))}
        </div>
        <div className="ue-preview-actions">
          <button className="ue-btn ghost" onClick={() => setState((previous) => ({ ...previous, history: [], hoverId: null, pressedId: null }))}>
            重置
          </button>
          <button className="ue-btn primary" onClick={close}>退出预览 (Esc)</button>
        </div>
      </div>
      <div className="ue-preview-stage" ref={stageRef} onClick={close}>
        <div
          className="ue-preview-frame"
          style={{ width: current.width * scale, height: current.height * scale }}
          onClick={(event) => event.stopPropagation()}
        >
          <div
            className="ue-preview-artboard"
            style={{
              width: current.width,
              height: current.height,
              background: current.background,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
            }}
          >
            {current.rootIds.map((id) => {
              const node = project.nodes[id];
              return node ? (
                <PreviewNode
                  key={id}
                  node={node}
                  project={project}
                  state={state}
                  parentLayout={null}
                  onHover={(nodeId) => setState((previous) => ({ ...previous, hoverId: nodeId }))}
                  onPress={(nodeId) => setState((previous) => ({ ...previous, pressedId: nodeId }))}
                  onRelease={() => setState((previous) => ({ ...previous, pressedId: null }))}
                  onRun={runInteraction}
                  isRoot
                />
              ) : null;
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

interface NodeProps {
  node: UINode;
  project: UIProject;
  state: PreviewState;
  parentLayout: 'free' | 'row' | 'column' | null;
  onHover: (id: string | null) => void;
  onPress: (id: string) => void;
  onRelease: () => void;
  onRun: (interaction: UIInteraction | undefined) => void;
  isRoot?: boolean;
}

function PreviewNode({ node, project, state, parentLayout, onHover, onPress, onRelease, onRun, isRoot }: NodeProps) {
  const effective = useMemo(() => {
    const merged = { ...node };
    const style = { ...node.style };
    if (node.states?.hover && state.hoverId === node.id) Object.assign(style, node.states.hover);
    if (node.states?.pressed && state.pressedId === node.id) Object.assign(style, node.states.pressed);
    if (node.states?.active) Object.assign(style, node.states.active);
    merged.style = style;
    return merged;
  }, [node, state.hoverId, state.pressedId]);

  const interactive = !!node.interaction && node.interaction.action !== 'none';
  const css = nodeCss(effective, { includePosition: !isRoot });
  const isAutoParent = parentLayout === 'row' || parentLayout === 'column';
  if (isRoot) {
    css.position = 'absolute';
    css.left = 0;
    css.top = 0;
  } else if (isAutoParent) {
    css.position = 'relative';
    delete css.left;
    delete css.top;
  }
  if (node.style.visible === false) return null;
  const textCss = nodeTextCss(effective);
  const label = node.text ?? node.placeholder ?? node.label ?? '';

  const onClick = (event: React.MouseEvent) => {
    event.stopPropagation();
    onRun(node.interaction);
  };

  const children = node.children.map((childId) => project.nodes[childId]).filter(Boolean);

  return (
    <div
      className={`ue-preview-node${interactive ? ' interactive' : ''}`}
      style={css as React.CSSProperties}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      onMouseDown={() => onPress(node.id)}
      onMouseUp={onRelease}
      onClick={onClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={(event) => {
        if (interactive && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault();
          onRun(node.interaction);
        }
      }}
    >
      {node.type === 'text' ? <span style={textCss as React.CSSProperties}>{node.text ?? ''}</span> : null}
      {node.type === 'button' ? (
        <span style={textCss as React.CSSProperties}>{node.text || 'Button'}</span>
      ) : null}
      {node.type === 'badge' ? <span style={textCss as React.CSSProperties}>{node.label || 'NEW'}</span> : null}
      {node.type === 'input' || node.type === 'textarea' ? (
        <span className="ue-preview-placeholder" style={{ color: node.style.color, opacity: 0.45 }}>
          {node.placeholder || node.value || '请输入…'}
        </span>
      ) : null}
      {node.type === 'image' && node.image?.src ? (
        <img
          src={node.image.src}
          alt={node.image.alt || node.name}
          style={{ width: '100%', height: '100%', objectFit: node.image.fit === 'fill' ? 'fill' : node.image.fit, borderRadius: 'inherit', display: 'block' }}
        />
      ) : null}
      {node.type === 'icon' ? (
        <span
          style={{ width: '100%', height: '100%', display: 'block', color: node.icon?.color || node.style.color }}
          dangerouslySetInnerHTML={{ __html: iconSvg(node.icon?.name ?? 'sparkle', node.icon?.color || node.style.color) }}
        />
      ) : null}
      {node.type === 'toggle' ? <TogglePreview checked={node.checked} accent={node.style.fill} /> : null}
      {node.type === 'slider' || node.type === 'progress' ? (
        <div className="ue-preview-bar" style={{ background: 'rgba(255,255,255,.12)' }}>
          <div style={{ width: `${node.percent ?? 50}%`, height: '100%', background: node.style.fill, borderRadius: 999 }} />
        </div>
      ) : null}
      {node.type === 'avatar' ? <div className="ue-preview-avatar" style={{ background: node.style.fill }}>{node.label?.[0] ?? 'A'}</div> : null}
      {node.type === 'tabs' ? (
        <div className="ue-preview-tabs">
          {(node.items ?? ['选项 1', '选项 2', '选项 3']).map((item, index) => (
            <span key={`${item}-${index}`} className={index === 0 ? 'active' : ''}>{item}</span>
          ))}
        </div>
      ) : null}
      {node.type === 'list' ? (
        <div className="ue-preview-list">
          {[1, 2, 3].map((row) => (
            <div key={row} className="ue-preview-list-row">
              <i />
              <span>列表项目 {row}</span>
              <em>{row % 2 === 0 ? '已完成' : '进行中'}</em>
            </div>
          ))}
        </div>
      ) : null}
      {node.type === 'divider' ? null : null}
      {children.map((child) => (
        <PreviewNode
          key={child.id}
          node={child}
          project={project}
          state={state}
          parentLayout={node.style.layout}
          onHover={onHover}
          onPress={onPress}
          onRelease={onRelease}
          onRun={onRun}
        />
      ))}
      {label && node.type !== 'text' && node.type !== 'button' && node.type !== 'badge' && node.type !== 'input' && node.type !== 'textarea' ? null : null}
    </div>
  );
}

function TogglePreview({ checked, accent }: { checked?: boolean; accent: string }) {
  return (
    <span className="ue-preview-toggle" style={{ background: checked ? accent : 'rgba(255,255,255,.16)' }}>
      <i style={{ transform: checked ? 'translateX(18px)' : 'translateX(2px)' }} />
    </span>
  );
}

