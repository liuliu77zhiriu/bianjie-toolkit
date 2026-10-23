/**
 * UI 编辑器 · 面板共享控件（自包含，类名前缀 up-）
 *
 * - 所有输入控件不直接写 store：文本/数字在 blur / Enter 时提交，拾色器与滑块走
 *   useLiveGesture（beginGesture → history=false 连续更新 → endGesture），避免历史爆炸；
 * - 数字输入保证不产生 NaN / 负尺寸（调用方通过 min 约束，默认钳制）；
 * - 颜色输入兼容 #hex / rgb() / rgba() / transparent，文本输入用 CSS.supports 校验。
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import type { UINode, UINodeStyle, UINodeType } from '@shared/uieditor';
import { editorStore } from '../store';

/* ================================================================== 基础布局 */

export function FieldRow({
  label,
  children,
  hint,
  disabled,
  inline,
}: {
  label: ReactNode;
  children: ReactNode;
  hint?: string;
  disabled?: boolean;
  inline?: boolean;
}) {
  return (
    <div className={`up-field${disabled ? ' disabled' : ''}${inline ? ' inline' : ''}`} title={hint}>
      <span className="up-field-label">{label}</span>
      <div className="up-field-body">{children}</div>
    </div>
  );
}

export function Section({
  title,
  actions,
  children,
  defaultOpen = true,
}: {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details className="up-section" open={defaultOpen}>
      <summary className="up-section-title">
        <span className="up-section-caret" aria-hidden="true">
          <Glyph name="chevron" size={12} />
        </span>
        <span>{title}</span>
        {actions ? (
          <span
            className="up-section-actions"
            onClick={(event) => {
              // 避免点击操作区按钮时触发 <details> 展开/收起
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            {actions}
          </span>
        ) : null}
      </summary>
      <div className="up-section-body">{children}</div>
    </details>
  );
}

export function EmptyState({
  icon = 'sparkle',
  title,
  hint,
  children,
}: {
  icon?: GlyphName;
  title: string;
  hint?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="up-empty">
      <span className="up-empty-icon">
        <Glyph name={icon} size={20} />
      </span>
      <div className="up-empty-title">{title}</div>
      {hint ? <div className="up-empty-hint">{hint}</div> : null}
      {children}
    </div>
  );
}

/* ================================================================== 图标 */

export type GlyphName =
  | 'eye'
  | 'eye-off'
  | 'lock'
  | 'unlock'
  | 'chevron'
  | 'chevron-down'
  | 'chevron-up'
  | 'plus'
  | 'trash'
  | 'copy'
  | 'search'
  | 'image'
  | 'upload'
  | 'close'
  | 'drag'
  | 'layers'
  | 'component'
  | 'template'
  | 'screen'
  | 'asset'
  | 'palette'
  | 'sliders'
  | 'bolt'
  | 'text'
  | 'edit'
  | 'check'
  | 'up'
  | 'down'
  | 'top'
  | 'bottom'
  | 'grid'
  | 'sparkle'
  | 'info';

const GLYPH_PATHS: Record<GlyphName, string> = {
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  'eye-off':
    'M3 3l18 18M10.6 10.7a3 3 0 0 0 4.2 4.2M9.9 5.2A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a18 18 0 0 1-3 4.1M6.1 6.6C3.4 8.6 2 12 2 12s3.5 7 10 7c1.5 0 2.9-.4 4.1-1',
  lock: 'M5 11h14v10H5zM8 11V8a4 4 0 0 1 8 0v3',
  unlock: 'M5 11h14v10H5zM8 11V8a4 4 0 0 1 7.5-2',
  chevron: 'm9 6 6 6-6 6',
  'chevron-down': 'm6 9 6 6 6-6',
  'chevron-up': 'm6 15 6-6 6 6',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14',
  copy: 'M9 9h11v11H9zM4 15V4h11',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.3-4.3',
  image: 'M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6',
  upload: 'M12 21V9M6 15l6-6 6 6M4 3h16',
  close: 'M18 6 6 18M6 6l12 12',
  drag: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  layers: 'M12 3 3 8l9 5 9-5-9-5ZM3 12l9 5 9-5M3 16l9 5 9-5',
  component: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  template: 'M3 4h18v4H3zM3 11h8v9H3zM14 11h7v9h-7z',
  screen: 'M3 4h18v12H3zM8 20h8',
  asset: 'M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6',
  palette:
    'M12 3a9 9 0 1 0 0 18c1.5 0 2-1 2-2 0-1.3-1-1.7-1-2.8 0-1 .8-1.7 1.8-1.7h1.7a3.5 3.5 0 0 0 3.5-3.5C20 7.6 16.4 3 12 3Z',
  sliders: 'M4 8h10M18 8h2M4 16h4M12 16h8M14 5v6M8 13v6',
  bolt: 'M13 2 4 14h6l-1 8 9-12h-6l1-8Z',
  text: 'M5 5h14M12 5v14M8.5 19h7',
  edit: 'M4 20h4L20 8l-4-4L4 16v4ZM14 6l4 4',
  check: 'm5 12.5 4.5 4.5L19 7',
  up: 'M12 19V5M6 11l6-6 6 6',
  down: 'M12 5v14M6 13l6 6 6-6',
  top: 'M5 4h14M12 20V8M7 13l5-5 5 5',
  bottom: 'M5 20h14M12 4v12M7 11l5 5 5-5',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  sparkle: 'M12 3l2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4Z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5.5M12 7.6v.2',
};

export function Glyph({ name, size = 14, className }: { name: GlyphName; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={GLYPH_PATHS[name]} />
    </svg>
  );
}

const NODE_GLYPH_PATHS: Record<UINodeType, string> = {
  frame: 'M4 4h16v16H4zM4 9h16M9 4v16',
  rect: 'M4 6h16v12H4z',
  ellipse: 'M4 12a8 8 0 1 0 16 0 8 8 0 0 0-16 0Z',
  line: 'M4 18 20 6',
  text: 'M5 5h14M12 5v14M8.5 19h7',
  image: 'M3 5h18v14H3zM3 15l5-5 4 4 3-3 6 6',
  icon: 'M12 3l2.4 6.6L21 12l-6.6 2.4L12 21l-2.4-6.6L3 12l6.6-2.4Z',
  button: 'M4 8h16v8H4zM9 12h6',
  input: 'M4 7h16v10H4zM8 10v4',
  textarea: 'M4 6h16v12H4zM7 10h10M7 14h6',
  toggle: 'M8 9h8a3 3 0 0 1 0 6H8a3 3 0 0 1 0-6ZM15 12h.01',
  slider: 'M4 12h16M14 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0',
  progress: 'M4 10h16v4H4zM4 12h9',
  badge: 'M4 4h9l7 7-9 9-7-7V4ZM8 8h.01',
  avatar: 'M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM5 21a7 7 0 0 1 14 0',
  divider: 'M4 12h16',
  tabs: 'M4 6h16v12H4zM4 10h16M10 6v12',
  list: 'M4 7h2M9 7h11M4 12h2M9 12h11M4 17h2M9 17h11',
  spacer: 'M4 4h16v16H4zM9 12h6',
};

export function NodeGlyph({ type, size = 13, className }: { type: UINodeType; size?: number; className?: string }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={NODE_GLYPH_PATHS[type] ?? NODE_GLYPH_PATHS.rect} />
    </svg>
  );
}

/* ================================================================== 标签页 */

export interface TabItem<T extends string> {
  id: T;
  label: string;
  icon?: GlyphName;
  title?: string;
}

export function TabBar<T extends string>({
  tabs,
  value,
  onChange,
  ariaLabel,
}: {
  tabs: ReadonlyArray<TabItem<T>>;
  value: T;
  onChange: (next: T) => void;
  ariaLabel: string;
}) {
  return (
    <div className="up-tabbar" role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === value}
          className={`up-tab${tab.id === value ? ' active' : ''}`}
          title={tab.title ?? tab.label}
          onClick={() => onChange(tab.id)}
        >
          {tab.icon ? (
            <span className="up-tab-icon">
              <Glyph name={tab.icon} size={14} />
            </span>
          ) : null}
          <span className="up-tab-label">{tab.label}</span>
        </button>
      ))}
    </div>
  );
}

