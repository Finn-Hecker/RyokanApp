import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const activity = 'Lio/ryokan/app/MainActivity;';

// Framework methods such as Activity.finish() are inherited and not shrunk by R8.
export function customBridgeMethods(rust, kotlin) {
  const declared = new Set([...kotlin.matchAll(/\bfun\s+(\w+)\s*\(/g)].map(match => match[1]));
  const calls = [...rust.matchAll(/\.call_method\s*\(\s*\w+\s*,\s*"([^"]+)"\s*,\s*"([^"]+)"/g)];
  return [...new Map(calls.filter(match => declared.has(match[1]))
    .map(match => [`${match[1]}${match[2]}`, { name: match[1], signature: match[2] }])).values()];
}

export function assertBridgeRetained(dumps, methods) {
  assert.ok(methods.length, 'No custom JNI bridge methods found');
  // Match definitions in the owning class, not strings or method references.
  const classes = dumps.flatMap(dump => dump.split(/^Class #\d+/m))
    .filter(section => section.match(/Class descriptor\s*:\s*'([^']+)'/)?.[1] === activity);
  assert.equal(classes.length, 1, 'MainActivity must retain its JNI class name');
  const definitions = [...classes[0].matchAll(/name\s*:\s*'([^']+)'\s+type\s*:\s*'([^']+)'\s+access\s*:\s*0x[\da-f]+\s*\(([^)]*)\)/gi)];
  for (const { name, signature } of methods) {
    assert.ok(definitions.some(match => match[1] === name && match[2] === signature
      && /\bPUBLIC\b/.test(match[3]) && !/\bSTATIC\b/.test(match[3])),
    `Missing public instance JNI method: ${activity}.${name}${signature}`);
  }
}

function run(command, args, encoding = 'utf8') {
  const result = spawnSync(command, args, { encoding, maxBuffer: 128 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr}`);
  return result.stdout;
}

export function verifyApk(apk, dexdump) {
  const sources = readdirSync(join(root, 'src-tauri/src'), { recursive: true })
    .filter(file => file.endsWith('.rs'))
    .map(file => readFileSync(join(root, 'src-tauri/src', file), 'utf8')).join('\n');
  const kotlin = readFileSync(join(root, 'src-tauri/gen/android/app/src/main/java/io/ryokan/app/MainActivity.kt'), 'utf8');
  const methods = customBridgeMethods(sources, kotlin);
  const entries = run('tar', ['-tf', apk]).split(/\r?\n/).filter(name => /^classes(?:\d+)?\.dex$/.test(name));
  assert.ok(entries.length, 'APK contains no DEX files');
  const temp = mkdtempSync(join(tmpdir(), 'ryokan-bridge-'));
  try {
    const dumps = entries.map(entry => {
      const path = join(temp, entry);
      writeFileSync(path, run('tar', ['-xOf', apk, entry], null));
      return run(dexdump, [path]);
    });
    assertBridgeRetained(dumps, methods);
    return methods;
  } finally {
    // Only the absolute directory created by mkdtemp above is removed.
    rmSync(temp, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [apk, dexdump] = process.argv.slice(2);
  assert.ok(apk && dexdump, 'Usage: node scripts/verify-android-bridge.mjs <release.apk> <SDK dexdump>');
  const methods = verifyApk(resolve(apk), resolve(dexdump));
  console.log(`APK bridge verified: ${methods.map(method => method.name + method.signature).join(', ')}`);
}
