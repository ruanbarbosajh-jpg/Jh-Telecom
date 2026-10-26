'use strict';
// PROVEDORES de IA (28/10/2026): camada independente do fornecedor. Cada provedor recebe { sistema, usuario } e devolve o TEXTO JSON do plano.
// Para trocar/acrescentar um fornecedor: escrever um adaptador novo aqui e listá-lo em IA_PROVEDORES (variável de ambiente da Vercel).
// Chaves e modelos SÓ vêm de variáveis de ambiente do servidor — nunca do navegador, nunca do código.
//   GEMINI_API_KEY      (+ GEMINI_MODEL = um ou mais modelos separados por vírgula, tentados em ordem; padrão "gemini-3.5-flash,gemini-3-flash-preview" — conferidos com a chave real em 28/10/2026:
//                         o gemini-2.5-flash e o 2.5-flash-lite NÃO existem mais para contas novas (404); os "-lite" respondiam em 12–24 s, os "flash" em 1–6 s)
//   GROQ_API_KEY        (+ GROQ_MODEL, padrão llama-3.3-70b-versatile — modelo de produção listado em console.groq.com/docs/models em 28/10/2026)
//   OPENROUTER_API_KEY  + OPENROUTER_MODEL      (use um modelo terminado em ":free")
//   IA_PROVEDORES       ordem de tentativa, ex.: "gemini,groq,openrouter" (padrão)
// Nenhum desses serviços é ligado a faturamento por este código; os limites do nível gratuito são do fornecedor, mudam sem aviso e
// não são garantidos — por isso o código tem fallback, limite por usuário e "esfriamento" depois de um 429.

const CLASSES_ERRO = { quota: 'quota', indisponivel: 'indisponivel', config: 'config', invalida: 'resposta_invalida' };

function erro(classe, detalhe, status) { const e = new Error(detalhe || classe); e.classe = classe; e.status = status || 0; return e; }

async function chamarHttp(fetchFn, url, init, tempoMs) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), tempoMs) : null;
  try {
    const r = await fetchFn(url, { ...init, signal: ctl ? ctl.signal : undefined });
    return r;
  } catch (e) {
    throw erro(CLASSES_ERRO.indisponivel, e && e.name === 'AbortError' ? 'tempo esgotado' : 'falha de rede');
  } finally { if (timer) clearTimeout(timer); }
}
function classificarStatus(status, corpoTxt) {
  if (status === 429 || /RESOURCE_EXHAUSTED|rate.?limit|quota/i.test(corpoTxt || '')) return CLASSES_ERRO.quota;
  if (status === 400 || status === 401 || status === 403 || status === 404) return CLASSES_ERRO.config;
  return CLASSES_ERRO.indisponivel;
}

