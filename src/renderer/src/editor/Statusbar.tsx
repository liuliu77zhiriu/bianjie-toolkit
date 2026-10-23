import { useEditor } from './store';
import { NODE_TYPE_LABELS } from '@shared/uieditor-kit';

export function Statusbar() {
  const screen = useEditor((s) => s.project.screens.find((item) => item.id === s.activeScreenId) ?? null);
  const selection = useEditor((s) => s.selection);
  const nodes = useEditor((s) => s.project.nodes);
  const zoom = useEditor((s) => s.zoom);
  const mode = useEditor((s) => s.mode);
  const selected = selection.map((id) => nodes[id]).filter(Boolean);
  const typeLabel = selected.length === 1 ? NODE_TYPE_LABELS[selected[0].type] ?? selected[0].type : null;

  return (
    <footer className="ue-statusbar">
      <div className="ue-status-left">
        <span className="ue-status-item">
          <i className="ue-status-dot" />
          {mode === 'design' ? '设计模式' : mode === 'prototype' ? '原型模式' : '预览模式'}
        </span>
        <span className="ue-status-sep" />
        <span className="ue-status-item">
          {screen ? `${screen.name} · ${screen.width}×${screen.height}` : '无页面'}
        </span>
        <span className="ue-status-sep" />
        <span className="ue-status-item">
          {selected.length === 0 ? '未选择' : selected.length === 1 ? `${typeLabel} · ${selected[0].name}` : `已选 ${selected.length} 个节点`}
        </span>
      </div>
      <div className="ue-status-right">
        <span className="ue-status-item">{Object.keys(nodes).length} 个节点</span>
        <span className="ue-status-sep" />
        <span className="ue-status-item">缩放 {Math.round(zoom * 100)}%</span>
        <span className="ue-status-sep" />
        <span className="ue-status-item muted">Ctrl+S 保存 · 双击文本编辑 · 右键更多操作</span>
      </div>
    </footer>
  );
}
