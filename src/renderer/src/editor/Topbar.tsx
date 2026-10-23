import { useEffect, useRef, useState } from 'react';
import type { UIProject } from '@shared/uieditor';
import { editorStore, useEditor } from './store';
import { EditorIcon } from './icons';

export type ExportKind = 'html' | 'json' | 'react' | 'plugin';

interface Props {
  project: UIProject;
  dirty: boolean;
  saving: boolean;
  savedAt: string | null;
  maximized: boolean;
  onSave: () => void;
  onExport: (kind: ExportKind) => void;
  onNewProject: () => void;
  onImportProject: () => void;
  onOpenProjects: () => void;
  onShowTemplates: () => void;
  onOpenFolder: () => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}

type MenuName = 'file' | 'edit' | 'view' | 'help' | null;

export function Topbar(props: Props) {
  const { project, dirty, saving, savedAt, maximized } = props;
  const mode = useEditor((s) => s.mode);
  const canUndo = useEditor((s) => s.canUndo);
  const canRedo = useEditor((s) => s.canRedo);
  const activeScreenId = useEditor((s) => s.activeScreenId);
  const [menu, setMenu] = useState<MenuName>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!menu && !exportOpen) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('.ue-menu, .ue-menu-trigger, .ue-export')) return;
      setMenu(null);
      setExportOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [menu, exportOpen]);

  useEffect(() => {
    if (editingName) {
      nameRef.current?.focus();
      nameRef.current?.select();
    }
  }, [editingName]);

  const saveLabel = saving ? '保存中…' : dirty ? '未保存' : savedAt ? `已保存 ${savedAt}` : '已保存';

  return (
    <header className="ue-topbar">
      <div className="ue-topbar-row ue-drag">
        <div className="ue-brand">
          <span className="ue-brand-mark">
            <EditorIcon name="sparkle" size={16} />
          </span>
          <span className="ue-brand-text">
            <b>UI 编辑器</b>
            <i>Bianjie Studio</i>
          </span>
        </div>

        <div className="ue-menu-bar ue-no-drag">
          <MenuButton label="文件" active={menu === 'file'} onClick={() => setMenu(menu === 'file' ? null : 'file')} />
          <MenuButton label="编辑" active={menu === 'edit'} onClick={() => setMenu(menu === 'edit' ? null : 'edit')} />
          <MenuButton label="视图" active={menu === 'view'} onClick={() => setMenu(menu === 'view' ? null : 'view')} />
          <MenuButton label="帮助" active={menu === 'help'} onClick={() => setMenu(menu === 'help' ? null : 'help')} />
          {menu === 'file' ? (
            <div className="ue-menu">
              <MenuItem label="新建空白画布" hint="Ctrl+N" onClick={() => { setMenu(null); props.onNewProject(); }} />
              <MenuItem label="从模板新建…" onClick={() => { setMenu(null); props.onShowTemplates(); }} />
              <MenuItem label="导入工程…" onClick={() => { setMenu(null); props.onImportProject(); }} />
              <MenuItem label="最近工程…" onClick={() => { setMenu(null); props.onOpenProjects(); }} />
              <div className="ue-menu-sep" />
              <MenuItem label="保存" hint="Ctrl+S" onClick={() => { setMenu(null); props.onSave(); }} />
              <div className="ue-menu-sep" />
              <MenuItem label="导出独立 HTML…" onClick={() => { setMenu(null); props.onExport('html'); }} />
              <MenuItem label="导出工程 JSON…" onClick={() => { setMenu(null); props.onExport('json'); }} />
              <MenuItem label="导出 React 组件…" onClick={() => { setMenu(null); props.onExport('react'); }} />
              <MenuItem label="发布为应用内工具…" onClick={() => { setMenu(null); props.onExport('plugin'); }} />
              <div className="ue-menu-sep" />
              <MenuItem label="打开工程目录" onClick={() => { setMenu(null); props.onOpenFolder(); }} />
            </div>
          ) : null}
          {menu === 'edit' ? (
            <div className="ue-menu">
              <MenuItem label="撤销" hint="Ctrl+Z" disabled={!canUndo} onClick={() => { setMenu(null); editorStore.undo(); }} />
              <MenuItem label="重做" hint="Ctrl+Y" disabled={!canRedo} onClick={() => { setMenu(null); editorStore.redo(); }} />
              <div className="ue-menu-sep" />
              <MenuItem label="复制" hint="Ctrl+C" onClick={() => { setMenu(null); editorStore.copySelection(); }} />
              <MenuItem label="粘贴" hint="Ctrl+V" onClick={() => { setMenu(null); editorStore.paste(); }} />
              <MenuItem label="复制副本" hint="Ctrl+D" onClick={() => { setMenu(null); editorStore.duplicateSelection(); }} />
              <MenuItem label="删除" hint="Delete" onClick={() => { setMenu(null); editorStore.deleteSelection(); }} />
              <div className="ue-menu-sep" />
              <MenuItem label="全选" hint="Ctrl+A" onClick={() => {
                setMenu(null);
                const screen = editorStore.getActiveScreen();
                if (!screen) return;
                const root = screen.rootIds[0];
                const node = root ? editorStore.getNode(root) : null;
                editorStore.select(node ? node.children : screen.rootIds);
              }} />
              <MenuItem label="分组" hint="Ctrl+G" onClick={() => { setMenu(null); editorStore.groupSelection(); }} />
              <MenuItem label="取消分组" hint="Ctrl+Shift+G" onClick={() => { setMenu(null); editorStore.ungroupSelection(); }} />
            </div>
          ) : null}
          {menu === 'view' ? (
            <div className="ue-menu">
              <MenuItem label="放大" hint="Ctrl+=" onClick={() => { setMenu(null); editorStore.setZoom(editorStore.getSnapshot().zoom + 0.1); }} />
              <MenuItem label="缩小" hint="Ctrl+-" onClick={() => { setMenu(null); editorStore.setZoom(editorStore.getSnapshot().zoom - 0.1); }} />
              <MenuItem label="100%" hint="Ctrl+1" onClick={() => { setMenu(null); editorStore.setZoom(1); }} />
              <div className="ue-menu-sep" />
              <MenuItem label={project.settings.showGrid ? '隐藏网格' : '显示网格'} onClick={() => {
                setMenu(null);
                editorStore.setProjectSettings({ showGrid: !project.settings.showGrid });
              }} />
              <MenuItem label={project.settings.snapToGrid ? '关闭网格吸附' : '开启网格吸附'} onClick={() => {
                setMenu(null);
                editorStore.setProjectSettings({ snapToGrid: !project.settings.snapToGrid });
              }} />
              <MenuItem label={project.settings.snapToGuides ? '关闭参考线吸附' : '开启参考线吸附'} onClick={() => {
                setMenu(null);
                editorStore.setProjectSettings({ snapToGuides: !project.settings.snapToGuides });
              }} />
            </div>
          ) : null}
          {menu === 'help' ? (
            <div className="ue-menu ue-menu-help">
              <div className="ue-help-title">常用快捷键</div>
              <div className="ue-help-grid">
                <span>选择</span><b>V</b><span>平移</span><b>H / 空格</b>
                <span>撤销 / 重做</span><b>Ctrl+Z / Ctrl+Y</b>
                <span>复制 / 粘贴</span><b>Ctrl+C / Ctrl+V</b>
                <span>复制副本</span><b>Ctrl+D</b>
                <span>分组 / 解组</span><b>Ctrl+G / Ctrl+Shift+G</b>
                <span>保存</span><b>Ctrl+S</b>
                <span>缩放</span><b>Ctrl+滚轮</b>
                <span>方向微调</span><b>方向键 / Shift+方向键</b>
              </div>
            </div>
          ) : null}
        </div>

        <div className="ue-topbar-center ue-no-drag">
          <button className={`ue-mode${mode === 'design' ? ' active' : ''}`} onClick={() => editorStore.setMode('design')}>设计</button>
          <button className={`ue-mode${mode === 'prototype' ? ' active' : ''}`} onClick={() => editorStore.setMode('prototype')}>原型</button>
          <button className={`ue-mode${mode === 'preview' ? ' active' : ''}`} onClick={() => editorStore.setMode('preview')}>
            <EditorIcon name="play" size={12} /> 预览
          </button>
        </div>

        <div className="ue-project-name ue-no-drag" onDoubleClick={() => setEditingName(true)}>
          {editingName ? (
            <input
              ref={nameRef}
              className="ue-name-input"
              defaultValue={project.name}
              onBlur={(event) => {
                editorStore.setProjectName(event.target.value);
                setEditingName(false);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
                if (event.key === 'Escape') setEditingName(false);
              }}
            />
          ) : (
            <button className="ue-name-button" title="双击重命名" onClick={() => setEditingName(true)}>
              {project.name}
            </button>
          )}
          <span className={`ue-save-state${dirty ? ' dirty' : ''}`}>{saveLabel}</span>
        </div>

        <div className="ue-top-actions ue-no-drag">
          <button className="ue-icon-btn" title="工程库" onClick={props.onOpenProjects}>
            <EditorIcon name="folder" size={16} />
          </button>
          <button className="ue-icon-btn" title="撤销 (Ctrl+Z)" disabled={!canUndo} onClick={() => editorStore.undo()}>
            <EditorIcon name="undo" size={16} />
          </button>
          <button className="ue-icon-btn" title="重做 (Ctrl+Y)" disabled={!canRedo} onClick={() => editorStore.redo()}>
            <EditorIcon name="redo" size={16} />
          </button>
          <span className="ue-action-sep" />
          <button className="ue-icon-btn" title="保存 (Ctrl+S)" onClick={props.onSave}>
            <EditorIcon name="save" size={16} />
          </button>
          <div className="ue-export">
            <button className="ue-export-btn" onClick={() => setExportOpen((open) => !open)}>
              <EditorIcon name="export" size={15} /> 导出
              <EditorIcon name="chevronDown" size={12} />
            </button>
            {exportOpen ? (
              <div className="ue-menu ue-export-menu">
                <MenuItem label="独立 HTML 页面" desc="自包含，可直接分享/打开" onClick={() => { setExportOpen(false); props.onExport('html'); }} />
                <MenuItem label="工程 JSON" desc="可再次导入编辑" onClick={() => { setExportOpen(false); props.onExport('json'); }} />
                <MenuItem label="React 组件" desc="TSX + CSS" onClick={() => { setExportOpen(false); props.onExport('react'); }} />
                <MenuItem label="发布为应用内工具" desc="出现在工具箱工具列表" onClick={() => { setExportOpen(false); props.onExport('plugin'); }} />
              </div>
            ) : null}
          </div>
          <span className="ue-action-sep" />
          <button className="ue-win-btn" title="最小化" onClick={props.onMinimize}><EditorIcon name="minus" size={14} /></button>
          <button className="ue-win-btn" title={maximized ? '还原' : '最大化'} onClick={props.onToggleMaximize}>
            <EditorIcon name={maximized ? 'restore' : 'maximize'} size={13} />
          </button>
          <button className="ue-win-btn close" title="关闭" onClick={props.onClose}><EditorIcon name="close" size={14} /></button>
        </div>
      </div>

      <div className="ue-screen-tabs ue-no-drag">
        <div className="ue-screen-list">
          {project.screens.map((screen) => (
            <button
              key={screen.id}
              className={`ue-screen-tab${screen.id === activeScreenId ? ' active' : ''}`}
              onClick={() => editorStore.setActiveScreen(screen.id)}
              onDoubleClick={() => {
                const name = window.prompt('页面名称', screen.name);
                if (name?.trim()) editorStore.renameScreen(screen.id, name.trim());
              }}
              title="双击重命名"
            >
              <span className="ue-screen-dot" />
              {screen.name}
              <span className="ue-screen-size">{screen.width}×{screen.height}</span>
            </button>
          ))}
          <button
            className="ue-screen-add"
            title="新建页面"
            onClick={() => {
              const id = editorStore.addScreen(`页面 ${project.screens.length + 1}`);
              editorStore.setActiveScreen(id);
            }}
          >
            <EditorIcon name="plus" size={13} />
          </button>
        </div>
        <div className="ue-screen-actions">
          <button className={`ue-chip${project.settings.showGrid ? ' active' : ''}`} title="网格" onClick={() => editorStore.setProjectSettings({ showGrid: !project.settings.showGrid })}>
            <EditorIcon name="grid" size={13} />
          </button>
          <button className={`ue-chip${project.settings.snapToGrid ? ' active' : ''}`} title="网格吸附" onClick={() => editorStore.setProjectSettings({ snapToGrid: !project.settings.snapToGrid })}>
            <EditorIcon name="magnet" size={13} />
          </button>
          <button className="ue-chip" title="打开工程目录" onClick={props.onOpenFolder}>
            <EditorIcon name="folder" size={13} />
          </button>
        </div>
      </div>
    </header>
  );
}

function MenuButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button className={`ue-menu-trigger${active ? ' active' : ''}`} onClick={onClick}>
      {label}
    </button>
  );
}

function MenuItem({
  label,
  hint,
  desc,
  disabled,
  onClick,
}: {
  label: string;
  hint?: string;
  desc?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button className="ue-menu-item" disabled={disabled} onClick={onClick}>
      <span className="ue-menu-item-label">
        {label}
        {desc ? <i>{desc}</i> : null}
      </span>
      {hint ? <span className="ue-menu-item-hint">{hint}</span> : null}
    </button>
  );
}
