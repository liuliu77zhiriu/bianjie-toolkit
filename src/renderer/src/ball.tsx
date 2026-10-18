import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import type { Settings } from '@shared/types';
import { invoke, on } from './lib/bridge';
import './theme/tokens.css';
import './theme/ball.css';

function BallApp() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [idle, setIdle] = useState(false);
  const [pressed, setPressed] = useState(false);
  const [dock, setDock] = useState<{ docked: boolean; side: 'left' | 'right' | null }>({
    docked: false,
    side: null,
  });
  const orbRef = useRef<HTMLDivElement | null>(null);
  const idleTimer = useRef<number | null>(null);
  const drag = useRef({
    active: false,
    moved: false,
    startX: 0,
    startY: 0,
    lastX: 0,
    lastY: 0,
    raf: 0,
  });

  useEffect(() => {
    let alive = true;
    invoke<Settings>('core', 'settings.get')
      .then((value) => {
        if (alive) setSettings(value);
      })
      .catch(() => undefined);
    const off = on('settings:changed', (payload) => {
      if (payload && typeof payload === 'object') setSettings(payload as Settings);
    });
    void invoke<{ docked?: boolean; side?: 'left' | 'right' | null }>('core', 'ball.dockState')
      .then((state) => {
        if (alive && state) setDock({ docked: !!state.docked, side: state.side ?? null });
      })
      .catch(() => undefined);
    const offDock = on('ball:docked', (payload) => {
      const data = payload as { docked?: boolean; side?: 'left' | 'right' | null } | undefined;
      setDock({ docked: !!data?.docked, side: data?.side ?? null });
      if (data?.docked) setIdle(false);
    });
    return () => {
      alive = false;
      off();
      offDock();
    };
  }, []);

  const scheduleIdle = (delay = 2600) => {
    if (idleTimer.current) window.clearTimeout(idleTimer.current);
    idleTimer.current = window.setTimeout(() => {
      if (!drag.current.active && !orbRef.current?.matches(':hover')) setIdle(true);
    }, delay);
  };

  useEffect(() => {
    scheduleIdle(1800);
    const onMove = () => {
      if (!drag.current.active) return;
      setIdle(false);
      scheduleIdle(4000);
    };
    window.addEventListener('pointermove', onMove);
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (idleTimer.current) window.clearTimeout(idleTimer.current);
    };
  }, []);

  const sendMove = () => {
    if (!drag.current.active) return;
    window.tk.ball.dragMove(drag.current.lastX, drag.current.lastY);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
    drag.current = {
      active: true,
      moved: false,
      startX: event.screenX,
      startY: event.screenY,
      lastX: event.screenX,
      lastY: event.screenY,
      raf: 0,
    };
    setPressed(true);
    setIdle(false);
    void window.tk.ball.dragStart();
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current.active) return;
    const dx = event.screenX - drag.current.startX;
    const dy = event.screenY - drag.current.startY;
    if (!drag.current.moved && Math.hypot(dx, dy) > 4) {
      drag.current.moved = true;
    }
    drag.current.lastX = event.screenX;
    drag.current.lastY = event.screenY;
    if (!drag.current.raf) {
      drag.current.raf = window.requestAnimationFrame(() => {
        drag.current.raf = 0;
        sendMove();
      });
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current.active) return;
    drag.current.active = false;
    setPressed(false);
    if (drag.current.raf) {
      window.cancelAnimationFrame(drag.current.raf);
      drag.current.raf = 0;
    }
    window.tk.ball.dragEnd(event.screenX, event.screenY, drag.current.moved);
    scheduleIdle(2200);
  };

  const handleContextMenu = (event: React.MouseEvent) => {
    event.preventDefault();
    void window.tk.ball.contextMenu();
  };

  const autoHide = settings?.appearance.ballAutoHide ?? true;
  const opacity = settings?.appearance.ballOpacity ?? 1;
  const accent = settings?.appearance.accent ?? '#4C8DFF';

  return (
    <div
      className={`ball-root${idle && autoHide ? ' idle' : ''}${pressed ? ' pressed' : ''}${dock.docked ? ' docked' : ''}${dock.side ? ` dock-${dock.side}` : ''}`}
      style={
        {
          '--ball-opacity': opacity,
          '--ball-size': `${settings?.appearance.ballSize ?? 56}px`,
          '--tk-accent': accent,
        } as CSSProperties
      }
      onMouseEnter={() => {
        setIdle(false);
        if (idleTimer.current) window.clearTimeout(idleTimer.current);
        void window.tk.ball.setHover(true);
      }}
      onMouseLeave={() => {
        void window.tk.ball.setHover(false);
        if (!drag.current.active) scheduleIdle(1800);
      }}
    >
      <span className="edge-grip" aria-hidden="true">
        <i />
      </span>
      <div
        ref={orbRef}
        className="orb"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onContextMenu={handleContextMenu}
        role="button"
        aria-label="便捷工具"
      >
        <span className="orb-ring" />
        <span className="orb-sheen" />
        <span className="orb-glyph">
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="3.2" y="3.2" width="7.6" height="7.6" rx="2.1" fill="#ffffff" fillOpacity="0.96" />
            <rect x="13.2" y="3.2" width="7.6" height="7.6" rx="2.1" fill="#ffffff" fillOpacity="0.5" />
            <rect x="3.2" y="13.2" width="7.6" height="7.6" rx="2.1" fill="#ffffff" fillOpacity="0.34" />
            <rect x="13.2" y="13.2" width="7.6" height="7.6" rx="2.1" fill="#ffffff" fillOpacity="0.9" />
          </svg>
        </span>
        <span className="orb-glow" />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<BallApp />);


