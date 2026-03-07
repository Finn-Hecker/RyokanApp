<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { HTMLButtonAttributes } from 'svelte/elements';

  let {
    children,
    variant = 'secondary',
    size = 'md',
    disabled = false,
    type = 'button',
    ariaLabel,
    ...rest
  }: {
    children?: Snippet;
    variant?: 'primary' | 'secondary' | 'icon' | 'ghost' | 'danger';
    size?: 'sm' | 'md' | 'lg';
    disabled?: boolean;
    type?: 'button' | 'submit' | 'reset';
    ariaLabel?: string;
  } & HTMLButtonAttributes = $props();

  const baseClasses = 'inline-flex items-center justify-center transition-all active:scale-95 font-medium tracking-wide';

  const variantClasses = {
    primary: 'bg-white text-ryokan-bg hover:bg-gray-200 border-none',
    secondary: 'bg-white/5 hover:bg-white/10 border border-white/5 hover:border-ryokan-accent/30 text-gray-400 hover:text-white',
    icon: 'bg-white/5 hover:bg-white/10 border border-white/5 hover:border-ryokan-accent/30 text-gray-500 hover:text-white',
    ghost: 'bg-transparent hover:bg-white/5 text-gray-400 hover:text-white',
    danger: 'bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300 border border-red-500/20'
  };

  const sizeClasses = {
    sm: 'h-8 px-3 text-xs gap-1.5',
    md: 'h-10 px-4 text-sm gap-2',
    lg: 'h-12 px-6 text-base gap-2.5'
  };

  const roundedClasses = {
    primary: 'rounded-full',
    secondary: 'rounded-full',
    icon: 'rounded-full',
    ghost: 'rounded-lg',
    danger: 'rounded-lg'
  };

  const iconSizeClasses = {
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-12 h-12'
  };

  let classes = $derived(
    variant === 'icon' 
      ? `${baseClasses} ${variantClasses[variant]} ${iconSizeClasses[size]} ${roundedClasses[variant]} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`
      : `${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${roundedClasses[variant]} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`
  );
</script>

<button
  {type}
  {disabled}
  aria-label={ariaLabel}
  class={classes}
  {...rest}
>
  {@render children?.()}
</button>