/* ================================================================== 文本 / 数字 */

function formatNumber(value: number, precision: number): string {
  if (!Number.isFinite(value)) return '0';
  const factor = 10 ** precision;
  return String(Math.round(value * factor) / factor);
}

export function TextInput({
  value,
  onCommit,
  placeholder,
  disabled,
  ariaLabel,
  title,
  mono,
  maxLength,
  mixed,
}: {
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel: string;
  title?: string;
  mono?: boolean;
  maxLength?: number;
  mixed?: boolean;
}) {
  const [text, setText] = useState(value);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);

  const commit = () => {
    if (mixed) return;
    if (text === value) return;
    onCommit(text);
  };

  return (
    <input
      type="text"
      className={`up-input${mono ? ' mono' : ''}`}
      value={text}
      placeholder={mixed ? '混合' : placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      title={title}
      maxLength={maxLength}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          event.currentTarget.blur();
        } else if (event.key === 'Escape') {
          setText(value);
          focused.current = false;
          event.currentTarget.blur();
        }
      }}
    />
  );
}

export function TextArea({
  value,
  onCommit,
  placeholder,
  disabled,
  ariaLabel,
  rows = 3,
}: {
  value: string;
  onCommit: (next: string) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel: string;
  rows?: number;
}) {
  const [text, setText] = useState(value);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(value);
  }, [value]);

  return (
    <textarea
      className="up-textarea"
      value={text}
      rows={rows}
      placeholder={placeholder}
      disabled={disabled}
      aria-label={ariaLabel}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        focused.current = false;
        if (text !== value) onCommit(text);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
    />
  );
}

