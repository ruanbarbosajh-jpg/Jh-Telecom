'use strict';
// RESULTADOS DO E-NPS (pesquisa anônima em que os técnicos avaliam o escritório) — cálculo e REGRAS DE ANONIMATO.
// Roda só no servidor, sobre as linhas lidas do Supabase INDEPENDENTE do E-NPS com a chave privada. O navegador nunca recebe linha
// individual: recebe só agregados (e os comentários soltos, embaralhados e sem data). Nada aqui conhece usuário do JH Telecom.
// Funções puras, sem rede — dá pra testar sem a Vercel (o mesmo arquivo roda no navegador de teste).

const MINIMO = 5;                                   // nenhum número (nem ponto de gráfico) sai com menos de 5 respostas
const PERIODOS = ['tudo', '30', '90', '180'];
const AGRUPAR = ['mes', 'sem'];
const IDS = ['a1', 'a2', 'a3', 'a4', 'b1', 'b2', 'b3', 'b4', 'c1', 'c2', 'c3', 'c4', 'd1', 'd2', 'd3', 'd4', 'e1', 'e2', 'e3', 'e4', 'e5'];
const CATEGORIAS = ['a', 'b', 'c', 'd', 'e'];
const ABERTAS = ['faz_bem', 'melhorar', 'sugestoes'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;

// Linha vinda do banco -> linha limpa (ou null se vier malformada). Só os campos que o painel usa; `dia` fica só pra filtrar/agrupar.
function limparLinha(r) {
  if (!r || typeof r !== 'object') return null;
  const dia = String(r.dia || '');
  const nps = r.e_nps;
  if (!ISO.test(dia) || !Number.isInteger(nps) || nps < 0 || nps > 10) return null;
  const resp = {};
  if (r.respostas && typeof r.respostas === 'object') {
    for (const id of IDS) { const v = r.respostas[id]; if (Number.isInteger(v) && v >= 0 && v <= 5) resp[id] = v; }
  }
  const txt = k => (typeof r[k] === 'string' ? r[k].trim().slice(0, 2000) : '');
  return { dia, nps, resp, faz_bem: txt('faz_bem'), melhorar: txt('melhorar'), sugestoes: txt('sugestoes') };
}

function dataSP(agoraMs) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(agoraMs)); }
function somarDias(iso, dias) { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + dias); return d.toISOString().slice(0, 10); }
function segundaDaSemana(iso) { const d = new Date(iso + 'T12:00:00Z'); const dow = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - dow); return d.toISOString().slice(0, 10); }

function resumoNps(rs) {
  const total = rs.length;
  const p = rs.filter(r => r.nps >= 9).length, d = rs.filter(r => r.nps <= 6).length, n = total - p - d;
  return { total, promotores: p, neutros: n, detratores: d, enps: total ? Math.round((p - d) / total * 100) : null,
    mediaNota: total ? Math.round(rs.reduce((s, r) => s + r.nps, 0) / total * 100) / 100 : null };
}
// média das respostas 1..5 (0 = "não se aplica" fica de fora)
function mediaGeral(rs) { let s = 0, n = 0; for (const r of rs) for (const id of IDS) { const v = r.resp[id]; if (v >= 1) { s += v; n++; } } return n ? Math.round(s / n * 100) / 100 : null; }

// Mantém o desenho (preenchido) sempre que houver >= MINIMO respostas "visíveis" (válidas + "não se aplica"); senão devolve null: sem número.
function porCategoria(rs, ids) {
  let s = 0, n = 0, na = 0;
  for (const r of rs) for (const id of ids) { const v = r.resp[id]; if (v === undefined) continue; if (v === 0) na++; else { s += v; n++; } }
  return n + na >= MINIMO && n ? Math.round(s / n * 100) / 100 : null;
}
function porPergunta(rs, id) {
  const dist = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }; let na = 0, n = 0, s = 0;
  for (const r of rs) { const v = r.resp[id]; if (v === undefined) continue; if (v === 0) na++; else { dist[v]++; n++; s += v; } }
  if (n + na < MINIMO || !n) return { id, media: null, dist: null, naoSeAplica: null };
  return { id, media: Math.round(s / n * 100) / 100, dist, naoSeAplica: na };
}

