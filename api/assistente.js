'use strict';
// POST /api/assistente — planejador de IA do assistente (só Analista, validado no servidor). GET devolve só o estado do serviço (sem segredos).
// A lógica fica em ../lib/ia/ (testável sem a Vercel). Chaves de IA: variáveis de ambiente do projeto na Vercel.
const { processar, saude } = require('../lib/ia/nucleo');

const ORIGENS_PADRAO = ['https://jh-telecom-pi.vercel.app'];

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'GET') return res.status(200).json(saude(process.env));
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ ok: false, codigo: 'metodo' }); }
  // só aceita pedido vindo do próprio site (navegador manda Origin em POST); chamada de outro site é barrada
  const origem = req.headers.origin;
  const permitidas = String(process.env.IA_ORIGENS || '').split(',').map(s => s.trim()).filter(Boolean);
  const lista = permitidas.length ? permitidas : ORIGENS_PADRAO;
  const ok = !origem || lista.includes(origem) || (process.env.IA_PERMITE_LOCAL === '1' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origem));
  if (!ok) return res.status(403).json({ ok: false, codigo: 'origem' });
  let corpo = req.body;
  try { if (typeof corpo === 'string') corpo = JSON.parse(corpo); } catch (e) { return res.status(400).json({ ok: false, codigo: 'corpo_invalido' }); }
  if (JSON.stringify(corpo || {}).length > 8000) return res.status(413).json({ ok: false, codigo: 'corpo_grande' });
  const auth = String(req.headers.authorization || ''), token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  try {
    const out = await processar({ env: process.env, fetchFn: fetch, corpo, token });
    return res.status(out.status).json(out.corpo);
  } catch (e) {
    console.error('[assistente] erro inesperado', e && e.message);
    return res.status(500).json({ ok: false, codigo: 'erro_interno' });
  }
};
