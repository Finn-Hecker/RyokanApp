<script lang="ts">
  import { onMount } from 'svelte';
  import { flip } from 'svelte/animate';
  import { cubicOut } from 'svelte/easing';
  import { sortableRules } from '$lib/components/settings/sortableRules';
  import { appState } from '$lib/stores/appState.svelte';
  import * as m from '$lib/paraglide/messages';
  import BottomSheet from '$lib/components/ui/BottomSheet.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Tooltip from '$lib/components/ui/Tooltip.svelte';
  import { previewTextRule, TEXT_RULE_SCOPES, TEXT_RULE_TARGETS, TEXT_RULE_TEMPLATES, type TextRule } from '$lib/ai/prompt/textRules';

  let choosingTemplate = $state(false);
  let draft = $state<TextRule | null>(null);
  let sample = $state('');
  let mobile = $state(false);
  let reducedMotion = $state(false);
  let sampleOpen = $state(true);
  onMount(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => mobile = query.matches;
    const syncMotion = () => reducedMotion = motion.matches;
    sync(); query.addEventListener('change', sync);
    syncMotion(); motion.addEventListener('change', syncMotion);
    return () => {
      query.removeEventListener('change', sync);
      motion.removeEventListener('change', syncMotion);
    };
  });
  const preview = $derived(draft ? previewTextRule(sample, draft) : null);
  const validSelection = $derived(Boolean(draft?.name.trim() && draft.scopes.length && draft.targets.length));
  const scopes = $derived({ user: m.text_rules_scope_user(), assistant: m.text_rules_scope_assistant(), reasoning: m.text_rules_scope_reasoning(), lorebook: m.text_rules_scope_lorebook() });
  const targets = $derived({ display: m.text_rules_target_display(), send: m.text_rules_target_send() });
  const templates = $derived({ name: m.text_rules_template_name(), replace: m.text_rules_template_replace(), remove: m.text_rules_template_remove(), lines: m.text_rules_template_lines() });

  function create(template?: typeof TEXT_RULE_TEMPLATES[number]) {
    choosingTemplate = false;
    draft = { id: crypto.randomUUID(), name: template ? templates[template.id] : '', pattern: template?.pattern ?? '', replacement: template?.replacement ?? '', flags: template?.flags ?? 'g', enabled: true, scopes: [template?.scope ?? 'assistant'], targets: ['display'] };
    sample = template?.example ?? '';
    sampleOpen = !mobile || !template;
  }
  function edit(rule: TextRule) {
    draft = { ...rule, scopes: [...rule.scopes], targets: [...rule.targets] };
    sample = '';
    sampleOpen = true;
  }
  function commit() {
    if (!draft || preview?.error || !validSelection) return;
    const rule = { ...draft, name: draft.name.trim(), scopes: [...draft.scopes], targets: [...draft.targets] };
    if (appState.textRules.some(item => item.id === rule.id)) appState.textRules = appState.textRules.map(item => item.id === rule.id ? rule : item);
    else appState.textRules = [...appState.textRules, rule];
  }
  let previewOrder = $state<TextRule[] | null>(null);
  let draggingId = $state<string | null>(null);
  const orderedRules = $derived(previewOrder ?? appState.textRules);
  function previewMove(id: string, index: number) {
    const rules = [...appState.textRules];
    const from = rules.findIndex(rule => rule.id === id);
    if (from < 0) return;
    const [rule] = rules.splice(from, 1);
    rules.splice(Math.max(0, Math.min(index, rules.length)), 0, rule);
    draggingId = id;
    if (previewOrder?.every((item, i) => item.id === rules[i]?.id)) return;
    previewOrder = rules;
  }
  function finishMove(commit: boolean) {
    if (commit && previewOrder) appState.textRules = previewOrder;
    previewOrder = null;
    draggingId = null;
  }
  function keyboardMove(event: KeyboardEvent, id: string) {
    if (event.target !== event.currentTarget || !event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    previewMove(id, appState.textRules.findIndex(rule => rule.id === id) + (event.key === 'ArrowUp' ? -1 : 1));
    finishMove(true);
  }

</script>

{#snippet actionIcon(action: 'edit' | 'delete' | 'add')}
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {#if action === 'edit'}<path d="m16 3 5 5M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z" />
    {:else if action === 'delete'}<path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" />
    {:else}<path d="M12 5v14M5 12h14" />{/if}
  </svg>
{/snippet}

<section class="rules-section">
  <span id="rule-sort-help" class="sr-only">{m.text_rules_sort_help()}</span>
  <div class="section-heading"><p class="hint">{m.text_rules_order()}</p><Button size="sm" onclick={() => choosingTemplate = true}>{@render actionIcon('add')}{m.text_rules_add()}</Button></div>
  {#if !appState.textRules.length}
    <div class="empty-state">
      <span class="empty-icon" aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16M8 5v14M5 19h6M14 12h6M17 9v6" /></svg></span>
      <p class="hint">{m.text_rules_empty()}</p>
    </div>
  {:else}
  <ol class="rules-list" use:sortableRules={{ preview: previewMove, finish: finishMove }}>
    {#each orderedRules as rule, index (rule.id)}
      <li class="rule-row" class:rule-disabled={!rule.enabled} class:rule-drag-source={draggingId === rule.id}
        data-rule-id={rule.id} animate:flip={{ duration: reducedMotion ? 0 : 190, easing: cubicOut }}>
        <span class="rule-number" aria-hidden="true">{index + 1}</span>
        <div class="rule-copy" title={`${rule.name} · ${rule.scopes.map(scope => scopes[scope]).join(" · ")} · ${rule.targets.map(target => targets[target]).join(" · ")}`}><strong>{rule.name}</strong><div class="rule-meta"><span>{rule.scopes.map(scope => scopes[scope]).join(' · ')}</span><span class="rule-target">{rule.targets.map(target => targets[target]).join(' · ')}</span></div>
          {#if previewTextRule('', rule).error}<p class="error">{m.text_rules_invalid()}</p>{/if}
        </div>
        <div class="row-actions">
          <button type="button" class="rule-action" aria-describedby="rule-sort-help" onkeydown={(event) => keyboardMove(event, rule.id)} aria-label={`${rule.name}: ${m.text_rules_edit()}`} title={m.text_rules_edit()} onclick={() => edit(rule)}>{@render actionIcon('edit')}</button>
          <button type="button" class="rule-action" aria-label={`${rule.name}: ${m.text_rules_delete()}`} title={m.text_rules_delete()} onclick={() => appState.textRules = appState.textRules.filter(item => item.id !== rule.id)}>{@render actionIcon('delete')}</button>
        </div>
        <label class="enabled" title={m.text_rules_enabled()}><span class="sr-only">{m.text_rules_enabled()}</span><input type="checkbox" role="switch" class="settings-switch-input sr-only" bind:checked={rule.enabled} aria-label={`${rule.name}: ${m.text_rules_enabled()}`} /><span class="settings-switch-track"><span class="settings-switch-thumb"></span></span></label>
      </li>
    {/each}
  </ol>
  {/if}
</section>

{#if choosingTemplate}
  <BottomSheet label={m.text_rules_template()} width="520px" breakpoint={768} onClose={() => choosingTemplate = false}>
    {#snippet children(close)}
      <div class="template-list">
        {#each TEXT_RULE_TEMPLATES as template}
          <button class="template-option" onclick={() => close(() => create(template))}>
            <span class="template-copy"><strong>{templates[template.id]}</strong>
              <span class="template-example"><span>{template.example}</span><span class="example-arrow" aria-hidden="true">→</span><span>{previewTextRule(template.example, template).text}</span></span>
            </span><span class="chevron" aria-hidden="true">›</span>
          </button>
        {/each}
        <button class="template-option custom-option" onclick={() => close(() => create())}><strong>{m.text_rules_custom()}</strong><span class="chevron" aria-hidden="true">+</span></button>
      </div>
    {/snippet}
  </BottomSheet>
{/if}

{#if draft}
  <BottomSheet label={m.text_rules_editor()} width="880px" breakpoint={768} compactMobile={false} maxHeight="740px" onClose={() => draft = null}>
    {#snippet children()}
      {#if draft}
        <div class="workspace">
          <div class="edit-column">
            <div class="field">
              <div class="field-heading"><label class="settings-label" for="rule-pattern">{m.text_rules_pattern()}</label><Tooltip ariaLabel={m.text_rules_pattern()}>{m.text_rules_pattern_hint()}</Tooltip></div>
              <textarea id="rule-pattern" class="settings-input code" rows="2" bind:value={draft.pattern} spellcheck="false" autocapitalize="none" aria-invalid={Boolean(preview?.error)} aria-describedby={preview?.error ? 'regex-error' : undefined}></textarea>
            </div>
            <div class="field">
              <div class="field-heading"><label class="settings-label" for="rule-replacement">{m.text_rules_replacement()}</label><Tooltip ariaLabel={m.text_rules_replacement()}>{m.text_rules_replacement_hint()}</Tooltip></div>
              <textarea id="rule-replacement" class="settings-input code" rows="2" bind:value={draft.replacement} spellcheck="false" placeholder={m.text_rules_remove_placeholder()}></textarea>
            </div>
            {#if preview?.error}<p class="error" id="regex-error" role="alert">{m.text_rules_invalid()}<br /><code>{preview.error}</code></p>{/if}
            <label class="field"><span class="settings-label">{m.text_rules_name()}</span><input class="settings-input" bind:value={draft.name} /></label>
            <details class="disclosure">
              <summary><span>{m.text_rules_application()}</span><span class="selection-summary">{draft.scopes.map(scope => scopes[scope]).join(' · ')}<br />{draft.targets.map(target => targets[target]).join(' · ')}</span></summary>
              <div class="disclosure-body">
                <fieldset><legend>{m.text_rules_scope()}</legend><div class="choices">
                  {#each TEXT_RULE_SCOPES as scope}<label class:selected={draft.scopes.includes(scope)}><input type="checkbox" checked={draft.scopes.includes(scope)} onchange={(event) => { if (draft) draft.scopes = event.currentTarget.checked ? [...draft.scopes, scope] : draft.scopes.filter(item => item !== scope); }} />{scopes[scope]}</label>{/each}
                </div></fieldset>
                <fieldset><legend>{m.text_rules_target()}</legend><div class="choices">
                  {#each TEXT_RULE_TARGETS as target}<label class:selected={draft.targets.includes(target)}><input type="checkbox" checked={draft.targets.includes(target)} onchange={(event) => { if (draft) draft.targets = event.currentTarget.checked ? [...draft.targets, target] : draft.targets.filter(item => item !== target); }} />{targets[target]}</label>{/each}
                </div></fieldset>
              </div>
            </details>
            {#if !draft.scopes.length || !draft.targets.length}<p class="error" role="alert">{m.text_rules_selection_required()}</p>{/if}
            <details class="disclosure">
              <summary>{m.text_rules_advanced()}</summary>
              <div class="disclosure-body">
                <div class="field"><div class="field-heading"><label class="settings-label" for="rule-flags">{m.text_rules_flags()}</label><Tooltip ariaLabel={m.text_rules_flags()} width={300}>{m.text_rules_flags_hint()}</Tooltip></div><input id="rule-flags" class="settings-input code" bind:value={draft.flags} spellcheck="false" autocapitalize="none" aria-invalid={Boolean(preview?.error)} /></div>
                <div class="technical-info"><span>{m.text_rules_engine_label()}</span><Tooltip ariaLabel={m.text_rules_engine_label()} width={300}>{m.text_rules_engine()}<br />{m.text_rules_reasoning_hint()}</Tooltip></div>
              </div>
            </details>
          </div>
          <section class="result-card" aria-label={m.text_rules_preview()}>
            <div class="result-heading"><h3>{m.text_rules_result()}</h3><span class="hint" role="status">{m.text_rules_matches({ count: preview?.matches ?? 0 })}</span><Tooltip ariaLabel={m.text_rules_preview()}>{m.text_rules_preview_hint()}</Tooltip></div>
            <pre class:empty={!sample} aria-live="polite" aria-atomic="true">{sample ? (preview?.text ?? sample) : m.text_rules_preview_empty()}</pre>
          </section>
          <details class="sample-card" bind:open={sampleOpen}>
            <summary>{m.text_rules_sample()}</summary>
            <label class="field"><span class="sr-only">{m.text_rules_sample()}</span><textarea class="settings-input sample-input" rows="4" bind:value={sample} placeholder={m.text_rules_sample_placeholder()}></textarea></label>
          </details>
        </div>
      {/if}
    {/snippet}
    {#snippet footer(close)}
      <div class="sheet-footer-actions"><Button variant="ghost" onclick={close}>{m.text_rules_cancel()}</Button><Button variant="primary" disabled={!validSelection || Boolean(preview?.error)} onclick={() => { commit(); close(); }}>{m.text_rules_apply()}</Button></div>
    {/snippet}
  </BottomSheet>
{/if}

<style>
  .rules-section { display:flex; flex-direction:column; gap:16px; }
  .section-heading { display:flex; flex-wrap:wrap; align-items:center; gap:12px 20px; justify-content:space-between; }
  .section-heading > .hint { flex:1; min-width:200px; max-width:420px; }
  .hint { color:var(--sheet-text-muted); font-size:12px; line-height:1.5; margin:0; }
  .rules-list { list-style:none; margin:0; padding:0; border:1px solid var(--sheet-divider); border-radius:15px; background:rgba(255,255,255,.025); }
  .rule-row { display:grid; grid-template-columns:28px minmax(0,1fr) auto auto; align-items:center; gap:10px; padding:10px 12px; position:relative; cursor:grab; user-select:none; -webkit-touch-callout:none; }
  .rule-row + .rule-row { border-top:1px solid var(--sheet-divider); }
  .rule-number { width:28px; height:28px; display:grid; place-items:center; border-radius:8px; background:rgba(212,180,131,.075); color:var(--accent); font-size:11px; font-weight:600; font-variant-numeric:tabular-nums; }
  .rule-copy { min-width:0; display:flex; align-items:center; gap:12px; overflow:hidden; }
  .rule-copy strong { color:var(--sheet-text); font-size:13px; font-weight:600; line-height:1.4; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .rule-meta { display:flex; align-items:center; gap:5px 8px; white-space:nowrap; overflow:hidden; color:var(--sheet-text-subtle); font-size:11px; line-height:1.5; }
  .rule-target { padding:2px 7px; border-radius:6px; background:rgba(255,255,255,.04); color:var(--sheet-text-muted); }
  .rule-disabled .rule-copy strong { color:var(--sheet-text-muted); }
  .rule-disabled .rule-number { color:var(--sheet-text-subtle); background:rgba(255,255,255,.035); }
  .enabled { display:flex; align-items:center; justify-content:center; min-height:44px; cursor:pointer; }
  .row-actions { display:flex; align-items:center; gap:2px; }
  .rule-action { width:32px; height:36px; display:grid; place-items:center; padding:0; border:0; border-radius:8px; background:transparent; color:var(--sheet-text-subtle); cursor:pointer; transition:color .15s,background .15s; }
  .rule-action:hover:enabled { color:var(--sheet-text); background:var(--sheet-surface-hover); }
  .rule-action:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
  .rule-action:disabled { opacity:.25; cursor:default; }
  .empty-state { display:flex; flex-direction:column; align-items:center; gap:14px; padding:36px 24px; border:1px solid var(--sheet-divider); border-radius:15px; background:rgba(255,255,255,.025); text-align:center; }
  .empty-state .hint { max-width:300px; }
  .empty-icon { display:grid; place-items:center; width:48px; height:48px; border-radius:14px; color:var(--accent); background:rgba(212,180,131,.075); }
  .template-list { display:grid; gap:4px; }
  .template-option { display:flex; align-items:center; gap:12px; width:100%; padding:14px 12px; border:0; border-radius:12px; background:transparent; color:var(--sheet-text); text-align:left; cursor:pointer; font:inherit; }
  .template-option:hover { background:var(--sheet-surface-hover); }
  .template-copy { display:grid; gap:8px; flex:1; min-width:0; }
  .template-option strong { font-size:13px; font-weight:600; }
  .template-example { display:grid; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr); align-items:center; gap:10px; color:var(--sheet-text-muted); font-size:12px; line-height:1.4; }
  .template-example > span { white-space:pre-wrap; overflow-wrap:anywhere; }
  .template-example > span:last-child { color:var(--sheet-text); }
  .example-arrow, .chevron { color:var(--accent); }
  .chevron { margin-left:auto; font-size:20px; }
  .custom-option { border-top:1px solid var(--sheet-divider); margin-top:4px; }
  .workspace { display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); grid-template-rows:auto 1fr; gap:16px 24px; align-items:start; color:var(--sheet-text); }
  .edit-column { grid-column:1; grid-row:1 / 3; display:grid; gap:16px; min-width:0; }
  .field { display:block; min-width:0; }
  .field-heading { display:flex; align-items:center; gap:8px; margin-bottom:8px; }
  .field-heading .settings-label { margin:0; }
  .code { font-family:ui-monospace, monospace; }
  textarea { display:block; resize:vertical; min-height:64px; max-height:200px; }
  .disclosure { border-top:1px solid var(--sheet-divider); }
  summary { cursor:pointer; padding:12px 0; font-size:13px; font-weight:550; }
  .selection-summary { display:block; margin:4px 0 0 16px; color:var(--sheet-text-muted); font-size:12px; font-weight:400; overflow-wrap:anywhere; }
  .disclosure-body { display:grid; gap:16px; padding:0 0 12px; }
  fieldset { border:0; padding:0; margin:0; min-width:0; }
  legend { color:var(--sheet-text-muted); font-size:12px; margin-bottom:8px; }
  .choices { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:6px; }
  .choices label { display:flex; gap:8px; align-items:center; min-height:44px; padding:8px 10px; border:1px solid var(--sheet-border); border-radius:11px; font-size:12px; cursor:pointer; }
  .choices label.selected { background:var(--sheet-selected); border-color:var(--sheet-selected-border); }
  .choices input { accent-color:var(--accent); width:16px; height:16px; flex-shrink:0; }
  .technical-info { display:flex; align-items:center; gap:8px; color:var(--sheet-text-muted); font-size:12px; }
  .error { margin:0; color:var(--sheet-danger); font-size:12px; overflow-wrap:anywhere; }
  .result-card { grid-column:2; grid-row:1; border:1px solid var(--sheet-border); border-radius:14px; padding:14px; background:var(--sheet-surface); min-width:0; }
  .result-heading { display:flex; align-items:center; gap:8px; }
  h3 { flex:1; margin:0; font-size:13px; font-weight:600; }
  pre { font:inherit; font-size:13px; line-height:1.6; white-space:pre-wrap; overflow-wrap:anywhere; margin:12px 0 0; min-height:112px; max-height:240px; overflow:auto; user-select:text; }
  pre.empty { color:var(--sheet-text-muted); }
  .sample-card { grid-column:2; grid-row:2; min-width:0; }
  .sample-card summary { padding-top:0; color:var(--sheet-text-muted); font-size:12px; }
  .sample-input { min-height:120px; }
  .rule-row:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; }
  .rule-drag-source { background:var(--sheet-selected); outline:1px dashed var(--sheet-selected-border); outline-offset:-2px; }
  .rule-drag-source > * { opacity:.2; }
  :global(.rule-drag-ghost) { background:var(--sheet-bg); border:1px solid var(--sheet-selected-border); border-radius:12px; box-shadow:0 12px 32px rgba(0,0,0,.3); cursor:grabbing; will-change:transform; }
  .enabled .settings-switch-track { width:30px; height:18px; }
  .enabled .settings-switch-thumb { width:10px; height:10px; }
  .enabled .settings-switch-input:checked + .settings-switch-track .settings-switch-thumb { transform:translateX(12px); }
  @media(max-width:767px) {
    .section-heading { gap:12px; }
    .section-heading > .hint { min-width:0; flex-basis:100%; max-width:none; }
    .section-heading :global(button) { min-height:44px; }
    .rule-row { grid-template-columns:20px minmax(0,1fr) auto 34px; gap:5px; padding:4px 8px; min-height:52px; }
    .rule-number { width:20px; height:20px; border-radius:6px; font-size:10px; }
    .rule-copy { gap:6px; }
    .rule-copy strong { font-size:13px; }
    .rule-meta { display:none; }
    .rule-copy .error { font-size:10px; white-space:nowrap; }
    .enabled { align-self:start; min-height:36px; padding-top:6px; }
    .row-actions { gap:0; }
    .rule-action { width:34px; height:44px; }
    .empty-state { padding:28px 20px; }
    .workspace { display:flex; flex-direction:column; gap:14px; }
    .result-card { position:sticky; top:-16px; z-index:1; order:-2; width:100%; background:var(--sheet-bg); padding:10px 12px; box-shadow:0 8px 14px var(--sheet-bg); }
    pre { min-height:24px; max-height:76px; margin-top:6px; font-size:13px; }
    .edit-column { width:100%; gap:12px; }
    .sample-card { width:100%; order:-1; }
    .sample-card summary { padding:10px 0; }
    .settings-input { font-size:16px; padding:10px 12px; }
    textarea { min-height:58px; }
    .template-option { padding:12px 8px; }
  }
</style>
