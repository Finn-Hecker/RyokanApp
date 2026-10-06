<script lang="ts">
  import { onMount } from 'svelte';
  import { appState, snapshotApiConnection, type ApiConnection } from '$lib/stores/appState.svelte';
  import { createDefaultApiParameterEnabled, type ApiParameterKey } from '$lib/ai/connections/apiParameters';
  import { capturePreset, importPreset, PresetError, MAX_PRESET_BYTES, type RyokanPreset, type StoredPreset } from '$lib/ai/presets/presetCore';
  import { loadPresetLibrary, savePresetLibrary, deletePreset, downloadPreset } from '$lib/ai/presets/presetLibrary';
  import { clearExportFeedback, showExportFeedback } from '$lib/stores/exportFeedback';
  import { reportDiagnostic } from '$lib/diagnostics/diagnostics';
  import { PROVIDER_LABELS } from '$lib/ai/connections/providers';
  import * as m from '$lib/paraglide/messages';
  import GeneralSection from './GeneralSection.svelte';
  import ServiceTierControl from './ServiceTierControl.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import { resolvePreset } from '$lib/ai/presets/presetCore';

  let { parameterEnabled, onApply, onDeactivate, onDeleted }: {
    parameterEnabled: Record<ApiParameterKey, boolean>;
    onApply: (preset: RyokanPreset, id: string) => Promise<void>;
    onDeactivate: () => Promise<void>;
    onDeleted: () => void;
  } = $props();
  let items = $state<StoredPreset[]>([]);
  let ready = $state(false);
  let busy = $state(false);
  let status = $state('');
  let error = $state('');
  let draft = $state<ApiConnection | null>(null);
  let draftEnabled = $state<Record<ApiParameterKey, boolean>>(createDefaultApiParameterEnabled());
  let name = $state('');
  let editingId = $state<string | null>(null);
  let previous = $state<RyokanPreset | undefined>();
  let deletingId = $state('');
  let fileInput = $state<HTMLInputElement>();
  $effect(() => {
    const connection = appState.apiSettings;
    deletingId = ''; status = '';
  });

  function showError(cause: unknown) {
    error = cause instanceof PresetError && cause.code === 'sensitiveParameters' ? m.preset_error_sensitive()
      : cause instanceof PresetError && cause.code === 'unsupportedVersion' ? m.preset_error_version()
      : cause instanceof PresetError ? m.preset_error_invalid() : m.preset_error_storage();
    reportDiagnostic('settings');
  }
  async function load() {
    error = '';
    try { items = await loadPresetLibrary(); ready = true; }
    catch (cause) { showError(cause); }
  }
  onMount(() => { void load(); });

  function edit(item?: StoredPreset) {
    const current = snapshotApiConnection(appState.apiSettings);
    current.parameterEnabled = { ...parameterEnabled };
    // Library entries are $state proxies; the pure core receives plain snapshots.
    const preset = item ? $state.snapshot(item.preset) : undefined;
    draft = preset ? resolvePreset(current, preset) : current;
    draftEnabled = { ...draft.parameterEnabled };
    name = item?.preset.name ?? '';
    editingId = item?.id ?? null;
    previous = preset;
    error = ''; status = ''; deletingId = '';
  }
  async function commit(next: StoredPreset[]) {
    await savePresetLibrary(next);
    items = next;
  }
  async function save() {
    if (!draft || busy) return;
    busy = true; error = '';
    try {
      draft.parameterEnabled = { ...draftEnabled };
      const preset = capturePreset(snapshotApiConnection(draft), name, previous ? $state.snapshot(previous) : undefined);
      const id = editingId ?? crypto.randomUUID();
      await commit([...items.filter(item => item.id !== id), { id, preset }]);
      draft = null; status = m.preset_saved();
    } catch (cause) { showError(cause); }
    finally { busy = false; }
  }
  async function apply(item: StoredPreset) {
    if (busy || draft || appState.apiSettings.appliedPresetId === item.id) return;
    busy = true; error = ''; status = '';
    try { await onApply($state.snapshot(item.preset), item.id); status = m.preset_applied(); }
    catch (cause) { showError(cause); }
    finally { busy = false; }
  }
  async function remove() {
    if (!deletingId || busy) return;
    busy = true; error = '';
    try {
      const id = deletingId;
      const restoresCurrentConnection = appState.apiSettings.appliedPresetId === id;
      items = await deletePreset($state.snapshot(items), id);
      if (restoresCurrentConnection) onDeleted();
      deletingId = ''; status = m.preset_deleted();
    }
    catch (cause) { showError(cause); }
    finally { busy = false; }
  }
  async function deactivate() {
    if (busy || draft || !appState.apiSettings.appliedPresetId) return;
    busy = true; error = ''; status = '';
    try { await onDeactivate(); status = m.preset_deactivated(); }
    catch (cause) { showError(cause); }
    finally { busy = false; }
  }
  async function importFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0]; input.value = '';
    if (!file || busy) return;
    busy = true; error = ''; status = '';
    try {
      if (file.size > MAX_PRESET_BYTES) throw new PresetError('invalidPreset');
      const preset = importPreset(await file.text());
      const id = crypto.randomUUID();
      await commit([...items, { id, preset }]); status = m.preset_imported();
    } catch (cause) { showError(cause); }
    finally { busy = false; }
  }
  async function exportFile(item: StoredPreset) {
    if (busy || draft) return;
    busy = true; error = ''; status = '';
    clearExportFeedback();
    try {
      if (await downloadPreset($state.snapshot(item), appState.interactionMode === 'mobile')) {
        showExportFeedback('success', appState.interactionMode === 'mobile' ? m.toast_preset_exported() : m.toast_download_started());
      }
    } catch {
      reportDiagnostic('settings');
      showExportFeedback('error', m.toast_export_failed());
    }
    finally { busy = false; }
  }
