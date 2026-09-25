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
  <p class="version">{m.update_version({ version: $updater.currentVersion || '—' })}</p>
  <div class="update-status" role="status" aria-live="polite">
    {#if $updater.error}
      <p class="error">{$updater.error === 'download' ? m.update_download_error() : $updater.error === 'install' ? m.update_install_error() : m.update_check_error()}</p>
    {:else if $updater.phase === 'current'}<p>{m.update_current()}</p>
    {:else if $updater.version}<p>{m.update_available({ version: $updater.version })}</p>{/if}
  </div>
  {#if !$updater.initialized}
    <Button onclick={() => updater.initialize()}>{m.update_check()}</Button>
  {:else if !$updater.supported}
    <p class="detail">{m.update_manual()}</p>
    <Button onclick={openReleases}>{m.update_releases()}</Button>
  {:else if $updater.phase === 'downloading'}
    <p class="detail">{m.update_downloading()}</p>
    <progress aria-label={m.update_downloading()} max={$updater.total || 1} value={$updater.total ? Math.min($updater.downloaded, $updater.total) : undefined}></progress>
  {:else if $updater.phase === 'ready'}
    <p class="detail">{m.update_restart_notice()}</p>
    <Button variant="primary" onclick={() => updater.install()}>{m.update_install()}</Button>
  {:else if $updater.phase === 'installing'}
    <p class="detail">{m.update_installing()}</p>
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
  {#if linkFailed}<p class="error link-error" role="alert">{m.update_link_error()}</p>{/if}
</section>

<style>
  .updates { margin-bottom:22px; padding-bottom:22px; border-bottom:1px solid rgba(255,255,255,.055); }
  h2 { margin:0; color:#d1cfd2; font-size:13px; font-weight:650; }
  p { margin:0; color:#5e5e63; font-size:11px; line-height:1.5; }
  .version { margin:8px 0 14px; }
  .update-status p, .detail { margin:0 0 14px; }
  .update-status .error, .error { color:#e88787; }
  .link-error { margin-top:8px; }
  progress { display:block; width:100%; height:5px; margin-top:10px; accent-color:#d4b483; }
  .release-link { margin-top:8px; }
</style>
