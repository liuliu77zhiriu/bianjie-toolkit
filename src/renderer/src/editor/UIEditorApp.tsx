import { useCallback, useEffect, useRef, useState } from 'react';
import type { UIProject, UIEditorProjectSummary } from '@shared/uieditor';
import { invoke, on } from '../lib/bridge';
import { CanvasStage } from './canvas/CanvasStage';
import { LeftPanel } from './panels/LeftPanel';
import { RightPanel } from './panels/RightPanel';
import { PreviewOverlay } from './Preview';
import { Statusbar } from './Statusbar';
import { Toolbar } from './Toolbar';
import { Topbar, type ExportKind } from './Topbar';
import { editorStore, useEditor } from './store';
import { EditorIcon } from './icons';
import './styles/editor.css';

interface ToastItem {
  id: number;
  message: string;
  kind: 'info' | 'success' | 'error';
}

export function UIEditorApp() {
  const dirty = useEditor((s) => s.dirty);
  const mode = useEditor((s) => s.mode);
  const project = useEditor((s) => s.project);
  const activeScreenId = useEditor((s) => s.activeScreenId);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [imageTarget, setImageTarget] = useState<string | null>(null);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [projects, setProjects] = useState<UIEditorProjectSummary[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const saveTimer = useRef<number | null>(null);
  const savingRef = useRef(false);

  const toast = useCallback((message: string, kind: ToastItem['kind'] = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((previous) => [...previous, { id, message, kind }]);
    window.setTimeout(() => setToasts((previous) => previous.filter((item) => item.id !== id)), 3600);
  }, []);

  const loadProject = useCallback(
    async (projectId: string | null) => {
      setError(null);
      try {
        const next = projectId
          ? await invoke<UIProject>('core', 'uieditor.load', { id: projectId })
          : await invoke<UIProject>('core', 'uieditor.defaultProject');
        editorStore.init(next);
        setLoaded(true);
        setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
        document.title = `${next.name} · UI 编辑器`;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    []
  );

  useEffect(() => {
    const offOpen = on('uieditor:open', (payload) => {
      const projectId = (payload as { projectId?: string | null } | undefined)?.projectId ?? null;
      void loadProject(projectId);
    });
    const offState = on('uieditor:window-state', (payload) => {
      setMaximized(!!(payload as { maximized?: boolean } | undefined)?.maximized);
    });
    // 先注册监听，再向主进程报告 ready，避免首个打开事件丢失
    window.tk.editor?.ready();
    void invoke<{ open: boolean; maximized: boolean }>('core', 'uieditor.windowState')
      .then((state) => setMaximized(!!state.maximized))
      .catch(() => undefined);
    return () => {
      offOpen();
      offState();
    };
  }, [loadProject]);

  const saveNow = useCallback(
    async (silent = false) => {
      if (!loaded || savingRef.current) return;
      savingRef.current = true;
      setSaving(true);
      try {
        const saved = await invoke<UIProject>('core', 'uieditor.save', { project: editorStore.getProject() });
        editorStore.markSaved();
        setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
        if (!silent) toast('已保存到本地工程', 'success');
        return saved;
      } catch (err) {
        if (!silent) toast(`保存失败：${err instanceof Error ? err.message : String(err)}`, 'error');
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
      return null;
    },
    [loaded, toast]
  );

  // 自动保存：dirty 后 900ms 合并写入
  useEffect(() => {
    if (!loaded || !dirty) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      void saveNow(true);
    }, 900);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [dirty, loaded, saveNow, project.updatedAt]);

  // 窗口失焦时兜底保存
  useEffect(() => {
    const onBlur = () => {
      if (editorStore.getSnapshot().dirty) void saveNow(true);
    };
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, [saveNow]);

  const newProject = useCallback(async () => {
    try {
      if (editorStore.getSnapshot().dirty) await saveNow(true);
      const next = await invoke<UIProject>('core', 'uieditor.create', { templateId: 'blank', name: '未命名设计' });
      editorStore.init(next);
      setSavedAt(null);
      toast('已新建空白画布', 'success');
    } catch (err) {
      toast(`新建失败：${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, [saveNow, toast]);

  const applyTemplate = useCallback(
    async (templateId: string) => {
      try {
        if (editorStore.getSnapshot().dirty) await saveNow(true);
        const next = await invoke<UIProject>('core', 'uieditor.create', { templateId });
        editorStore.init(next);
        setSavedAt(null);
        toast('已从模板创建新工程', 'success');
      } catch (err) {
        toast(`创建模板失败：${err instanceof Error ? err.message : String(err)}`, 'error');
      }
    },
    [saveNow, toast]
  );

  const importProject = useCallback(async () => {
    try {
      const next = await invoke<UIProject | null>('core', 'uieditor.importProject');
      if (!next) return;
      editorStore.init(next);
      setSavedAt(null);
      toast('工程已导入', 'success');
    } catch (err) {
      toast(`导入失败：${err instanceof Error ? err.message : String(err)}`, 'error');
    }
  }, [toast]);

  const exportProject = useCallback(
    async (kind: ExportKind) => {
      try {
        if (kind === 'plugin') {
          const result = await invoke<{ ok: boolean; pluginId?: string; error?: string }>('core', 'uieditor.publishPlugin', {
            project: editorStore.getProject(),
          });
          if (result.ok) toast(`已发布为应用内工具${result.pluginId ? `：${result.pluginId}` : ''}`, 'success');
          else toast(`发布失败：${result.error ?? '未知错误'}`, 'error');
          return;
        }
        const projectSnapshot = editorStore.getProject();
        const target =
          kind === 'html'
            ? await invoke<string | null>('core', 'uieditor.exportHtml', { project: projectSnapshot })
            : kind === 'json'
              ? await invoke<string | null>('core', 'uieditor.exportJson', { project: projectSnapshot })
              : await invoke<string | null>('core', 'uieditor.exportReact', { project: projectSnapshot });
        if (target) toast(`已导出：${target}`, 'success');
      } catch (err) {
        toast(`导出失败：${err instanceof Error ? err.message : String(err)}`, 'error');
      }
    },
    [toast]
  );

  const closeWindow = useCallback(async () => {
    if (editorStore.getSnapshot().dirty) await saveNow(true);
    void window.tk.editor?.close();
  }, [saveNow]);

  // 全局快捷键
  useEffect(() => {
    if (!loaded) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const inInput = !!target?.closest('input, textarea, select, [contenteditable="true"]');
      const mod = event.ctrlKey || event.metaKey;
      if (inInput && !(mod && event.key.toLowerCase() === 's')) return;
      const key = event.key.toLowerCase();
      if (mod && key === 's') {
        event.preventDefault();
        void saveNow();
        return;
      }
      if (mod && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) editorStore.redo();
        else editorStore.undo();
        return;
      }
      if (mod && key === 'y') {
        event.preventDefault();
        editorStore.redo();
        return;
      }
      if (mod && key === 'c') {
        editorStore.copySelection();
        return;
      }
      if (mod && key === 'v') {
        event.preventDefault();
        editorStore.paste();
        return;
      }
      if (mod && key === 'd') {
        event.preventDefault();
        editorStore.duplicateSelection();
        return;
      }
      if (mod && key === 'g') {
        event.preventDefault();
        if (event.shiftKey) editorStore.ungroupSelection();
        else editorStore.groupSelection();
        return;
      }
      if (mod && key === 'a') {
        event.preventDefault();
        const screen = editorStore.getActiveScreen();
        const root = screen?.rootIds[0] ? editorStore.getNode(screen.rootIds[0]) : null;
        editorStore.select(root ? root.children : []);
        return;
      }
      if (mod && (key === '=' || key === '+')) {
        event.preventDefault();
        editorStore.setZoom(editorStore.getSnapshot().zoom + 0.1);
        return;
      }
      if (mod && key === '-') {
        event.preventDefault();
        editorStore.setZoom(editorStore.getSnapshot().zoom - 0.1);
        return;
      }
      if (mod && key === '0') {
        event.preventDefault();
        window.dispatchEvent(new CustomEvent('uieditor:fit'));
        return;
      }
      if (mod && key === '1') {
        event.preventDefault();
        editorStore.setZoom(1);
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        editorStore.deleteSelection();
        return;
      }
      if (event.key === 'Escape') {
        if (editorStore.getSnapshot().mode === 'preview') editorStore.setMode('design');
        else editorStore.select([]);
        return;
      }
      const step = event.shiftKey ? 10 : 1;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        editorStore.beginGesture();
        editorStore.moveSelectionBy(-step, 0);
        editorStore.endGesture('微调');
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        editorStore.beginGesture();
        editorStore.moveSelectionBy(step, 0);
        editorStore.endGesture('微调');
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        editorStore.beginGesture();
        editorStore.moveSelectionBy(0, -step);
        editorStore.endGesture('微调');
      } else if (event.key === 'ArrowDown') {
        event.preventDefault();
        editorStore.beginGesture();
        editorStore.moveSelectionBy(0, step);
        editorStore.endGesture('微调');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [loaded, saveNow]);

  const handleImageRequest = useCallback((nodeId: string) => {
    setImageTarget(nodeId);
    fileRef.current?.click();
  }, []);

  const refreshProjects = useCallback(async () => {
    setProjectsLoading(true);
    try {
      const list = await invoke<UIEditorProjectSummary[]>('core', 'uieditor.list');
      setProjects(list);
    } catch (err) {
      toast(`读取工程库失败：${err instanceof Error ? err.message : String(err)}`, 'error');
    } finally {
      setProjectsLoading(false);
    }
  }, [toast]);

  const openProjects = useCallback(() => {
    setProjectsOpen(true);
    void refreshProjects();
  }, [refreshProjects]);

  const openProjectById = useCallback(
    async (projectId: string) => {
      setProjectsOpen(false);
      await loadProject(projectId);
    },
    [loadProject]
  );

  const duplicateProject = useCallback(
    async (projectId: string) => {
      try {
        await invoke<UIProject>('core', 'uieditor.duplicate', { id: projectId });
        await refreshProjects();
        toast('工程副本已创建', 'success');
      } catch (err) {
        toast(`复制失败：${err instanceof Error ? err.message : String(err)}`, 'error');
      }
    },
    [refreshProjects, toast]
  );

  const deleteProject = useCallback(
    async (project: UIEditorProjectSummary) => {
      if (!window.confirm(`确定删除工程「${project.name}」吗？该操作不可撤销。`)) return;
      try {
        await invoke('core', 'uieditor.remove', { id: project.id });
        await refreshProjects();
        if (project.id === editorStore.getProject().id) {
          const latest = await invoke<UIProject>('core', 'uieditor.defaultProject');
          editorStore.init(latest);
        }
        toast('工程已删除', 'success');
      } catch (err) {
        toast(`删除失败：${err instanceof Error ? err.message : String(err)}`, 'error');
      }
    },
    [refreshProjects, toast]
  );

  if (error) {
    return (
      <div className="ue-error">
        <div className="ue-error-card">
          <EditorIcon name="help" size={26} />
          <h2>无法打开 UI 编辑器</h2>
          <p>{error}</p>
          <button className="ue-btn primary" onClick={() => void loadProject(null)}>重试</button>
        </div>
      </div>
    );
  }

  if (!loaded) {
    return (
      <div className="ue-loading">
        <span className="ue-loading-mark"><EditorIcon name="sparkle" size={22} /></span>
        <div>正在准备 UI 工作台…</div>
        <small>加载工程 / 渲染节点 / 初始化画布</small>
      </div>
    );
  }

  return (
    <div className="ue-app">
      <Topbar
        project={project}
        dirty={dirty}
        saving={saving}
        savedAt={savedAt}
        maximized={maximized}
        onSave={() => void saveNow()}
        onExport={(kind) => void exportProject(kind)}
        onNewProject={() => void newProject()}
        onImportProject={() => void importProject()}
        onOpenProjects={openProjects}
        onShowTemplates={() => editorStore.setLeftTab('templates')}
        onOpenFolder={() => void invoke('core', 'uieditor.openFolder').catch(() => undefined)}
        onMinimize={() => window.tk.editor?.minimize()}
        onToggleMaximize={() => window.tk.editor?.toggleMaximize()}
        onClose={() => void closeWindow()}
      />
      <Toolbar />
      <div className="ue-workbench">
        <LeftPanel onApplyTemplate={(templateId) => void applyTemplate(templateId)} />
        <div className="ue-canvas-area">
          <CanvasStage onRequestImage={handleImageRequest} />
        </div>
        <RightPanel />
      </div>
      <Statusbar />
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        style={{ display: 'none' }}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file || !imageTarget) return;
          if (file.size > 4 * 1024 * 1024) {
            toast('图片过大（最大 4MB），请压缩后使用', 'error');
            return;
          }
          const reader = new FileReader();
          reader.onload = () => {
            const src = String(reader.result ?? '');
            editorStore.updateNode(imageTarget, { image: { src, fit: 'cover', alt: file.name } });
            toast('图片已插入画布', 'success');
            setImageTarget(null);
          };
          reader.readAsDataURL(file);
        }}
      />
      {projectsOpen ? (
        <div className="ue-modal-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setProjectsOpen(false);
        }}>
          <div className="ue-project-modal">
            <div className="ue-project-head">
              <div>
                <h2>工程库</h2>
                <p>继续编辑最近的设计，或从模板开始新的工程</p>
              </div>
              <div className="ue-project-head-actions">
                <button className="ue-btn ghost" onClick={() => void importProject()}>导入工程</button>
                <button className="ue-btn" onClick={() => { setProjectsOpen(false); editorStore.setLeftTab('templates'); }}>从模板新建</button>
                <button className="ue-btn primary" onClick={() => { setProjectsOpen(false); void newProject(); }}>新建空白</button>
                <button className="ue-icon-btn" title="关闭" onClick={() => setProjectsOpen(false)}>
                  <EditorIcon name="close" size={15} />
                </button>
              </div>
            </div>
            <div className="ue-project-list">
              {projectsLoading ? <div className="ue-project-empty">正在读取工程…</div> : null}
              {!projectsLoading && !projects.length ? <div className="ue-project-empty">还没有工程，新建一个开始设计吧</div> : null}
              {projects.map((project) => (
                <div key={project.id} className={`ue-project-card${project.id === editorStore.getProject().id ? ' current' : ''}`}>
                  <span className="ue-project-thumb" style={{ background: `linear-gradient(140deg, ${project.accent}44, #0b0f18)` }}>
                    <i style={{ background: project.accent }} />
                  </span>
                  <button className="ue-project-main" onClick={() => void openProjectById(project.id)}>
                    <b>{project.name}</b>
                    <span>{project.screenCount} 页面 · {project.nodeCount} 节点 · {new Date(project.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                    {project.description ? <small>{project.description}</small> : null}
                  </button>
                  <div className="ue-project-actions">
                    <button className="ue-btn sm" onClick={() => void openProjectById(project.id)}>打开</button>
                    <button className="ue-icon-btn" title="复制工程" onClick={() => void duplicateProject(project.id)}>
                      <EditorIcon name="copy" size={14} />
                    </button>
                    <button className="ue-icon-btn danger" title="删除工程" onClick={() => void deleteProject(project)}>
                      <EditorIcon name="trash" size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {mode === 'preview' ? (
        <PreviewOverlay project={project} initialScreenId={activeScreenId} onClose={() => editorStore.setMode('design')} />
      ) : null}
      <div className="ue-toasts">
        {toasts.map((item) => (
          <div key={item.id} className={`ue-toast ${item.kind}`}>
            <EditorIcon name={item.kind === 'error' ? 'help' : item.kind === 'success' ? 'check' : 'sparkle'} size={14} />
            {item.message}
          </div>
        ))}
      </div>
    </div>
  );
}
