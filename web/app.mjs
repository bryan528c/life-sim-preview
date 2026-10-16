// Cached legacy HTML may still request root/web/app.mjs directly. Do not load
// any game or storage here. A versioned query fetches the explicit choice page.
const entry = new URL('../', import.meta.url);
entry.searchParams.set('entry', 'life-2026-10-16-scene-variety-stable-01');
window.location.replace(entry.href);
