/**
 * 图层树（左侧「图层」页）
 *
 * - 从当前屏幕 rootIds 递归渲染；画板根节点不可重命名 / 隐藏 / 锁定 / 拖拽；
 * - 点击选中（Shift / Ctrl / Cmd 多选）、双击重命名、眼睛 / 锁图标、展开收起、拖拽换层级；
 * - 拖拽仅通过 store 的 beginGesture / getProject / endGesture 公共 API 修改结构，
 *   自动换算父节点坐标，并阻止把节点拖进自己的子树。
 */
import { useMemo, useState, type CSSProperties, type DragEvent, type ReactNode } from 'react';
import type { UINode, UIProject } from '@shared/uieditor';
import { screenNodeIds } from '@shared/uieditor-kit';
import { editorStore, type EditorSnapshot } from '../store';
import { EmptyState, Glyph, NodeGlyph } from './controls';

type DropPosition = 'before' | 'after' | 'inside';

interface DropTarget {
  id: string;
  position: DropPosition;
}

export function isArtboardNode(node: UINode | null | undefined): boolean {
  return !!node && node.parentId === null && node.type === 'frame' && node.name === '画板';
}

function isContainer(node: UINode): boolean {
  return node.type === 'frame' || node.type === 'list' || node.type === 'tabs';
}

function absolutePosition(project: UIProject, nodeId: string): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let current: UINode | undefined = project.nodes[nodeId];
  while (current) {
    x += current.style.x;
    y += current.style.y;
    if (!current.parentId) break;
    current = project.nodes[current.parentId];
  }
  return { x, y };
}

/** 通过 store 的 gesture API 完成一次结构移动（一次历史）。 */
export function moveNodeInProject(nodeId: string, targetId: string, position: DropPosition): boolean {
  const project = editorStore.getProject();
  const screen = editorStore.getActiveScreen();
  const node = project.nodes[nodeId];
  const target = project.nodes[targetId];
  if (!screen || !node || !target || nodeId === targetId) return false;
  if (isArtboardNode(node)) return false;

  // 不能移动进自己的子树
  let cursor: UINode | undefined = target;
  while (cursor) {
    if (cursor.id === nodeId) return false;
    cursor = cursor.parentId ? project.nodes[cursor.parentId] : undefined;
  }

  const origin = absolutePosition(project, nodeId);

  editorStore.beginGesture();
  try {
    // 从原父级移除
    if (node.parentId) {
      const parent = project.nodes[node.parentId];
      if (parent) parent.children = parent.children.filter((child) => child !== nodeId);
    } else {
      screen.rootIds = screen.rootIds.filter((rootId) => rootId !== nodeId);
    }

    let nextParentId: string | null;
    if (position === 'inside') {
      nextParentId = target.id;
      target.children.push(nodeId);
    } else {
      nextParentId = target.parentId;
      if (nextParentId) {
        const parent = project.nodes[nextParentId];
        if (!parent) return false;
        const index = parent.children.indexOf(targetId);
        parent.children.splice(index < 0 ? parent.children.length : index + (position === 'after' ? 1 : 0), 0, nodeId);
      } else {
        const index = screen.rootIds.indexOf(targetId);
        screen.rootIds.splice(index < 0 ? screen.rootIds.length : index + (position === 'after' ? 1 : 0), 0, nodeId);
      }
    }

    node.parentId = nextParentId;
    const parentOrigin = nextParentId ? absolutePosition(project, nextParentId) : { x: 0, y: 0 };
    node.style.x = Math.round(origin.x - parentOrigin.x);
    node.style.y = Math.round(origin.y - parentOrigin.y);
  } finally {
    editorStore.endGesture('调整层级');
  }
  editorStore.select([nodeId]);
  return true;
}