export function NumberInput({
  value,
  onCommit,
  mixed,
  min = -99999,
  max = 99999,
  step = 1,
  precision = 0,
  suffix,
  disabled,
  ariaLabel,
  title,
}: {
  value: number;
  onCommit: (next: number) => void;
  mixed?: boolean;
  min?: number;
  max?: number;
  step?: number;
  precision?: number;
  suffix?: string;
  disabled?: boolean;
  ariaLabel: string;
  title?: string;
}) {
  const [text, setText] = useState(mixed ? '' : formatNumber(value, precision));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(mixed ? '' : formatNumber(value, precision));
  }, [value, mixed, precision]);

  const clamp = (next: number) => Math.min(max, Math.max(min, next));

  const commit = () => {
    if (text.trim() === '') {
      setText(mixed ? '' : formatNumber(value, precision));
      return;
    }
    const parsed = Number(text);
    if (!Number.isFinite(parsed)) {
      setText(mixed ? '' : formatNumber(value, precision));
      return;
    }
    const next = clamp(parsed);
    setText(formatNumber(next, precision));
    if (mixed || next !== value) onCommit(next);
  };

  return (
    <div className={`up-number${mixed ? ' mixed' : ''}${disabled ? ' disabled' : ''}`} title={title}>
      <input
        type="text"
        inputMode="decimal"
        value={text}
        placeholder={mixed ? '混合' : undefined}
        disabled={disabled}
        aria-label={ariaLabel}
        onFocus={() => {
          focused.current = true;
          if (mixed) setText('');
        }}
        onChange={(event) => {
          const raw = event.target.value;
          if (/^-?\d*(\.\d*)?$/.test(raw) || raw === '') setText(raw);
        }}
        onBlur={() => {
          focused.current = false;
          commit();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            setText(mixed ? '' : formatNumber(value, precision));
            focused.current = false;
            event.currentTarget.blur();
          } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            const current = Number(text);
            const base = Number.isFinite(current) && text.trim() !== '' ? current : value;
            const next = clamp(base + (event.key === 'ArrowUp' ? step : -step));
            setText(formatNumber(next, precision));
            onCommit(next);
          }
        }}
      />
      {suffix ? <span className="up-number-suffix">{suffix}</span> : null}
    </div>
  );
}

