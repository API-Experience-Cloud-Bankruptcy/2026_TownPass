import { router, type Href } from 'expo-router';

const GUARD_MS = 800;
let last = 0;

/** router.push that ignores a repeat tap, so a double tap does not stack the same page twice. */
export function go(href: Href) {
  const now = Date.now();
  if (now - last < GUARD_MS) return;
  last = now;
  router.push(href);
}

/** Back one page (home when there is no history), ignoring a repeat tap. */
export function goBack() {
  const now = Date.now();
  if (now - last < GUARD_MS) return;
  last = now;
  if (router.canGoBack()) router.back();
  else router.replace('/');
}
