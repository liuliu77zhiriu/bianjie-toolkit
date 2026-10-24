/** 流光搜索 · 左侧悬浮玻璃图标栏 */
import { Icon, type IconName } from './Icon';

export type SearchTab = 'search' | 'downloads' | 'history' | 'bookmarks' | 'settings';

const NAV: Array<{ key: SearchTab; label: string; icon: IconName; hint: string }> = [
  { key: 'search', label: '搜索', icon: 'search', hint: '搜索网页' },
  { key: 'downloads', label: '下载', icon: 'download', hint: '下载队列' },
  { key: 'history', label: '历史', icon: 'history', hint: '搜索历史' },
  { key: 'bookmarks', label: '书签', icon: 'bookmark', hint: '收藏结果' },
  { key: 'settings', label: '设置', icon: 'settings', hint: '搜索与下载设置' },
];

export function Sidebar({
  active,
  onChange,
  badge,
}: {
  active: SearchTab;
  onChange: (tab: SearchTab) => void;
  badge?: number;
}) {
  return (
    <aside className="s-rail" aria-label="主导航">
      <div className="s-rail-nav" role="tablist" aria-orientation="vertical">
        {NAV.map((item) => {
          const activeItem = active === item.key;
          return (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={activeItem}
              className={`s-rail-btn${activeItem ? ' active' : ''}`}
              data-label={item.hint}
              onClick={() => onChange(item.key)}
            >
              <span className="s-rail-icon">
                <Icon name={item.icon} size={19} />
              </span>
              {item.key === 'downloads' && badge && badge > 0 ? (
                <span className="s-rail-badge">{badge > 99 ? '99+' : badge}</span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="s-rail-foot" aria-hidden="true">
        <span className="s-rail-dot" />
      </div>
    </aside>
  );
}
