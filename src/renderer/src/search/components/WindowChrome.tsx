/** 流光搜索 · 顶部自定义标题栏（品牌 + 中央 mini 搜索 + 窗口控制） */
import type { RefObject } from 'react';
import { Icon } from './Icon';
import { SearchBox } from './SearchBox';
import { engineLabel } from '../lib/format';
import type { SearchEngine } from '@shared/search';

export interface WindowChromeProps {
  query: string;
  engine?: SearchEngine;
  maximized: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
  onQueryChange: (value: string) => void;
  onSubmit: (query: string) => void;
  onMinimize: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}

export function WindowChrome({
  query,
  engine,
  maximized,
  inputRef,
  onQueryChange,
  onSubmit,
  onMinimize,
  onToggleMaximize,
  onClose,
}: WindowChromeProps) {
  return (
    <header className="s-titlebar">
      <div className="s-brand">
        <span className="s-brand-mark" aria-hidden="true">
          <Icon name="sparkle" size={16} />
        </span>
        <span className="s-brand-text">
          <b>流光搜索</b>
          <span>Search &amp; Download</span>
        </span>
      </div>

      <div className="s-titlebar-search">
        <SearchBox
          variant="mini"
          value={query}
          onChange={onQueryChange}
          onSubmit={onSubmit}
          placeholder="快速搜索…"
          engineLabel={engineLabel(engine)}
          inputRef={inputRef}
        />
      </div>

      <div className="s-window-actions">
        <button type="button" className="s-window-btn" title="最小化" aria-label="最小化" onClick={onMinimize}>
          <Icon name="minimize" size={14} strokeWidth={1.6} />
        </button>
        <button
          type="button"
          className="s-window-btn"
          title={maximized ? '还原' : '最大化'}
          aria-label={maximized ? '还原' : '最大化'}
          onClick={onToggleMaximize}
        >
          <Icon name={maximized ? 'restore' : 'maximize'} size={13} strokeWidth={1.6} />
        </button>
        <button type="button" className="s-window-btn close" title="关闭" aria-label="关闭" onClick={onClose}>
          <Icon name="close" size={15} strokeWidth={1.6} />
        </button>
      </div>
    </header>
  );
}
