<script lang="ts">
  let {
    title,
    subtitle
  }: {
    title: string;
    subtitle: string;
  } = $props();

  let titleText = $derived(title.slice(0, -1));
  let titleMark = $derived(title.slice(-1));
</script>

<header class="mb-3 sm:mb-5 md:mb-7">
  <h1 class="mb-1 text-[1.875rem] font-semibold leading-tight tracking-tight text-ryokan-text/90 md:text-[2rem]">
    {titleText}<span class="text-ryokan-accent">{titleMark}</span>
  </h1>
  <p class="text-[0.9375rem] leading-6 text-gray-500 md:text-base">
    {subtitle}
  </p>
</header>
