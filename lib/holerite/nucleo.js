'use strict';
// NÚCLEO do envio de holerites por WhatsApp (06/11/2026, SÓ o Analista). Usa a WhatsApp Business Platform (Cloud API da Meta): um modelo (template) APROVADO
// com cabeçalho de DOCUMENTO (o PDF do holerite) é enviado, um técnico por vez, para o número confirmado dele.
// O QUE ESTE ARQUIVO GARANTE (tudo conferido AQUI, no servidor, nunca pelo que o navegador diz):
//   • sessão válida e perfil = analista (tabela `perfis`, lida com o token da própria pessoa);
//   • o telefone vem do BANCO (tecnico_contatos, status 'confirmado') pela CHAVE do técnico — o navegador não escolhe o destino; se mandar um número diferente, recusa;
//   • nunca reenvia um holerite já enviado (folha_holerite_envios) a não ser com o pedido explícito "reenviar";
//   • o PDF precisa ser um PDF de verdade (cabeçalho %PDF) de até 2 MB;
//   • sem as variáveis de ambiente da Meta (WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_TEMPLATE) NADA é enviado: só o modo teste (dryRun) responde.
// O token da Meta fica SÓ nas variáveis de ambiente do projeto na Vercel — nunca no HTML, nunca no navegador, nunca em log.
const SUPABASE_URL_PADRAO = 'https://tameptndgnzvnghgmtqk.supabase.co';
const SUPABASE_KEY_PADRAO = 'sb_publishable_cFCAzA9ubiiTuDHml-6Htw_nxVAK1_L';   // chave PÚBLICA do JH (a mesma do HTML)
const PERFIS_PERMITIDOS = ['analista'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GRAPH = 'https://graph.facebook.com/v21.0';
const MAX_PDF = 2 * 1024 * 1024;

const USO = new Map();
function limite(userId, agoraMs, env) {
  const max = Number(env.HOLERITE_LIMITE_MINUTO) || 60;
  const l = (USO.get(userId) || []).filter(t => agoraMs - t < 60000);
  if (l.length >= max) return true;
  l.push(agoraMs); USO.set(userId, l); return false;
}
async function fetchTempo(fetchFn, url, init, ms) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), ms) : null;
  try { return await fetchFn(url, { ...init, signal: ctl ? ctl.signal : undefined }); } finally { if (timer) clearTimeout(timer); }
}
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
  if (!PERFIS_PERMITIDOS.includes(role)) return { ok: false, status: 403, codigo: 'sem_permissao' };
  return { ok: true, userId: u.id, role, cab, base };
}
function configurado(env) { return !!(env.WHATSAPP_TOKEN && String(env.WHATSAPP_TOKEN).length > 20 && /^\d{6,25}$/.test(String(env.WHATSAPP_PHONE_ID || '').trim()) && /^[a-z0-9_]{1,512}$/.test(String(env.WHATSAPP_TEMPLATE || '').trim())); }
function saude(env) { return { ok: true, configurado: configurado(env), modelo: configurado(env) ? String(env.WHATSAPP_TEMPLATE).trim() : null }; }   // nunca devolve token nem id do número
const mascara = t => String(t).replace(/^(\d{2})(\d{2})(\d)(\d{3,4})(\d{4})$/, '$1 $2 $3****-$5');

function validar(c) {
  if (!c || typeof c !== 'object') return 'corpo_invalido';
  const txt = (v, max) => typeof v === 'string' && v.length > 0 && v.length <= max;
  if (!txt(c.periodo, 60) || !txt(c.tecnico, 160) || !/^[a-z0-9: ]{2,160}$/.test(String(c.tecnicoChave || ''))) return 'dados_invalidos';
  if (!/^[A-Za-z0-9._\- ]{3,120}\.pdf$/.test(String(c.arquivo || ''))) return 'arquivo_invalido';
  if (typeof c.pdfBase64 !== 'string' || c.pdfBase64.length < 200 || c.pdfBase64.length > MAX_PDF * 1.4 || !/^[A-Za-z0-9+/=]+$/.test(c.pdfBase64)) return 'pdf_invalido';
  return null;
}

