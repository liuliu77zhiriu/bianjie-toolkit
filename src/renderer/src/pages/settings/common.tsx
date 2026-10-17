/**
 * 设置页 / 编辑器共享的基础控件。
 * 所有设置写入统一走 lib/bridge 的 patchSettings / invoke，禁止直接访问 window.tk。
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { SettingsPatch } from '@shared/types';
import { formatHotkey, invoke, patchSettings, toast } from '../../lib/bridge';
import { Icon } from '../../ui/Icon';

/* ------------------------------------------------------------------ 工具函数 */

export function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err.trim()) return err.trim();
  return '操作失败，请稍后再试';
}

/** 统一设置写入：失败 toast 并返回 false，成功可附带轻提示。 */
export function usePatcher(): (patch: SettingsPatch, okMessage?: string) => Promise<boolean> {
  return useCallback(async (patch: SettingsPatch, okMessage?: string) => {
    try {
      await patchSettings(patch);
      if (okMessage) toast(okMessage, 'success');
      return true;
    } catch (err) {
      toast(errorMessage(err), 'error');
      return false;
    }
  }, []);
}

/** 打开主进程已知路径（截图目录 / 录制目录 / 日志 / 用户数据）。 */
export async function openAppPath(kind: string): Promise<void> {
  try {
    await invoke('core', 'app.openPath', { kind });
  } catch (err) {
    toast(errorMessage(err), 'error');
  }
}

export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/* ------------------------------------------------------------------ 布局 */