// Evolução / histórico: grupos por mês (ou semana) SEMPRE com >= MINIMO respostas. Grupo pequeno é juntado ao seguinte (e a sobra final ao
// anterior), então os grupos cobrem todas as respostas do recorte e não sobra resposta "escondida" que se descobriria subtraindo do total.
function grupos(rs, agrupar) {
  const chave = r => agrupar === 'sem' ? segundaDaSemana(r.dia) : r.dia.slice(0, 7);
  const m = new Map(); for (const r of rs) { const k = chave(r); (m.get(k) || m.set(k, []).get(k)).push(r); }
  const ks = [...m.keys()].sort(); const out = []; let atual = { ks: [], rs: [] };
  for (const k of ks) { atual.ks.push(k); atual.rs.push(...m.get(k)); if (atual.rs.length >= MINIMO) { out.push(atual); atual = { ks: [], rs: [] }; } }
  if (atual.rs.length) { if (out.length) { const ult = out[out.length - 1]; ult.ks.push(...atual.ks); ult.rs.push(...atual.rs); } else out.push(atual); }
  return out.filter(g => g.rs.length >= MINIMO).map(g => {
    const primeira = g.ks[0], ultima = g.ks[g.ks.length - 1];
    const rot = agrupar === 'sem' ? (primeira === ultima ? primeira : primeira + ' a ' + ultima) : (primeira === ultima ? primeira : primeira + ' a ' + ultima);
    return { periodo: rot, ...resumoNps(g.rs), mediaGeral: mediaGeral(g.rs) };
  });
}

function embaralhar(a, sorteio) { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(sorteio() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function sorteioPadrao() { try { const b = require('crypto').randomBytes(4).readUInt32BE(0); return b / 4294967296; } catch (e) { return Math.random(); } }

// Regra de entrada: `linhas` = todas as respostas do banco; `pedido` = { periodo, agrupar }; devolve SEMPRE um objeto sem linha individual.
function calcular(linhasBrutas, pedido, opts) {
  const o = opts || {}; const agoraMs = o.agoraMs != null ? o.agoraMs : Date.now(); const sorteio = o.sorteio || sorteioPadrao;
  const periodo = PERIODOS.includes(String(pedido && pedido.periodo)) ? String(pedido.periodo) : 'tudo';
  const agrupar = AGRUPAR.includes(String(pedido && pedido.agrupar)) ? String(pedido.agrupar) : 'mes';
  const todas = (linhasBrutas || []).map(limparLinha).filter(Boolean);
  const base = { ok: true, minimo: MINIMO, periodo, agrupar };
  if (todas.length < MINIMO) return { ...base, liberado: false, motivo: 'poucas_respostas' };
  let rs = todas;
  if (periodo !== 'tudo') { const corte = somarDias(dataSP(agoraMs), -Number(periodo)); rs = todas.filter(r => r.dia >= corte); }
  if (rs.length < MINIMO) return { ...base, liberado: false, motivo: 'poucas_respostas' };
  // trava contra subtração: o que ficou FORA do recorte também não pode ser um grupo pequeno (1 a 4 respostas) deduzível de "Tudo" − recorte
  const fora = todas.length - rs.length;
  if (fora > 0 && fora < MINIMO) return { ...base, liberado: false, motivo: 'recorte_isola' };

  const categorias = CATEGORIAS.map(c => ({ id: c, media: porCategoria(rs, IDS.filter(i => i[0] === c)) }));
  const perguntas = IDS.map(id => porPergunta(rs, id));
  const comentarios = {}; for (const k of ABERTAS) comentarios[k] = embaralhar(rs.map(r => r[k]).filter(Boolean), sorteio);
  return { ...base, liberado: true, resumo: resumoNps(rs), mediaGeral: mediaGeral(rs), categorias, perguntas, evolucao: grupos(rs, agrupar), comentarios };
}

module.exports = { MINIMO, PERIODOS, AGRUPAR, IDS, limparLinha, calcular, grupos, resumoNps, porPergunta, porCategoria, embaralhar, dataSP, somarDias };
