import './theme/tokens.css';
import './theme/overlay.css';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const root = document.getElementById('overlay')!;
root.innerHTML = `
  <div class="shade"></div>
  <div class="crosshair crosshair-x"><i></i></div>
  <div class="crosshair crosshair-y"><i></i></div>
  <div class="selection" hidden>
    <span class="corner tl"></span><span class="corner tr"></span>
    <span class="corner bl"></span><span class="corner br"></span>
    <span class="size-badge">0 × 0</span>
  </div>
  <div class="overlay-hint">
    <span class="hint-dot"></span>
    <span class="hint-text">拖拽选择区域</span>
    <span class="hint-sep"></span>
    <span class="tk-kbd">Esc</span>
    <span class="hint-sub">取消</span>
  </div>
  <div class="overlay-tip" hidden>松开鼠标完成截图</div>
`;

const shade = root.querySelector<HTMLElement>('.shade')!;
const selection = root.querySelector<HTMLElement>('.selection')!;
const sizeBadge = root.querySelector<HTMLElement>('.size-badge')!;
const crosshairX = root.querySelector<HTMLElement>('.crosshair-x')!;
const crosshairY = root.querySelector<HTMLElement>('.crosshair-y')!;
const hintText = root.querySelector<HTMLElement>('.hint-text')!;
const overlayTip = root.querySelector<HTMLElement>('.overlay-tip')!;

let dragging = false;
let startX = 0;
let startY = 0;
let current: Rect = { x: 0, y: 0, width: 0, height: 0 };
let settled = false;

const params = new URLSearchParams(location.search);
hintText.textContent = params.get('hint') || '拖拽选择区域';

function moveCrosshair(x: number, y: number) {
  crosshairX.style.transform = `translateY(${y}px)`;
  crosshairY.style.transform = `translateX(${x}px)`;
}

function updateSelection(): Rect {
  const x = Math.min(startX, current.x);
  const y = Math.min(startY, current.y);
  const width = Math.abs(current.x - startX);
  const height = Math.abs(current.y - startY);
  const rect: Rect = { x, y, width, height };
  selection.style.transform = `translate(${x}px, ${y}px)`;
  selection.style.width = `${width}px`;
  selection.style.height = `${height}px`;
  sizeBadge.textContent = `${width} × ${height}`;
  const showBadgeX = Math.min(window.innerWidth - 84, x + width - 8);
  sizeBadge.style.left = `${showBadgeX}px`;
  sizeBadge.style.top = `${Math.max(6, y - 30)}px`;
  overlayTip.hidden = false;
  return rect;
}

function beginDrag(event: PointerEvent) {
  if (settled || event.button !== 0) return;
  dragging = true;
  startX = event.clientX;
  startY = event.clientY;
  current = { x: startX, y: startY, width: 0, height: 0 };
  selection.hidden = false;
  shade.classList.add('dimmed');
  crosshairX.classList.add('hidden');
  crosshairY.classList.add('hidden');
  updateSelection();
  window.tk.overlay.setHovering(true);
}

function moveDrag(event: PointerEvent) {
  if (!dragging) {
    moveCrosshair(event.clientX, event.clientY);
    return;
  }
  current = { x: event.clientX, y: event.clientY, width: 0, height: 0 };
  updateSelection();
}

function endDrag(event: PointerEvent) {
  if (!dragging || settled) return;
  dragging = false;
  const rect = updateSelection();
  if (rect.width >= 4 && rect.height >= 4) {
    settled = true;
    void window.tk.overlay.select(rect);
  } else {
    reset();
  }
}

function reset() {
  dragging = false;
  selection.hidden = true;
  shade.classList.remove('dimmed');
  crosshairX.classList.remove('hidden');
  crosshairY.classList.remove('hidden');
  overlayTip.hidden = true;
  window.tk.overlay.setHovering(false);
}

function cancel() {
  if (settled) return;
  settled = true;
  window.tk.overlay.cancel();
}

window.addEventListener('pointerdown', beginDrag);
window.addEventListener('pointermove', moveDrag);
window.addEventListener('pointerup', endDrag);
window.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  cancel();
});
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    cancel();
  }
});
window.addEventListener('blur', () => {
  // 失焦不取消，避免误触
});

void (async () => {
  try {
    const info = await window.tk.overlay.init();
    if (!info) {
      settled = true;
      return;
    }
    document.documentElement.style.setProperty('--scale', String(info.scaleFactor));
  } catch {
    cancel();
  }
})();





