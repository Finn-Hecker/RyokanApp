import { readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
export function makeConfig(channel, publicKey, version, targetVersion) {
  if (!['stable', 'test'].includes(channel)) throw new Error('Channel must be stable or test');
  const decoded = Buffer.from(publicKey || '', 'base64').toString('utf8').trim().split(/\r?\n/);
  if (!decoded[0]?.startsWith('untrusted comment:') || Buffer.from(decoded[1] || '', 'base64').length !== 42) {
    throw new Error('Set TAURI_UPDATER_PUBLIC_KEY to the full contents of the signer .pub file');
  }
  const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  if (!stableVersion.test(version)) throw new Error('Version must be a stable numeric x.y.z');
  const config = { plugins: { updater: { pubkey: publicKey.trim() } } };
  if (channel === 'test') {
    if (!stableVersion.test(targetVersion || '')) throw new Error('Test target must be a stable numeric x.y.z');
    if (version.split('.').some((n, i) => Number(n) > 65535)) throw new Error('Test version exceeds Windows version limits');
    Object.assign(config, {
      version, productName: 'Ryokan Updater Test', identifier: 'ryokan.updater-test',
      app: { windows: [{ label: 'main', title: 'Ryokan Updater Test', width: 800, height: 850, dragDropEnabled: false }] },
    });
    config.plugins.updater.endpoints = [
      `https://github.com/Finn-Hecker/RyokanApp/releases/download/updater-test-v${targetVersion}/latest.json`,
    ];
  }
  return config;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const channel = process.argv[2];
  const productionVersion = JSON.parse(readFileSync(resolve(root, 'src-tauri/tauri.conf.json'), 'utf8')).version;
  const version = channel === 'test' ? process.argv[3] : productionVersion;
  const config = makeConfig(channel, process.env.TAURI_UPDATER_PUBLIC_KEY, version, process.argv[4]);
  writeFileSync(resolve(root, 'src-tauri/updater.generated.json'), JSON.stringify(config, null, 2) + '\n');
  const tag = channel === 'test' ? `updater-test-v${version}` : `v${version}`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `tag=${tag}\n`);
  console.log(`Prepared ${channel} ${version} config (public key only). Production version unchanged.`);
}
