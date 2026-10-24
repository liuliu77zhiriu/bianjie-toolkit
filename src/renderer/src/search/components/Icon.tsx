/** 流光搜索 · 线条图标集（1.7 描边，24 视口） */
import type { ReactNode } from 'react';

export type IconName =
  | 'search'
  | 'download'
  | 'history'
  | 'bookmark'
  | 'bookmarkFilled'
  | 'settings'
  | 'close'
  | 'minimize'
  | 'maximize'
  | 'restore'
  | 'arrowRight'
  | 'arrowUpRight'
  | 'external'
  | 'folder'
  | 'play'
  | 'pause'
  | 'refresh'
  | 'trash'
  | 'plus'
  | 'check'
  | 'alert'
  | 'link'
  | 'file'
  | 'chevronDown'
  | 'clock'
  | 'sparkle'
  | 'globe'
  | 'info';

const paths: Record<IconName, ReactNode> = {
  search: (
    <>
      <circle cx="11" cy="11" r="6.4" />
      <path d="m16 16 4.5 4.5" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v10.6" />
      <path d="m7.4 10.4 4.6 4.6 4.6-4.6" />
      <path d="M5 19.5h14" />
    </>
  ),
  history: (
    <>
      <path d="M3.6 12a8.4 8.4 0 1 0 2.5-5.9" />
      <path d="M3.5 4.6v4.6h4.6" />
      <path d="M12 8.2v4.4l3 1.8" />
    </>
  ),
  bookmark: <path d="M6.6 4.5h10.8v15.2L12 15.8l-5.4 3.9z" />,
  bookmarkFilled: <path d="M6.6 4.5h10.8v15.2L12 15.8l-5.4 3.9z" fill="currentColor" stroke="none" />,
  settings: (
    <>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M19.2 13.4a1.6 1.6 0 0 0 .32 1.77l.06.06a1.95 1.95 0 1 1-2.76 2.76l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-.98 1.47V19.6a1.95 1.95 0 1 1-3.9 0v-.1a1.6 1.6 0 0 0-1.05-1.47 1.6 1.6 0 0 0-1.77.32l-.06.06a1.95 1.95 0 1 1-2.76-2.76l.06-.06a1.6 1.6 0 0 0 .32-1.77 1.6 1.6 0 0 0-1.47-.98H4.4a1.95 1.95 0 1 1 0-3.9h.1a1.6 1.6 0 0 0 1.47-1.05 1.6 1.6 0 0 0-.32-1.77l-.06-.06a1.95 1.95 0 1 1 2.76-2.76l.06.06a1.6 1.6 0 0 0 1.77.32h.08a1.6 1.6 0 0 0 .98-1.47V4.4a1.95 1.95 0 1 1 3.9 0v.1a1.6 1.6 0 0 0 .98 1.47 1.6 1.6 0 0 0 1.77-.32l.06-.06a1.95 1.95 0 1 1 2.76 2.76l-.06.06a1.6 1.6 0 0 0-.32 1.77v.08a1.6 1.6 0 0 0 1.47.98h.1a1.95 1.95 0 1 1 0 3.9h-.1a1.6 1.6 0 0 0-1.42.98Z" />
    </>
  ),
  close: <path d="m6.5 6.5 11 11m0-11-11 11" />,
  minimize: <path d="M5.5 12h13" />,
  maximize: <rect x="5.2" y="5.2" width="13.6" height="13.6" rx="2.6" />,
  restore: (
    <>
      <rect x="8.2" y="8.2" width="10.6" height="10.6" rx="2.2" />
      <path d="M5.4 15.4V6.8a1.4 1.4 0 0 1 1.4-1.4h8.6" />
    </>
  ),
  arrowRight: (
    <>
      <path d="M5 12h13.4" />
      <path d="m13.2 6.8 5.2 5.2-5.2 5.2" />
    </>
  ),
  arrowUpRight: (
    <>
      <path d="M7 17 17 7" />
      <path d="M9 7h8v8" />
    </>
  ),
  external: (
    <>
      <path d="M14 4.6h5.4V10" />
      <path d="M19.4 4.6 11 13" />
      <path d="M18 14v4.4a1.6 1.6 0 0 1-1.6 1.6H5.6A1.6 1.6 0 0 1 4 18.4V7.6A1.6 1.6 0 0 1 5.6 6H10" />
    </>
  ),
  folder: (
    <path d="M3.6 7.6A1.6 1.6 0 0 1 5.2 6h3.9l2 2.2h7.7a1.6 1.6 0 0 1 1.6 1.6v8.6a1.6 1.6 0 0 1-1.6 1.6H5.2a1.6 1.6 0 0 1-1.6-1.6z" />
  ),
  play: <path d="M8.6 5.9v12.2L18.8 12z" />,
  pause: (
    <>
      <path d="M9.4 5.8v12.4" />
      <path d="M14.6 5.8v12.4" />
    </>
  ),
  refresh: (
    <>
      <path d="M19.8 11.4a7.8 7.8 0 1 0-2.2 6.1" />
      <path d="M19.8 5.4v6h-6" />
    </>
  ),
  trash: (
    <>
      <path d="M4.8 7.2h14.4M9.2 7.2V5.4A1.2 1.2 0 0 1 10.4 4.2h3.2A1.2 1.2 0 0 1 14.8 5.4v1.8" />
      <path d="m6.6 7.2.8 11.6a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4l.8-11.6" />
      <path d="M10.2 11v5.4M13.8 11v5.4" />
    </>
  ),
  plus: <path d="M12 5.4v13.2M5.4 12h13.2" />,
  check: <path d="m5.2 12.6 4.6 4.6 9-10" />,
  alert: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M12 7.6v5.2M12 16.2v.2" />
    </>
  ),
  link: (
    <>
      <path d="M10 14a3.6 3.6 0 0 0 5.1 0l3-3a3.6 3.6 0 0 0-5.1-5.1l-1.5 1.5" />
      <path d="M14 10a3.6 3.6 0 0 0-5.1 0l-3 3a3.6 3.6 0 0 0 5.1 5.1l1.5-1.5" />
    </>
  ),
  file: (
    <>
      <path d="M6 4.6h7.2L18 9.4v9.6a1.4 1.4 0 0 1-1.4 1.4H6a1.4 1.4 0 0 1-1.4-1.4V6a1.4 1.4 0 0 1 1.4-1.4Z" />
      <path d="M13.2 4.6v4.8H18" />
    </>
  ),
  chevronDown: <path d="m6.6 9.6 5.4 5.4 5.4-5.4" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7.6V12l3 1.8" />
    </>
  ),
  sparkle: (
    <>
      <path d="M12 3.8 13.7 9l5.3 1.7-5.3 1.7L12 17.6l-1.7-5.2L5 10.7 10.3 9z" />
      <path d="M6.2 17.4v2.8M18.6 4.2v2.6" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M3.8 12h16.4" />
      <path d="M12 3.8c2.3 2.3 3.4 5.1 3.4 8.2s-1.1 5.9-3.4 8.2c-2.3-2.3-3.4-5.1-3.4-8.2S9.7 6.1 12 3.8Z" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 11v5.4M12 7.6v.2" />
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
      {paths[name] ?? paths.sparkle}
    </svg>
  );
}
