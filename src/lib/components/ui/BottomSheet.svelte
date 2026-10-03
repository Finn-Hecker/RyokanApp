<script module lang="ts">
  // Keep the background locked until the last modal's outro actually finishes.
  let locks = 0;
  let previousOverflow = '';
  function lockBackground(node: HTMLDialogElement) {
    document.body.appendChild(node);
    if (locks++ === 0) {
      previousOverflow = document.documentElement.style.overflow;
      document.documentElement.style.overflow = 'hidden';
    }
    return { destroy() {
      node.close();
      if (--locks === 0) document.documentElement.style.overflow = previousOverflow;
      node.remove();
    } };
  }
</script>

<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import * as m from '$lib/paraglide/messages';
  import { registerBackHandler } from '$lib/stores/navigation';
  import { androidViewport } from '$lib/utils/androidViewport';
  import { canDragSheet, SheetVelocity, shouldDismissSheet } from '$lib/utils/bottomSheetGesture';

  let { onClose, label, children, header, toolbar, footer, onScroll, desktop = 'center', width = '560px', height = 'auto', dismissible = true,
    beforeClose, breakpoint = 640, mobileOnly = false, forceMobile = false, describedBy, mobileHeight, compactMobileHeight, maxHeight = '100%', closeLabel = m.create_char_close_aria() }: {
    onClose: () => void; label: string; children: Snippet<[(after?: (() => void) | Event) => void]>;
    header?: Snippet; toolbar?: Snippet; footer?: Snippet<[(after?: (() => void) | Event) => void]>;
    onScroll?: (event: Event & { currentTarget: EventTarget & HTMLDivElement }) => void;
    desktop?: 'center' | 'side'; width?: string; height?: string; dismissible?: boolean;
    beforeClose?: () => boolean; breakpoint?: number; mobileOnly?: boolean; forceMobile?: boolean; describedBy?: string;
    mobileHeight?: string; compactMobileHeight?: string; maxHeight?: string; closeLabel?: string;
  } = $props();
  let dialog = $state<HTMLDialogElement>()!;
  let panel = $state<HTMLDivElement>()!;
  let backdrop = $state<HTMLButtonElement>()!;
  let visible = $state(true);
  let mobile = $state(false);
  let reduced = $state(false);
  let ready = false;
  let distance = 0;
  let sheetHeight = 1;
  let gesture: { id: number; x: number; y: number; target: HTMLElement; dragging: boolean; velocity: SheetVelocity } | null = null;
  let settling: Animation[] = [];

  let alive = true;
  function close(after?: (() => void) | Event) {
    if (!visible || !dismissible) return;
    if (beforeClose?.()) return;
    visible = false;
    gesture = null;
    const transform = getComputedStyle(panel).transform;
    const opacity = getComputedStyle(backdrop).opacity;
    panel.inert = true;
    settling.forEach(animation => animation.cancel());
    const options: KeyframeAnimationOptions = { duration: reduced ? 0 : 220, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' };
    settling = [panel.animate([{ transform: transform === 'none' ? 'translate3d(0,0,0)' : transform },
      { transform: mobile ? `translate3d(0,${panel.getBoundingClientRect().height}px,0)` : 'translate3d(0,24px,0)' }], options),
      backdrop.animate([{ opacity }, { opacity: 0 }], options)];
    const finish = () => {
      if (!alive) return;
      // Release native focus/inertness before an action focuses an input or
      // opens a non-native confirmation elsewhere in the application.
      dialog.close();
      onClose();
      if (typeof after === 'function') after();
    };
    void Promise.all(settling.map(animation => animation.finished)).then(finish, finish);
  }

  function releaseForOutro() {
    if (!visible) return;
    // External parent changes (navigation, viewport switches, async success)
    // must release native inertness before the replacement UI tries to focus.
    visible = false;
    gesture = null;
    dialog.setAttribute('data-exiting', '');
    dialog.inert = true;
    dialog.close();
  }

  function backdropMotion(node: HTMLElement) {
    const opacity = Number(node.style.opacity || 1);
    return { duration: reduced || !visible ? 0 : 260, css: (t: number) => `opacity:${t * opacity}` };
  }

  function motion(node: HTMLElement) {
    const isMobile = forceMobile || window.matchMedia(`(max-width: ${breakpoint - 1}px)`).matches;
    const offset = distance || (isMobile ? node.getBoundingClientRect().height : 24);
    return { duration: reduced || !visible ? 0 : 260, easing: (t: number) => 1 - Math.pow(1 - t, 3),
      css: (t: number) => isMobile ? `transform:translate3d(0,${(1-t)*offset}px,0)`
        : `opacity:${t};transform:translate3d(${desktop === 'side' ? (1-t)*24 : 0}px,${desktop === 'center' ? (1-t)*12 : 0}px,0)` };
  }

  function paint() {
    panel.style.transform = `translate3d(0,${distance}px,0)`;
    backdrop.style.opacity = String(Math.max(0, 1 - distance / sheetHeight));
  }
  function snapBack() {
    const options = { duration: reduced ? 0 : 320, easing: 'cubic-bezier(.16,1,.3,1)' };
    settling = [panel.animate([{ transform: `translate3d(0,${distance}px,0)` }, { transform: 'translate3d(0,0,0)' }], options),
      backdrop.animate([{ opacity: backdrop.style.opacity || '1' }, { opacity: 1 }], options)];
    distance = 0;
    paint();
  }
  function start(id: number, x: number, y: number, target: EventTarget | null) {
    if (!mobile || !dismissible || !visible || !ready || !(target instanceof Element)) return;
    const element = target instanceof HTMLElement ? target : target.parentElement;
    if (!element || element.closest('dialog') !== dialog) return;
    if (settling.some(animation => animation.playState === 'running')) {
      const transform = getComputedStyle(panel).transform;
      distance = transform === 'none' ? 0 : Math.max(0, new DOMMatrixReadOnly(transform).m42);
      settling.forEach(animation => animation.cancel());
      paint();
    }
    sheetHeight = panel.getBoundingClientRect().height;
    const velocity = new SheetVelocity();
    velocity.add(y, performance.now());
    gesture = { id, x, y: y - distance, target: element, dragging: distance > 0, velocity };
  }
  function move(x: number, y: number, event: Event) {
    if (!gesture) return;
    const dx = x - gesture.x, dy = y - gesture.y;
    gesture.velocity.add(y, performance.now());
    if (!gesture.dragging) {
      if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 8) { gesture = null; return; }
      if (!canDragSheet(gesture.target, panel) || dy < 0) { gesture.y = y; gesture.velocity = new SheetVelocity(); gesture.velocity.add(y, performance.now()); return; }
      if (dy < 8) return;
      gesture.dragging = true;
    }
    if (!event.cancelable) { end(true); return; }
    event.preventDefault();
    distance = Math.max(0, dy);
    paint();
  }
  function end(cancelled = false) {
    if (!gesture) return;
    const dragged = gesture.dragging;
    const velocity = gesture.velocity.get(performance.now());
    gesture = null;
    if (!dragged) return;
    if (!cancelled && shouldDismissSheet(distance, sheetHeight, velocity)) close();
    if (visible) snapBack();
    // Suppress the synthetic click after dragging across an action button.
    suppressClickUntil = performance.now() + 400;
  }
  let suppressClickUntil = 0;

  onMount(() => {
    const query = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const sync = () => {
      mobile = forceMobile || query.matches; end(true);
      if (mobileOnly && !mobile) {
        visible = false;
        dialog.close();
        onClose();
      }
    };
    sync();
    if (!visible) return;
    query.addEventListener('change', sync);
    reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    dialog.showModal();
    const timer = setTimeout(() => ready = true, reduced ? 0 : 280);
    const unregister = registerBackHandler(() => { if (!dismissible || !dialog.open) return false; close(); return true; });
    const touchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) { end(true); return; }
      const touch = event.touches[0]; start(touch.identifier, touch.clientX, touch.clientY, event.target);
    };
    const touchMove = (event: TouchEvent) => {
      if (event.touches.length !== 1) { end(true); return; }
      const touch = Array.from(event.touches).find(touch => touch.identifier === gesture?.id);
      if (touch) move(touch.clientX, touch.clientY, event);
    };
    const touchEnd = (event: TouchEvent) => {
      const touch = Array.from(event.changedTouches).find(touch => touch.identifier === gesture?.id);
      if (touch && gesture?.dragging) {
        gesture.velocity.add(touch.clientY, performance.now());
        distance = Math.max(0, touch.clientY - gesture.y);
        paint();
      }
      end();
    };
    const touchCancel = () => end(true);
    const click = (event: MouseEvent) => { if (performance.now() < suppressClickUntil) { event.preventDefault(); event.stopPropagation(); } };
    panel.addEventListener('touchstart', touchStart, { passive: true });
    panel.addEventListener('touchmove', touchMove, { passive: false });
    panel.addEventListener('touchend', touchEnd);
    panel.addEventListener('touchcancel', touchCancel);
    panel.addEventListener('click', click, true);
    return () => {
      alive = false;
      dialog.close();
      clearTimeout(timer); unregister(); query.removeEventListener('change', sync);
      settling.forEach(animation => animation.cancel());
      panel.removeEventListener('touchstart', touchStart); panel.removeEventListener('touchmove', touchMove);
      panel.removeEventListener('touchend', touchEnd); panel.removeEventListener('touchcancel', touchCancel);
      panel.removeEventListener('click', click, true);
    };
  });
