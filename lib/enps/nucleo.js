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
const EMAILS_BLOQUEADOS = [];   // 04/11/2026: a Thaís passou a ter acesso (pedido do cliente); a lista fica pra bloquear alguma conta de Supervisor/Coordenador no futuro
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
  return { ok: true, userId: u.id, role };
}

// Lê TODAS as respostas do E-NPS com a chave privada. Só as colunas que o painel usa: não existe coluna de nome, e-mail, IP nem horário.
async function lerRespostas({ fetchFn, env }) {
  const url = String(env.ENPS_SUPABASE_URL || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, ''), chave = String(env.ENPS_SERVICE_KEY || '').trim();   // trim: espaço/quebra de linha colado junto com a chave derruba o cabeçalho
  // chave nova (sb_secret_...) não é JWT: vai só no cabeçalho apikey; a antiga (service_role, JWT) vai nos dois
  const cab = chave.startsWith('sb_') ? { apikey: chave } : { apikey: chave, Authorization: 'Bearer ' + chave };
  const linhas = [];
  for (let p = 0; p < MAX_PAGINAS; p++) {
    const ini = p * POR_PAGINA;
    const resto = `&order=dia.asc&limit=${POR_PAGINA}&offset=${ini}`;
    let r = await fetchTempo(fetchFn, `${url}/rest/v1/respostas_v2?select=dia,e_nps,respostas,faz_bem,melhorar,sugestoes,atendente,obs_atendente${resto}`, { headers: cab }, 8000);
    // 04/11/2026: enquanto o SQL do atendente (enps-escritorio/adicionar-atendente.sql) não foi rodado, as colunas novas não existem (400): lê sem elas
    if (r.status === 400) r = await fetchTempo(fetchFn, `${url}/rest/v1/respostas_v2?select=dia,e_nps,respostas,faz_bem,melhorar,sugestoes${resto}`, { headers: cab }, 8000);
    if (!r.ok) throw new Error('enps_leitura_' + r.status);
    const l = await r.json(); if (!Array.isArray(l)) throw new Error('enps_formato');
    linhas.push(...l); if (l.length < POR_PAGINA) break;
  }
  return linhas;
}

// cabeçalhos e URL do banco do E-NPS (mesma regra de lerRespostas)
function acessoEnps(env) {
  const url = String(env.ENPS_SUPABASE_URL || '').trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, ''), chave = String(env.ENPS_SERVICE_KEY || '').trim();
  return { url, cab: chave.startsWith('sb_') ? { apikey: chave } : { apikey: chave, Authorization: 'Bearer ' + chave } };
}

// ---- GERENCIAR RESPOSTAS (04/11/2026, pedido do cliente: "somente o analista pode editar ou excluir"; escolhido: SÓ EXCLUIR, ninguém edita resposta de pesquisa anônima) ----
// Só o ANALISTA (conferido aqui, no servidor, pelo perfil da tabela `perfis`). `listar` devolve cada resposta SEM identificação (o banco do E-NPS não guarda nome, e-mail nem IP) com o id
// opaco que serve pra excluir; `excluir` apaga por id, no máximo 50 por vez, e só com `confirmar: true`.
const MAX_EXCLUIR = 50, MAX_LISTA = 500;
const mediaDasRespostas = r => { const v = Object.values(r || {}).map(Number).filter(x => x >= 1 && x <= 5); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 100) / 100 : null; };
const corta = (t, n) => String(t || '').slice(0, n);
async function listarParaAnalista({ fetchFn, env }) {
  const { url, cab } = acessoEnps(env);
  let r = await fetchTempo(fetchFn, `${url}/rest/v1/respostas_v2?select=id,dia,e_nps,respostas,faz_bem,melhorar,sugestoes,atendente,obs_atendente&order=dia.desc&limit=${MAX_LISTA}`, { headers: cab }, 8000);
  if (r.status === 400) r = await fetchTempo(fetchFn, `${url}/rest/v1/respostas_v2?select=id,dia,e_nps,respostas,faz_bem,melhorar,sugestoes&order=dia.desc&limit=${MAX_LISTA}`, { headers: cab }, 8000);
  if (!r.ok) throw new Error('enps_leitura_' + r.status);
  const l = await r.json(); if (!Array.isArray(l)) throw new Error('enps_formato');
  return l.map(x => ({ id: x.id, dia: x.dia, nota: x.e_nps, media: mediaDasRespostas(x.respostas), faz_bem: corta(x.faz_bem, 300), melhorar: corta(x.melhorar, 300), sugestoes: corta(x.sugestoes, 300), atendente: x.atendente || '', obs_atendente: corta(x.obs_atendente, 300) }));
}
async function excluirParaAnalista({ fetchFn, env, ids }) {
  const { url, cab } = acessoEnps(env);
  const r = await fetchTempo(fetchFn, `${url}/rest/v1/respostas_v2?id=in.(${ids.join(',')})&select=id`, { method: 'DELETE', headers: { ...cab, Prefer: 'return=representation' } }, 8000);
  if (!r.ok) throw new Error('enps_exclusao_' + r.status);
  const l = await r.json(); return Array.isArray(l) ? l.length : 0;
}

