import { useCallback, useEffect, useRef, useState } from 'react';
import { basicSetup } from 'codemirror';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { javascript } from '@codemirror/lang-javascript';
import { oneDark } from '@codemirror/theme-one-dark';
import type { PluginEditResult, PluginFileEntry, PluginFilesPayload } from '@shared/types';
import { formatBytes, invoke, toast } from '../../lib/bridge';
import { Icon } from '../../ui/Icon';
import { ConfirmProvider, errorMessage, useConfirm } from './common';

type FileLanguage = PluginFileEntry['language'];

interface ReadFileResult {
  content: string;
  overridden: boolean;
  baseContent?: string;
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
  const saveRef = useRef<() => void>(() => undefined);

  const [payload, setPayload] = useState<PluginFilesPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState<string | null>(null);
  const [fileInfo, setFileInfo] = useState<{ overridden: boolean; language: FileLanguage } | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loadingFile, setLoadingFile] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const markDirty = useCallback((value: boolean) => {
    dirtyRef.current = value;
    setDirty(value);
  }, []);

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

  /* -------------------------------------------------------- 读取文件 */

  const openFile = useCallback(
    async (file: PluginFileEntry, force = false) => {
      if (!file.editable) {
        toast('该文件为二进制或体积过大，暂不支持编辑', 'error');
        return;
      }
      if (!force && pathRef.current === file.path) return;
      if (!force && dirtyRef.current && pathRef.current && pathRef.current !== file.path) {
        const discard = await confirm({
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
    [confirm, markDirty, pluginId]
  );

  const refreshFiles = useCallback(async () => {
    try {
      const data = await invoke<PluginFilesPayload>('core', 'plugins.files', { id: pluginId });
      setPayload(data);
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
        else setError('该插件没有可编辑的文本文件');
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
    if (!view || !path || savingRef.current) return;
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
  }, [markDirty, pluginId, refreshFiles]);

  saveRef.current = () => {
    void save();
  };

  /* -------------------------------------------------------- 键盘与返回保护 */

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      event.stopPropagation();
      if (confirmingRef.current) return;
      saveRef.current();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  useEffect(() => {
    if (!dirty) return undefined;
    const askDiscard = async () => {
      if (confirmingRef.current) return;
      confirmingRef.current = true;
      try {
        const discard = await confirm({
          title: '放弃未保存的修改？',
          message: '编辑器中有尚未保存的内容，离开后会丢失。',
          confirmText: '放弃修改',
          danger: true,
        });
        if (discard) onDone();
      } finally {
        confirmingRef.current = false;
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      void askDiscard();
    };
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const back = target?.closest?.('.panel-header button[aria-label="返回"]');
      if (!back) return;
      event.preventDefault();
      event.stopPropagation();
      void askDiscard();
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('click', onClick, true);
    };
  }, [dirty, confirm, onDone]);

  const restoreFile = async () => {
    const path = pathRef.current;
    if (!path || reloading) return;
    const discard = await confirm({
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
        savedRef.current = '';
        pathRef.current = null;
        setCurrentPath(null);
        markDirty(false);
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
        const discard = await confirm({
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

  const files = payload?.files ?? [];
  const busy = saving || reloading || loadingFile;
  const statusText = loadError
    ? loadError
    : currentPath
      ? `${currentPath} · ${fileInfo ? languageLabel(fileInfo.language) : ''}`
      : '未选择文件';

  return (
    <div className="settings-shell editor-shell">
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
            className="tk-btn sm primary"
            onClick={() => void save()}
            disabled={!currentPath || saving || reloading || !dirty}
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
        <aside className="editor-files" aria-label="插件文件列表">
          {files.length ? (
            files.map((file) => {
              const active = file.path === currentPath;
              return (
                <button
                  key={file.path}
                  type="button"
                  className={`editor-file${active ? ' active' : ''}${file.editable ? '' : ' readonly'}`}
                  title={file.editable ? file.path : `${file.path}（不可编辑）`}
                  onClick={() => void openFile(file)}
                >
                  <span className={`editor-file-dot${file.overridden ? ' on' : ''}`} />
                  <span className="editor-file-name">{file.path}</span>
                  <span className="editor-file-size">{formatBytes(file.size)}</span>
                </button>
              );
            })
          ) : (
            <div className="editor-files-empty">{loadError ? '无法读取文件' : '加载中…'}</div>
          )}
        </aside>

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
        <span className="editor-status-tip">Ctrl+S 保存 · 自动语法校验与热重载</span>
      </div>
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
