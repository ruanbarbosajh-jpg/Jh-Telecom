'use strict';
// POST /api/enps-respostas — resultados AGREGADOS e anônimos do E-NPS (técnicos avaliando o escritório), só para perfis autorizados do JH.
// A sessão e o perfil são conferidos no servidor; a chave privada do Supabase do E-NPS fica só nas variáveis de ambiente (ENPS_SUPABASE_URL e
// ENPS_SERVICE_KEY, no projeto do JH na Vercel) e nunca chega ao navegador. A lógica fica em ../lib/enps/ (testável sem a Vercel).
const { processar, saude } = require('../lib/enps/nucleo');

const ORIGENS_PADRAO = ['https://jh-telecom-pi.vercel.app'];

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'GET') return res.status(200).json(saude(process.env));
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ ok: false, codigo: 'metodo' }); }
  const origem = req.headers.origin;
  const permitidas = String(process.env.ENPS_ORIGENS || '').split(',').map(s => s.trim()).filter(Boolean);
  const lista = permitidas.length ? permitidas : ORIGENS_PADRAO;
  const ok = !origem || lista.includes(origem) || (process.env.ENPS_PERMITE_LOCAL === '1' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origem));
  if (!ok) return res.status(403).json({ ok: false, codigo: 'origem' });
  let corpo = req.body;
  try { if (typeof corpo === 'string') corpo = JSON.parse(corpo); } catch (e) { return res.status(400).json({ ok: false, codigo: 'corpo_invalido' }); }
  if (JSON.stringify(corpo || {}).length > 2000) return res.status(413).json({ ok: false, codigo: 'corpo_grande' });
  const auth = String(req.headers.authorization || ''), token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  try {
    const out = await processar({ env: process.env, fetchFn: fetch, corpo, token });
    return res.status(out.status).json(out.corpo);
  } catch (e) {
    console.error('[enps-respostas] erro inesperado', e && e.message);   // nunca registra token, perfil nem dado de resposta
    return res.status(500).json({ ok: false, codigo: 'erro_interno' });
  }
};
