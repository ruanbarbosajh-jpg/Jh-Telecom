'use strict';
// POST /api/holerite-enviar — envia (ou simula) UM holerite em PDF para o WhatsApp do técnico, só pelo Analista. A lógica fica em ../lib/holerite/nucleo.js.
// GET devolve só { configurado, modelo }: serve pra tela saber se a integração da Meta está ligada (nunca devolve token nem id do número).
// Variáveis de ambiente (Settings › Environment Variables do projeto na Vercel): WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_TEMPLATE.
// Modelo a cadastrar no WhatsApp Manager (categoria UTILITY, idioma pt_BR, cabeçalho DOCUMENTO). Corpo sugerido:
//   "Olá {{1}}, segue o seu holerite de serviços do período {{2}}. Em caso de dúvida, fale com o escritório da JH Telecom."
const { processar, saude } = require('../lib/holerite/nucleo');

const ORIGENS_PADRAO = ['https://jh-telecom-pi.vercel.app'];

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method === 'GET') return res.status(200).json(saude(process.env));
  if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ ok: false, codigo: 'metodo' }); }
  const origem = req.headers.origin;
  const permitidas = String(process.env.HOLERITE_ORIGENS || '').split(',').map(s => s.trim()).filter(Boolean);
  const lista = permitidas.length ? permitidas : ORIGENS_PADRAO;
  const ok = !origem || lista.includes(origem) || (process.env.HOLERITE_PERMITE_LOCAL === '1' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origem));
  if (!ok) return res.status(403).json({ ok: false, codigo: 'origem' });
  let corpo = req.body;
  try { if (typeof corpo === 'string') corpo = JSON.parse(corpo); } catch (e) { return res.status(400).json({ ok: false, codigo: 'corpo_invalido' }); }
  const tam = JSON.stringify(corpo || {}).length;
  if (tam > 3200000) return res.status(413).json({ ok: false, codigo: 'corpo_grande' });
  const auth = String(req.headers.authorization || ''), token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  try {
    const out = await processar({ env: process.env, fetchFn: fetch, corpo, token });
    return res.status(out.status).json(out.corpo);
  } catch (e) {
    console.error('[holerite-enviar] erro inesperado', e && e.message);   // nunca registra token, telefone nem conteúdo do PDF
    return res.status(500).json({ ok: false, codigo: 'erro_interno' });
  }
};
