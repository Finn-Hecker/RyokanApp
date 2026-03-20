<script lang="ts">
  let {
    charName,
    onConfirm,
    onCancel
  }: {
    charName: string;
    onConfirm: () => void;
    onCancel: () => void;
  } = $props();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onCancel();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Backdrop -->
<div
  class="fixed inset-0 z-50 flex items-center justify-center p-4"
  role="presentation"
>
  <!-- Dimmed overlay -->
  <div
    class="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
    onclick={onCancel}
    role="presentation"
  ></div>

  <!-- Modal panel -->
  <div
    class="relative z-10 w-full max-w-sm bg-[#13131a] border border-white/[0.09] rounded-2xl shadow-2xl animate-modal-in p-6"
    role="alertdialog"
    aria-modal="true"
    aria-labelledby="delete-modal-title"
    aria-describedby="delete-modal-desc"
  >
    <!-- Icon -->
    <div class="w-11 h-11 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center mb-4">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-red-400">
        <polyline points="3 6 5 6 21 6"/>
        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
        <path d="M10 11v6"/><path d="M14 11v6"/>
        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
      </svg>
    </div>

    <h2 id="delete-modal-title" class="text-base font-semibold text-gray-100 mb-1">
      Charakter löschen
    </h2>
    <p id="delete-modal-desc" class="text-sm text-gray-400 leading-relaxed mb-6">
      Soll <span class="text-gray-200 font-medium">„{charName}"</span> wirklich gelöscht werden? Alle zugehörigen Chats werden ebenfalls entfernt. Diese Aktion kann nicht rückgängig gemacht werden.
    </p>

    <div class="flex items-center gap-2.5">
      <button
        type="button"
        onclick={onCancel}
        class="flex-1 h-9 rounded-xl bg-white/[0.05] hover:bg-white/[0.09] border border-white/[0.08] text-sm text-gray-300 hover:text-white transition-all active:scale-[0.97]"
      >
        Abbrechen
      </button>
      <button
        type="button"
        onclick={onConfirm}
        class="flex-1 h-9 rounded-xl bg-red-500/80 hover:bg-red-500 border border-red-500/50 text-sm text-white font-medium transition-all active:scale-[0.97]"
      >
        Löschen
      </button>
    </div>
  </div>
</div>

<style>
  @keyframes fade-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }
  @keyframes modal-in {
    from { opacity: 0; transform: scale(0.95) translateY(8px); }
    to   { opacity: 1; transform: scale(1) translateY(0); }
  }
  .animate-fade-in {
    animation: fade-in 0.15s ease-out both;
  }
  .animate-modal-in {
    animation: modal-in 0.18s cubic-bezier(0.34, 1.2, 0.64, 1) both;
  }
</style>