# Musa CRM — Dra. Musa Estética de Elite

CRM de clínica de estética com captação, atendimento por WhatsApp e acompanhamento clínico.
Demonstração: [demo-musa.mulinotech.com](https://demo-musa.mulinotech.com)

Projeto da **Mulino Tech / Inpyx Group**.

## O que o sistema faz

O produto tem duas metades no mesmo código.

**Site público** — captação de leads: catálogo de procedimentos, antes e depois, quiz de avaliação de
pele com análise por IA, formulário de contato e WhatsApp flutuante.

**Console CRM** — operação da clínica:

| Módulo | O que faz |
|---|---|
| Visão Geral | Total de leads, taxa de conversão, faturamento, LTV médio e custo por lead |
| Funil & Leads | Kanban comercial com cinco estágios, atribuição a vendedor e notas |
| Pacientes | Ficha completa, anamnese, laudo por IA, planos de tratamento e sessões com evolução clínica |
| Atendimento | Caixa de entrada de WhatsApp dentro do CRM, com resposta sugerida por IA |
| Integração WhatsApp | Instâncias da Evolution API, QR Code e status de conexão |
| Cadastros | Catálogo de tratamentos e equipe comercial |
| Logs do Sistema | Trilha de auditoria das ações |

## Stack

- **Front:** React 19, Vite 6, TypeScript, Tailwind 4, Recharts, Motion
- **Back:** Node + Express 4, mysql2
- **Banco:** MySQL 8
- **Integrações:** Google Gemini (análise de pele e sugestão de resposta), Evolution API (WhatsApp)

## Rodando localmente

```bash
cd app
npm install
cp .env.example .env      # preencha com os seus valores
npm run server            # API na porta definida em PORT (padrão 3001)
npm run dev               # front com Vite, em outra aba
```

Para produção: `npm run build` gera `app/dist/`, servido pelo próprio Express.

## Configuração

Todas as credenciais vêm de variáveis de ambiente — veja `app/.env.example`. O arquivo `.env` **não é
versionado** e não deve ser, em hipótese alguma: ele guarda acesso ao banco, chave do Gemini e chave
da Evolution API.

## Estrutura

```
app/
  app.js                  API Express e conexão com o MySQL
  schema.sql              esquema do banco
  src/
    App.tsx               composição do site público + console CRM
    types.ts              tipos de domínio
    data.ts               conteúdo do site (procedimentos, avaliações)
    components/           componentes do site e do CRM
    assets/               imagens dos procedimentos e resultados
```

## Roadmap

Está em andamento uma expansão operacional do produto — agenda, precificação, financeiro, documentos
e anamnese, estoque e fidelização — precedida de uma fase de fundação que introduz migrations,
autenticação com JWT, modularização do backend e testes automatizados.

O plano de trabalho, o backlog e os documentos de contexto por módulo são mantidos fora deste
repositório enquanto ele for público.