function configurado(env) { return !!(env.ENPS_SUPABASE_URL && /^https:\/\//.test(env.ENPS_SUPABASE_URL) && env.ENPS_SERVICE_KEY && String(env.ENPS_SERVICE_KEY).length > 20); }

// corpo = { periodo, agrupar }. Devolve { status, corpo }. Ordem: sessão (401) -> perfil (403) -> limite (429) -> configuração (503) -> dados.
async function processar({ env, fetchFn, corpo, token, agoraMs, sorteio }) {
  const agora = agoraMs != null ? agoraMs : Date.now();
  const auth = await autenticar({ fetchFn, env, token });
  if (!auth.ok) return { status: auth.status, corpo: { ok: false, codigo: auth.codigo } };       // sem sessão ou sem perfil: NENHUM dado
  if (limite(auth.userId, agora, env)) return { status: 429, corpo: { ok: false, codigo: 'limite_minuto' } };
  if (!configurado(env)) return { status: 503, corpo: { ok: false, codigo: 'nao_configurado' } };
  const acao = corpo && corpo.acao;
  if (acao === 'listar' || acao === 'excluir') {
    if (auth.role !== 'analista') return { status: 403, corpo: { ok: false, codigo: 'so_analista' } };      // gerenciar respostas = SÓ o Analista (Supervisor, Gestão, RH e Thaís só leem os resultados)
    try {
      if (acao === 'listar') return { status: 200, corpo: { ok: true, acao, respostas: await listarParaAnalista({ fetchFn, env }) } };
      const ids = Array.isArray(corpo.ids) ? corpo.ids.map(String) : [];
      if (corpo.confirmar !== true || !ids.length || ids.length > MAX_EXCLUIR || ids.some(i => !UUID.test(i)) || new Set(ids).size !== ids.length) return { status: 400, corpo: { ok: false, codigo: 'pedido_invalido' } };
      const n = await excluirParaAnalista({ fetchFn, env, ids });
      console.error('[enps-respostas] exclusão pelo Analista: ' + n + ' resposta(s)');   // só a contagem; nunca o conteúdo
      return { status: 200, corpo: { ok: true, acao, excluidas: n } };
    } catch (e) { console.error('[enps-respostas] gerenciar falhou:', e && e.message); return { status: 502, corpo: { ok: false, codigo: 'enps_indisponivel', detalhe: String((e && e.message) || 'erro').replace(/[^a-z0-9_ ]/gi, '').slice(0, 40) } }; }
  }
  let linhas;
  try { linhas = await lerRespostas({ fetchFn, env }); } catch (e) { console.error('[enps-respostas] leitura do banco do E-NPS falhou:', e && e.message); return { status: 502, corpo: { ok: false, codigo: 'enps_indisponivel', detalhe: String((e && e.message) || 'erro').replace(/[^a-z0-9_ ]/gi, '').slice(0, 40) } }; }   // só o código do erro (ex.: enps_leitura_401), pra quem JÁ está autorizado; nunca a chave nem dado
  return { status: 200, corpo: calcular(linhas, corpo || {}, { agoraMs: agora, sorteio }) };
}

// GET: estado do serviço, sem segredo e sem exigir login (só diz se as variáveis existem)
function saude(env) { return { ok: true, servico: 'enps-respostas', minimo: MINIMO, configurado: configurado(env) }; }

module.exports = { processar, saude, autenticar, lerRespostas, configurado, PERFIS_PERMITIDOS, EMAILS_BLOQUEADOS };