// cota do nível gratuito é POR MODELO: o modelo que devolveu 429 fica 60 s de fora (o próximo da lista assume sem perder tempo)
const ESFRIA_MODELO = new Map();
const ADAPTADORES = {
  gemini: {
    configurado: env => !!env.GEMINI_API_KEY,
    modelo: env => ADAPTADORES.gemini.modelos(env)[0],
    modelos: env => String(env.GEMINI_MODEL || 'gemini-3.5-flash,gemini-3-flash-preview').split(',').map(x => x.trim()).filter(Boolean),
    async chamar({ fetchFn, env, sistema, usuario, tempoMs }) {
      const inicio = Date.now(); let ultimo = null;
      for (const modelo of ADAPTADORES.gemini.modelos(env)) {
        const restante = tempoMs - (Date.now() - inicio); if (restante < 1200) break;
        if ((ESFRIA_MODELO.get(modelo) || 0) > Date.now()) { ultimo = ultimo || erro(CLASSES_ERRO.quota, 'gemini: modelo esfriando'); continue; }   // este modelo deu 429 há pouco: nem tenta
        try { return await ADAPTADORES.gemini.umModelo({ fetchFn, env, sistema, usuario, tempoMs: restante, modelo }); }
        catch (e) { ultimo = e; if (e.classe === CLASSES_ERRO.quota) ESFRIA_MODELO.set(modelo, Date.now() + 60000); if (e.classe === CLASSES_ERRO.invalida) throw e; }   // resposta inválida não tenta o próximo modelo (já gastou tempo): quem decide é o fallback entre provedores
      }
      throw ultimo || erro(CLASSES_ERRO.indisponivel, 'gemini: sem tempo');
    },
    async umModelo({ fetchFn, env, sistema, usuario, tempoMs, modelo }) {
      // plano curto: sem "raciocínio" (3.x: thinkingLevel minimal; 2.5: orçamento 0) — com o raciocínio padrão a resposta levava 3–6 s a mais e gastava tokens à toa
      const cfg = { temperature: 0, maxOutputTokens: 1000, responseMimeType: 'application/json' };
      if (/gemini-3/.test(modelo)) cfg.thinkingConfig = { thinkingLevel: 'minimal' };
      else if (/gemini-2\.5/.test(modelo)) cfg.thinkingConfig = { thinkingBudget: 0 };
      const r = await chamarHttp(fetchFn, `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelo)}:generateContent`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
        body: JSON.stringify({ systemInstruction: { parts: [{ text: sistema }] }, contents: [{ role: 'user', parts: [{ text: usuario }] }], generationConfig: cfg }),
      }, tempoMs);
      const txt = await r.text();
      if (!r.ok) throw erro(classificarStatus(r.status, txt), `gemini ${r.status}`, r.status);
      let j; try { j = JSON.parse(txt); } catch (e) { throw erro(CLASSES_ERRO.invalida, 'gemini: resposta não é JSON'); }
      const parte = j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts && j.candidates[0].content.parts[0];
      if (!parte || typeof parte.text !== 'string') throw erro(CLASSES_ERRO.invalida, 'gemini: sem texto');
      const u = j.usageMetadata || {};
      return { texto: parte.text, modelo, tokensEntrada: u.promptTokenCount || 0, tokensSaida: u.candidatesTokenCount || 0 };
    },
  },
  groq: {
    configurado: env => !!env.GROQ_API_KEY,
    modelo: env => env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    async chamar(args) { return chamarCompativelOpenAI(args, 'https://api.groq.com/openai/v1/chat/completions', args.env.GROQ_API_KEY, ADAPTADORES.groq.modelo(args.env), 'groq', {}); },
  },
  openrouter: {
    configurado: env => !!env.OPENROUTER_API_KEY && !!env.OPENROUTER_MODEL,
    modelo: env => env.OPENROUTER_MODEL || '',
    async chamar(args) { return chamarCompativelOpenAI(args, 'https://openrouter.ai/api/v1/chat/completions', args.env.OPENROUTER_API_KEY, args.env.OPENROUTER_MODEL, 'openrouter', { 'HTTP-Referer': 'https://jh-telecom-pi.vercel.app', 'X-Title': 'JH Telecom' }); },
  },
};
async function chamarCompativelOpenAI({ fetchFn, sistema, usuario, tempoMs }, url, chave, modelo, nome, extras) {
  const r = await chamarHttp(fetchFn, url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + chave, ...extras },
    body: JSON.stringify({ model: modelo, temperature: 0, max_tokens: 700, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: sistema }, { role: 'user', content: usuario }] }),
  }, tempoMs);
  const txt = await r.text();
  if (!r.ok) throw erro(classificarStatus(r.status, txt), `${nome} ${r.status}`, r.status);
  let j; try { j = JSON.parse(txt); } catch (e) { throw erro(CLASSES_ERRO.invalida, `${nome}: resposta não é JSON`); }
  const msg = j && j.choices && j.choices[0] && j.choices[0].message;
  if (!msg || typeof msg.content !== 'string') throw erro(CLASSES_ERRO.invalida, `${nome}: sem texto`);
  const u = j.usage || {};
  return { texto: msg.content, modelo, tokensEntrada: u.prompt_tokens || 0, tokensSaida: u.completion_tokens || 0 };
}

// tira o JSON do texto do modelo (aceita cerca ```json e texto em volta)
function extrairJson(texto) {
  let t = String(texto || '').trim();
  const cerca = t.match(/```(?:json)?\s*([\s\S]*?)```/i); if (cerca) t = cerca[1].trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a < 0 || b <= a) throw erro(CLASSES_ERRO.invalida, 'sem JSON');
  try { return JSON.parse(t.slice(a, b + 1)); } catch (e) { throw erro(CLASSES_ERRO.invalida, 'JSON inválido'); }
}

// memória do processo (instância da função): provedor que devolveu 429 fica "esfriando" e não é chamado de novo logo em seguida
const ESFRIANDO = new Map();
const ESFRIA_MS = 60 * 1000;