export function Group({
  title,
  actions,
  children,
}: {
  title?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="settings-group">
      {title ? (
        <div className="settings-label group-head">
          <span>{title}</span>
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Row({
  title,
  desc,
  children,
  stacked,
  controlWidth,
}: {
  title: ReactNode;
  desc?: ReactNode;
  children?: ReactNode;
  stacked?: boolean;
  controlWidth?: 'auto' | 'wide' | 'full';
}) {
  return (
    <div className={`settings-row${stacked ? ' column' : ''}`}>
      <div className="row-main">
        <div className="row-title">{title}</div>
        {desc ? <div className="row-desc">{desc}</div> : null}
      </div>
      {children !== undefined && children !== null ? (
        <div className={`row-control${stacked ? ' full' : controlWidth === 'wide' ? ' wide' : ''}`}>{children}</div>
      ) : null}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  disabled,
  label,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      className="tk-switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    />
  );
}

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: string;
  hint?: string;
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  disabled,
  ariaLabel,
}: {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (next: T) => void;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  return (
    <div className="seg" role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          className={option.value === value ? 'active' : ''}
          title={option.hint}
          disabled={disabled}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ 滑块 */

/**
 * 滑块：拖动时只更新本地显示 + 180ms 防抖写回；松手 / 键盘抬起立即提交。
 */
export function Slider({
  min,
  max,
  step = 1,
  value,
  onCommit,
  format,
  minLabel,
  maxLabel,
  ariaLabel,
}: {
  min: number;
  max: number;
  step?: number;
  value: number;
  onCommit: (next: number) => void;
  format?: (next: number) => string;
  minLabel?: string;
  maxLabel?: string;
  ariaLabel?: string;
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
      if (timer.current) window.clearTimeout(timer.current);
    },
    []
  );

  const commit = (next: number) => {
    if (timer.current) {
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
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      onCommit(latest.current);
    }, 180);
  };

  const fill = max > min ? Math.round(((draft - min) / (max - min)) * 100) : 0;
  const text = format ? format(draft) : String(draft);

  return (
    <div className="slider-field">
      <div className="slider-head">
        <span className="slider-value">{text}</span>
        {minLabel || maxLabel ? (
          <span className="slider-scale">
            <span>{minLabel}</span>
            <span>{maxLabel}</span>
          </span>
        ) : null}
      </div>
      <input
        type="range"
        className="tk-range"
        min={min}
        max={max}
        step={step}
        value={draft}
        aria-label={ariaLabel}
        style={{ '--fill': `${fill}%` } as CSSProperties}
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
          if (dragging.current) commit(latest.current);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ 快捷键输入 */

const KEY_ALIAS: Record<string, string> = {
  ' ': 'Space',
  Spacebar: 'Space',
  Escape: 'Esc',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  CapsLock: 'Capslock',
  '+': 'Plus',
};

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'Shift', 'Meta', 'Dead']);

function acceleratorFromEvent(event: KeyboardEvent): string | null {
  if (MODIFIER_KEYS.has(event.key)) return null;
  let key = KEY_ALIAS[event.key] ?? event.key;
  if (!key) return null;
  if (key.length === 1) key = key.toUpperCase();
  const modifiers: string[] = [];
  if (event.ctrlKey) modifiers.push('Ctrl');
  if (event.altKey) modifiers.push('Alt');
  if (event.shiftKey) modifiers.push('Shift');
  if (event.metaKey) modifiers.push('Super');
  const isFunctionKey = /^F([1-9]|1[0-9]|2[0-4])$/.test(key);
  if (!modifiers.length && !isFunctionKey) return null;
  return [...modifiers, key].join('+');
}

export function HotkeyField({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  label: string;
}) {
  const [editing, setEditing] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const invalidTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (invalidTimer.current) window.clearTimeout(invalidTimer.current);
    },
    []
  );

  const flashInvalid = () => {
    setInvalid(true);
    if (invalidTimer.current) window.clearTimeout(invalidTimer.current);
    invalidTimer.current = window.setTimeout(() => setInvalid(false), 1000);
  };

  const display = editing ? '按下组合键…' : value ? formatHotkey(value) : '未设置';

  return (
    <div
      className={`hotkey-field${editing ? ' editing' : ''}${invalid ? ' invalid' : ''}`}
      tabIndex={0}
      role="button"
      aria-label={`${label}：${display}`}
      onFocus={() => setEditing(true)}
      onBlur={() => setEditing(false)}
      onKeyDown={(event) => {
        if (event.key === 'Tab') {
          setEditing(false);
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (event.key === 'Escape') {
          setEditing(false);
          event.currentTarget.blur();
          return;
        }
        if (event.key === 'Backspace' || event.key === 'Delete') {
          onChange('');
          setEditing(false);
          event.currentTarget.blur();
          return;
        }
        const accel = acceleratorFromEvent(event.nativeEvent);
        if (!accel) {
          flashInvalid();
          return;
        }
        onChange(accel);
        setEditing(false);
        event.currentTarget.blur();
      }}
    >
      <span className="hotkey-text">{display}</span>
      {editing ? <span className="hotkey-tip">Esc 取消 · Delete 清除</span> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ 弹层 */

export function Modal({
  title,
  children,
  footer,
  onClose,
  width,
}: {
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  width?: number;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [onClose]);

  // 挂到 .panel 内以继承用户强调色变量，同时脱离页面滚动容器
  const portalRoot = document.querySelector('.panel') ?? document.body;
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="modal-card" role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : '对话框'} style={{ width }}>
        <div className="modal-head">
          <span className="modal-title">{title}</span>
          <button type="button" className="tk-icon-btn" onClick={onClose} aria-label="关闭">
            <Icon name="close" size={14} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>,
    portalRoot
  );
}

/* ------------------------------------------------------------------ 确认框 */

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn>(async () => false);

interface ConfirmState {
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConfirmState | null>(null);

  const confirm = useCallback<ConfirmFn>(
    (options) => new Promise<boolean>((resolve) => setState({ options, resolve })),
    []
  );

  const close = useCallback((value: boolean) => {
    setState((current) => {
      current?.resolve(value);
      return null;
    });
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state ? (
        <Modal
          title={state.options.title}
          onClose={() => close(false)}
          footer={
            <>
              <button type="button" className="tk-btn" onClick={() => close(false)}>
                {state.options.cancelText ?? '取消'}
              </button>
              <button
                type="button"
                className={`tk-btn${state.options.danger ? ' danger' : ' primary'}`}
                onClick={() => close(true)}
                autoFocus
              >
                {state.options.confirmText ?? '确定'}
              </button>
            </>
          }
        >
          <div className="confirm-message">{state.options.message}</div>
        </Modal>
      ) : null}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext);
}

/* ------------------------------------------------------------------ 路径选择 */

export function SaveDirRow({
  kind,
  title,
  desc,
  value,
  openKind,
  fallback,
}: {
  kind: 'capture' | 'recorder';
  title: string;
  desc?: ReactNode;
  value: string;
  openKind: 'screenshots' | 'recordings';
  fallback?: string;
}) {
  const patch = usePatcher();
  const [busy, setBusy] = useState(false);

  const pick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const dir = await invoke<string | null>('core', 'settings.pickDir', { kind });
      if (dir) toast('保存目录已更新', 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Row title={title} desc={desc} stacked>
      <div className="path-field">
        <div className="path-box" title={value || fallback || undefined}>
          <Icon name="folder" size={13} />
          <span className={`path-text${value ? '' : ' muted'}`}>{value || fallback || '默认目录'}</span>
          {!value ? <span className="path-tag">默认</span> : null}
        </div>
        <div className="path-actions">
          <button type="button" className="tk-btn sm" onClick={pick} disabled={busy}>
            {busy ? '选择中…' : '选择目录'}
          </button>
          <button type="button" className="tk-icon-btn" onClick={() => void openAppPath(openKind)} title="打开目录" aria-label="打开目录">
            <Icon name="external" size={14} />
          </button>
          {value ? (
            <button
              type="button"
              className="tk-btn sm ghost"
              onClick={() => {
                const body: SettingsPatch = kind === 'capture' ? { capture: { saveDir: '' } } : { recorder: { saveDir: '' } };
                void patch(body, '已恢复默认目录');
              }}
            >
              默认
            </button>
          ) : null}
        </div>
      </div>
    </Row>
  );
}
