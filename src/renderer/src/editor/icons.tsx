import { useMemo } from 'react';

/** 编辑器图标：24×24 线性图标，路径内置避免网络/字体依赖 */
const PATHS: Record<string, string> = {
  select: 'M5 3l7 17 2.2-6.2L21 11.5 5 3Z',
  hand: 'M8 12V5.5a1.5 1.5 0 0 1 3 0V11m0 0V4.5a1.5 1.5 0 0 1 3 0V11m0 0V6a1.5 1.5 0 0 1 3 0v8.5A6.5 6.5 0 0 1 10.5 21h-1a6 6 0 0 1-5-2.7L2 14.5a1.7 1.7 0 0 1 2.8-1.9L7 15V8.5',
  frame: 'M4 4h16v16H4zM4 9h16M9 4v16',
  rect: 'M4 5h16v14H4z',
  ellipse: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
  line: 'M4 20 20 4',
  text: 'M4 6V4h16v2M12 4v16M8 20h8',
  image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M8 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z',
  icon: 'm12 3 2.6 5.6L21 9.5l-4.6 4.4 1.1 6.1-5.5-2.9L6.5 20l1.1-6.1L3 9.5l6.4-.9L12 3Z',
  button: 'M4 7h16v10H4zM8 12h8',
  input: 'M3 7h18v10H3zM7 10v4',
  toggle: 'M8 8h8a4 4 0 0 1 0 8H8a4 4 0 0 1 0-8Zm8 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  slider: 'M3 12h18M8 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm8 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Z',
  progress: 'M3 10h18v4H3zM3 12h10',
  badge: 'M12 3l2 4 4.5.6-3.3 3.2.8 4.5L12 13.2 8 15.3l.8-4.5L5.5 7.6 10 7l2-4Z',
  divider: 'M3 12h18',
  tabs: 'M4 5h16v14H4zM4 9h16M8 5v4M14 5v4',
  list: 'M4 6h16M4 12h16M4 18h16',
  undo: 'M9 7 4 12l5 5M4 12h9a6 6 0 0 1 6 6v1',
  redo: 'm15 7 5 5-5 5M20 12h-9a6 6 0 0 0-6 6v1',
  save: 'M5 3h12l3 3v15H5V3Zm3 0v6h8V3M8 21v-7h8v7',
  export: 'M12 3v12M7 8l5-5 5 5M5 21h14',
  preview: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  play: 'M8 5v14l11-7L8 5Z',
  close: 'M18 6 6 18M6 6l12 12',
  minus: 'M5 12h14',
  maximize: 'M5 5h14v14H5z',
  restore: 'M8 8h11v11H8zM5 16V5h11',
  plus: 'M12 5v14M5 12h14',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14',
  copy: 'M9 9h11v11H9zM4 15V4h11',
  lock: 'M5 11h14v10H5zM8 11V8a4 4 0 0 1 8 0v3',
  unlock: 'M5 11h14v10H5zM8 11V8a4 4 0 0 1 7.5-2',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  eyeOff: 'M3 3l18 18M10.6 6.2A10 10 0 0 1 12 6c6.5 0 10 6 10 6a17 17 0 0 1-3.1 3.9M6.2 8.2C3.8 9.8 2 12 2 12s3.5 7 10 7c1.7 0 3.2-.4 4.6-1',
  chevron: 'm9 6 6 6-6 6',
  chevronDown: 'm6 9 6 6 6-6',
  chevronRight: 'm9 6 6 6-6 6',
  layers: 'm12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
  components: 'M3 3h8v8H3zM13 3h8v8h-8zM3 13h8v8H3zM13 13h8v8h-8z',
  template: 'M4 4h16v16H4zM4 8h16M9 8v12',
  screens: 'M3 5h18v12H3zM8 21h8',
  assets: 'M3 5h7l2 2h9v12H3z',
  code: 'm8 6-6 6 6 6M16 6l6 6-6 6',
  grid: 'M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18',
  magnet: 'M6 3v9a6 6 0 0 0 12 0V3M6 8h4M14 8h4',
  zoomIn: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3M11 8v6M8 11h6',
  zoomOut: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3M8 11h6',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  alignLeft: 'M4 3v18M8 7h11M8 12h7M8 17h11',
  alignCenterH: 'M12 3v18M5 7h14M7 12h10M5 17h14',
  alignRight: 'M20 3v18M5 7h11M9 12h7M5 17h11',
  alignTop: 'M3 4h18M7 8v11M12 8v7M17 8v11',
  alignCenterV: 'M3 12h18M7 5v14M12 7v10M17 5v14',
  alignBottom: 'M3 20h18M7 5v11M12 9v7M17 5v11',
  distH: 'M4 4v16M20 4v16M9 8h6v8H9z',
  distV: 'M4 4h16M4 20h16M8 9v6h8V9z',
  group: 'M4 4h7v7H4zM13 13h7v7h-7zM13 4h7v7h-7zM4 13h7v7H4z',
  ungroup: 'M3 3h8v8H3zM13 13h8v8h-8zM13 3h3M3 13v3M18 3h3v3',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
  settings: 'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c0 .66.39 1.26 1 1.51H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z',
  help: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM9.1 9a3 3 0 1 1 4.3 2.8c-.8.4-1.4 1.1-1.4 2.2M12 17h.01',
  sparkle: 'M12 2l2.2 6.2L21 10l-6.8 1.8L12 18l-2.2-6.2L3 10l6.8-1.8L12 2Z',
  upload: 'M12 21V9M6 15l6-6 6 6M4 3h16',
  publish: 'M12 3v12M7 8l5-5 5 5M5 21h14',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  back: 'M19 12H5M11 6l-6 6 6 6',
  rotate: 'M21 12a9 9 0 1 1-3-6.7M21 3v6h-6',
  state: 'M4 12a8 8 0 1 1 8 8M4 4v8h8',
};

export type EditorIconName = keyof typeof PATHS;

export function EditorIcon({ name, size = 16, className }: { name: string; size?: number; className?: string }) {
  const path = useMemo(() => PATHS[name] ?? PATHS.sparkle, [name]);
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}
