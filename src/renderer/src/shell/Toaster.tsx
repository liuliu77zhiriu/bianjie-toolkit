import { useToasts } from '../lib/bridge';

export function Toaster() {
  const toasts = useToasts();
  if (!toasts.length) return null;
  return (
    <div className="toast-host">
      {toasts.map((item) => (
        <div key={item.id} className={`toast-item ${item.type}`}>
          {item.message}
        </div>
      ))}
    </div>
  );
}
