import { THEME_STORAGE_KEY } from '@/lib/theme';

/**
 * The no-flash script.
 *
 * This runs synchronously in <head>, BEFORE the browser paints anything, so
 * <html> already carries the right data-theme on the very first frame. Without
 * it, the page would paint cream-and-ink and then snap to dark once React
 * hydrated — the "flash of wrong theme".
 *
 * It is deliberately hand-written, dependency-free and wrapped in try/catch:
 * localStorage throws outright in some privacy modes, and a failure here must
 * degrade to "follow the system", never to a blank page. It mirrors
 * resolveTheme() in lib/theme.ts — keep the two in step.
 */
const script = `(function(){try{
var p=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)});
if(p!=='light'&&p!=='dark'&&p!=='system')p='system';
var d=p==='system'?matchMedia('(prefers-color-scheme: dark)').matches:p==='dark';
document.documentElement.setAttribute('data-theme',d?'dark':'light');
}catch(e){
document.documentElement.setAttribute('data-theme','light');
}})();`;

export function ThemeScript() {
  // suppressHydrationWarning: this script mutates <html> before React sees it,
  // which is the entire point.
  return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
