'use strict';
// NÚCLEO do painel E-NPS dentro do JH Telecom (04/11/2026). O JH funciona como INTERMEDIÁRIO AUTORIZADO: confere a sessão e o perfil da pessoa
// no Supabase DO JH e só então consulta o Supabase INDEPENDENTE do E-NPS com a chave privada (variável de ambiente do servidor, nunca no
// navegador). Os dois bancos continuam separados: nada do JH vai pro E-NPS e nenhuma linha do E-NPS (com data, id ou horário) volta pro JH.
const { calcular, MINIMO } = require('./resultados');

const SUPABASE_URL_PADRAO = 'https://tameptndgnzvnghgmtqk.supabase.co';
const SUPABASE_KEY_PADRAO = 'sb_publishable_cFCAzA9ubiiTuDHml-6Htw_nxVAK1_L';   // chave PÚBLICA do JH (a mesma do HTML)
// quem pode ver (decidido AQUI, no servidor, pelo perfil gravado na tabela `perfis` — nunca pelo que o navegador diz):
const PERFIS_PERMITIDOS = ['analista', 'admin', 'gestao', 'rh'];          // Analista, Supervisores/Coordenador, Gestão e RH
// A Thaís tem conta de Supervisor no banco mas trabalha como Escritório no sistema: fica de fora (Escritório e Almoxarifado = 403).
const EMAILS_BLOQUEADOS = ['thais@jhtelecom.com.br'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POR_PAGINA = 1000, MAX_PAGINAS = 20;       // até 20.000 respostas

const USO = new Map();   // userId -> [timestamps] (limite por usuário, em memória da instância)
function limite(userId, agoraMs, env) {
  const max = Number(env.ENPS_LIMITE_MINUTO) || 20;
  const l = (USO.get(userId) || []).filter(t => agoraMs - t < 60000);
  if (l.length >= max) return true;
  l.push(agoraMs); USO.set(userId, l); return false;
}

async function fetchTempo(fetchFn, url, init, ms) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), ms) : null;
  try { return await fetchFn(url, { ...init, signal: ctl ? ctl.signal : undefined }); } finally { if (timer) clearTimeout(timer); }
}

// 1) o Supabase do JH confere o token (assinatura/validade); 2) o perfil vem da tabela `perfis` lida COM O TOKEN DA PESSOA (só enxerga a própria linha).
async function autenticar({ fetchFn, env, token }) {
  const base = env.SUPABASE_URL || SUPABASE_URL_PADRAO, chave = env.SUPABASE_KEY || SUPABASE_KEY_PADRAO;
  if (!token || typeof token !== 'string' || token.length < 20 || token.length > 4000) return { ok: false, status: 401, codigo: 'nao_autenticado' };
  const cab = { apikey: chave, Authorization: 'Bearer ' + token };
  let u;
  try {
    const r = await fetchTempo(fetchFn, base + '/auth/v1/user', { headers: cab }, 4000);
    if (!r.ok) return { ok: false, status: 401, codigo: 'nao_autenticado' };
    u = await r.json();
  } catch (e) { return { ok: false, status: 503, codigo: 'auth_indisponivel' }; }
  if (!u || !UUID.test(String(u.id || ''))) return { ok: false, status: 401, codigo: 'nao_autenticado' };
  let role = null;
  try {
    const r = await fetchTempo(fetchFn, `${base}/rest/v1/perfis?select=role&id=eq.${u.id}`, { headers: cab }, 4000);
    if (!r.ok) return { ok: false, status: 503, codigo: 'perfil_indisponivel' };
    const l = await r.json(); role = Array.isArray(l) && l[0] ? l[0].role : null;
  } catch (e) { return { ok: false, status: 503, codigo: 'perfil_indisponivel' }; }
  const email = String(u.email || '').toLowerCase();
  if (!PERFIS_PERMITIDOS.includes(role) || EMAILS_BLOQUEADOS.includes(email)) return { ok: false, status: 403, codigo: 'sem_permissao' };
  return { ok: true, userId: u.id };
}

// Lê TODAS as respostas do E-NPS com a chave privada. Só as colunas que o painel usa: não existe coluna de nome, e-mail, IP nem horário.
async function lerRespostas({ fetchFn, env }) {
  const url = String(env.ENPS_SUPABASE_URL || '').replace(/\/+$/, ''), chave = env.ENPS_SERVICE_KEY;
  const cab = { apikey: chave, Authorization: 'Bearer ' + chave };
  const linhas = [];
  for (let p = 0; p < MAX_PAGINAS; p++) {
    const ini = p * POR_PAGINA;
    const r = await fetchTempo(fetchFn, `${url}/rest/v1/respostas_v2?select=dia,e_nps,respostas,faz_bem,melhorar,sugestoes&order=dia.asc&limit=${POR_PAGINA}&offset=${ini}`, { headers: cab }, 8000);
    if (!r.ok) throw new Error('enps_leitura_' + r.status);
    const l = await r.json(); if (!Array.isArray(l)) throw new Error('enps_formato');
    linhas.push(...l); if (l.length < POR_PAGINA) break;
  }
  return linhas;
}

function configurado(env) { return !!(env.ENPS_SUPABASE_URL && /^https:\/\//.test(env.ENPS_SUPABASE_URL) && env.ENPS_SERVICE_KEY && String(env.ENPS_SERVICE_KEY).length > 20); }

// corpo = { periodo, agrupar }. Devolve { status, corpo }. Ordem: sessão (401) -> perfil (403) -> limite (429) -> configuração (503) -> dados.
async function processar({ env, fetchFn, corpo, token, agoraMs, sorteio }) {
  const agora = agoraMs != null ? agoraMs : Date.now();
  const auth = await autenticar({ fetchFn, env, token });
  if (!auth.ok) return { status: auth.status, corpo: { ok: false, codigo: auth.codigo } };       // sem sessão ou sem perfil: NENHUM dado
  if (limite(auth.userId, agora, env)) return { status: 429, corpo: { ok: false, codigo: 'limite_minuto' } };
  if (!configurado(env)) return { status: 503, corpo: { ok: false, codigo: 'nao_configurado' } };
  let linhas;
  try { linhas = await lerRespostas({ fetchFn, env }); } catch (e) { return { status: 502, corpo: { ok: false, codigo: 'enps_indisponivel' } }; }
  return { status: 200, corpo: calcular(linhas, corpo || {}, { agoraMs: agora, sorteio }) };
}

// GET: estado do serviço, sem segredo e sem exigir login (só diz se as variáveis existem)
function saude(env) { return { ok: true, servico: 'enps-respostas', minimo: MINIMO, configurado: configurado(env) }; }

module.exports = { processar, saude, autenticar, lerRespostas, configurado, PERFIS_PERMITIDOS, EMAILS_BLOQUEADOS };