function listarConfigurados(env) {
  const ordem = String(env.IA_PROVEDORES || 'gemini,groq,openrouter').split(',').map(s => s.trim().toLowerCase()).filter(n => ADAPTADORES[n]);
  return ordem.filter(n => ADAPTADORES[n].configurado(env));
}

// tenta os provedores EM ORDEM dentro do orçamento de tempo. A mesma pergunta/contexto vai pra todos (nada é perdido na troca).
// Devolve { ok, plano(json bruto), provedor, modelo, ms, tokensEntrada, tokensSaida, tentativas:[{provedor, ok, classe, ms}] }
async function planejarComFallback({ env, fetchFn, sistema, usuario, orcamentoMs, agora }) {
  const lista = listarConfigurados(env), tentativas = [];
  if (!lista.length) return { ok: false, codigo: 'sem_provedor', tentativas };
  const t0 = agora();
  for (const nome of lista) {
    const restante = orcamentoMs - (agora() - t0);
    if (restante < 1200) { tentativas.push({ provedor: nome, ok: false, classe: 'sem_tempo', ms: 0 }); break; }
    const ate = ESFRIANDO.get(nome);
    if (ate && ate > agora()) { tentativas.push({ provedor: nome, ok: false, classe: 'esfriando', ms: 0 }); continue; }
    const ini = agora();
    try {
      const r = await ADAPTADORES[nome].chamar({ fetchFn, env, sistema, usuario, tempoMs: Math.min(restante, Number(env.IA_TEMPO_POR_PROVEDOR_MS) || 12000) });
      const json = extrairJson(r.texto);
      tentativas.push({ provedor: nome, ok: true, ms: agora() - ini });
      return { ok: true, plano: json, provedor: nome, modelo: r.modelo, ms: agora() - t0, tokensEntrada: r.tokensEntrada, tokensSaida: r.tokensSaida, tentativas };
    } catch (e) {
      const classe = e.classe || CLASSES_ERRO.indisponivel;
      if (classe === CLASSES_ERRO.quota) ESFRIANDO.set(nome, agora() + ESFRIA_MS);
      tentativas.push({ provedor: nome, ok: false, classe, status: e.status || 0, ms: agora() - ini });
    }
  }
  const todosQuota = tentativas.length && tentativas.every(t => ['quota', 'esfriando'].includes(t.classe));
  return { ok: false, codigo: todosQuota ? 'quota_esgotada' : 'indisponivel', tentativas };
}

// DIAGNÓSTICO (botão "Testar conexão com a IA"): uma chamada MÍNIMA em cada provedor configurado, sem nenhum dado do sistema, pra saber se a chave e o modelo funcionam.
// Devolve só nomes, modelos, tempos e a classe do erro — nunca a chave.
const FALTAM = { gemini: env => (env.GEMINI_API_KEY ? [] : ['GEMINI_API_KEY']), groq: env => (env.GROQ_API_KEY ? [] : ['GROQ_API_KEY']), openrouter: env => [...(env.OPENROUTER_API_KEY ? [] : ['OPENROUTER_API_KEY']), ...(env.OPENROUTER_MODEL ? [] : ['OPENROUTER_MODEL'])] };
async function diagnosticar({ env, fetchFn, agora }) {
  const lista = listarConfigurados(env), resultados = [];
  for (const nome of lista) {
    const ini = agora();
    try {
      const r = await ADAPTADORES[nome].chamar({ fetchFn, env, sistema: 'Responda somente com este JSON, sem mais nada: {"acao":"fora_do_escopo","motivo":"teste"}', usuario: 'teste de conexão', tempoMs: 12000 });
      extrairJson(r.texto);
      resultados.push({ provedor: nome, modelo: r.modelo, ok: true, ms: agora() - ini });
    } catch (e) { resultados.push({ provedor: nome, modelo: ADAPTADORES[nome].modelo(env) || null, ok: false, classe: e.classe || CLASSES_ERRO.indisponivel, status: e.status || 0, ms: agora() - ini }); }
  }
  const ausentes = Object.keys(ADAPTADORES).filter(n => !lista.includes(n)).map(n => ({ provedor: n, falta: FALTAM[n](env) }));
  return { configurados: lista, resultados, ausentes };
}

module.exports = { ESFRIA_MODELO, ADAPTADORES, planejarComFallback, listarConfigurados, diagnosticar, extrairJson, ESFRIANDO, CLASSES_ERRO };
