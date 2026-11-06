# JH TELECOM · Nexus System

Sistema de gestão da operação (produção, prazos/SLA, IFI-IRR, PCR, frota, pedágio,
financeiro e folha de pagamento).

- `index.html` — o sistema inteiro (HTML + CSS + JavaScript num arquivo só).
- `vercel.json` — configuração da hospedagem.
- `api/` e `lib/` — função do assistente de IA (`/api/assistente`); precisam ir junto, na raiz. Chaves de IA ficam em Settings › Environment Variables da Vercel (`GEMINI_API_KEY` etc.), nunca no código.
- `api/enps-respostas.js` + `lib/enps/` — painel de resultados do E-NPS dos técnicos dentro do JH (função segura que confere o perfil e consulta o Supabase INDEPENDENTE do E-NPS). Variáveis de ambiente do projeto: `ENPS_SUPABASE_URL` e `ENPS_SERVICE_KEY` (chave `service_role` do E-NPS; só no servidor, nunca no código nem no navegador).

## Atualizar o site

Suba o `index.html` novo por cima (Add file → Upload files) e confirme o commit.
A Vercel republica sozinha em menos de um minuto, no mesmo endereço.
