import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { basicSetup } from 'codemirror';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import type { PluginEditResult, PluginFileEntry, PluginFilesPayload } from '@shared/types';
import { formatBytes, invoke, toast } from '../../lib/bridge';
import { Icon } from '../../ui/Icon';
import { ConfirmProvider, errorMessage, Modal, useConfirm, type ConfirmOptions } from './common';
import './editor-files.css';

type FileLanguage = PluginFileEntry['language'];

interface ReadFileResult {
  content: string;
  overridden: boolean;
  baseContent?: string;
}

type TemplateKey = 'blank' | 'js' | 'html' | 'css' | 'json' | 'md';

const TEMPLATE_OPTIONS: ReadonlyArray<{ key: TemplateKey; label: string; ext: string; hint: string }> = [
  { key: 'blank', label: '空白', ext: '', hint: '空文件；已知扩展名会补最小模板' },
  { key: 'js', label: 'JavaScript', ext: '.js', hint: '注释头 + 空模块' },
  { key: 'html', label: 'HTML', ext: '.html', hint: '极简 HTML 骨架' },
  { key: 'css', label: 'CSS', ext: '.css', hint: '样式注释头' },
  { key: 'json', label: 'JSON', ext: '.json', hint: '空对象 {}' },
  { key: 'md', label: 'Markdown', ext: '.md', hint: '一级标题' },
];

const DEFAULT_FILES_WIDTH = 180;
const MIN_FILES_WIDTH = 150;
const MAX_FILES_WIDTH = 420;

/** 新建文件的初始内容（空白模板交给后端按扩展名生成）。 */
function templateContent(template: TemplateKey, relPath: string): string {
  const name = relPath.split('/').pop() ?? relPath;
  const stem = name.replace(/\.[^.]+$/, '') || name;
  switch (template) {
    case 'blank':
      return '';
    case 'js':
      return `/** ${name} */\n`;
    case 'html':
      return `<!doctype html>\n<html lang="zh-CN">\n<head>\n<meta charset="utf-8" />\n<title>${stem}</title>\n</head>\n<body>\n\n</body>\n</html>\n`;
    case 'css':
      return `/* ${name} */\n`;
    case 'json':
      return '{}\n';
    case 'md':
      return `# ${stem}\n`;
    default:
      return '';
  }
}

/** 选择模板时，若用户填写的路径没有扩展名则自动补上模板默认扩展名。 */
function withTemplateExtension(relPath: string, template: TemplateKey): string {
  const ext = TEMPLATE_OPTIONS.find((item) => item.key === template)?.ext ?? '';
  if (!ext) return relPath;
  const base = relPath.split('/').pop() ?? '';
  if (!base || /\.[a-z0-9]{1,12}$/i.test(base)) return relPath;
  return `${relPath}${ext}`;
}

const LANGUAGE_THEME = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '11.5px',
    backgroundColor: 'transparent',
  },
  '&.cm-focused': {
    outline: 'none',
  },
  '.cm-scroller': {
    fontFamily: 'var(--tk-mono)',
    lineHeight: '1.55',
    overflow: 'auto',
  },
  '.cm-content': {
    padding: '8px 0 10px',
    caretColor: 'var(--tk-accent)',
  },
  '.cm-gutters': {
    backgroundColor: 'rgba(5, 10, 20, 0.5)',
    borderRight: '1px solid rgba(140, 180, 255, 0.08)',
    color: 'rgba(140, 170, 220, 0.55)',
  },
  '.cm-activeLine': {
    backgroundColor: 'rgba(var(--tk-accent-rgb), 0.06)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'rgba(var(--tk-accent-rgb), 0.08)',
    color: 'var(--tk-text-2)',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'rgba(var(--tk-accent-rgb), 0.25)',
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--tk-accent)',
  },
});

function languageExtension(language: FileLanguage | undefined) {
  if (language === 'javascript' || language === 'json') return javascript();
  return [];
}

function languageLabel(language: FileLanguage | undefined): string {
  switch (language) {
    case 'javascript':
      return 'JavaScript';
    case 'json':
      return 'JSON';
    case 'html':
      return 'HTML';
    case 'css':
      return 'CSS';
    default:
      return '文本';
  }
}

