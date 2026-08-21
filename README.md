# JH TELECOM · Nexus System

Sistema de gestão da operação (produção, prazos/SLA, IFI-IRR, PCR, frota, pedágio,
financeiro e folha de pagamento).

## Como funciona

- `index.html` — o sistema inteiro (HTML + CSS + JavaScript num arquivo só).
- `vercel.json` — configuração da hospedagem.

Não tem build, não tem dependência para instalar. A Vercel publica o arquivo como está.

## Como atualizar o site

1. Abra este repositório no GitHub.
2. Clique em `index.html` → ícone de lápis (**Edit**) → ou use **Add file → Upload files**
   e solte o `index.html` novo por cima.
3. Confirme em **Commit changes**.

A Vercel republica sozinha em menos de um minuto, no mesmo endereço.

## Banco de dados

Os dados ficam no Supabase (projeto JH TELECOM - SYSTEM). O login é por conta
(Supabase Auth) e o perfil de cada pessoa vem da tabela `perfis`.
Os scripts de configuração do banco ficam fora deste repositório.
