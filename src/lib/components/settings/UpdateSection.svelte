<script lang="ts">
  import { onMount } from 'svelte';
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { updater } from '$lib/stores/updater';
  import Button from '$lib/components/ui/Button.svelte';
  import * as m from '$lib/paraglide/messages';
  let linkFailed = $state(false);
  onMount(() => { void updater.initialize(); });
  async function openReleases() {
    linkFailed = false;
    try { await openUrl('https://github.com/Finn-Hecker/RyokanApp/releases/latest'); }
    catch { linkFailed = true; }
  }
</script>

<section class="updates" aria-label={m.update_title()}>
  <h2>{m.update_title()}</h2>
  <p>{m.update_version({ version: $updater.currentVersion || '—' })}</p>
  <div role="status" aria-live="polite">
    {#if $updater.error}
      <p class="error">{$updater.error === 'download' ? m.update_download_error() : $updater.error === 'install' ? m.update_install_error() : m.update_check_error()}</p>
    {:else if $updater.phase === 'current'}<p>{m.update_current()}</p>
    {:else if $updater.version}<p>{m.update_available({ version: $updater.version })}</p>{/if}
  </div>
  {#if !$updater.initialized}
    <Button onclick={() => updater.initialize()}>{m.update_check()}</Button>
  {:else if !$updater.supported}
    <p>{m.update_manual()}</p>
    <Button onclick={openReleases}>{m.update_releases()}</Button>
  {:else if $updater.phase === 'downloading'}
    <p>{m.update_downloading()}</p>
    <progress aria-label={m.update_downloading()} max={$updater.total || 1} value={$updater.total ? Math.min($updater.downloaded, $updater.total) : undefined}></progress>
  {:else if $updater.phase === 'ready'}
    <p>{m.update_restart_notice()}</p>
    <Button variant="primary" onclick={() => updater.install()}>{m.update_install()}</Button>
  {:else if $updater.phase === 'installing'}
    <p>{m.update_installing()}</p>
  {:else if $updater.phase === 'available'}
    <Button onclick={() => updater.download()}>{m.update_download()}</Button>
  {:else}
    <Button disabled={$updater.phase === 'checking'} onclick={() => updater.check()}>
      {$updater.phase === 'checking' ? m.update_checking() : m.update_check()}
    </Button>
  {/if}
  {#if $updater.supported && $updater.error}
    <div class="release-link"><Button variant="ghost" onclick={openReleases}>{m.update_releases()}</Button></div>
  {/if}
  {#if linkFailed}<p class="error" role="alert">{m.update_link_error()}</p>{/if}
</section>

<style>
  .updates { padding:18px; margin-bottom:20px; border:1px solid rgba(255,255,255,.06); border-radius:12px; background:rgba(255,255,255,.025); }
  h2 { color:#e7e2da; font-size:14px; font-weight:600; }
  p { color:#99979b; font-size:12px; line-height:1.6; margin:8px 0 12px; }
  .error { color:#fca5a5; }
  progress { width:100%; accent-color:#d4b483; }
  .release-link { margin-top:8px; }
</style>
