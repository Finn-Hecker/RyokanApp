import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const tests = ['src', 'scripts'].flatMap(directory =>
  readdirSync(new URL(`${directory}/`, root), { recursive: true })
    .filter(file => file.endsWith('.test.mjs'))
    .map(file => fileURLToPath(new URL(`${directory}/${file.replaceAll('\\', '/')}`, root)))
).sort();

if (!tests.length) throw new Error('No frontend tests found');
const result = spawnSync(process.execPath, ['--experimental-strip-types', '--test', ...tests], {
  cwd: fileURLToPath(root),
  stdio: 'inherit',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