/* ================================================================== 选择 / 分段 / 开关 */

export function Select<T extends string>({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
  mixed,
  title,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (next: T) => void;
  disabled?: boolean;
  ariaLabel: string;
  mixed?: boolean;
  title?: string;
}) {
  return (
    <div className={`up-select${disabled ? ' disabled' : ''}`} title={title}>
      <select
        value={mixed ? '' : value}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(event) => {
          if (event.target.value !== '') onChange(event.target.value as T);
        }}
      >
        {mixed ? <option value="">混合</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <span className="up-select-arrow" aria-hidden="true">
        <Glyph name="chevron-down" size={11} />
      </span>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
  mixed,
  compact,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string; title?: string }>;
  onChange: (next: T) => void;
  disabled?: boolean;
  ariaLabel: string;
  mixed?: boolean;
  compact?: boolean;
}) {
  return (
    <div className={`up-seg${compact ? ' compact' : ''}`} role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={!mixed && option.value === value ? 'active' : ''}
          title={option.title ?? option.label}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  disabled,
  ariaLabel,
  title,
  mixed,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  ariaLabel: string;
  title?: string;
  mixed?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      title={title ?? ariaLabel}
      disabled={disabled}
      className={`up-switch${checked ? ' on' : ''}${mixed ? ' mixed' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className="up-switch-knob" />
    </button>
  );
}

export function CheckField({
  label,
  checked,
  onChange,
  disabled,
  title,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <label className={`up-check${disabled ? ' disabled' : ''}`} title={title}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/* ================================================================== 滑块 */

export function SliderField({
  value,
  min,
  max,
  step = 1,
  onCommit,
  disabled,
  ariaLabel,
  format,
  unit,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onCommit: (next: number) => void;
  disabled?: boolean;
  ariaLabel: string;
  format?: (next: number) => string;
  unit?: string;
}) {
  const [draft, setDraft] = useState(value);
  const dragging = useRef(false);
  const latest = useRef(value);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (!dragging.current) {
      setDraft(value);
      latest.current = value;
    }
  }, [value]);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    []
  );

  const commit = (next: number) => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    dragging.current = false;
    latest.current = next;
    onCommit(next);
  };

  const schedule = (next: number) => {
    setDraft(next);
    latest.current = next;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      onCommit(latest.current);
    }, 120);
  };

  const fill = max > min ? Math.round(((draft - min) / (max - min)) * 100) : 0;
  const display = format ? format(draft) : `${Math.round(draft * 100) / 100}${unit ?? ''}`;

  return (
    <div className={`up-slider${disabled ? ' disabled' : ''}`}>
      <div className="up-slider-head">
        <span className="up-slider-value">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={draft}
        disabled={disabled}
        aria-label={ariaLabel}
        style={{ '--up-fill': `${fill}%` } as CSSProperties}
        onPointerDown={() => {
          dragging.current = true;
        }}
        onChange={(event) => schedule(Number(event.currentTarget.value))}
        onPointerUp={() => commit(latest.current)}
        onPointerCancel={() => commit(latest.current)}
        onKeyDown={() => {
          dragging.current = true;
        }}
        onKeyUp={() => commit(latest.current)}
        onBlur={() => {
          dragging.current = false;
        }}
      />
    </div>
  );
}

/* ================================================================== 颜色 */

export interface ParsedColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

function clampByte(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)));
}

export function parseColor(value: string | null | undefined): ParsedColor | null {
  if (!value) return null;
  const raw = value.trim().toLowerCase();
  if (!raw || raw === 'transparent') return raw === 'transparent' ? { r: 0, g: 0, b: 0, a: 0 } : null;

  const shortHex = /^#([0-9a-f]{3})([0-9a-f])?$/.exec(raw);
  if (shortHex) {
    const digits = shortHex[1].split('').map((char) => parseInt(char + char, 16));
    const alpha = shortHex[2] ? parseInt(shortHex[2] + shortHex[2], 16) / 255 : 1;
    return { r: digits[0], g: digits[1], b: digits[2], a: Math.round(alpha * 100) / 100 };
  }

  const hex = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(raw);
  if (hex) {
    const numeric = parseInt(hex[1], 16);
    const alpha = hex[2] ? parseInt(hex[2], 16) / 255 : 1;
    return { r: (numeric >> 16) & 255, g: (numeric >> 8) & 255, b: numeric & 255, a: Math.round(alpha * 100) / 100 };
  }

  const rgb = /^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*(?:[,/]\s*([\d.]+%?))?\s*\)$/.exec(raw);
  if (rgb) {
    let alpha = 1;
    if (rgb[4]) alpha = rgb[4].endsWith('%') ? Number(rgb[4].slice(0, -1)) / 100 : Number(rgb[4]);
    return {
      r: clampByte(Number(rgb[1])),
      g: clampByte(Number(rgb[2])),
      b: clampByte(Number(rgb[3])),
      a: Math.round(Math.min(1, Math.max(0, alpha)) * 100) / 100,
    };
  }
  return null;
}

function toHex(parsed: ParsedColor): string {
  const part = (value: number) => clampByte(value).toString(16).padStart(2, '0');
  return `#${part(parsed.r)}${part(parsed.g)}${part(parsed.b)}`;
}

export function toCssColor(parsed: ParsedColor, alpha?: number): string {
  const nextAlpha = Math.min(1, Math.max(0, alpha ?? parsed.a));
  if (nextAlpha >= 1) return toHex(parsed);
  if (nextAlpha <= 0) return 'transparent';
  return `rgba(${clampByte(parsed.r)}, ${clampByte(parsed.g)}, ${clampByte(parsed.b)}, ${Math.round(nextAlpha * 100) / 100})`;
}

export function isCssColor(value: string): boolean {
  const text = value.trim();
  if (!text) return false;
  if (text.toLowerCase() === 'transparent') return true;
  if (typeof CSS !== 'undefined' && typeof CSS.supports === 'function') {
    return CSS.supports('color', text);
  }
  return parseColor(text) !== null;
}

export function ColorInput({
  value,
  onChange,
  disabled,
  ariaLabel,
  mixed,
  allowAlpha = true,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  ariaLabel: string;
  mixed?: boolean;
  allowAlpha?: boolean;
}) {
  const parsed = parseColor(value);
  const hex = parsed ? toHex(parsed) : '#ffffff';
  const alphaPercent = parsed ? Math.round(parsed.a * 100) : 100;

  const [text, setText] = useState(mixed ? '' : value);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(mixed ? '' : value);
  }, [value, mixed]);

  const commitText = () => {
    if (mixed) return;
    const next = text.trim();
    if (next === value) return;
    if (!isCssColor(next)) {
      setText(value);
      return;
    }
    onChange(next);
  };

  const emitFromParts = (next: ParsedColor, alpha = next.a) => {
    onChange(toCssColor(next, alpha));
  };

  return (
    <div className={`up-color${disabled ? ' disabled' : ''}${mixed ? ' mixed' : ''}`}>
      <span
        className="up-color-swatch"
        style={{ backgroundColor: mixed ? 'transparent' : value }}
        title={mixed ? '混合值' : value}
      >
        <input
          type="color"
          value={hex}
          aria-label={mixed ? `${ariaLabel}：混合` : ariaLabel}
          disabled={disabled}
          onChange={(event) => {
            const next = parseColor(event.target.value);
            if (!next) return;
            emitFromParts(next, parsed ? parsed.a : 1);
          }}
        />
      </span>
      <input
        type="text"
        className="up-color-hex"
        value={text}
        placeholder={mixed ? '混合' : '#RRGGBB'}
        disabled={disabled}
        aria-label={`${ariaLabel} 色值`}
        onFocus={() => {
          focused.current = true;
          if (mixed) setText('');
        }}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => {
          focused.current = false;
          commitText();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          } else if (event.key === 'Escape') {
            setText(mixed ? '' : value);
            focused.current = false;
            event.currentTarget.blur();
          }
        }}
      />
      {allowAlpha ? (
        <div className="up-color-alpha" title="不透明度（%）">
          <input
            type="text"
            inputMode="numeric"
            value={alphaPercent}
            aria-label={`${ariaLabel} 不透明度`}
            disabled={disabled}
            onChange={(event) => {
              const raw = Number(event.target.value.replace('%', ''));
              if (!Number.isFinite(raw)) return;
              const percent = Math.min(100, Math.max(0, raw));
              const base = parseColor(value) ?? { r: 255, g: 255, b: 255, a: 1 };
              emitFromParts(base, percent / 100);
            }}
          />
          <span>%</span>
        </div>
      ) : null}
    </div>
  );
}

