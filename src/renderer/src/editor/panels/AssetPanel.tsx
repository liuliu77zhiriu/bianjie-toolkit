/**
 * 资源库（左侧「资源」页）
 *
 * - 本地图片通过 <input type=file> 导入，FileReader 转 dataURL（单张 ≤ 3MB）；
 * - 模块内缓存 + localStorage `uieditor.assets` 持久化；
 * - 点击缩略图把图片应用到当前选中的 image 节点（可多选批量，一次历史）；
 * - 无选中图片节点时给出提示，支持删除资源。
 */
import { useCallback, useRef, useState } from 'react';
import { editorStore } from '../store';
import { EmptyState, Glyph } from './controls';

const STORAGE_KEY = 'uieditor.assets';
const MAX_FILE_BYTES = 3 * 1024 * 1024;
const MAX_ASSETS = 24;

export interface EditorAsset {
  id: string;
  name: string;
  src: string;
  size: number;
  createdAt: number;
}

function isAsset(value: unknown): value is EditorAsset {
  if (!value || typeof value !== 'object') return false;
  const item = value as EditorAsset;
  return typeof item.id === 'string' && typeof item.src === 'string' && typeof item.name === 'string';
}

let assetCache: EditorAsset[] | null = null;

function loadAssets(): EditorAsset[] {
  if (assetCache) return assetCache;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    assetCache = Array.isArray(parsed) ? parsed.filter(isAsset) : [];
  } catch {
    assetCache = [];
  }
  return assetCache;
}

function persistAssets(assets: EditorAsset[]): boolean {
  assetCache = assets;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(assets));
    return true;
  } catch {
    return false;
  }
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('读取图片失败'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'));
    reader.readAsDataURL(file);
  });
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function newAssetId(): string {
  return `asset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function AssetPanel() {
  const [assets, setAssets] = useState<EditorAsset[]>(() => loadAssets());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const commitAssets = useCallback((next: EditorAsset[]) => {
    setAssets(next);
    if (!persistAssets(next)) {
      setError('本地空间不足：资源已导入，但刷新后可能丢失。');
    }
  }, []);

  const importFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || !files.length) return;
      setBusy(true);
      setError(null);
      try {
        const accepted: EditorAsset[] = [];
        const rejected: string[] = [];
        for (const file of Array.from(files)) {
          if (!file.type.startsWith('image/')) {
            rejected.push(`${file.name}（不是图片）`);
            continue;
          }
          if (file.size > MAX_FILE_BYTES) {
            rejected.push(`${file.name}（超过 3MB）`);
            continue;
          }
          try {
            const src = await readAsDataUrl(file);
            accepted.push({
              id: newAssetId(),
              name: file.name.replace(/\.[^.]+$/, '') || '图片',
              src,
              size: file.size,
              createdAt: Date.now(),
            });
          } catch {
            rejected.push(`${file.name}（读取失败）`);
          }
        }
        if (accepted.length) {
          const next = [...accepted, ...assets].slice(0, MAX_ASSETS);
          commitAssets(next);
        }
        if (rejected.length) setError(`已跳过：${rejected.join('、')}`);
      } finally {
        setBusy(false);
        if (fileRef.current) fileRef.current.value = '';
      }
    },
    [assets, commitAssets]
  );

  const applyAsset = (asset: EditorAsset) => {
    const project = editorStore.getProject();
    const imageIds = editorStore
      .getSnapshot()
      .selection.filter((id) => project.nodes[id]?.type === 'image');
    if (!imageIds.length) {
      setError('请先在画布或图层中选中一个「图片」节点，再点击资源应用。');
      return;
    }
    editorStore.updateNodes(imageIds, (node) => {
      node.image = { src: asset.src, fit: node.image?.fit ?? 'cover', alt: node.image?.alt ?? asset.name };
    });
    setError(null);
  };

  const removeAsset = (asset: EditorAsset) => {
    commitAssets(assets.filter((item) => item.id !== asset.id));
  };

  const totalSize = assets.reduce((sum, asset) => sum + asset.size, 0);

  return (
    <div className="up-assets">
      <div className="up-lib-head">
        <span className="up-panel-label">
          本地图片
          <span className="up-lib-count">{assets.length} 张 · {formatBytes(totalSize)}</span>
        </span>
        <button
          type="button"
          className="up-btn sm primary"
          title="导入本地图片（单张 ≤ 3MB）"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          <Glyph name="upload" size={12} />
          <span>{busy ? '导入中…' : '导入图片'}</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          aria-label="选择本地图片"
          onChange={(event) => void importFiles(event.target.files)}
        />
      </div>

      {error ? (
        <div className="up-alert">
          <span>{error}</span>
          <button type="button" className="up-alert-close" aria-label="关闭提示" onClick={() => setError(null)}>
            <Glyph name="close" size={11} />
          </button>
        </div>
      ) : null}

      <div className="up-scroll up-asset-scroll">
        {assets.length === 0 ? (
          <EmptyState
            icon="image"
            title="还没有本地资源"
            hint="导入图片后，选中画布中的图片节点并点击缩略图即可应用。"
          >
            <button type="button" className="up-btn sm" onClick={() => fileRef.current?.click()} disabled={busy}>
              选择图片…
            </button>
          </EmptyState>
        ) : (
          <>
            <div className="up-asset-grid" role="list" aria-label="本地图片资源">
              {assets.map((asset) => (
                <div key={asset.id} className="up-asset-card" role="listitem">
                  <button
                    type="button"
                    className="up-asset-apply"
                    title={`应用「${asset.name}」到选中的图片节点`}
                    aria-label={`应用图片 ${asset.name}`}
                    onClick={() => applyAsset(asset)}
                  >
                    <img className="up-asset-img" src={asset.src} alt={asset.name} loading="lazy" />
                    <span className="up-asset-name" title={asset.name}>
                      {asset.name}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="up-asset-del"
                    title="删除资源"
                    aria-label={`删除资源 ${asset.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      removeAsset(asset);
                    }}
                  >
                    <Glyph name="trash" size={11} />
                  </button>
                </div>
              ))}
            </div>
            <p className="up-lib-note">
              <Glyph name="info" size={12} />
              <span>点击缩略图应用到选中的图片节点；资源保存在本机，不会上传。</span>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
