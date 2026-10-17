import type { ReactNode } from 'react';
import type { PluginRuntimeInfo } from '@shared/types';

export type IconName =
  | 'home'
  | 'camera'
  | 'record'
  | 'note'
  | 'timer'
  | 'settings'
  | 'close'
  | 'back'
  | 'folder'
  | 'copy'
  | 'plus'
  | 'search'
  | 'trash'
  | 'pin'
  | 'play'
  | 'pause'
  | 'refresh'
  | 'check'
  | 'code'
  | 'plugin'
  | 'info'
  | 'monitor'
  | 'window'
  | 'mic'
  | 'volume'
  | 'stop'
  | 'download'
  | 'external'
  | 'edit'
  | 'dots'
  | 'bolt'
  | 'clock'
  | 'image'
  | 'palette'
  | 'keyboard'
  | 'database'
  | 'power'
  | 'chevron-right'
  | 'arrow-up-right'
  | 'sparkle';

const paths: Record<IconName, ReactNode> = {
  home: (
    <>
      <path d="M3.5 10.5 12 3.5l8.5 7" />
      <path d="M5.5 9.5v9a1.5 1.5 0 0 0 1.5 1.5h10a1.5 1.5 0 0 0 1.5-1.5v-9" />
      <path d="M9.5 20v-5h5v5" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7H8l1.3-2h5.4L16 7h2.5A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
      <circle cx="12" cy="13" r="3.2" />
    </>
  ),
  record: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2.5" />
      <circle cx="12" cy="12" r="3.4" />
    </>
  ),
  note: (
    <>
      <path d="M5 4.5h9.5L19 9v10.5a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 4 19.5v-13A2 2 0 0 1 5.5 4.5Z" />
      <path d="M14 4.5V9h4.5" />
      <path d="M8 13h7M8 16.5h5" />
    </>
  ),
  timer: (
    <>
      <circle cx="12" cy="13" r="7.5" />
      <path d="M12 9v4.2l2.6 1.6" />
      <path d="M9 2.5h6M12 2.5V5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 13.6a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1 1.56V20a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.11-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1H4a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.87.34H10a1.7 1.7 0 0 0 1-1.56V4a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.87V10a1.7 1.7 0 0 0 1.56 1H20a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1Z" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
  back: (
    <>
      <path d="M14.5 5.5 8 12l6.5 6.5" />
      <path d="M8.5 12H20" />
    </>
  ),
  folder: (
    <path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4l2 2.2h8A1.5 1.5 0 0 1 20.5 9.7v8.8A1.5 1.5 0 0 1 19 20H5a1.5 1.5 0 0 1-1.5-1.5Z" />
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 5.5v-1a1 1 0 0 0-1-1h-9a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h1" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.3" />
      <path d="m15.5 15.5 4.5 4.5" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 7h15M9 7V5.2A1.2 1.2 0 0 1 10.2 4h3.6A1.2 1.2 0 0 1 15 5.2V7" />
      <path d="M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12" />
      <path d="M10 11v5.5M14 11v5.5" />
    </>
  ),
  pin: (
    <>
      <path d="M9 3.5h6l-.8 5.2 3.2 3.1a1 1 0 0 1-.7 1.7H13l-.6 6.5h-.8L11 12.5H7.3a1 1 0 0 1-.7-1.7l3.2-3.1z" />
    </>
  ),
  play: <path d="M8.5 5.8v12.4L19 12z" />,
  pause: (
    <>
      <path d="M9 5.5v13M15 5.5v13" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11.5a8 8 0 1 0-2.3 6.3" />
      <path d="M20 5.5v6h-6" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7" />,
  code: (
    <>
      <path d="m8.5 7-5 5 5 5M15.5 7l5 5-5 5" />
      <path d="M13.5 4.5 10.5 19.5" />
    </>
  ),
  plugin: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.6" />
      <rect x="13" y="4" width="7" height="7" rx="1.6" />
      <rect x="4" y="13" width="7" height="7" rx="1.6" />
      <rect x="13" y="13" width="7" height="7" rx="1.6" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.8v.2" />
    </>
  ),
  monitor: (
    <>
      <rect x="3" y="4.5" width="18" height="12" rx="2" />
      <path d="M8.5 20h7M12 16.5V20" />
    </>
  ),
  window: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M3.5 8.5h17M7 6.6h.2M9.6 6.6h.2" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="3.5" width="6" height="10" rx="3" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3" />
    </>
  ),
  volume: (
    <>
      <path d="M4 9.5h3l4-3.5v12l-4-3.5H4z" />
      <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
    </>
  ),
  stop: <rect x="6.5" y="6.5" width="11" height="11" rx="2.4" />,
  download: (
    <>
      <path d="M12 4v11M7.5 11l4.5 4.5 4.5-4.5" />
      <path d="M4.5 19.5h15" />
    </>
  ),
  external: (
    <>
      <path d="M14 4.5h5.5V10" />
      <path d="M19.5 4.5 11 13" />
      <path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
    </>
  ),
  edit: (
    <>
      <path d="M4.5 19.5h4l10-10a2.1 2.1 0 0 0-3-3l-10 10z" />
      <path d="m13.5 7.5 3 3" />
    </>
  ),
  dots: (
    <>
      <circle cx="6" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  bolt: <path d="M13.5 3 5.5 13h5l-1 8 8-10h-5z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 1.8" />
    </>
  ),
  image: (
    <>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="9" cy="9.5" r="1.6" />
      <path d="m4.5 17 4.5-4.5 4 4 3-3 3.5 3.5" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3.5a8.5 8.5 0 0 0 0 17c1.4 0 2-.9 2-1.8 0-1.2-1-1.6-1-2.7 0-1 .8-1.7 1.8-1.7h1.7a4 4 0 0 0 4-4c0-3.8-3.8-6.8-8.5-6.8Z" />
      <circle cx="8" cy="9" r=".9" fill="currentColor" stroke="none" />
      <circle cx="12" cy="7" r=".9" fill="currentColor" stroke="none" />
      <circle cx="16" cy="9" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
  keyboard: (
    <>
      <rect x="3" y="6.5" width="18" height="11" rx="2" />
      <path d="M6.5 9.5h.2M10 9.5h.2M13.5 9.5h.2M17 9.5h.2M6.5 13h.2M10 13h.2M13.5 13h.2M17 13h.2M8 16h8" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="6" rx="7.5" ry="3" />
      <path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6" />
      <path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" />
    </>
  ),
  power: (
    <>
      <path d="M12 3.5v8" />
      <path d="M7.2 6.6a7 7 0 1 0 9.6 0" />
    </>
  ),
  'chevron-right': <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />,
  'arrow-up-right': (
    <>
      <path d="M7 17 17 7" />
      <path d="M9 7h8v8" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3.5 13.8 9l5.5 1.8-5.5 1.8L12 18l-1.8-5.4L4.7 10.8 10.2 9z" />
      <path d="M6 17.5v3M19 4.5v2.8" />
    </>
  ),
};

export function Icon({
  name,
  size = 18,
  strokeWidth = 1.7,
  className,
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.plugin}
    </svg>
  );
}

const KNOWN_ICONS = new Set(Object.keys(paths));

export function PluginGlyph({ plugin, size = 20 }: { plugin: PluginRuntimeInfo; size?: number }) {
  const iconName = plugin.manifest.icon && KNOWN_ICONS.has(plugin.manifest.icon) ? (plugin.manifest.icon as IconName) : 'plugin';
  return (
    <span className="plugin-glyph" style={{ display: 'inline-flex', width: size, height: size }}>
      <Icon name={iconName} size={size} />
    </span>
  );
}

export function pluginAccent(plugin: PluginRuntimeInfo): string {
  const hex = plugin.manifest.accent || '#4C8DFF';
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '76, 141, 255';
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`;
}
