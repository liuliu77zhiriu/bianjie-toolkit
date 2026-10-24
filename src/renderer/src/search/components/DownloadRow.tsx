/** 流光搜索 · 下载队列条目 */
import type { DownloadItem } from '@shared/search';
import { Icon } from './Icon';
import {
  DOWNLOAD_STATUS_LABEL,
  fileExtOf,
  formatBytes,
  formatRelative,
  formatSpeed,
  prettyUrl,
  progressOf,
} from '../lib/format';

export interface DownloadRowProps {
  item: DownloadItem;
  busy: boolean;
  highlight: boolean;
  onPause: (item: DownloadItem) => void;
  onResume: (item: DownloadItem) => void;
  onCancel: (item: DownloadItem) => void;
  onRetry: (item: DownloadItem) => void;
  onRemove: (item: DownloadItem) => void;
  onOpen: (item: DownloadItem) => void;
  onFolder: (item: DownloadItem) => void;
}

export function DownloadRow({
  item,
  busy,
  highlight,
  onPause,
  onResume,
  onCancel,
  onRetry,
  onRemove,
  onOpen,
  onFolder,
}: DownloadRowProps) {
  const progress = progressOf(item);
  const percent = Math.round(progress * 100);
  const active = item.status === 'downloading' || item.status === 'paused' || item.status === 'queued';
  const terminal = item.status === 'completed' || item.status === 'error' || item.status === 'canceled';
  const ext = fileExtOf(item.name);

  let meta = '';
  if (item.status === 'downloading') {
    const total = item.totalBytes > 0 ? formatBytes(item.totalBytes) : '未知';
    const speed = formatSpeed(item.speed);
    meta = `${formatBytes(item.receivedBytes)} / ${total}${speed ? ` · ${speed}` : ''}${item.totalBytes > 0 ? ` · ${percent}%` : ''}`;
  } else if (item.status === 'paused') {
    meta = `${formatBytes(item.receivedBytes)}${item.totalBytes > 0 ? ` / ${formatBytes(item.totalBytes)}` : ''} · 已暂停`;
  } else if (item.status === 'queued') {
    meta = '等待前面任务完成…';
  } else if (item.status === 'completed') {
    meta = `${formatBytes(item.totalBytes || item.receivedBytes)} · ${formatRelative(item.completedAt ?? item.createdAt)}`;
  } else if (item.status === 'error') {
    meta = item.error || '下载失败';
  } else {
    meta = `已取消 · ${formatBytes(item.receivedBytes)}`;
  }

  return (
    <div
      className={`s-dl-row${highlight ? ' flash' : ''}${busy ? ' busy' : ''}`}
      data-status={item.status}
    >
      <span className="s-dl-type" aria-hidden="true">
        <Icon name="file" size={18} />
        <em>{ext}</em>
      </span>

      <div className="s-dl-main">
        <div className="s-dl-head">
          <span className="s-dl-name" title={item.name}>
            {item.name}
          </span>
          <span className={`s-status-chip ${item.status}`}>{DOWNLOAD_STATUS_LABEL[item.status]}</span>
        </div>
        <div className="s-dl-url" title={item.url}>
          {prettyUrl(item.url, 94)}
        </div>
        <div className="s-dl-bar" data-status={item.status}>
          <span style={{ width: `${item.status === 'completed' ? 100 : percent}%` }} />
        </div>
        <div className={`s-dl-meta${item.status === 'error' ? ' error' : ''}`} title={meta}>
          {meta}
        </div>
      </div>

      <div className="s-dl-actions">
        {item.status === 'downloading' ? (
          <button type="button" className="s-icon-btn" title="暂停" disabled={busy} onClick={() => onPause(item)}>
            <Icon name="pause" size={15} />
          </button>
        ) : null}
        {item.status === 'paused' ? (
          <button type="button" className="s-icon-btn" title="继续下载" disabled={busy} onClick={() => onResume(item)}>
            <Icon name="play" size={15} />
          </button>
        ) : null}
        {active ? (
          <button type="button" className="s-icon-btn" title="取消下载" disabled={busy} onClick={() => onCancel(item)}>
            <Icon name="close" size={15} />
          </button>
        ) : null}
        {item.status === 'error' || item.status === 'canceled' ? (
          <button type="button" className="s-icon-btn" title="重试" disabled={busy} onClick={() => onRetry(item)}>
            <Icon name="refresh" size={15} />
          </button>
        ) : null}
        {item.status === 'completed' ? (
          <button type="button" className="s-icon-btn accent" title="打开文件" onClick={() => onOpen(item)}>
            <Icon name="external" size={15} />
          </button>
        ) : null}
        {item.status !== 'queued' ? (
          <button type="button" className="s-icon-btn" title="打开所在文件夹" onClick={() => onFolder(item)}>
            <Icon name="folder" size={15} />
          </button>
        ) : null}
        {terminal ? (
          <button type="button" className="s-icon-btn danger" title="从列表移除" disabled={busy} onClick={() => onRemove(item)}>
            <Icon name="trash" size={15} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
