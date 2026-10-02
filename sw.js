/* JH TELECOM · Nexus System — service worker (PWA, 02/10/2026)
 *
 * O que faz:
 *  • a página do sistema (index.html): REDE PRIMEIRO — sempre pega a versão nova
 *    publicada; só usa a cópia guardada se estiver sem internet (assim o app abre
 *    mesmo offline, e nunca fica preso numa versão velha);
 *  • bibliotecas de CDN (xlsx, supabase-js, jsPDF, html2canvas, Leaflet...):
 *    COPIA PRIMEIRO — têm versão fixa e hash SRI, então a cópia é idêntica; o
 *    sistema abre bem mais rápido da 2ª vez em diante e gasta menos dados no celular;
 *  • NÃO mexe em nada do Supabase (dados, login), nem nos mapas — passam direto.
 * Pra forçar todo mundo a limpar a cópia antiga: troque VERSAO. */
const VERSAO = 'jh-pwa-v1';
const CDNS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'unpkg.com', 'code.jquery.com'];

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== VERSAO) await caches.delete(k);
  await self.clients.claim();
})()));

async function redePrimeiro(req) {
  const cache = await caches.open(VERSAO);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const guardada = await cache.match(req, { ignoreSearch: true }) || await cache.match('./', { ignoreSearch: true });
    if (guardada) return guardada;
    throw e;
  }
}
async function copiaPrimeiro(req) {
  const cache = await caches.open(VERSAO);
  const guardada = await cache.match(req);
  if (guardada) return guardada;
  const res = await fetch(req);
  if (res && res.ok) cache.put(req, res.clone());
  return res;
}
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) e.respondWith(redePrimeiro(req));
    return;
  }
  if (CDNS.includes(url.hostname)) e.respondWith(copiaPrimeiro(req));
});
