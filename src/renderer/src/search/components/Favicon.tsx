/** 流光搜索 · 结果 favicon（远程图标，失败回退柔色字母） */
import { useMemo, useState } from 'react';
import { hostOf, hueOf, initialOf } from '../lib/format';

export function Favicon({
  url,
  label,
  size = 30,
  radius,
}: {
  url: string;
  label: string;
  size?: number;
  radius?: number;
}) {
  const host = useMemo(() => hostOf(url), [url]);
  const [failed, setFailed] = useState(false);
  const hue = useMemo(() => hueOf(host || label || 'x'), [host, label]);
  const style = {
    width: size,
    height: size,
    borderRadius: radius ?? Math.round(size * 0.32),
    background: `linear-gradient(150deg, hsl(${hue} 82% 96%), hsl(${(hue + 44) % 360} 78% 88%))`,
    color: `hsl(${hue} 52% 42%)`,
    fontSize: Math.max(10, Math.round(size * 0.42)),
  };

  if (!host || failed) {
    return (
      <span className="s-favicon fallback" style={style} aria-hidden="true">
        {initialOf(label || host || '?')}
      </span>
    );
  }

  return (
    <span className="s-favicon" style={{ ...style, background: 'rgba(255,255,255,0.72)' }} aria-hidden="true">
      <img
        src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`}
        alt=""
        width={Math.round(size * 0.62)}
        height={Math.round(size * 0.62)}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    </span>
  );
}