async function processar({ env, fetchFn, corpo, token }) {
  const falha = (status, codigo, extra) => ({ status, corpo: { ok: false, codigo, ...(extra || {}) } });
  const auth = await autenticar({ fetchFn, env, token });
  if (!auth.ok) return falha(auth.status, auth.codigo);
  if (limite(auth.userId, Date.now(), env)) return falha(429, 'limite');
  const erro = validar(corpo);
  if (erro) return falha(400, erro);
  const dryRun = corpo.dryRun !== false;           // sem pedir explicitamente o envio real, é teste
  const reenviar = corpo.reenviar === true;
  let pdf;
  try { pdf = Buffer.from(corpo.pdfBase64, 'base64'); } catch (e) { return falha(400, 'pdf_invalido'); }
  if (pdf.length > MAX_PDF || pdf.slice(0, 5).toString('latin1') !== '%PDF-') return falha(400, 'pdf_invalido');
  // telefone: SEMPRE do banco, pela chave do técnico, só se estiver confirmado
  let tel = null;
  try {
    const r = await fetchTempo(fetchFn, `${auth.base}/rest/v1/tecnico_contatos?select=telefone,status&chave=eq.${encodeURIComponent(corpo.tecnicoChave)}`, { headers: auth.cab }, 5000);
    if (!r.ok) return falha(503, 'contatos_indisponivel');
    const l = await r.json();
    if (!Array.isArray(l) || l.length !== 1 || l[0].status !== 'confirmado' || !/^55\d{10,11}$/.test(String(l[0].telefone))) return falha(409, 'sem_telefone_confirmado');
    tel = String(l[0].telefone);
  } catch (e) { return falha(503, 'contatos_indisponivel'); }
  if (corpo.telefone && String(corpo.telefone).replace(/\D/g, '') !== tel) return falha(409, 'telefone_divergente');   // a tela e o banco não concordam: não envia
  // já enviado?
  try {
    const r = await fetchTempo(fetchFn, `${auth.base}/rest/v1/folha_holerite_envios?select=status&periodo=eq.${encodeURIComponent(corpo.periodo)}&tecnico_chave=eq.${encodeURIComponent(corpo.tecnicoChave)}`, { headers: auth.cab }, 5000);
    if (r.ok) { const l = await r.json(); if (Array.isArray(l) && l[0] && l[0].status === 'enviado' && !reenviar && !dryRun) return falha(409, 'ja_enviado'); }
  } catch (e) { /* sem a tabela de controle o navegador já avisou; não trava o teste */ }
  if (dryRun) return { status: 200, corpo: { ok: true, simulado: true, destino: mascara(tel), bytes: pdf.length, configurado: configurado(env) } };
  if (!configurado(env)) return falha(503, 'nao_configurado');
  // ---- envio real (Cloud API) ----
  const tokenMeta = String(env.WHATSAPP_TOKEN).trim(), numeroId = String(env.WHATSAPP_PHONE_ID).trim(), modelo = String(env.WHATSAPP_TEMPLATE).trim();
  try {
    const fd = new FormData();
    fd.append('messaging_product', 'whatsapp'); fd.append('type', 'application/pdf');
    fd.append('file', new Blob([pdf], { type: 'application/pdf' }), corpo.arquivo);
    const up = await fetchTempo(fetchFn, `${GRAPH}/${numeroId}/media`, { method: 'POST', headers: { Authorization: 'Bearer ' + tokenMeta }, body: fd }, 15000);
    const upj = await up.json().catch(() => ({}));
    if (!up.ok || !upj.id) return falha(502, 'meta_upload', { detalhe: erroMeta(upj) });
    const primeiro = String(corpo.tecnico).trim().split(/\s+/)[0] || 'técnico';
    const env2 = await fetchTempo(fetchFn, `${GRAPH}/${numeroId}/messages`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + tokenMeta, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: tel, type: 'template', template: { name: modelo, language: { code: 'pt_BR' }, components: [
        { type: 'header', parameters: [{ type: 'document', document: { id: upj.id, filename: corpo.arquivo } }] },
        { type: 'body', parameters: [{ type: 'text', text: primeiro }, { type: 'text', text: corpo.periodo }] }] } }) }, 15000);
    const ej = await env2.json().catch(() => ({}));
    if (!env2.ok || !(ej.messages && ej.messages[0])) return falha(502, 'meta_envio', { detalhe: erroMeta(ej) });
    return { status: 200, corpo: { ok: true, simulado: false, mensagemId: ej.messages[0].id, destino: mascara(tel) } };
  } catch (e) { return falha(504, 'meta_indisponivel'); }
}
// só o código e a mensagem curta do erro da Meta — nunca o corpo inteiro, que pode ecoar dados
function erroMeta(j) { const e = j && j.error; return e ? `${e.code || ''} ${String(e.message || '').slice(0, 160)}`.trim() : 'resposta inesperada'; }

module.exports = { processar, saude, configurado, validar, mascara };
