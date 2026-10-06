import assert from 'node:assert/strict';
import test from 'node:test';
import { get } from 'svelte/store';
import { exportFeedback, showExportFeedback, clearExportFeedback } from './exportFeedback.ts';

test('one shared toast replaces old feedback and cancellation clears its timer', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  showExportFeedback('success', 'Preset exportiert.');
  t.mock.timers.tick(2000);
  showExportFeedback('error', 'Export fehlgeschlagen.');
  t.mock.timers.tick(800);
  assert.deepEqual(get(exportFeedback), { type: 'error', message: 'Export fehlgeschlagen.' });
  t.mock.timers.tick(4200);
  assert.equal(get(exportFeedback), null);
  showExportFeedback('success', 'Diagnose exportiert.');
  clearExportFeedback();
  t.mock.timers.tick(2800);
  assert.equal(get(exportFeedback), null);
});
