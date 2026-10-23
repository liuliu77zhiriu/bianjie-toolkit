import type { UIEditorTool } from '@shared/uieditor';
import { editorStore, useEditor } from './store';
import { EditorIcon } from './icons';

interface ToolDef {
  id: UIEditorTool;
  label: string;
  icon: string;
  hint: string;
}

const DRAW_TOOLS: ToolDef[] = [
  { id: 'select', label: '选择', icon: 'select', hint: 'V' },
  { id: 'hand', label: '平移', icon: 'hand', hint: 'H / 空格' },
  { id: 'frame', label: '容器', icon: 'frame', hint: 'F' },
  { id: 'rect', label: '矩形', icon: 'rect', hint: 'R' },
  { id: 'ellipse', label: '圆形', icon: 'ellipse', hint: 'O' },
  { id: 'line', label: '线段', icon: 'line', hint: 'L' },
  { id: 'text', label: '文本', icon: 'text', hint: 'T' },
  { id: 'image', label: '图片', icon: 'image', hint: 'I' },
];

const INSERT_TOOLS: ToolDef[] = [
  { id: 'button', label: '按钮', icon: 'button', hint: '' },
  { id: 'input', label: '输入框', icon: 'input', hint: '' },
  { id: 'icon', label: '图标', icon: 'icon', hint: '' },
  { id: 'toggle', label: '开关', icon: 'toggle', hint: '' },
  { id: 'slider', label: '滑杆', icon: 'slider', hint: '' },
  { id: 'progress', label: '进度', icon: 'progress', hint: '' },
  { id: 'badge', label: '徽标', icon: 'badge', hint: '' },
  { id: 'divider', label: '分割线', icon: 'divider', hint: '' },
  { id: 'tabs', label: '选项卡', icon: 'tabs', hint: '' },
  { id: 'list', label: '列表', icon: 'list', hint: '' },
];

const ALIGN_ACTIONS: Array<{ kind: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'; icon: string; label: string }> = [
  { kind: 'left', icon: 'alignLeft', label: '左对齐' },
  { kind: 'hcenter', icon: 'alignCenterH', label: '水平居中' },
  { kind: 'right', icon: 'alignRight', label: '右对齐' },
  { kind: 'top', icon: 'alignTop', label: '顶对齐' },
  { kind: 'vcenter', icon: 'alignCenterV', label: '垂直居中' },
  { kind: 'bottom', icon: 'alignBottom', label: '底对齐' },
];

export function Toolbar() {
  const tool = useEditor((s) => s.tool);
  const zoom = useEditor((s) => s.zoom);
  const selection = useEditor((s) => s.selection);
  const screen = useEditor((s) => s.project.screens.find((item) => item.id === s.activeScreenId) ?? null);
  const settings = useEditor((s) => s.project.settings);

  const insertNode = (type: UIEditorTool) => {
    if (!screen) return;
    const x = Math.round(screen.width / 2 - 60);
    const y = Math.round(screen.height / 2 - 20);
    editorStore.addNode(type as never, { x, y });
  };

  return (
    <div className="ue-toolbar">
      <div className="ue-tool-group">
        {DRAW_TOOLS.map((item) => (
          <button
            key={item.id}
            className={`ue-tool${tool === item.id ? ' active' : ''}`}
            title={`${item.label}${item.hint ? ` (${item.hint})` : ''}`}
            onClick={() => editorStore.setTool(item.id)}
          >
            <EditorIcon name={item.icon} size={16} />
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      <span className="ue-toolbar-sep" />

      <div className="ue-tool-group compact">
        {INSERT_TOOLS.map((item) => (
          <button
            key={item.id}
            className="ue-tool compact"
            title={`插入${item.label}`}
            onClick={() => insertNode(item.id)}
          >
            <EditorIcon name={item.icon} size={15} />
          </button>
        ))}
      </div>

      <span className="ue-toolbar-sep" />

      <div className="ue-tool-group">
        {ALIGN_ACTIONS.map((item) => (
          <button
            key={item.kind}
            className="ue-tool icon-only"
            title={item.label}
            disabled={selection.length === 0}
            onClick={() => editorStore.alignSelection(item.kind)}
          >
            <EditorIcon name={item.icon} size={15} />
          </button>
        ))}
        <button className="ue-tool icon-only" title="水平分布" disabled={selection.length < 3} onClick={() => editorStore.distributeSelection('horizontal')}>
          <EditorIcon name="distH" size={15} />
        </button>
        <button className="ue-tool icon-only" title="垂直分布" disabled={selection.length < 3} onClick={() => editorStore.distributeSelection('vertical')}>
          <EditorIcon name="distV" size={15} />
        </button>
      </div>

      <span className="ue-toolbar-sep" />

      <div className="ue-tool-group">
        <button className="ue-tool icon-only" title="置顶" disabled={!selection.length} onClick={() => selection.forEach((id) => editorStore.reorderNode(id, 'front'))}>
          <EditorIcon name="layers" size={15} />
        </button>
        <button className="ue-tool icon-only" title="分组 (Ctrl+G)" disabled={selection.length < 2} onClick={() => editorStore.groupSelection()}>
          <EditorIcon name="group" size={15} />
        </button>
        <button className="ue-tool icon-only" title="取消分组" disabled={!selection.length} onClick={() => editorStore.ungroupSelection()}>
          <EditorIcon name="ungroup" size={15} />
        </button>
      </div>

      <div className="ue-toolbar-spacer" />

      <div className="ue-tool-group">
        <button className={`ue-tool icon-only${settings.showGrid ? ' active-soft' : ''}`} title="网格" onClick={() => editorStore.setProjectSettings({ showGrid: !settings.showGrid })}>
          <EditorIcon name="grid" size={15} />
        </button>
        <button className={`ue-tool icon-only${settings.snapToGrid ? ' active-soft' : ''}`} title="网格吸附" onClick={() => editorStore.setProjectSettings({ snapToGrid: !settings.snapToGrid })}>
          <EditorIcon name="magnet" size={15} />
        </button>
      </div>

      <span className="ue-toolbar-sep" />

      <div className="ue-zoom">
        <button className="ue-tool icon-only" title="缩小" onClick={() => editorStore.setZoom(zoom - 0.1)}>
          <EditorIcon name="zoomOut" size={15} />
        </button>
        <button className="ue-zoom-value" title="100%" onClick={() => editorStore.setZoom(1)}>
          {Math.round(zoom * 100)}%
        </button>
        <button className="ue-tool icon-only" title="放大" onClick={() => editorStore.setZoom(zoom + 0.1)}>
          <EditorIcon name="zoomIn" size={15} />
        </button>
        <button className="ue-tool icon-only" title="适配屏幕 (Ctrl+0)" onClick={() => window.dispatchEvent(new CustomEvent('uieditor:fit'))}>
          <EditorIcon name="fit" size={15} />
        </button>
      </div>
    </div>
  );
}
