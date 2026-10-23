/**
 * UI 编辑器 · 节点渲染工具
 * 画布、预览、导出器共用，保证设计态与运行态尽量一致。
 */
import type { UINode, UINodeStyle } from './uieditor';
import { gradientCss, radiusCss, shadowCss } from './uieditor-kit';

export type CssObject = Record<string, string | number>;

export interface RenderResult {
  css: CssObject;
  textCss: CssObject;
  innerText: boolean;
}

const TRANSPARENT = 'transparent';

function isTransparent(value: string | null | undefined): boolean {
  if (!value) return true;
  const normalized = value.replace(/\s+/g, '').toLowerCase();
  return (
    normalized === 'transparent' ||
    normalized === 'rgba(0,0,0,0)' ||
    normalized === 'rgba(0,0,0,0.0)' ||
    normalized === '#00000000'
  );
}

export function nodeCss(node: UINode, options: { includePosition?: boolean; absolute?: boolean } = {}): CssObject {
  const style = node.style;
  const css: Record<string, string | number | undefined> = {};
  if (options.includePosition !== false) {
    css.position = options.absolute === false ? 'relative' : 'absolute';
    css.left = `${style.x}px`;
    css.top = `${style.y}px`;
  }
  css.width = `${style.width}px`;
  css.height = `${style.height}px`;
  css.opacity = style.opacity;
  css.borderRadius = radiusCss(style.radius);
  css.transform = style.rotation ? `rotate(${style.rotation}deg)` : undefined;
  css.transformOrigin = 'center center';
  css.overflow = style.clip ? 'hidden' : 'visible';
  css.boxSizing = 'border-box';

  const gradient = gradientCss(style.gradient);
  if (gradient) {
    css.backgroundImage = gradient;
    css.backgroundColor = TRANSPARENT;
  } else if (!isTransparent(style.fill)) {
    css.backgroundColor = style.fill;
  }
  if (style.backgroundImage) {
    css.backgroundImage = `url("${style.backgroundImage}")`;
    css.backgroundSize = 'cover';
    css.backgroundPosition = 'center';
  }
  if (style.strokeWidth > 0 && !isTransparent(style.stroke)) {
    css.border = `${style.strokeWidth}px solid ${style.stroke}`;
  }
  const shadow = shadowCss(style.shadow);
  if (shadow) css.boxShadow = shadow;
  if (style.blur > 0) css.filter = `blur(${style.blur}px)`;

  css.display = 'flex';
  if (style.layout === 'row') {
    css.flexDirection = 'row';
    css.gap = `${style.gap}px`;
    css.padding = `${style.padding}px`;
    css.alignItems = alignToFlex(style.align);
    css.justifyContent = justifyToFlex(style.justify);
  } else if (style.layout === 'column') {
    css.flexDirection = 'column';
    css.gap = `${style.gap}px`;
    css.padding = `${style.padding}px`;
    css.alignItems = alignToFlex(style.align);
    css.justifyContent = justifyToFlex(style.justify);
  } else {
    css.position = options.absolute === false ? 'relative' : 'absolute';
  }

  // 去掉 undefined，避免 React / 导出出现 "undefined"
  for (const key of Object.keys(css)) if (css[key] === undefined) delete css[key];
  return css as CssObject;
}

export function nodeTextCss(node: UINode): CssObject {
  const style = node.style;
  const css: Record<string, string | number | undefined> = {
    color: style.color,
    fontFamily: style.fontFamily,
    fontSize: `${style.fontSize}px`,
    fontWeight: style.fontWeight,
    lineHeight: style.lineHeight,
    letterSpacing: `${style.letterSpacing}px`,
    textAlign: style.textAlign,
    textTransform: style.textTransform === 'none' ? undefined : style.textTransform,
    textDecoration: style.textDecoration === 'none' ? undefined : style.textDecoration,
    width: '100%',
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    display: 'flex',
    alignItems: 'center',
    justifyContent:
      style.textAlign === 'center' ? 'center' : style.textAlign === 'right' ? 'flex-end' : 'flex-start',
  };
  for (const key of Object.keys(css)) if (css[key] === undefined) delete css[key];
  return css as CssObject;
}

export function alignToFlex(align: UINodeStyle['align']): string {
  switch (align) {
    case 'center':
      return 'center';
    case 'end':
      return 'flex-end';
    case 'start':
      return 'flex-start';
    default:
      return 'stretch';
  }
}

export function justifyToFlex(justify: UINodeStyle['justify']): string {
  switch (justify) {
    case 'center':
      return 'center';
    case 'end':
      return 'flex-end';
    case 'space-between':
      return 'space-between';
    default:
      return 'flex-start';
  }
}

/* ------------------------------------------------------------------ 图标 */

const ICON_PATHS: Record<string, string> = {
  home: 'M4 11.5 12 4l8 7.5M6.5 10.5V20h11v-9.5',
  settings:
    'M12 15.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c0 .66.39 1.26 1 1.51H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3',
  user: 'M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z',
  play: 'M8 5v14l11-7L8 5Z',
  pause: 'M7 4h4v16H7zM13 4h4v16h-4z',
  plus: 'M12 5v14M5 12h14',
  check: 'M20 6 9 17l-5-5',
  close: 'M18 6 6 18M6 6l12 12',
  arrow: 'M5 12h14M13 6l6 6-6 6',
  heart:
    'M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z',
  star: 'm12 3 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3-5.8 3 1.1-6.5L3.6 9.8l6.5-.9L12 3Z',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z',
  image: 'M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM12 6v6l4 2',
  camera:
    'M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1Zm12 4a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  mic: 'M12 3a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM19 10v1a7 7 0 0 1-14 0v-1M12 18v3',
  volume: 'M11 5 6 9H3v6h3l5 4V5ZM15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13',
  chevron: 'm9 6 6 6-6 6',
  menu: 'M4 6h16M4 12h16M4 18h16',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  copy: 'M9 9h11v11H9zM4 15V4h11',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  lock: 'M5 11h14v10H5zM8 11V8a4 4 0 0 1 8 0v3',
  move: 'M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3',
  code: 'm8 6-6 6 6 6M16 6l6 6-6 6',
  download: 'M12 3v12M6 9l6 6 6-6M4 21h16',
  upload: 'M12 21V9M6 15l6-6 6 6M4 3h16',
  sparkle: 'M12 2l2.2 6.2L21 10l-6.8 1.8L12 18l-2.2-6.2L3 10l6.8-1.8L12 2Z',
  layout: 'M3 3h18v18H3zM3 9h18M9 9v12',
};

export interface IconInfo {
  name: string;
  label: string;
}

export const ICON_LIBRARY: IconInfo[] = Object.keys(ICON_PATHS).map((name) => ({ name, label: name }));

export function iconSvg(name: string, color = 'currentColor', size = 0): string {
  const path = ICON_PATHS[name] ?? ICON_PATHS.sparkle;
  const dimension = size > 0 ? ` width="${size}" height="${size}"` : ' width="100%" height="100%"';
  return `<svg${dimension} viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
}

export function iconDataUri(name: string, color = '#ffffff'): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(iconSvg(name, color, 24))}`;
}

