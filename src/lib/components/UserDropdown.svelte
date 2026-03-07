<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { roleState, setActiveRole } from '$lib/stores/roleStore.svelte';

  let isOpen = $state(false);
  let triggerEl = $state<HTMLButtonElement | null>(null);
  let dropdownEl = $state<HTMLDivElement | null>(null);

  let activeRole = $derived(roleState.allRoles.find(p => p.id === roleState.activeRoleId) ?? roleState.allRoles[0] ?? null);

  function handleOutsideClick(e: MouseEvent) {
    if (
      isOpen &&
      !triggerEl?.contains(e.target as Node) &&
      !dropdownEl?.contains(e.target as Node)
    ) {
      isOpen = false;
    }
  }

  function switchRole(id: string) {
    setActiveRole(id);
    isOpen = false;
  }
</script>

<svelte:window onmousedown={handleOutsideClick} />

<div class="relative h-10 w-10 shrink-0">
  <button
    bind:this={triggerEl}
    onclick={() => (isOpen = !isOpen)}
    aria-label={m.dropdown_aria_open_menu()}
    aria-expanded={isOpen}
    aria-haspopup="true"
    class="relative w-10 h-10 rounded-xl overflow-visible shrink-0 group"
  >
    <div
      class="w-full h-full rounded-xl overflow-hidden ring-1 transition-all duration-200 active:scale-95
             {isOpen
               ? 'ring-2 ring-ryokan-accent/70'
               : 'ring-white/[0.08] group-hover:ring-2 group-hover:ring-ryokan-accent/60'}"
    >
      {#if activeRole?.avatarUrl}
        <img src={activeRole.avatarUrl} alt={activeRole.name} class="w-full h-full object-cover" />
      {:else}
        <div class="w-full h-full bg-white/[0.06] flex items-center justify-center">
          {#if activeRole?.name}
            <span class="text-sm font-bold text-gray-300">
              {activeRole.name[0].toUpperCase()}
            </span>
          {:else}
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="text-gray-500">
              <circle cx="12" cy="8" r="4"/>
              <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
            </svg>
          {/if}
        </div>
      {/if}
    </div>

    <span
      class="absolute bottom-0 right-0 translate-x-0.5 translate-y-0.5 w-2.5 h-2.5 rounded-full
             bg-emerald-500 ring-2 ring-[#0f1117]"
    ></span>
  </button>

  {#if isOpen}
    <div
      bind:this={dropdownEl}
      role="menu"
      aria-label={m.dropdown_aria_switch_role()}
      class="absolute right-0 top-[calc(100%+0.9rem)] z-50 w-56 animate-in"
    >
      <div class="absolute -top-[7px] right-3 w-3.5 h-3.5
                  bg-[#13151c] border-t border-l border-white/[0.08]
                  rotate-45 rounded-tl-[5px] shadow-[-2px_-2px_4px_rgba(0,0,0,0.3)]">
      </div>

      <div class="bg-[#13151c] border border-white/[0.08] rounded-2xl shadow-2xl shadow-black/60 overflow-hidden">

      <ul class="py-1.5 overflow-y-auto" style="max-height: calc(5 * 2.75rem)" role="none">
        {#each roleState.allRoles as role (role.id)}
          <li role="none">
            <button
              onclick={() => switchRole(role.id)}
              role="menuitem"
              class="w-full flex items-center gap-3 px-3 py-2 text-left
                     hover:bg-white/[0.06] active:bg-white/[0.10] transition-colors duration-100
                     group/item"
            >
              <div class="w-7 h-7 rounded-lg overflow-hidden shrink-0 bg-white/[0.05] ring-1 ring-white/[0.06] flex items-center justify-center">
                {#if role.avatarUrl}
                  <img src={role.avatarUrl} alt={role.name} class="w-full h-full object-cover" />
                {:else}
                  <span class="text-[11px] font-bold text-gray-400">
                    {role.name?.[0]?.toUpperCase() ?? '?'}
                  </span>
                {/if}
              </div>

              <div class="flex-1 min-w-0">
                <p class="text-sm font-medium truncate leading-none mb-0.5
                           {activeRole?.id === role.id ? 'text-ryokan-accent' : 'text-gray-200 group-hover/item:text-white'}">
                  {role.name}
                </p>
                {#if role.pronouns}
                  <p class="text-[10px] text-gray-600 truncate leading-none">{role.pronouns}</p>
                {/if}
              </div>

              {#if activeRole?.id === role.id}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                     stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
                     class="shrink-0 text-ryokan-accent">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              {/if}
            </button>
          </li>
        {/each}

        {#if roleState.allRoles.length === 0}
          <li class="px-3 py-3 text-xs text-gray-600 italic text-center">
            {m.dropdown_empty_roles()}
          </li>
        {/if}
      </ul>

      </div>
    </div>
  {/if}
</div>

<style>
  @keyframes dropdown-in {
    from {
      opacity: 0;
      transform: translateY(-9px) scale(0.95);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  .animate-in {
    animation: dropdown-in 180ms cubic-bezier(0.16, 1, 0.3, 1) both;
    transform-origin: top right;
  }
</style>