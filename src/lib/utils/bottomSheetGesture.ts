export function shouldDismissSheet(distance: number, height: number, velocity: number) {
  return distance >= Math.min(180, height * 0.3) || (distance >= 24 && velocity >= 0.65);
}

/** Recent movement only: a pause or reversal must not count as a fast swipe. */
export class SheetVelocity {
  private samples: { y: number; time: number }[] = [];
  add(y: number, time: number) {
    const last = this.samples.at(-1), previous = this.samples.at(-2);
    if (last && previous && (y - last.y) * (last.y - previous.y) < 0) {
      this.samples = [last]; // A reversal must not inherit the preceding flick.
    }
    this.samples.push({ y, time });
    this.samples = this.samples.filter(sample => time - sample.time <= 100);
  }
  get(time: number) {
    const recent = this.samples.filter(sample => time - sample.time <= 100);
    if (recent.length < 2) return 0;
    const first = recent[0], last = recent[recent.length - 1];
    return (last.y - first.y) / Math.max(1, last.time - first.time);
  }
}

export function canDragSheet(target: HTMLElement, panel: HTMLElement) {
  if (target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [data-sheet-no-drag]')) return false;
  for (let node: HTMLElement | null = target; node && panel.contains(node); node = node.parentElement) {
    if (node.scrollHeight > node.clientHeight && /(auto|scroll)/.test(getComputedStyle(node).overflowY) && node.scrollTop > 0) return false;
    if (node === panel) break;
  }
  return true;
}
