/** 流光搜索 · 确认弹层（白色玻璃，替代 window.confirm） */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Icon } from '../components/Icon';

export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn>(async () => false);

interface PendingState {
  options: ConfirmOptions;
  resolve: (value: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingState | null>(null);

  const confirm = useCallback<ConfirmFn>(
    (options) => new Promise<boolean>((resolve) => setPending({ options, resolve })),
    []
  );

  const close = useCallback((value: boolean) => {
    setPending((current) => {
      current?.resolve(value);
      return null;
    });
  }, []);

  useEffect(() => {
    if (!pending) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close(false);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        close(true);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [pending, close]);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending ? (
        <div
          className="s-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close(false);
          }}
        >
          <div className="s-modal" role="dialog" aria-modal="true" aria-label={pending.options.title}>
            <div className="s-modal-icon" aria-hidden="true">
              <Icon name={pending.options.danger ? 'alert' : 'info'} size={19} />
            </div>
            <div className="s-modal-body">
              <div className="s-modal-title">{pending.options.title}</div>
              {pending.options.message ? <div className="s-modal-message">{pending.options.message}</div> : null}
            </div>
            <div className="s-modal-actions">
              <button type="button" className="s-btn ghost" onClick={() => close(false)}>
                {pending.options.cancelText ?? '取消'}
              </button>
              <button
                type="button"
                className={`s-btn${pending.options.danger ? ' danger' : ' primary'}`}
                onClick={() => close(true)}
                autoFocus
              >
                {pending.options.confirmText ?? '确定'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  return useContext(ConfirmContext);
}
