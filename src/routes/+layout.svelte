<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { initializeTheme } from '#lib/theme.ts';
  onMount(initializeTheme);
  import { locale } from '#lib/i18n/store.ts';
  let { children } = $props();
  $effect(() => { if (typeof document !== 'undefined') document.documentElement.lang = $locale; });
</script>

{@render children()}
