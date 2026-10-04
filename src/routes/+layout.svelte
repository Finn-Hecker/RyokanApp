<script lang="ts">
  import { onMount } from "svelte";
  import "../app.css";

  onMount(() => {
    if (!/Android/i.test(navigator.userAgent)) return;

    const root = document.documentElement;
    root.classList.add("android-no-zoom");
    const viewport = document.querySelector('meta[name="viewport"]');
    const originalViewport = viewport?.getAttribute("content");
    viewport?.setAttribute("content", "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, interactive-widget=resizes-content");

    function preventPinch(event: TouchEvent) {
      if (event.touches.length > 1 && event.cancelable) event.preventDefault();
    }

    document.addEventListener("touchstart", preventPinch, { passive: false, capture: true });
    document.addEventListener("touchmove", preventPinch, { passive: false, capture: true });

    return () => {
      root.classList.remove("android-no-zoom");
      if (originalViewport != null) viewport?.setAttribute("content", originalViewport);
      document.removeEventListener("touchstart", preventPinch, true);
      document.removeEventListener("touchmove", preventPinch, true);
    };
  });
</script>

<slot />
