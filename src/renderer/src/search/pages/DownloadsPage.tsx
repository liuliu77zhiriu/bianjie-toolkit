/** 流光搜索 · 下载队列页（粘贴 URL / 保存目录 / 进度 / 暂停恢复取消重试打开） */
import { useMemo, useState, type FormEvent } from 'react';
import type { DownloadItem, SearchPaths, SearchSettings } from '@shared/search';
import { Icon } from '../components/Icon';
import { DownloadRow } from '../components/DownloadRow';
import { downloadsApi, searchApi } from '../lib/api';
import { errorText, formatBytes } from '../lib/format';
import { useConfirm } from '../lib/confirm';
import { toast } from '../lib/toast';

export interface DownloadsPageProps {
  items: DownloadItem[];
  settings: SearchSettings;
  paths: SearchPaths | null;
  changedId?: string;
  loading: boolean;
  onItemsChange: (items: DownloadItem[]) => void;
  onSettingsChange: (settings: SearchSettings) => void;
}

const PRIORITY: Record<DownloadItem['status'], number> = {
  downloading: 0,
  paused: 1,
  queued: 2,
  error: 3,
  canceled: 4,
  completed: 5,
};

export function DownloadsPage({
  items,
  settings,
  paths,
  changedId,
  loading,
  onItemsChange,
  onSettingsChange,
}: DownloadsPageProps) {
  const confirm = useConfirm();
  const [draft, setDraft] = useState('');
  const [starting, setStarting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);

  const { activeItems, completedItems } = useMemo(() => {
    const sorted = [...items].sort((a, b) => {
      const rank = PRIORITY[a.status] - PRIORITY[b.status];
      if (rank !== 0) return rank;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    return {
      activeItems: sorted.filter((item) => item.status !== 'completed'),
      completedItems: sorted.filter((item) => item.status === 'completed'),
    };
  }, [items]);

  const activeCount = activeItems.filter((item) => item.status === 'downloading' || item.status === 'queued').length;
  const completedCount = completedItems.length;
  const saveDir = settings.saveDir || paths?.saveDir || paths?.downloads || '';

  const start = async (event?: FormEvent) => {
    event?.preventDefault();
    const url = draft.trim();
    if (!url) {
      toast('请先粘贴下载链接', 'error');
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      toast('仅支持 http / https 链接', 'error');
      return;
    }
    if (starting) return;
    setStarting(true);
    try {
      await downloadsApi.start({ url, source: 'manual' });
      setDraft('');
      toast('已加入下载队列', 'success');
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setStarting(false);
    }
  };

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setDraft(text.trim());
        toast('已粘贴链接', 'success');
      } else {
        toast('剪贴板为空', 'info');
      }
    } catch {
      toast('无法读取剪贴板，请直接在输入框按 Ctrl+V', 'info');
    }
  };

  const pickDir = async () => {
    if (picking) return;
    setPicking(true);
    try {
      const dir = await searchApi.pickDir();
      if (dir) {
        const next = await searchApi.patchSettings({ saveDir: dir });
        onSettingsChange(next);
        toast('下载目录已更新', 'success');
      }
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setPicking(false);
    }
  };

  const openFolder = async () => {
    try {
      await downloadsApi.openFolder();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  };

  const mutate = async (id: string, action: () => Promise<DownloadItem[]>, message?: string) => {
    if (busyId) return;
    setBusyId(id);
    try {
      const next = await action();
      onItemsChange(next);
      if (message) toast(message, 'success');
    } catch (err) {
      toast(errorText(err), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (item: DownloadItem) => {
    if (item.status === 'completed') {
      const ok = await confirm({
        title: '从列表移除',
        message: `确定从下载列表移除「${item.name}」吗？\n已下载的文件不会被删除。`,
        confirmText: '移除',
      });
      if (!ok) return;
    }
    await mutate(item.id, () => downloadsApi.remove(item.id), '已从列表移除');
  };

  const clearCompleted = async () => {
    if (!completedCount) return;
    const ok = await confirm({
      title: '清空已完成',
      message: `确定移除 ${completedCount} 条已完成记录吗？已下载的文件不会被删除。`,
      confirmText: '清空',
      danger: true,
    });
    if (!ok) return;
    try {
      const next = await downloadsApi.clearCompleted();
      onItemsChange(next);
      toast('已清空完成记录', 'success');
    } catch (err) {
      toast(errorText(err), 'error');
    }
  };

  const rowProps = (item: DownloadItem) => ({
    item,
    busy: busyId === item.id,
    highlight: changedId === item.id,
    onPause: (target: DownloadItem) => void mutate(target.id, () => downloadsApi.pause(target.id), '已暂停'),
    onResume: (target: DownloadItem) => void mutate(target.id, () => downloadsApi.resume(target.id), '继续下载'),
    onCancel: (target: DownloadItem) => void mutate(target.id, () => downloadsApi.cancel(target.id), '已取消下载'),
    onRetry: (target: DownloadItem) => void mutate(target.id, () => downloadsApi.retry(target.id), '重新下载'),
    onRemove: (target: DownloadItem) => void remove(target),
    onOpen: (target: DownloadItem) => {
      void downloadsApi.openFile(target.id).catch((err) => toast(errorText(err), 'error'));
    },
    onFolder: (target: DownloadItem) => {
      void downloadsApi.openFolder(target.id).catch((err) => toast(errorText(err), 'error'));
    },
  });

  return (
    <div className="s-page s-downloads-page">
      <div className="s-page-head">
        <div className="s-page-heading">
          <h2>下载队列</h2>
          <p>
            {activeCount > 0 ? `${activeCount} 个任务进行中` : '当前没有进行中的任务'}
            {completedCount > 0 ? ` · 已完成 ${completedCount}` : ''}
          </p>
        </div>
        <div className="s-page-head-actions">
          <button type="button" className="s-btn ghost" onClick={() => void openFolder()}>
            <Icon name="folder" size={14} />
            打开下载目录
          </button>
          {completedCount > 0 ? (
            <button type="button" className="s-btn ghost" onClick={() => void clearCompleted()}>
              <Icon name="trash" size={14} />
              清空已完成
            </button>
          ) : null}
        </div>
      </div>

      <form className="s-download-form" onSubmit={(event) => void start(event)}>
        <div className="s-download-input">
          <Icon name="link" size={15} />
          <input
            value={draft}
            spellCheck={false}
            placeholder="粘贴文件直链，例如 https://example.com/photo.jpg"
            aria-label="下载链接"
            onChange={(event) => setDraft(event.currentTarget.value)}
          />
          <button type="button" className="s-download-paste" onClick={() => void paste()} title="从剪贴板粘贴">
            粘贴
          </button>
        </div>
        <div className="s-download-controls">
          <button type="button" className="s-path-chip" title={saveDir ? `保存到 ${saveDir}` : '选择保存目录'} onClick={() => void pickDir()}>
            <Icon name="folder" size={13} />
            <span>{saveDir ? saveDir.split(/[\\/]/).filter(Boolean).pop() : '默认目录'}</span>
          </button>
          <button type="submit" className="s-btn primary" disabled={starting || !draft.trim()}>
            {starting ? <span className="s-spinner" /> : <Icon name="download" size={14} />}
            {starting ? '正在开始…' : '开始下载'}
          </button>
        </div>
      </form>

      {loading && !items.length ? (
        <div className="s-loading-block">
          <span className="s-spinner dark" />
          正在读取下载队列…
        </div>
      ) : null}

      {!loading && !items.length ? (
        <div className="s-empty large">
          <span className="s-empty-icon">
            <Icon name="download" size={24} />
          </span>
          <div className="s-empty-title">下载队列是空的</div>
          <div className="s-empty-desc">粘贴图片、压缩包或安装包直链，任务会在这里排队下载</div>
          <button type="button" className="s-btn ghost" onClick={() => void openFolder()}>
            <Icon name="folder" size={14} />
            查看下载文件夹
          </button>
        </div>
      ) : null}

      {activeItems.length ? (
        <section className="s-dl-section">
          <div className="s-dl-section-head">
            <span>进行中</span>
            <span className="s-dl-section-count">{activeItems.length}</span>
          </div>
          <div className="s-dl-list">
            {activeItems.map((item) => (
              <DownloadRow key={item.id} {...rowProps(item)} />
            ))}
          </div>
        </section>
      ) : null}

      {completedItems.length ? (
        <section className="s-dl-section">
          <div className="s-dl-section-head">
            <span>已完成</span>
            <span className="s-dl-section-count">{completedItems.length}</span>
            <span className="s-dl-section-total">
              共 {formatBytes(completedItems.reduce((sum, item) => sum + (item.totalBytes || item.receivedBytes || 0), 0))}
            </span>
          </div>
          <div className="s-dl-list">
            {completedItems.map((item) => (
              <DownloadRow key={item.id} {...rowProps(item)} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
