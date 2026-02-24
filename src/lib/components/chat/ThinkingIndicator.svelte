<script lang="ts">
  import * as m from '$lib/paraglide/messages';
</script>

<div class="flex items-start mb-6 animate-fade-in">
  <div class="flex flex-col items-start">
    <div class="flex items-center space-x-3 text-gray-500 px-4 py-2 rounded-xl border border-white/5 shadow-inner">
      <span class="relative flex h-2.5 w-2.5">
        <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-ryokan-accent opacity-50"></span>
        <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-ryokan-accent/80"></span>
      </span>
      <span class="text-xs font-medium italic tracking-wide">{m.chat_thinking()}</span>
    </div>
  </div>
</div>