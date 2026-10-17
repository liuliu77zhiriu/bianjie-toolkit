import type { CSSProperties } from 'react';
import type { IconName } from '../ui/Icon';
import { Icon } from '../ui/Icon';

export interface DockItem {
  id: string;
  label: string;
  icon: IconName;
}

interface DockProps {
  items: DockItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
}

export function Dock({ items, activeId, onSelect }: DockProps) {
  const activeIndex = Math.max(0, items.findIndex((item) => item.id === activeId));
  return (
    <nav
      className="panel-dock"
      style={
        {
          '--dock-count': items.length,
          '--dock-index': activeIndex,
        } as CSSProperties
      }
    >
      <span className="dock-indicator" style={{ opacity: activeId ? 1 : 0 }} />
      {items.map((item) => (
        <button
          key={item.id}
          className={`dock-item${item.id === activeId ? ' active' : ''}`}
          onClick={() => onSelect(item.id)}
          title={item.label}
        >
          <Icon name={item.icon} size={17} />
          <span className="dock-label">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

