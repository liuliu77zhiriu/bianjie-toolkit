import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronBin = path.join(rootDir, 'node_modules/electron/dist/electron.exe');

const args = ['.', ...process.argv.slice(2)];
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
env.TK_APP_ROOT = rootDir;
if (!env.TK_HOME) env.TK_HOME = '';

const child = spawn(electronBin, args, { cwd: rootDir, env, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
