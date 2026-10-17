import { useEffect, useState, type CSSProperties } from 'react';
import type { PluginEditResult, PluginRuntimeInfo } from '@shared/types';
import { invoke, toast, usePlugins } from '../../lib/bridge';
import { Icon, PluginGlyph, pluginAccent } from '../../ui/Icon';
import { Modal, Switch, errorMessage, openAppPath, useConfirm } from './common';

const ID_RE = /^[a-z][a-z0-9-]{1,31}$/;

interface NewPluginForm {
  id: string;
  name: string;
  description: string;
}

const EMPTY_FORM: NewPluginForm = { id: '', name: '', description: '' };

export function PluginsTab({ onOpenEditor }: { onOpenEditor: (pluginId: string) => void }) {
  const plugins = usePlugins();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<NewPluginForm>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [justCreated, setJustCreated] = useState<string | null>(null);

  const enabledCount = plugins.filter((plugin) => plugin.enabled).length;

  useEffect(() => {
    if (!justCreated) return undefined;
    const timer = window.setTimeout(() => setJustCreated(null), 4000);
    return () => window.clearTimeout(timer);
  }, [justCreated]);

  const run = async (key: string, task: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    try {
      await task();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  };

  const toggle = (plugin: PluginRuntimeInfo, enabled: boolean) =>
    run(`toggle:${plugin.id}`, async () => {
      await invoke('core', 'plugins.setEnabled', { id: plugin.id, enabled });
      toast(enabled ? `已启用「${plugin.manifest.name}」` : `已禁用「${plugin.manifest.name}」`, 'success');
    });

  const reload = (plugin: PluginRuntimeInfo) =>
    run(`reload:${plugin.id}`, async () => {
      const result = await invoke<PluginEditResult>('core', 'plugins.reload', { id: plugin.id });
      if (result?.ok) toast(`「${plugin.manifest.name}」已重新加载`, 'success');
      else toast(result?.error?.message ?? '插件重新加载失败，请查看日志', 'error');
    });

  const openDir = (plugin: PluginRuntimeInfo) =>
    run(`dir:${plugin.id}`, async () => {
      await invoke('core', 'plugins.openDir', { id: plugin.id });
    });

  const restore = async (plugin: PluginRuntimeInfo) => {
    const ok = await confirm({
      title: '恢复插件默认',
      message: `将删除「${plugin.manifest.name}」的全部自定义覆盖文件并重新加载，内置原文件不受影响。`,
      confirmText: '恢复默认',
      danger: true,
    });
    if (!ok) return;
    await run(`restore:${plugin.id}`, async () => {
      const result = await invoke<PluginEditResult>('core', 'plugins.restore', { id: plugin.id });
      if (result?.ok) toast(`「${plugin.manifest.name}」已恢复默认`, 'success');
      else toast(result?.error?.message ?? '恢复失败', 'error');
    });
  };

  const remove = async (plugin: PluginRuntimeInfo) => {
    const ok = await confirm({
      title: '删除插件',
      message: `「${plugin.manifest.name}」及其全部文件将被永久删除，无法撤销。`,
      confirmText: '删除',
      danger: true,
    });
    if (!ok) return;
    await run(`delete:${plugin.id}`, async () => {
      await invoke('core', 'plugins.delete', { id: plugin.id });
      toast(`已删除「${plugin.manifest.name}」`, 'success');
    });
  };

  const importPlugin = () =>
    run('import', async () => {
      const plugin = await invoke<PluginRuntimeInfo | null>('core', 'plugins.import');
      if (plugin) toast(`已导入「${plugin.manifest.name}」`, 'success');
      else toast('已取消导入', 'info');
    });

  const createPlugin = async () => {
    const id = form.id.trim().toLowerCase();
    const name = form.name.trim() || id;
    if (!ID_RE.test(id)) {
      setFormError('插件 ID 需为 2-32 位小写字母 / 数字 / 连字符，且以字母开头');
      return;
    }
    setFormError('');
    setBusy('create');
    try {
      const plugin = await invoke<PluginRuntimeInfo>('core', 'plugins.create', {
        id,
        name,
        description: form.description.trim() || undefined,
      });
      setCreating(false);
      setForm(EMPTY_FORM);
      setJustCreated(plugin.id);
      toast(`已创建「${plugin.manifest.name}」，点击“编辑”开始定制`, 'success');
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <div className="plugins-toolbar">
        <div className="plugins-count">
          共 {plugins.length} 个插件 · {enabledCount} 个启用
        </div>
        <div className="plugins-toolbar-actions">
          <button
            type="button"
            className="tk-btn sm primary"
            onClick={() => {
              setForm(EMPTY_FORM);
              setFormError('');
              setCreating(true);
            }}
            disabled={!!busy}
          >
            <Icon name="plus" size={12} />
            新建
          </button>
          <button type="button" className="tk-btn sm" onClick={() => void importPlugin()} disabled={!!busy}>
            <Icon name="download" size={12} />
            {busy === 'import' ? '导入中…' : '导入'}
          </button>
          <button type="button" className="tk-icon-btn" title="打开插件目录" aria-label="打开插件目录" onClick={() => void openAppPath('plugins')}>
            <Icon name="folder" size={14} />
          </button>
        </div>
      </div>

      {plugins.length ? (
        <div className="plugin-list">
          {plugins.map((plugin) => {
            const errorText = plugin.error?.trim();
            const isBusy = !!busy && busy.endsWith(`:${plugin.id}`);
            const status = errorText
              ? { label: '错误', tone: 'danger' }
              : plugin.enabled
                ? plugin.loaded
                  ? { label: '已加载', tone: 'success' }
                  : { label: '未加载', tone: '' }
                : { label: '已禁用', tone: '' };
            return (
              <div
                key={plugin.id}
                className={`plugin-card${plugin.enabled ? '' : ' disabled'}${justCreated === plugin.id ? ' just-created' : ''}`}
              >
                <div className="plugin-head">
                  <span
                    className="plugin-icon"
                    style={
                      {
                        '--plugin-rgb': pluginAccent(plugin),
                        '--plugin-accent': plugin.manifest.accent || '#4C8DFF',
                      } as CSSProperties
                    }
                  >
                    <PluginGlyph plugin={plugin} size={18} />
                  </span>
                  <div className="plugin-main">
                    <div className="plugin-name-line">
                      <span className="plugin-name">{plugin.manifest.name}</span>
                      <span className="plugin-version">v{plugin.manifest.version}</span>
                    </div>
                    <div className="plugin-badges">
                      <span className="tk-badge">{plugin.source === 'builtin' ? '内置' : '用户'}</span>
                      <span className={`tk-badge${status.tone ? ` ${status.tone}` : ''}`}>{status.label}</span>
                      {plugin.customized ? <span className="tk-badge accent">已自定义</span> : null}
                      {!plugin.hasUI ? <span className="tk-badge">无界面</span> : null}
                    </div>
                  </div>
                  <Switch
                    checked={plugin.enabled}
                    disabled={!!busy}
                    onChange={(next) => void toggle(plugin, next)}
                    label={`启用 ${plugin.manifest.name}`}
                  />
                </div>

                {errorText ? (
                  <div className="plugin-error" title={errorText}>
                    <Icon name="info" size={12} />
                    <span>{errorText}</span>
                  </div>
                ) : null}

                <div className="plugin-actions">
                  <button type="button" className="tk-btn sm" onClick={() => onOpenEditor(plugin.id)} disabled={!!busy}>
                    <Icon name="code" size={12} />
                    编辑
                  </button>
                  <button type="button" className="tk-btn sm ghost" onClick={() => void reload(plugin)} disabled={!!busy}>
                    <Icon name="refresh" size={12} />
                    {isBusy && busy === `reload:${plugin.id}` ? '重载中…' : '重载'}
                  </button>
                  <button type="button" className="tk-btn sm ghost" onClick={() => void openDir(plugin)} disabled={!!busy}>
                    <Icon name="folder" size={12} />
                    目录
                  </button>
                  {plugin.customized ? (
                    <button type="button" className="tk-btn sm ghost" onClick={() => void restore(plugin)} disabled={!!busy}>
                      <Icon name="refresh" size={12} />
                      恢复
                    </button>
                  ) : null}
                  {plugin.source === 'user' ? (
                    <button type="button" className="tk-btn sm danger" onClick={() => void remove(plugin)} disabled={!!busy}>
                      <Icon name="trash" size={12} />
                      删除
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="tk-empty">
          <Icon name="plugin" size={26} />
          <div>还没有发现插件</div>
          <div>点击「新建」从模板创建，或「导入」已有插件目录</div>
        </div>
      )}

      {creating ? (
        <Modal
          title="新建插件"
          onClose={() => setCreating(false)}
          footer={
            <>
              <button type="button" className="tk-btn" onClick={() => setCreating(false)} disabled={busy === 'create'}>
                取消
              </button>
              <button type="button" className="tk-btn primary" onClick={() => void createPlugin()} disabled={busy === 'create'}>
                {busy === 'create' ? '创建中…' : '创建插件'}
              </button>
            </>
          }
        >
          <div className="form-field">
            <label className="field-label" htmlFor="new-plugin-id">
              插件 ID
            </label>
            <input
              id="new-plugin-id"
              className="tk-input"
              value={form.id}
              placeholder="例如 my-tool"
              autoFocus
              onChange={(event) => setForm((current) => ({ ...current, id: event.currentTarget.value }))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void createPlugin();
                }
              }}
            />
            <div className="field-hint">小写字母开头，可包含数字与连字符，创建后不可修改</div>
          </div>
          <div className="form-field">
            <label className="field-label" htmlFor="new-plugin-name">
              显示名称
            </label>
            <input
              id="new-plugin-name"
              className="tk-input"
              value={form.name}
              placeholder="例如 我的小工具"
              onChange={(event) => setForm((current) => ({ ...current, name: event.currentTarget.value }))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void createPlugin();
                }
              }}
            />
          </div>
          <div className="form-field">
            <label className="field-label" htmlFor="new-plugin-desc">
              简介
            </label>
            <textarea
              id="new-plugin-desc"
              className="tk-input tk-textarea"
              value={form.description}
              placeholder="一句话说明这个工具能做什么（可选）"
              onChange={(event) => setForm((current) => ({ ...current, description: event.currentTarget.value }))}
            />
          </div>
          <div className="field-hint">创建后会生成 plugin.json / main.js / index.html / app.js / style.css / icon.svg 模板</div>
          {formError ? <div className="form-error">{formError}</div> : null}
        </Modal>
      ) : null}
    </>
  );
}
