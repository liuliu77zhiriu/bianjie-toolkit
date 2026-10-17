import { useState } from 'react';
import type { Settings } from '@shared/types';
import { invoke, toast, useAppInfo } from '../../lib/bridge';
import { Icon } from '../../ui/Icon';
import { Group, Row, errorMessage, openAppPath, useConfirm } from './common';

interface DirectoryEntry {
  label: string;
  kind: 'userData' | 'logs' | 'screenshots' | 'recordings';
  value: string;
}

export function AboutTab({ settings }: { settings: Settings }) {
  const info = useAppInfo();
  const confirm = useConfirm();
  const [busy, setBusy] = useState<string | null>(null);

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

  const exportSettings = () =>
    run('export', async () => {
      const file = await invoke<string | null>('core', 'settings.export');
      if (file) toast(`设置已导出到 ${file}`, 'success');
      else toast('已取消导出', 'info');
    });

  const importSettings = async () => {
    const ok = await confirm({
      title: '导入设置',
      message: '导入会覆盖当前全部设置项，建议先导出备份当前设置。',
      confirmText: '选择文件导入',
    });
    if (!ok) return;
    await run('import', async () => {
      const next = await invoke<Settings | null>('core', 'settings.import');
      if (next) toast('设置已导入并立即生效', 'success');
      else toast('已取消导入', 'info');
    });
  };

  const relaunch = async () => {
    const ok = await confirm({ title: '重启应用', message: '应用会立即关闭并重新启动。', confirmText: '重新启动' });
    if (!ok) return;
    await run('relaunch', async () => {
      await invoke('core', 'app.relaunch');
    });
  };

  const quit = async () => {
    const ok = await confirm({ title: '退出应用', message: '退出后悬浮球、全局快捷键都将停止工作。', confirmText: '退出', danger: true });
    if (!ok) return;
    await run('quit', async () => {
      await invoke('core', 'app.quit');
    });
  };

  const directories: DirectoryEntry[] = info
    ? [
        { label: '用户数据目录', kind: 'userData', value: info.paths.userData },
        { label: '日志目录', kind: 'logs', value: info.paths.logs },
        { label: '截图目录', kind: 'screenshots', value: settings.capture.saveDir || info.paths.screenshots },
        { label: '录制目录', kind: 'recordings', value: settings.recorder.saveDir || info.paths.recordings },
      ]
    : [];

  return (
    <>
      <Group title="应用信息">
        <Row title="应用名称" desc={info?.isPackaged ? '正式打包版本' : '开发调试版本'}>
          <span className="info-value">{info?.name ?? '便捷工具'}</span>
        </Row>
        <Row title="应用版本">
          <span className="info-value mono">v{info?.version ?? '—'}</span>
        </Row>
        <div className="info-grid">
          <div className="info-cell">
            <span className="info-cell-label">Electron</span>
            <span className="info-cell-value mono">{info?.electron ?? '—'}</span>
          </div>
          <div className="info-cell">
            <span className="info-cell-label">Chromium</span>
            <span className="info-cell-value mono">{info?.chrome ?? '—'}</span>
          </div>
          <div className="info-cell">
            <span className="info-cell-label">Node.js</span>
            <span className="info-cell-value mono">{info?.node ?? '—'}</span>
          </div>
          <div className="info-cell">
            <span className="info-cell-label">平台</span>
            <span className="info-cell-value">{info ? `${info.platform === 'win32' ? 'Windows' : info.platform} · ${info.locale}` : '—'}</span>
          </div>
        </div>
      </Group>

      <Group title="目录">
        {directories.map((entry) => (
          <div key={entry.kind} className="dir-row">
            <div className="dir-main">
              <div className="row-title">{entry.label}</div>
              <div className="dir-path" title={entry.value}>
                {entry.value}
              </div>
            </div>
            <button type="button" className="tk-btn sm ghost" onClick={() => void openAppPath(entry.kind)}>
              <Icon name="external" size={12} />
              打开
            </button>
          </div>
        ))}
      </Group>

      <Group title="设置备份">
        <Row title="导出设置" desc="将当前全部设置保存为 JSON 文件">
          <button type="button" className="tk-btn sm" onClick={() => void exportSettings()} disabled={!!busy}>
            <Icon name="download" size={12} />
            {busy === 'export' ? '导出中…' : '导出'}
          </button>
        </Row>
        <Row title="导入设置" desc="从 JSON 文件恢复设置，会覆盖当前配置">
          <button type="button" className="tk-btn sm" onClick={() => void importSettings()} disabled={!!busy}>
            <Icon name="copy" size={12} />
            {busy === 'import' ? '导入中…' : '导入'}
          </button>
        </Row>
      </Group>

      <Group title="应用操作">
        <Row title="重启应用" desc="重新加载主进程与全部插件">
          <button type="button" className="tk-btn sm" onClick={() => void relaunch()} disabled={!!busy}>
            <Icon name="refresh" size={12} />
            重启
          </button>
        </Row>
        <Row title="退出应用" desc="完全退出便捷工具，可再次从开始菜单启动">
          <button type="button" className="tk-btn sm danger" onClick={() => void quit()} disabled={!!busy}>
            <Icon name="power" size={12} />
            退出
          </button>
        </Row>
      </Group>

      <div className="settings-note about-foot">
        <Icon name="sparkle" size={12} />
        便捷工具 · 轻量、稳定、可扩展
      </div>
    </>
  );
}