</script>

{#snippet actionIcon(action: 'apply' | 'deactivate' | 'edit' | 'delete' | 'add' | 'import' | 'export')}
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    {#if action === 'apply'}<path d="m5 12 4 4L19 6" />
    {:else if action === 'deactivate'}<path d="M12 3v9M7 5a8 8 0 1010 0" />
    {:else if action === 'edit'}<path d="m16 3 5 5M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15z" />
    {:else if action === 'delete'}<path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6" />
    {:else if action === 'add'}<path d="M12 5v14M5 12h14" />
    {:else if action === 'import'}<path d="M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6" />
    {:else}<path d="M12 15V3m-5 5 5-5 5 5M4 15v6h16v-6" />{/if}
  </svg>
{/snippet}

<section class="preset-section">
  {#if !ready}
    {#if error}<Button onclick={load}>{m.preset_retry()}</Button>{:else}<p>{m.preset_loading()}</p>{/if}
  {:else}
    <div class="section-heading">
      <p class="hint">{m.preset_description()}</p>
      <div class="actions">
        <Button size="sm" disabled={busy || !!draft} onclick={() => edit()}>{@render actionIcon('add')}{m.preset_create()}</Button>
        <Button size="sm" disabled={busy || !!draft} onclick={() => fileInput?.click()}>{@render actionIcon('import')}{m.preset_import()}</Button>
        <input bind:this={fileInput} type="file" accept=".json,application/json" hidden onchange={importFile} />
      </div>
    </div>
    {#if !items.length}
      <div class="empty-state">
        <span class="empty-icon" aria-hidden="true">{@render actionIcon('add')}</span>
        <p class="hint">{m.preset_empty()}</p>
      </div>
    {:else}
      <p class="hint">{m.preset_apply_hint({ provider: PROVIDER_LABELS[appState.apiSettings.providerKind] })}</p>
      <ul class="presets-list" aria-label={m.preset_select()}>
        {#each items as item (item.id)}
          <li class="preset-row">
            <div class="preset-copy">
              <div class="preset-name"><strong title={item.preset.name}>{item.preset.name}</strong>
                {#if appState.apiSettings.appliedPresetId === item.id}<span class="active-badge">{m.preset_active()}</span>{/if}
              </div>
              <div class="preset-meta">{Object.keys(item.preset.providers).map(provider => PROVIDER_LABELS[provider as keyof typeof PROVIDER_LABELS]).join(' · ')}</div>
            </div>
            <div class="row-actions">
              <button type="button" class="preset-action apply-action" class:applied={appState.apiSettings.appliedPresetId === item.id} disabled={busy || !!draft} aria-label={`${item.preset.name}: ${appState.apiSettings.appliedPresetId === item.id ? m.preset_deactivate() : m.preset_apply()}`} title={appState.apiSettings.appliedPresetId === item.id ? m.preset_deactivate() : m.preset_apply()} onclick={() => appState.apiSettings.appliedPresetId === item.id ? deactivate() : apply(item)}><span class="apply-icon">{@render actionIcon(appState.apiSettings.appliedPresetId === item.id ? 'deactivate' : 'apply')}</span><span class="apply-label">{appState.apiSettings.appliedPresetId === item.id ? m.preset_deactivate() : m.preset_apply()}</span></button>
              <button type="button" class="preset-action" disabled={busy || !!draft} aria-label={`${item.preset.name}: ${m.preset_edit()}`} title={m.preset_edit()} onclick={() => edit(item)}>{@render actionIcon('edit')}</button>
              <button type="button" class="preset-action" disabled={busy || !!draft} aria-label={`${item.preset.name}: ${m.preset_export()}`} title={m.preset_export()} onclick={() => exportFile(item)}>{@render actionIcon('export')}</button>
              <button type="button" class="preset-action" disabled={busy || !!draft} aria-label={`${item.preset.name}: ${m.preset_delete()}`} title={m.preset_delete()} onclick={() => { deletingId = item.id; status = ''; }}>{@render actionIcon('delete')}</button>
            </div>
            {#if !item.preset.providers[appState.apiSettings.providerKind]}<p class="hint row-hint">{m.preset_provider_missing()}</p>{/if}
            {#if deletingId === item.id}
              <div class="delete-confirmation">
                <p class="hint">{m.preset_delete_hint()}</p>
                <div class="actions"><Button size="sm" variant="danger" disabled={busy} onclick={remove}>{m.preset_delete()}</Button><Button size="sm" disabled={busy} onclick={() => deletingId = ''}>{m.preset_cancel()}</Button></div>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
    {#if draft}
      <div class="settings-card editor-heading">
        <label class="settings-label" for="preset-name">{m.preset_name()}</label>
        <input id="preset-name" class="settings-input" bind:value={name} maxlength="120" />
        <p class="hint">{m.preset_editor_hint({ provider: PROVIDER_LABELS[draft.providerKind] })}</p>
        <ServiceTierControl connection={draft} />
      </div>
      <GeneralSection bind:connection={draft} promptPrefix="preset" bind:parameterEnabled={draftEnabled} powerUser={true} category="parameters" />
      <GeneralSection bind:connection={draft} bind:parameterEnabled={draftEnabled} powerUser={true} category="advanced" />
      <div class="actions"><Button variant="primary" disabled={busy || !name.trim()} onclick={save}>{m.preset_save()}</Button><Button disabled={busy} onclick={() => draft = null}>{m.preset_cancel()}</Button></div>
    {/if}
  {/if}
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <p class="hint" role="status">{status}</p>
</section>

<style>
  .preset-section { display:flex; flex-direction:column; gap:16px; }
  .section-heading { display:flex; flex-wrap:wrap; align-items:center; gap:12px 20px; justify-content:space-between; }
  .section-heading > .hint { flex:1; min-width:200px; max-width:420px; }
  .editor-heading { display:flex; flex-direction:column; gap:12px; }
  .actions { display:flex; flex-wrap:wrap; gap:8px; }
  .hint { margin:0; color:var(--sheet-text-muted); font-size:12px; line-height:1.5; }
  .presets-list { list-style:none; margin:0; padding:0; border:1px solid var(--sheet-divider); border-radius:15px; background:rgba(255,255,255,.025); }
  .preset-row { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:10px; padding:10px 12px; }
  .preset-row + .preset-row { border-top:1px solid var(--sheet-divider); }
  .preset-copy { min-width:0; display:grid; gap:4px; }
  .preset-name { display:flex; align-items:center; gap:8px; min-width:0; }
  .preset-name strong { color:var(--sheet-text); font-size:13px; font-weight:600; line-height:1.4; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .preset-meta { color:var(--sheet-text-subtle); font-size:11px; line-height:1.5; overflow-wrap:anywhere; }
  .active-badge { flex-shrink:0; padding:2px 7px; border-radius:6px; background:rgba(212,180,131,.075); color:var(--accent); font-size:11px; }
  .row-actions { display:flex; align-items:center; gap:2px; }
  .preset-action { width:32px; height:36px; display:grid; place-items:center; padding:0; border:0; border-radius:8px; background:transparent; color:var(--sheet-text-subtle); cursor:pointer; transition:color .15s,background .15s; }
  .preset-action:hover:enabled { color:var(--sheet-text); background:var(--sheet-surface-hover); }
  .preset-action:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
  .preset-action:disabled { opacity:.25; cursor:default; }
  .apply-action { width:auto; padding:0 10px; color:var(--sheet-text-muted); font:inherit; font-size:12px; }
  .apply-action.applied { color:var(--accent); opacity:.7; }
  .apply-icon { display:none; }
  .row-hint,.delete-confirmation { grid-column:1 / -1; }
  .delete-confirmation { display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:10px; padding-top:10px; border-top:1px solid var(--sheet-divider); }
  .empty-state { display:flex; flex-direction:column; align-items:center; gap:14px; padding:36px 24px; border:1px solid var(--sheet-divider); border-radius:15px; background:rgba(255,255,255,.025); text-align:center; }
  .empty-state .hint { max-width:300px; }
  .empty-icon { display:grid; place-items:center; width:48px; height:48px; border-radius:14px; color:var(--accent); background:rgba(212,180,131,.075); }
  .settings-label { margin:0; }
  .error { color:var(--sheet-danger); font-size:12px; line-height:1.5; }
  @media(max-width:767px) {
    .section-heading { gap:12px; }
    .section-heading > .hint { min-width:0; flex-basis:100%; max-width:none; }
    .section-heading :global(button),.row-actions :global(button),.delete-confirmation :global(button) { min-height:44px; }
    .preset-row { grid-template-columns:minmax(0,1fr) auto; gap:5px; padding:8px; }
    .preset-name { gap:5px; }
    .active-badge { padding:2px 5px; font-size:10px; }
    .row-actions { gap:0; }
    .preset-action { width:34px; height:44px; padding:0; }
    .apply-icon { display:grid; place-items:center; }
    .apply-label { display:none; }
    .empty-state { padding:28px 20px; }
  }
</style>