</script>

<dialog bind:this={dialog} use:androidViewport use:lockBackground class:mobile class:side={desktop === 'side'} aria-label={label} aria-describedby={describedBy} data-exiting={visible ? undefined : ''}
    oncancel={(event) => { event.preventDefault(); close(); }} style={`--sheet-width:${width};--sheet-height:${height};--sheet-max-height:${maxHeight};--sheet-mobile-height:${mobileHeight ?? height};--sheet-compact-height:${compactMobileHeight ?? mobileHeight ?? height}`}>
    <button bind:this={backdrop} class="backdrop" aria-label={closeLabel} tabindex="-1" onclick={close} transition:backdropMotion|global></button>
    <div bind:this={panel} class="panel" transition:motion|global onoutrostart={releaseForOutro}>
      {#if dismissible}
      <div class="handle" aria-hidden="true"
        onpointerdown={(event) => { if (event.pointerType !== 'touch') { start(event.pointerId, event.clientX, event.clientY, event.currentTarget); event.currentTarget.setPointerCapture(event.pointerId); } }}
        onpointermove={(event) => { if (event.pointerType !== 'touch' && gesture?.id === event.pointerId) move(event.clientX, event.clientY, event); }}
        onpointerup={(event) => { if (event.pointerType !== 'touch') end(); }} onpointercancel={(event) => { if (event.pointerType !== 'touch') end(true); }}><span></span></div>
      {/if}
      <header class="sheet-header">
        <div class="sheet-heading">{#if header}{@render header()}{:else}<h2>{label}</h2>{/if}</div>
        {#if dismissible}
          <button type="button" class="sheet-close" aria-label={closeLabel} onclick={close}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
          </button>
        {/if}
      </header>
      {#if toolbar}<div class="sheet-toolbar">{@render toolbar()}</div>{/if}
      <div class="content" data-sheet-body onscroll={onScroll}>{@render children(close)}</div>
      {#if footer}<footer class="sheet-footer">{@render footer(close)}</footer>{/if}
    </div>
</dialog>

<style>
  dialog { position:fixed; inset:0; width:100%; height:var(--app-visible-height,100dvh); max-width:none; max-height:none; margin:0; padding:max(24px,env(safe-area-inset-top)) max(24px,env(safe-area-inset-right)) max(24px,env(safe-area-inset-bottom)) max(24px,env(safe-area-inset-left)); border:0; background:transparent; color:inherit; overflow:hidden; }
  dialog[open], dialog[data-exiting] { display:flex; align-items:center; justify-content:center; }
  dialog[data-exiting] { z-index:1200; pointer-events:none; }
  dialog::backdrop { background:transparent; }
  /* showModal() can initially focus this full-screen button even with tabindex=-1.
     It is outside the Tab order; keep focus indicators on the sheet's controls. */
  .backdrop { position:absolute; inset:0; width:100%; height:100%; border:0; outline:none; background:rgba(8,8,12,.65); backdrop-filter:blur(4px); will-change:opacity; }
  .panel { --sheet-gutter:20px; position:relative; display:flex; flex-direction:column; width:min(var(--sheet-width),100%); height:var(--sheet-height); max-height:min(var(--sheet-max-height),100%); min-height:0; border:1px solid var(--sheet-border); border-radius:22px; background:var(--sheet-bg); color:var(--sheet-text); font-size:14px; line-height:1.5; box-shadow:0 24px 80px rgba(0,0,0,.48),0 1px 0 rgba(255,255,255,.025) inset; overflow:hidden; will-change:transform; -webkit-user-select:none; user-select:none; }
  .panel, .panel :global(*) { scrollbar-width:none; -ms-overflow-style:none; }
  .panel::-webkit-scrollbar, .panel :global(*::-webkit-scrollbar) { display:none; width:0; height:0; }
  .panel :global(input), .panel :global(textarea), .panel :global([contenteditable="true"]) { -webkit-user-select:text; user-select:text; }
  .panel :global(button:focus-visible) { outline:2px solid var(--color-ryokan-accent); outline-offset:2px; }
  .sheet-header { display:flex; align-items:center; gap:12px; flex:0 0 auto; padding:16px var(--sheet-gutter) 12px; border-bottom:1px solid var(--sheet-divider); }
  .sheet-heading { flex:1; min-width:0; }
  .sheet-heading :global(h1), .sheet-heading :global(h2), .sheet-heading :global(h3) { margin:0; color:var(--sheet-text); font-size:18px; font-weight:650; line-height:1.35; letter-spacing:-.01em; }
  .sheet-heading :global(p) { margin:4px 0 0; color:var(--sheet-text-muted); font-size:12px; line-height:1.4; }
  .sheet-close { display:grid; place-items:center; flex:0 0 44px; width:44px; height:44px; border:0; border-radius:14px; background:var(--sheet-surface); color:var(--sheet-text-muted); cursor:pointer; transition:background 140ms,color 140ms,transform 140ms; }
  .sheet-close:hover { background:var(--sheet-surface-hover); color:var(--sheet-text); }
  .sheet-close:active { transform:scale(.94); }
  .sheet-close:focus-visible { outline:2px solid var(--color-ryokan-accent); outline-offset:2px; }
  .sheet-toolbar { flex:0 0 auto; padding:12px var(--sheet-gutter); border-bottom:1px solid var(--sheet-divider); }
  .content { flex:1 1 auto; min-height:0; overflow-y:auto; overflow-x:hidden; padding:16px var(--sheet-gutter); overscroll-behavior-y:contain; }
  .sheet-footer { flex:0 0 auto; padding:16px var(--sheet-gutter); border-top:1px solid var(--sheet-divider); }
  .sheet-footer :global(.sheet-footer-actions) { display:flex; justify-content:flex-end; gap:8px; }
  .sheet-footer :global(.sheet-footer-actions > button) { min-height:48px; border-radius:14px; font-size:14px; font-weight:600; letter-spacing:0; }
  .sheet-footer :global(button[data-variant="primary"]) { background:var(--color-ryokan-accent); color:#211c16; box-shadow:0 3px 12px rgba(212,180,131,.1); }
  .sheet-footer :global(button[data-variant="primary"]:hover:not(:disabled)) { background:#dfc39c; }
  .sheet-footer :global(button[data-variant="secondary"]) { background:var(--sheet-surface); border-color:var(--sheet-border); color:var(--sheet-text); }
  .sheet-footer :global(button[data-variant="secondary"]:hover:not(:disabled)) { background:var(--sheet-surface-hover); }
  .sheet-footer :global(button[data-variant="danger"]) { background:var(--sheet-danger-surface); border-color:rgba(239,68,68,.18); color:var(--sheet-danger); }
  .handle { display:none; }
  dialog.side:not(.mobile) { padding:0; justify-content:flex-end; }
  .side:not(.mobile) .panel { height:100%; border-radius:0; padding-top:env(safe-area-inset-top); padding-right:env(safe-area-inset-right); padding-bottom:env(safe-area-inset-bottom); }
  dialog.mobile { padding:calc(env(safe-area-inset-top) + 12px) 0 0; align-items:flex-end; }
  .mobile .panel { height:var(--sheet-mobile-height); width:100%; max-height:min(calc(var(--app-visible-height,100dvh) * .9),calc(var(--app-visible-height,100dvh) - env(safe-area-inset-top) - 12px)); border-radius:22px 22px 0 0; border-width:1px 0 0; padding-bottom:env(safe-area-inset-bottom); }
  .mobile .panel { --sheet-gutter:16px; }
  .mobile .sheet-header { padding-top:6px; padding-bottom:12px; }
  .mobile .panel:not(:has(.handle)) .sheet-header { padding-top:20px; }
  .mobile .content, .mobile .sheet-header, .mobile .sheet-toolbar, .mobile .sheet-footer { padding-left:calc(var(--sheet-gutter) + env(safe-area-inset-left)); padding-right:calc(var(--sheet-gutter) + env(safe-area-inset-right)); }
  .mobile .sheet-footer :global(.sheet-footer-actions > button) { flex:1; }
  .mobile .handle { display:flex; flex:0 0 26px; align-items:center; justify-content:center; touch-action:none; user-select:none; }
  @media (max-height:500px) { .mobile .panel { height:var(--sheet-compact-height); max-height:calc(var(--app-visible-height,100dvh) - env(safe-area-inset-top) - 12px); } }
  .handle span { width:38px; height:4px; border-radius:999px; background:rgba(255,255,255,.16); }
  @media (prefers-reduced-motion:reduce) { .sheet-close { transition:none; } }
</style>
