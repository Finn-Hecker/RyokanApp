import assert from 'node:assert/strict';
import test from 'node:test';
import { canDragSheet, SheetVelocity, shouldDismissSheet } from './bottomSheetGesture.ts';

test('distance scales with sheet height and is capped for tall sheets', () => {
  assert.equal(shouldDismissSheet(89, 300, 0), false);
  assert.equal(shouldDismissSheet(90, 300, 0), true);
  assert.equal(shouldDismissSheet(179, 800, 0), false);
  assert.equal(shouldDismissSheet(180, 800, 0), true);
});

test('fast swipes dismiss, tiny movements and upward releases snap back', () => {
  assert.equal(shouldDismissSheet(40, 600, .8), true);
  assert.equal(shouldDismissSheet(10, 600, 2), false);
  assert.equal(shouldDismissSheet(40, 600, -.8), false);
});

test('velocity uses recent samples and forgets a held or reversed swipe', () => {
  const velocity = new SheetVelocity();
  velocity.add(0, 0);
  velocity.add(60, 60);
  assert.equal(velocity.get(60), 1);
  assert.equal(velocity.get(200), 0);
  velocity.add(60, 200);
  velocity.add(30, 230);
  assert.equal(velocity.get(230), -1);
});

test('all nested scroll containers must be at the top; editable controls opt out', () => {
  const previous = globalThis.getComputedStyle;
  globalThis.getComputedStyle = node => ({ overflowY: node.overflow });
  try {
    const panel = { scrollHeight: 500, clientHeight: 500, scrollTop: 0, overflow: 'hidden', contains: () => true };
    const outer = { parentElement: panel, scrollHeight: 800, clientHeight: 300, scrollTop: 20, overflow: 'auto' };
    const inner = { parentElement: outer, scrollHeight: 400, clientHeight: 200, scrollTop: 0, overflow: 'auto', closest: () => null };
    assert.equal(canDragSheet(inner, panel), false);
    outer.scrollTop = 0;
    assert.equal(canDragSheet(inner, panel), true);
    inner.scrollTop = 30;
    assert.equal(canDragSheet(inner, panel), false);
    inner.scrollTop = 0;
    inner.closest = () => ({});
    assert.equal(canDragSheet(inner, panel), false);
  } finally {
    globalThis.getComputedStyle = previous;
  }
});


test('an immediate upward reversal cancels the downward flick velocity', () => {
  const velocity = new SheetVelocity();
  velocity.add(0, 0); velocity.add(90, 30); velocity.add(60, 60);
  assert.equal(velocity.get(60), -1);
  assert.equal(shouldDismissSheet(60, 600, velocity.get(60)), false);
});