function EditorInner({ pluginId, onDone }: { pluginId: string; onDone: () => void }) {
  const confirm = useConfirm();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const languageSlot = useRef(new Compartment());
  const savedRef = useRef('');
  const pathRef = useRef<string | null>(null);
  const dirtyRef = useRef(false);
  const savingRef = useRef(false);
  const confirmingRef = useRef(false);
  /** 任一确认框 / 弹层打开时为 true：Esc 交给弹层自己处理，避免误关编辑器。 */
  const dialogGuardRef = useRef(false);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const saveRef = useRef<() => void>(() => undefined);

  const [payload, setPayload] = useState<PluginFilesPayload | null>(null);
  const [deletedFiles, setDeletedFiles] = useState<string[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [fileInfo, setFileInfo] = useState<{ overridden: boolean; language: FileLanguage } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [template, setTemplate] = useState<TemplateKey>('blank');
  const [createError, setCreateError] = useState<string | null>(null);
  const [filesWidth, setFilesWidth] = useState(DEFAULT_FILES_WIDTH);
  const [fullscreen, setFullscreen] = useState(false);

  const markDirty = useCallback((value: boolean) => {
    dirtyRef.current = value;
    setDirty(value);
  }, []);

  /** 所有确认框统一走这里：期间 Esc 不触发页面返回/全屏退出。 */
  const ask = useCallback(
    async (options: ConfirmOptions): Promise<boolean> => {
      dialogGuardRef.current = true;
      try {
        return await confirm(options);
      } finally {
        dialogGuardRef.current = false;
      }
    },
    [confirm]
  );

  /* -------------------------------------------------------- 创建 CodeMirror */

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: '',
        extensions: [
          basicSetup,
          oneDark,
          LANGUAGE_THEME,
          EditorView.lineWrapping,
          languageSlot.current.of([]),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            const text = update.state.doc.toString();
            const next = text !== savedRef.current;
            if (next !== dirtyRef.current) markDirty(next);
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [markDirty]);

  useEffect(
    () => () => {
      resizeCleanupRef.current?.();
    },
    []
  );

  /* -------------------------------------------------------- 读取文件 */

  const openFile = useCallback(
    async (file: PluginFileEntry, force = false) => {
      if (!file.editable) {
        toast('该文件为二进制或体积过大，暂不支持编辑', 'error');
        return;
      }
      if (!force && pathRef.current === file.path) return;
      if (!force && dirtyRef.current && pathRef.current && pathRef.current !== file.path) {
        const discard = await ask({
          title: '放弃未保存的修改？',
          message: `「${pathRef.current}」有尚未保存的修改，切换文件后会丢失。`,
          confirmText: '放弃修改',
          danger: true,
        });
        if (!discard) return;
      }
      setLoadingFile(true);
      setError(null);
      try {
        const data = await invoke<ReadFileResult>('core', 'plugins.readFile', { id: pluginId, path: file.path });
        savedRef.current = data.content;
        pathRef.current = file.path;
        setCurrentPath(file.path);
        setFileInfo({ overridden: data.overridden, language: file.language });
        markDirty(false);
        const view = viewRef.current;
        if (view) {
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: data.content },
            selection: { anchor: 0 },
            effects: languageSlot.current.reconfigure(languageExtension(file.language)),
          });
          view.scrollDOM.scrollTop = 0;
        }
      } catch (err) {
        setError(errorMessage(err));
      } finally {
        setLoadingFile(false);
      }
    },
    [ask, markDirty, pluginId]
  );

  /** 清空编辑器（当前文件被删除且没有可切换的相邻文件时）。 */
  const clearEditor = useCallback(() => {
    savedRef.current = '';
    pathRef.current = null;
    setCurrentPath(null);
    setFileInfo(null);
    markDirty(false);
    const view = viewRef.current;
    if (view) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: '' },
        selection: { anchor: 0 },
        effects: languageSlot.current.reconfigure([]),
      });
    }
  }, [markDirty]);

  const refreshFiles = useCallback(async () => {
    try {
      const data = await invoke<PluginFilesPayload>('core', 'plugins.files', { id: pluginId });
      setPayload(data);
      setDeletedFiles(data.deletedFiles ?? []);
      const info = data.files.find((file) => file.path === pathRef.current);
      if (info) setFileInfo({ overridden: info.overridden, language: info.language });
      return data;
    } catch {
      return null;
    }
  }, [pluginId]);

  const loadPlugin = useCallback(
    async (selectPath?: string) => {
      try {
        const data = await invoke<PluginFilesPayload>('core', 'plugins.files', { id: pluginId });
        setPayload(data);
        setDeletedFiles(data.deletedFiles ?? []);
        setLoadError(null);
        if (selectPath) {
          const target = data.files.find((file) => file.path === selectPath && file.editable);
          if (target) {
            await openFile(target, true);
            return;
          }
        }
        const editable = data.files.filter((file) => file.editable);
        const preferred = editable.find((file) => file.path === 'main.js') ?? editable[0];
        if (preferred) await openFile(preferred, true);
        else if (data.files.length) setError('该插件没有可编辑的文本文件');
        else setError('该插件没有文件，可新建文件或恢复已删除文件');
      } catch (err) {
        setLoadError(errorMessage(err));
      }
    },
    [openFile, pluginId]
  );

  useEffect(() => {
    void loadPlugin();
  }, [loadPlugin]);

  /* -------------------------------------------------------- 保存 / 恢复 / 重载 */

  const save = useCallback(async () => {
    const view = viewRef.current;
    const path = pathRef.current;
    if (!view || !path || savingRef.current || mutating) return;
    const content = view.state.doc.toString();
    if (content === savedRef.current) {
      markDirty(false);
      return;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const result = await invoke<PluginEditResult>('core', 'plugins.writeFile', { id: pluginId, path, content });
      if (!result?.ok) {
        setError(result?.error?.message ?? '保存失败，请稍后再试');
        toast('保存失败，你的修改仍保留在编辑器中', 'error');
        return;
      }
      savedRef.current = content;
      markDirty(false);
      if (result.error) {
        setError(`已写入文件，但插件热重载失败：${result.error.message}`);
        toast('已保存，但插件热重载失败', 'error');
      } else {
        toast('已保存并热重载', 'success');
      }
      await refreshFiles();
    } catch (err) {
      setError(errorMessage(err));
      toast(errorMessage(err), 'error');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [markDirty, mutating, pluginId, refreshFiles]);

  saveRef.current = () => {
    void save();
  };

  /* -------------------------------------------------------- 键盘与返回保护 */

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      event.stopPropagation();
      if (confirmingRef.current || dialogGuardRef.current || showCreate) return;
      saveRef.current();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [showCreate]);

  const askDiscard = useCallback(async () => {
    if (confirmingRef.current) return;
    confirmingRef.current = true;
    try {
      const discard = await ask({
        title: '放弃未保存的修改？',
        message: '编辑器中有尚未保存的内容，离开后会丢失。',
        confirmText: '放弃修改',
        danger: true,
      });
      if (discard) onDone();
    } finally {
      confirmingRef.current = false;
    }
  }, [ask, onDone]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // 弹层 / 确认框自行处理 Esc
      if (showCreate || dialogGuardRef.current) return;
      // 全屏编辑时 Esc 只退出全屏，不关闭页面
      if (fullscreen) {
        event.preventDefault();
        event.stopPropagation();
        setFullscreen(false);
        return;
      }
      if (!dirtyRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      void askDiscard();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [askDiscard, fullscreen, showCreate]);

  useEffect(() => {
    if (!dirty) return undefined;
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const back = target?.closest?.('.panel-header button[aria-label="返回"]');
      if (!back) return;
      event.preventDefault();
      event.stopPropagation();
      void askDiscard();
    };
    window.addEventListener('click', onClick, true);
    return () => window.removeEventListener('click', onClick, true);
  }, [askDiscard, dirty]);

  const restoreFile = async () => {
    const path = pathRef.current;
    if (!path || reloading) return;
    const discard = await ask({
      title: '恢复此文件默认',
      message: `将删除「${path}」的自定义覆盖文件并重新加载插件，当前未保存的修改会丢失。`,
      confirmText: '恢复默认',
      danger: true,
    });
    if (!discard) return;
    setReloading(true);
    setError(null);
    try {
      await invoke<PluginEditResult>('core', 'plugins.restore', { id: pluginId, path });
      const data = await refreshFiles();
      const files = data?.files ?? payload?.files ?? [];
      const still = files.find((file) => file.path === path && file.editable);
      if (still) {
        await openFile(still, true);
      } else {
        clearEditor();
        const next = files.find((file) => file.editable);
        if (next) await openFile(next, true);
      }
      toast('已恢复默认文件', 'success');
    } catch (err) {
      setError(errorMessage(err));
      toast(errorMessage(err), 'error');
    } finally {
      setReloading(false);
    }
  };

  const reloadPlugin = async () => {
    if (reloading) return;
    setReloading(true);
    setError(null);
    try {
      const result = await invoke<PluginEditResult>('core', 'plugins.reload', { id: pluginId });
      if (result?.ok) toast('插件已重新加载', 'success');
      else toast(result?.error?.message ?? '插件重新加载失败', 'error');
      await refreshFiles();
    } catch (err) {
      setError(errorMessage(err));
      toast(errorMessage(err), 'error');
    } finally {
      setReloading(false);
    }
  };

  const closeEditor = async () => {
    if (dirtyRef.current) {
      if (confirmingRef.current) return;
      confirmingRef.current = true;
      try {
        const discard = await ask({
          title: '放弃未保存的修改？',
          message: '编辑器中有尚未保存的内容，返回后会丢失。',
          confirmText: '放弃修改',
          danger: true,
        });
        if (!discard) return;
      } finally {
        confirmingRef.current = false;
      }
    }
    onDone();
  };

  /* -------------------------------------------------------- 新建 / 删除 / 恢复文件 */

  const refreshList = async () => {
    if (mutating) return;
    const data = await refreshFiles();
    if (!data) {
      toast('刷新文件列表失败', 'error');
      return;
    }
    if (pathRef.current && !data.files.some((file) => file.path === pathRef.current)) {
      if (dirtyRef.current) {
        setError(`「${pathRef.current}」已不在文件列表中，你的未保存修改仍保留在编辑器中`);
      } else {
        clearEditor();
      }
    }
    toast('文件列表已刷新', 'success');
  };

  const openCreateDialog = async () => {
    if (mutating) return;
    if (dirtyRef.current) {
      const discard = await ask({
        title: '放弃未保存的修改？',
        message: '新建文件后会打开新文件，当前未保存的修改会丢失。',
        confirmText: '继续新建',
        danger: true,
      });
      if (!discard) return;
    }
    setCreateError(null);
    setNewPath('');
    setTemplate('blank');
    setShowCreate(true);
  };

  const closeCreateDialog = () => {
    if (mutating) return;
    setShowCreate(false);
    setCreateError(null);
  };

  const submitCreate = async () => {
    const rel = newPath.trim().replace(/\\/g, '/').replace(/^\/+/, '');
    if (!rel || mutating) return;
    setCreateError(null);
    setMutating(true);
    try {
      const content = templateContent(template, rel);
      const result = await invoke<PluginEditResult>('core', 'plugins.createFile', {
        id: pluginId,
        path: rel,
        content,
        template,
      });
      if (!result?.ok) {
        setCreateError(result?.error?.message ?? '创建失败，请检查文件路径');
        return;
      }
      setShowCreate(false);
      const data = await refreshFiles();
      if (result.error) {
        setError(`文件已创建，但插件热重载失败：${result.error.message}`);
        toast('文件已创建，但插件热重载失败', 'error');
      } else {
        toast('已创建文件', 'success');
      }
      const target = data?.files.find((file) => file.path === rel || file.path.toLowerCase() === rel.toLowerCase());
      if (target) await openFile(target, true);
    } catch (err) {
      setCreateError(errorMessage(err));
      toast(errorMessage(err), 'error');
    } finally {
      setMutating(false);
    }
  };

  const requestDeleteFile = async (file: PluginFileEntry) => {
    if (mutating) return;
    const message = file.overridden
      ? `「${file.path}」有你的自定义覆盖。删除会移除覆盖层文件：若存在内置版本会重新显示，否则文件将被彻底删除。`
      : `「${file.path}」是插件自带的文件。删除会以覆盖层墓碑隐藏，可在下方「已删除文件」中恢复。`;
    const loseDirty = file.path === pathRef.current && dirtyRef.current;
    const confirmed = await ask({
      title: '删除文件',
      message: `${message}${loseDirty ? ' 当前文件有未保存修改，删除后会丢失。' : ''}`,
      confirmText: '删除',
      danger: true,
    });
    if (!confirmed) return;
    setMutating(true);
    setError(null);
    const previous = payload?.files ?? [];
    const previousIndex = Math.max(
      0,
      previous.findIndex((item) => item.path === file.path)
    );
    try {
      const result = await invoke<PluginEditResult>('core', 'plugins.deleteFile', { id: pluginId, path: file.path });
      if (!result?.ok) {
        setError(result?.error?.message ?? '删除失败');
        toast(result?.error?.message ?? '删除失败', 'error');
        return;
      }
      const data = await refreshFiles();
      if (result.error) {
        setError(`文件已删除，但插件热重载失败：${result.error.message}`);
        toast('文件已删除，但插件热重载失败', 'error');
      } else {
        toast(file.overridden ? '已删除覆盖文件' : '文件已删除，可在「已删除文件」中恢复', 'success');
      }
      if (pathRef.current === file.path) {
        const remaining = data?.files ?? previous.filter((item) => item.path !== file.path);
        if (remaining.some((item) => item.path === file.path)) {
          // 只是删除了覆盖层：同路径的内置版本重新可见
          const restored = remaining.find((item) => item.path === file.path);
          if (restored) await openFile(restored, true);
        } else {
          const next = remaining[Math.min(previousIndex, remaining.length - 1)] ?? remaining[0] ?? null;
          if (next && next.editable) await openFile(next, true);
          else clearEditor();
        }
      }
    } catch (err) {
      setError(errorMessage(err));
      toast(errorMessage(err), 'error');
    } finally {
      setMutating(false);
    }
  };

  const restoreDeletedFile = async (rel: string) => {
    if (mutating) return;
    setMutating(true);
    setError(null);
    try {
      const result = await invoke<PluginEditResult>('core', 'plugins.restoreDeleted', { id: pluginId, path: rel });
      if (!result?.ok) {
        setError(result?.error?.message ?? '恢复失败');
        toast(result?.error?.message ?? '恢复失败', 'error');
        return;
      }
      const data = await refreshFiles();
      if (result.error) {
        setError(`已恢复文件，但插件热重载失败：${result.error.message}`);
        toast('已恢复文件，但插件热重载失败', 'error');
      } else {
        toast(`已恢复 ${rel}`, 'success');
      }
      const target = data?.files.find((file) => file.path === rel);
      if (target && target.editable && !pathRef.current) await openFile(target, true);
    } catch (err) {
      setError(errorMessage(err));
      toast(errorMessage(err), 'error');
    } finally {
      setMutating(false);
    }
  };

  /* -------------------------------------------------------- 文件列表宽度拖拽 */

  const startResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      resizeCleanupRef.current?.();
      const startX = event.clientX;
      const startWidth = filesWidth;
      const onMove = (moveEvent: PointerEvent) => {
        const next = Math.round(
          Math.min(MAX_FILES_WIDTH, Math.max(MIN_FILES_WIDTH, startWidth + moveEvent.clientX - startX))
        );
        setFilesWidth(next);
      };
      const cleanup = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onStop);
        window.removeEventListener('pointercancel', onStop);
        document.body.classList.remove('editor-resizing');
        resizeCleanupRef.current = null;
      };
      const onStop = () => {
        cleanup();
        // 容器尺寸变化后让 CodeMirror 重新测量
        requestAnimationFrame(() => viewRef.current?.requestMeasure());
      };
      document.body.classList.add('editor-resizing');
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onStop);
      window.addEventListener('pointercancel', onStop);
      resizeCleanupRef.current = cleanup;
    },
    [filesWidth]
  );

  const files = payload?.files ?? [];
  const busy = saving || reloading || loadingFile || mutating;
  const statusText = loadError
    ? loadError
    : currentPath
      ? `${currentPath} · ${fileInfo ? languageLabel(fileInfo.language) : ''}`
      : '未选择文件';

  return (
    <div className={`settings-shell editor-shell${fullscreen ? ' is-fullscreen' : ''}`}>
      <div className="editor-toolbar">
        <div className="editor-badges">
          <span className="tk-badge mono">{pluginId}</span>
          {payload?.customized ? <span className="tk-badge accent">已自定义</span> : null}
          {fileInfo?.overridden ? <span className="tk-badge accent">已覆盖</span> : null}
          {dirty ? <span className="tk-badge success">已修改</span> : null}
          {fileInfo ? <span className="tk-badge">{languageLabel(fileInfo.language)}</span> : null}
        </div>
        <div className="editor-actions">
          <button
            type="button"
            className="tk-btn sm"
            onClick={() => void openCreateDialog()}
            disabled={mutating || !payload}
            title="在覆盖层新建文件（支持子目录）"
          >
            <Icon name="plus" size={12} />
            新建文件
          </button>
          <button
            type="button"
            className="tk-btn sm primary"
            onClick={() => void save()}
            disabled={!currentPath || saving || reloading || !dirty || mutating}
            title="保存并应用（Ctrl+S）"
          >
            <Icon name="check" size={12} />
            {saving ? '保存中…' : '保存并应用'}
          </button>
          <button
            type="button"
            className="tk-btn sm ghost"
            onClick={() => void restoreFile()}
            disabled={!currentPath || busy}
            title="恢复此文件默认"
          >
            <Icon name="refresh" size={12} />
            恢复默认
          </button>
          <button
            type="button"
            className="tk-icon-btn"
            onClick={() => void refreshList()}
            disabled={busy}
            title="刷新文件列表"
            aria-label="刷新文件列表"
          >
            <Icon name="refresh" size={14} />
          </button>
          <button
            type="button"
            className={`tk-icon-btn${fullscreen ? ' active' : ''}`}
            onClick={() => setFullscreen((value) => !value)}
            disabled={mutating}
            title={fullscreen ? '退出全屏编辑（Esc）' : '全屏编辑（隐藏文件列表）'}
            aria-label={fullscreen ? '退出全屏编辑' : '全屏编辑'}
            aria-pressed={fullscreen}
          >
            <Icon name="monitor" size={14} />
          </button>
          <button
            type="button"
            className="tk-icon-btn"
            onClick={() => void reloadPlugin()}
            disabled={reloading}
            title="重新加载插件"
            aria-label="重新加载插件"
          >
            <Icon name="bolt" size={14} />
          </button>
          <button type="button" className="tk-icon-btn" onClick={() => void closeEditor()} title="关闭编辑器" aria-label="关闭编辑器">
            <Icon name="close" size={14} />
          </button>
        </div>
      </div>

      {error ? (
        <div className="editor-error">
          <Icon name="info" size={13} />
          <span>{error}</span>
          <button type="button" className="editor-error-close" onClick={() => setError(null)} aria-label="关闭错误提示">
            <Icon name="close" size={11} />
          </button>
        </div>
      ) : null}

      <div className="editor-body">
        {!fullscreen ? (
          <>
            <aside
              className="editor-files"
              aria-label="插件文件列表"
              style={{ width: `${filesWidth}px` }}
            >
              <div className="editor-files-list">
                {files.length ? (
                  files.map((file) => {
                    const active = file.path === currentPath;
                    return (
                      <div
                        key={file.path}
                        className={`editor-file${active ? ' active' : ''}${file.editable ? '' : ' readonly'}`}
                      >
                        <button
                          type="button"
                          className="editor-file-open"
                          title={file.editable ? file.path : `${file.path}（不可编辑）`}
                          disabled={mutating}
                          onClick={() => void openFile(file)}
                        >
                          <span className={`editor-file-dot${file.overridden ? ' on' : ''}`} />
                          <span className="editor-file-name">{file.path}</span>
                          <span className="editor-file-size">{formatBytes(file.size)}</span>
                        </button>
                        <button
                          type="button"
                          className="editor-file-del"
                          title={`删除 ${file.path}`}
                          aria-label={`删除 ${file.path}`}
                          disabled={mutating}
                          onClick={(event) => {
                            event.stopPropagation();
                            void requestDeleteFile(file);
                          }}
                        >
                          <Icon name="trash" size={11} />
                        </button>
                      </div>
                    );
                  })
                ) : (
                  <div className="editor-files-empty">{loadError ? '无法读取文件' : payload ? '暂无文件' : '加载中…'}</div>
                )}
              </div>

              {deletedFiles.length ? (
                <div className="editor-deleted" aria-label="已删除文件">
                  <div className="editor-deleted-head">
                    <Icon name="trash" size={10} />
                    <span>已删除 · {deletedFiles.length}</span>
                  </div>
                  {deletedFiles.map((rel) => (
                    <div className="editor-deleted-item" key={rel}>
                      <span className="editor-deleted-name" title={rel}>
                        {rel}
                      </span>
                      <button
                        type="button"
                        className="editor-deleted-restore"
                        title={`恢复 ${rel}`}
                        aria-label={`恢复 ${rel}`}
                        disabled={mutating}
                        onClick={() => void restoreDeletedFile(rel)}
                      >
                        <Icon name="refresh" size={10} />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </aside>
            <div
              className="editor-splitter"
              role="separator"
              aria-orientation="vertical"
              aria-label="调整文件列表宽度"
              title="拖动调整文件列表宽度，双击恢复默认"
              onPointerDown={startResize}
              onDoubleClick={() => setFilesWidth(DEFAULT_FILES_WIDTH)}
            />
          </>
        ) : null}

        <div className="editor-main">
          <div ref={hostRef} className="editor-cm-host" />
          {!payload && !loadError ? (
            <div className="editor-overlay">
              <span className="spinner" />
              <span>正在读取插件文件…</span>
            </div>
          ) : null}
          {loadError ? (
            <div className="editor-overlay editor-overlay-error">
              <Icon name="info" size={22} />
              <span>{loadError}</span>
              <button type="button" className="tk-btn sm" onClick={() => void loadPlugin()}>
                重试
              </button>
            </div>
          ) : null}
          {payload && !currentPath && !loadingFile ? (
            <div className="editor-overlay">
              <Icon name="code" size={22} />
              <span>请选择左侧文件开始编辑</span>
            </div>
          ) : null}
          {loadingFile ? (
            <div className="editor-overlay soft">
              <span className="spinner" />
            </div>
          ) : null}
        </div>
      </div>

      <div className="editor-status" title={statusText}>
        <span className="editor-status-path">{statusText}</span>
        <span className="editor-status-tip">
          {fullscreen ? 'Esc 退出全屏 · Ctrl+S 保存' : 'Ctrl+S 保存 · 自动语法校验与热重载'}
        </span>
      </div>

      {showCreate ? (
        <Modal
          title="新建文件"
          width={440}
          onClose={closeCreateDialog}
          footer={
            <>
              <button type="button" className="tk-btn" onClick={closeCreateDialog} disabled={mutating}>
                取消
              </button>
              <button
                type="button"
                className="tk-btn primary"
                onClick={() => void submitCreate()}
                disabled={mutating || !newPath.trim()}
              >
                {mutating ? '创建中…' : '创建文件'}
              </button>
            </>
          }
        >
          <div className="editor-create-form">
            <label className="editor-create-label" htmlFor="editor-create-path">
              文件路径
            </label>
            <input
              id="editor-create-path"
              className="tk-input"
              value={newPath}
              placeholder="lib/helpers.js"
              spellCheck={false}
              autoComplete="off"
              autoFocus
              disabled={mutating}
              onChange={(event) => setNewPath(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void submitCreate();
                }
              }}
            />
            <div className="editor-create-hint">相对插件目录，支持子目录（如 lib/utils.js）；文件写入用户覆盖层，不修改内置文件。</div>

            <span className="editor-create-label">初始模板</span>
            <div className="editor-template-grid" role="group" aria-label="初始模板">
              {TEMPLATE_OPTIONS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={`editor-template${template === option.key ? ' active' : ''}`}
                  title={option.hint}
                  aria-pressed={template === option.key}
                  disabled={mutating}
                  onClick={() => {
                    setTemplate(option.key);
                    setNewPath((prev) => (prev.trim() ? withTemplateExtension(prev.trim(), option.key) : prev));
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {createError ? <div className="form-error">{createError}</div> : null}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

export function PluginEditorPage({ pluginId, onDone }: { pluginId: string; onDone: () => void }) {
  return (
    <ConfirmProvider>
      <EditorInner pluginId={pluginId} onDone={onDone} />
    </ConfirmProvider>
  );
}
