import { protocol, net } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { AppPaths } from '../../shared/types';
import type { Logger } from './logger';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

export type PluginResolver = (pluginId: string, relativePath: string) => string | null;

export function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'tk',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

export class TkProtocol {
  private resolver: PluginResolver | null = null;
  private allowedRoots: string[] = [];

  constructor(private paths: AppPaths, private logger: Logger) {
    this.allowedRoots = [
      path.resolve(paths.userData),
      path.resolve(paths.screenshots),
      path.resolve(paths.recordings),
      path.resolve(paths.temp),
      path.resolve(paths.resourcesDir),
    ];
  }

  setPluginResolver(resolver: PluginResolver) {
    this.resolver = resolver;
  }

  setAllowedRoots(roots: string[]) {
    const unique = new Set(roots.map((r) => path.resolve(r)).filter(Boolean));
    this.allowedRoots = Array.from(unique);
  }

  install() {
    protocol.handle('tk', async (request) => {
      try {
        return await this.handle(request);
      } catch (err) {
        this.logger.warn('[protocol] 请求失败', request.url, err);
        return new Response('Not found', { status: 404 });
      }
    });
  }

  private async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const host = url.hostname;
    const pathname = decodeURIComponent(url.pathname);

    if (host === 'app') return this.serveFile(path.join(this.paths.rendererDir, pathname), false);
    if (host === 'plugin-sdk') return this.serveFile(path.join(this.paths.resourcesDir, 'plugin-sdk', pathname), false);
    if (host === 'assets') return this.serveFile(path.join(this.paths.resourcesDir, pathname), false);
    if (host === 'file') return this.serveAllowedFile(pathname);
    if (host === 'plugin') {
      const trimmed = pathname.replace(/^\/+/, '');
      const slash = trimmed.indexOf('/');
      if (slash <= 0) return new Response('Bad plugin path', { status: 400 });
      const pluginId = trimmed.slice(0, slash);
      const relative = trimmed.slice(slash + 1);
      if (!this.resolver) return new Response('Plugin resolver not ready', { status: 503 });
      if (relative.includes('..')) return new Response('Forbidden', { status: 403 });
      const abs = this.resolver(pluginId, relative);
      if (!abs) return new Response('Plugin file not found', { status: 404 });
      return this.serveFile(abs, true);
    }
    return new Response('Unknown tk host', { status: 404 });
  }

  private async serveAllowedFile(urlPath: string): Promise<Response> {
    const encoded = urlPath.replace(/^\/+/, '');
    let decoded = '';
    try {
      decoded = Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
    } catch {
      return new Response('Bad path', { status: 400 });
    }
    const abs = path.resolve(decoded);
    if (!this.isAllowed(abs)) return new Response('Forbidden', { status: 403 });
    return this.serveFile(abs, false);
  }

  private isAllowed(abs: string): boolean {
    return this.allowedRoots.some((root) => {
      const rel = path.relative(root, abs);
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    });
  }

  private async serveFile(abs: string, noCache: boolean): Promise<Response> {
    const resolved = path.resolve(abs);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(resolved);
    } catch {
      return new Response('Not found', { status: 404 });
    }
    if (!stat.isFile()) return new Response('Not found', { status: 404 });
    if (stat.size > 200 * 1024 * 1024) return new Response('Too large', { status: 413 });

    const mime = MIME[path.extname(resolved).toLowerCase()] ?? 'application/octet-stream';
    // 媒体文件交给 net.fetch 以支持 range 请求；小文本/资源直接读入并显式设置 MIME。
    if (stat.size > 4 * 1024 * 1024 && (mime.startsWith('video/') || mime.startsWith('audio/'))) {
      const res = await net.fetch(pathToFileURL(resolved).toString());
      const headers = new Headers(res.headers);
      if (!headers.get('content-type')) headers.set('content-type', mime);
      return new Response(res.body, { status: res.status, headers });
    }
    const data = await fs.promises.readFile(resolved);
    const headers = new Headers({
      'content-type': mime,
      'content-length': String(data.byteLength),
      'cache-control': noCache ? 'no-store' : 'no-cache',
    });
    if (noCache) headers.set('access-control-allow-origin', '*');
    return new Response(new Uint8Array(data), { status: 200, headers });
  }
}