/* ================================================================== store 提交辅助 */

/** 单选直接 updateStyle；多选批量写入（一次历史）。 */
export function applyStylePatch(selection: string[], patch: Partial<UINodeStyle>, history = true): void {
  if (!selection.length) return;
  if (selection.length === 1) {
    editorStore.updateStyle(selection[0], patch, history);
    return;
  }
  editorStore.updateNodes(
    selection,
    (node) => {
      node.style = {
        ...node.style,
        ...patch,
        radius: patch.radius
          ? ([...patch.radius] as [number, number, number, number])
          : node.style.radius,
      };
    },
    history
  );
}

/** 单选直接 updateNode；多选批量 Object.assign（一次历史）。 */
export function applyNodePatch(selection: string[], patch: Partial<UINode>, history = true): void {
  if (!selection.length) return;
  if (selection.length === 1) {
    editorStore.updateNode(selection[0], patch, history);
    return;
  }
  editorStore.updateNodes(
    selection,
    (node) => {
      Object.assign(node, patch);
    },
    history
  );
}

/**
 * 连续输入（拾色器、滑块、拖拽）合并为一步历史：
 * 第一次变更 beginGesture，随后以 history=false 更新，空闲 400ms 后 endGesture。
 */
export function useLiveGesture(label = '调整样式'): { run: (apply: () => void) => void; finish: () => void } {
  const timer = useRef<number | null>(null);
  const active = useRef(false);

  const finish = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    if (!active.current) return;
    active.current = false;
    editorStore.endGesture(label);
  }, [label]);

  const run = useCallback(
    (apply: () => void) => {
      if (!active.current) {
        active.current = true;
        editorStore.beginGesture();
      }
      apply();
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(finish, 400);
    },
    [finish]
  );

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
      if (active.current) {
        active.current = false;
        editorStore.endGesture(label);
      }
    },
    [label]
  );

  return { run, finish };
}

/* ================================================================== 多选混合值 */

export function pickStyle<T>(nodes: UINode[], get: (style: UINodeStyle) => T): { value: T; mixed: boolean } {
  const first = get(nodes[0].style);
  return { value: first, mixed: nodes.some((node) => get(node.style) !== first) };
}

export function pickNode<T>(nodes: UINode[], get: (node: UINode) => T): { value: T; mixed: boolean } {
  const first = get(nodes[0]);
  return { value: first, mixed: nodes.some((node) => get(node) !== first) };
}

export function percentLabel(value: number): string {
  return `${Math.round(value * 100)}%`;
}
