/** 流光搜索 · 轻量 Toast（白色玻璃） */
import { useSyncExternalStore } from 'react';
import { Icon } from '../components/Icon';

export type ToastKind = 'info' | 'success' | 'error';

export interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

let items: ToastItem[] = [];
let seq = 0;
const subscribers = new Set<() => void>();

function emit() {
  subscribers.forEach((sub) => sub());
}

export function toast(message: string, kind: ToastKind = 'info', duration = 2600): void {
  const id = ++seq;
  items = [...items, { id, message, kind }].slice(-4);
  emit();
  window.setTimeout(() => {
    items = items.filter((item) => item.id !== id);
    emit();
  }, duration);
}

function subscribe(callback: () => void) {
  subscribers.add(callback);
  return () => {
    subscribers.delete(callback);
  };
}

export function ToastHost() {
  const list = useSyncExternalStore(subscribe, () => items);
  if (!list.length) return null;
  return (
    <div className="s-toast-host" aria-live="polite">
      {list.map((item) => (
        <div key={item.id} className={`s-toast ${item.kind}`} role="status">
          <span className="s-toast-icon">
            <Icon name={item.kind === 'success' ? 'check' : item.kind === 'error' ? 'alert' : 'sparkle'} size={14} />
          </span>
          <span className="s-toast-text">{item.message}</span>
        </div>
      ))}
    </div>
  );
}
