<script lang="ts">
  import { onMount } from 'svelte';
  import { appState } from '$lib/stores/appState.svelte';
  import * as m from '$lib/paraglide/messages';
  import BottomSheet from '$lib/components/ui/BottomSheet.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import Tooltip from '$lib/components/ui/Tooltip.svelte';
  import { previewTextRule, TEXT_RULE_SCOPES, TEXT_RULE_TARGETS, TEXT_RULE_TEMPLATES, type TextRule } from '$lib/utils/textRules';

  let choosingTemplate = $state(false);
  let draft = $state<TextRule | null>(null);
  let sample = $state('');
  let mobile = $state(false);
  let sampleOpen = $state(true);
  onMount(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const sync = () => mobile = query.matches;
    sync(); query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
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
  function move(index: number, offset: number) {
    const rules = [...appState.textRules];
    const next = index + offset;
    if (next < 0 || next >= rules.length) return;
    [rules[index], rules[next]] = [rules[next], rules[index]];
    appState.textRules = rules;
  }
</script>

<section class="rules-section">
  <div class="section-heading"><p class="hint">{m.text_rules_order()}</p><Button onclick={() => choosingTemplate = true}>{m.text_rules_add()}</Button></div>
  {#if !appState.textRules.length}<p class="hint">{m.text_rules_empty()}</p>{/if}
  <ol class="rules-list">
    {#each appState.textRules as rule, index (rule.id)}
      <li class="rule-row">
        <label class="enabled"><span class="sr-only">{m.text_rules_enabled()}</span><input type="checkbox" role="switch" class="settings-switch-input sr-only" bind:checked={rule.enabled} aria-label={`${rule.name}: ${m.text_rules_enabled()}`} /><span class="settings-switch-track"><span class="settings-switch-thumb"></span></span></label>
        <div class="rule-copy"><strong>{index + 1}. {rule.name}</strong><p class="hint">{rule.scopes.map(scope => scopes[scope]).join(' · ')} · {rule.targets.map(target => targets[target]).join(' · ')}</p>
          {#if previewTextRule('', rule).error}<p class="error">{m.text_rules_invalid()}</p>{/if}
        </div>
        <div class="row-actions">
          <Button variant="icon" ariaLabel={`${rule.name}: ${m.text_rules_up()}`} disabled={index === 0} onclick={() => move(index, -1)}>↑</Button>
          <Button variant="icon" ariaLabel={`${rule.name}: ${m.text_rules_down()}`} disabled={index === appState.textRules.length - 1} onclick={() => move(index, 1)}>↓</Button>
          <Button onclick={() => edit(rule)}>{m.text_rules_edit()}</Button>
          <Button variant="danger" ariaLabel={`${rule.name}: ${m.text_rules_delete()}`} onclick={() => appState.textRules = appState.textRules.filter(item => item.id !== rule.id)}>{m.text_rules_delete()}</Button>
        </div>
      </li>
    {/each}
  </ol>
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
  .section-heading { display:flex; flex-wrap:wrap; align-items:center; gap:16px; justify-content:space-between; }
  .hint { color:var(--sheet-text-muted); font-size:12px; line-height:1.5; margin:0; }
  .rules-list { list-style:none; margin:0; padding:0; display:grid; gap:12px; }
  .rule-row { display:flex; flex-wrap:wrap; align-items:center; gap:14px; padding:12px 0; border-bottom:1px solid var(--sheet-divider); }
  .rule-copy { flex:1; min-width:0; overflow-wrap:anywhere; }
  .rule-copy strong { font-size:14px; }
  .enabled { display:flex; align-items:center; min-height:44px; }
  .row-actions { display:flex; flex-wrap:wrap; gap:8px; width:100%; }
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
  @media(min-width:768px) { .row-actions { width:auto; } }
  @media(max-width:767px) {
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