export function LayerTree({ snapshot }: { snapshot: EditorSnapshot }) {
  const screen = snapshot.project.screens.find((item) => item.id === snapshot.activeScreenId) ?? null;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<DropTarget | null>(null);

  const nodes = snapshot.project.nodes;
  const selected = useMemo(() => new Set(snapshot.selection), [snapshot.selection]);
  const totalCount = useMemo(
    () => (screen ? screenNodeIds(snapshot.project, screen.id).length : 0),
    [snapshot.project, screen]
  );

  if (!screen) {
    return <EmptyState icon="screen" title="还没有页面" hint="在「页面」标签中新建一个页面后开始设计。" />;
  }

  const toggleCollapse = (id: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearDrag = () => {
    setDragId(null);
    setDrop(null);
  };

  const beginRename = (node: UINode) => {
    if (isArtboardNode(node)) return;
    setRenamingId(node.id);
    setDraft(node.name);
  };

  const commitRename = (node: UINode) => {
    const trimmed = draft.trim();
    setRenamingId(null);
    if (trimmed && trimmed !== node.name) editorStore.renameNode(node.id, trimmed);
  };

  const onDragStart = (event: DragEvent<HTMLDivElement>, node: UINode) => {
    if (isArtboardNode(node)) {
      event.preventDefault();
      return;
    }
    event.stopPropagation();
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-uieditor-node', node.id);
    event.dataTransfer.setData('text/plain', node.id);
    setDragId(node.id);
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>, node: UINode) => {
    if (!dragId || dragId === node.id) return;
    // 不允许悬停在自己的祖先上（由 commit 再兜底一次）
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5;
    let position: DropPosition;
    if (isArtboardNode(node)) position = 'inside';
    else if (ratio < 0.3) position = 'before';
    else if (ratio > 0.7) position = 'after';
    else position = isContainer(node) ? 'inside' : 'after';
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    setDrop({ id: node.id, position });
  };

  const onDrop = (event: DragEvent<HTMLDivElement>, node: UINode) => {
    event.preventDefault();
    event.stopPropagation();
    const sourceId =
      dragId ||
      event.dataTransfer.getData('application/x-uieditor-node') ||
      event.dataTransfer.getData('text/plain');
    const position = drop?.id === node.id ? drop.position : 'after';
    clearDrag();
    if (!sourceId || sourceId === node.id) return;
    moveNodeInProject(sourceId, node.id, position);
  };

  const renderRows = (ids: string[], depth: number): ReactNode[] =>
    ids.flatMap((id) => {
      const node = nodes[id];
      if (!node) return [];
      const hasChildren = node.children.length > 0;
      const isCollapsed = collapsed.has(id);
      const isSelected = selected.has(id);
      const isHovered = snapshot.hoverId === id;
      const artboard = isArtboardNode(node);
      const dropClass =
        drop?.id === id ? ` drop-${drop.position}` : '';
      const rowStyle = {
        '--up-depth': depth,
        paddingLeft: 6 + depth * 13,
      } as CSSProperties;

      const row = (
        <div
          key={id}
          className={`up-layer-row${isSelected ? ' selected' : ''}${isHovered ? ' hover' : ''}${
            node.style.visible ? '' : ' hidden'
          }${node.style.locked ? ' locked' : ''}${artboard ? ' artboard' : ''}${dropClass}`}
          style={rowStyle}
          role="treeitem"
          aria-selected={isSelected}
          aria-expanded={hasChildren ? !isCollapsed : undefined}
          aria-level={depth + 1}
          draggable={!artboard}
          onDragStart={(event) => onDragStart(event, node)}
          onDragOver={(event) => onDragOver(event, node)}
          onDrop={(event) => onDrop(event, node)}
          onDragEnd={clearDrag}
          onClick={(event) => {
            event.stopPropagation();
            editorStore.toggleSelect(id, event.shiftKey || event.ctrlKey || event.metaKey);
          }}
          onDoubleClick={(event) => {
            event.stopPropagation();
            beginRename(node);
          }}
          onMouseEnter={() => editorStore.hover(id)}
          onMouseLeave={() => editorStore.hover(null)}
        >
          {depth > 0 ? (
            <span
              className="up-layer-guide"
              style={{ left: 12 + (depth - 1) * 13 }}
              aria-hidden="true"
            />
          ) : null}
          <button
            type="button"
            className={`up-layer-arrow${hasChildren ? '' : ' empty'}`}
            aria-label={hasChildren ? (isCollapsed ? '展开' : '收起') : undefined}
            tabIndex={hasChildren ? 0 : -1}
            onClick={(event) => {
              event.stopPropagation();
              if (hasChildren) toggleCollapse(id);
            }}
          >
            {hasChildren ? <Glyph name={isCollapsed ? 'chevron' : 'chevron-down'} size={11} /> : <span className="up-layer-dot" />}
          </button>
          <span className="up-layer-icon">
            <NodeGlyph type={node.type} size={13} />
          </span>
          {renamingId === id ? (
            <input
              className="up-layer-rename"
              autoFocus
              value={draft}
              aria-label="节点名称"
              onChange={(event) => setDraft(event.target.value)}
              onClick={(event) => event.stopPropagation()}
              onBlur={() => commitRename(node)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitRename(node);
                } else if (event.key === 'Escape') {
                  setRenamingId(null);
                }
              }}
            />
          ) : (
            <span className="up-layer-name" title={artboard ? `${node.name}（画板）` : node.name}>
              {node.name}
            </span>
          )}
          {artboard ? <span className="up-layer-badge">画板</span> : null}
          {!artboard && node.component ? <span className="up-layer-badge">组件</span> : null}
          {isArtboardNode(node) ? null : (
            <span className="up-layer-actions">
              <button
                type="button"
                className={`up-layer-btn${node.style.visible ? '' : ' active'}`}
                title={node.style.visible ? '隐藏节点' : '显示节点'}
                aria-label={node.style.visible ? `隐藏 ${node.name}` : `显示 ${node.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  editorStore.updateStyle(id, { visible: !node.style.visible });
                }}
              >
                <Glyph name={node.style.visible ? 'eye' : 'eye-off'} size={12} />
              </button>
              <button
                type="button"
                className={`up-layer-btn${node.style.locked ? ' active' : ''}`}
                title={node.style.locked ? '解锁节点' : '锁定节点'}
                aria-label={node.style.locked ? `解锁 ${node.name}` : `锁定 ${node.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  editorStore.updateStyle(id, { locked: !node.style.locked });
                }}
              >
                <Glyph name={node.style.locked ? 'lock' : 'unlock'} size={12} />
              </button>
            </span>
          )}
        </div>
      );

      if (!hasChildren || isCollapsed) return [row];
      return [row, ...renderRows(node.children, depth + 1)];
    });

  const selectionCount = snapshot.selection.length;
  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () => setCollapsed(new Set(screenNodeIds(snapshot.project, screen.id)));

  return (
    <div className="up-layers">
      <div className="up-layers-toolbar">
        <div className="up-layers-title">
          <span>{screen.name}</span>
          <span className="up-layers-count">{totalCount}</span>
        </div>
        <div className="up-layers-actions">
          <button type="button" className="up-icon-btn" title="全部展开" aria-label="全部展开" onClick={expandAll}>
            <Glyph name="chevron-down" size={13} />
          </button>
          <button type="button" className="up-icon-btn" title="全部收起" aria-label="全部收起" onClick={collapseAll}>
            <Glyph name="chevron-up" size={13} />
          </button>
        </div>
      </div>
      {selectionCount > 0 ? (
        <div className="up-layers-toolbar selection">
          <span className="up-layers-selected">已选 {selectionCount}</span>
          <div className="up-layers-actions">
            <button
              type="button"
              className="up-icon-btn"
              title="编组（选中 2 个以上同父节点）"
              aria-label="编组"
              onClick={() => editorStore.groupSelection()}
            >
              <Glyph name="component" size={13} />
            </button>
            <button
              type="button"
              className="up-icon-btn"
              title="取消编组"
              aria-label="取消编组"
              onClick={() => editorStore.ungroupSelection()}
            >
              <Glyph name="layers" size={13} />
            </button>
            <button
              type="button"
              className="up-icon-btn"
              title="复制选中节点"
              aria-label="复制选中节点"
              onClick={() => editorStore.duplicateSelection()}
            >
              <Glyph name="copy" size={13} />
            </button>
            <button
              type="button"
              className="up-icon-btn danger"
              title="删除选中节点"
              aria-label="删除选中节点"
              onClick={() => editorStore.deleteSelection()}
            >
              <Glyph name="trash" size={13} />
            </button>
          </div>
        </div>
      ) : null}
      <div
        className="up-layer-list up-scroll"
        role="tree"
        aria-label={`${screen.name} 图层`}
        onDragLeave={(event) => {
          if (event.currentTarget === event.target) setDrop(null);
        }}
      >
        {renderRows(screen.rootIds, 0)}
      </div>
    </div>
  );
}
