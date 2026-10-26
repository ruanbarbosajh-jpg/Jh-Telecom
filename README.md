# JH TELECOM · Nexus System

Sistema de gestão da operação (produção, prazos/SLA, IFI-IRR, PCR, frota, pedágio,
financeiro e folha de pagamento).

- `index.html` — o sistema inteiro (HTML + CSS + JavaScript num arquivo só).
- `vercel.json` — configuração da hospedagem.
- `api/` e `lib/` — função do assistente de IA (`/api/assistente`); precisam ir junto, na raiz. Chaves de IA ficam em Settings › Environment Variables da Vercel (`GEMINI_API_KEY` etc.), nunca no código.

## Atualizar o site

Suba o `index.html` novo por cima (Add file → Upload files) e confirme o commit.
A Vercel republica sozinha em menos de um minuto, no mesmo endereço.
