import assert from 'node:assert/strict';
import test from 'node:test';
import { supportedImageFormat } from './imageFormats.ts';

test('recognizes supported avatar formats from bytes rather than filename or MIME type', () => {
  const text = value => new TextEncoder().encode(value);
  assert.equal(supportedImageFormat(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])), 'png');
  assert.equal(supportedImageFormat(new Uint8Array([255, 216, 255, 224])), 'jpeg');
  assert.equal(supportedImageFormat(text('GIF87a')), 'gif');
  assert.equal(supportedImageFormat(text('GIF89a')), 'gif');
  assert.equal(supportedImageFormat(text('RIFF1234WEBP')), 'webp');
});

test('rejects unsupported, truncated and misleading image signatures', () => {
  for (const bytes of [
    [], [137, 80, 78, 71], [255, 216],
    [...new TextEncoder().encode('BM')],
    [...new TextEncoder().encode('<svg></svg>')],
    [...new TextEncoder().encode('RIFF1234WAVE')],
    [0, 0, 0, 32, ...new TextEncoder().encode('ftypavif')],
  ]) assert.equal(supportedImageFormat(new Uint8Array(bytes)), null);
});
