/** 流光搜索 · 结果卡片与骨架屏 */
import type { MouseEvent } from 'react';
import type { SearchResult } from '@shared/search';
import { Favicon } from './Favicon';
import { Icon } from './Icon';
import { engineLabel, prettyUrl } from '../lib/format';

export function ResultCard({
  result,
  bookmarked,
  onOpen,
  onDownload,
  onBookmark,
  onContextMenu,
}: {
  result: SearchResult;
  bookmarked: boolean;
  onOpen: (result: SearchResult) => void;
  onDownload: (result: SearchResult) => void;
  onBookmark: (result: SearchResult) => void;
  onContextMenu?: (event: MouseEvent<HTMLElement>) => void;
}) {
  return (
    <article className="s-result" onContextMenu={onContextMenu}>
      <Favicon url={result.url} label={result.title} size={32} />
      <div className="s-result-main">
        <div className="s-result-head">
          <button type="button" className="s-result-title" title={result.title} onClick={() => onOpen(result)}>
            {result.title}
          </button>
          <span className="s-engine-chip">{engineLabel(result.engine)}</span>
          {result.downloadable ? <span className="s-tag download">可下载</span> : null}
        </div>
        <button type="button" className="s-result-url" title={result.url} onClick={() => onOpen(result)}>
          <Icon name="link" size={11} />
          <span>{result.displayUrl || prettyUrl(result.url)}</span>
        </button>
        {result.snippet ? <p className="s-result-snippet">{result.snippet}</p> : null}
      </div>
      <div className="s-result-actions">
        <button type="button" className="s-icon-btn" title="在浏览器中打开" onClick={() => onOpen(result)}>
          <Icon name="external" size={15} />
        </button>
        <button
          type="button"
          className={`s-icon-btn${bookmarked ? ' active' : ''}`}
          title={bookmarked ? '取消收藏' : '收藏此结果'}
          aria-pressed={bookmarked}
          onClick={() => onBookmark(result)}
        >
          <Icon name={bookmarked ? 'bookmarkFilled' : 'bookmark'} size={15} />
        </button>
        <button
          type="button"
          className={`s-download-chip${result.downloadable ? ' strong' : ''}`}
          title={result.downloadable ? '下载此文件' : '下载此链接'}
          onClick={() => onDownload(result)}
        >
          <Icon name="download" size={14} />
          <span>下载</span>
        </button>
      </div>
    </article>
  );
}

export function ResultSkeleton() {
  return (
    <div className="s-result skeleton" aria-hidden="true">
      <span className="s-skeleton-favicon" />
      <div className="s-result-main">
        <span className="s-skeleton-line w60" />
        <span className="s-skeleton-line w34" />
        <span className="s-skeleton-line w92" />
        <span className="s-skeleton-line w78" />
      </div>
    </div>
  );
}
