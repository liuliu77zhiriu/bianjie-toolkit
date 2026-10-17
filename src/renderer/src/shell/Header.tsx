import { Icon } from '../ui/Icon';

interface HeaderProps {
  title: string;
  subtitle: string;
  showBrand: boolean;
  canBack: boolean;
  showSettings: boolean;
  compact?: boolean;
  onBack: () => void;
  onSettings: () => void;
  onClose: () => void;
}

function BrandMark() {
  return (
    <span className="brand-mark">
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="3" y="3" width="8" height="8" rx="2.2" fill="#ffffff" fillOpacity="0.95" />
        <rect x="13" y="3" width="8" height="8" rx="2.2" fill="#ffffff" fillOpacity="0.55" />
        <rect x="3" y="13" width="8" height="8" rx="2.2" fill="#ffffff" fillOpacity="0.4" />
        <rect x="13" y="13" width="8" height="8" rx="2.2" fill="#ffffff" fillOpacity="0.92" />
      </svg>
    </span>
  );
}

export function Header({
  title,
  subtitle,
  showBrand,
  canBack,
  showSettings,
  compact = false,
  onBack,
  onSettings,
  onClose,
}: HeaderProps) {
  return (
    <header className={`panel-header${compact ? ' compact' : ''}`}>
      {canBack ? (
        <button className="tk-icon-btn" onClick={onBack} title="返回" aria-label="返回">
          <Icon name="back" size={17} />
        </button>
      ) : showBrand ? (
        <BrandMark />
      ) : null}
      {compact ? null : (
        <div className="header-titles">
          <div className="header-title">{title}</div>
          <div className="header-sub">{subtitle}</div>
        </div>
      )}
      <div className="header-actions">
        {showSettings ? (
          <button className="tk-icon-btn" onClick={onSettings} title="设置" aria-label="设置">
            <Icon name="settings" size={16} />
          </button>
        ) : null}
        <button className="tk-icon-btn close-btn" onClick={onClose} title="关闭（Esc）" aria-label="关闭">
          <Icon name="close" size={16} />
        </button>
      </div>
    </header>
  );
}
