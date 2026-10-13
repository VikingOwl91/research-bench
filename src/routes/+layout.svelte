<script lang="ts">
  import '../app.css';
  import { locale } from '#lib/i18n/store.ts';
  let { children } = $props();
  $effect(() => { if (typeof document !== 'undefined') document.documentElement.lang = $locale; });
</script>

{@render children()}
