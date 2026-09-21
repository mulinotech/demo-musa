# Esta pasta é LEGADO — o projeto vive em `app/`

`front-src/` guarda **recortes** de telas enviados em entregas antigas (agosto e
início de setembro de 2026). Ela nunca foi o projeto: é um punhado de arquivos
soltos, com a estrutura achatada, e **está desatualizada**.

O código do front — e do servidor — vive em **`app/`**:

    app/src/        as telas (React + TypeScript)
    app/server/     a API (Express)
    app/db/         as migrations
    app/tests/      a suíte
    app/scripts/    a varredura de vazamento e os diagnósticos

Em 21/09/2026 esta pasta enganou a leitura do estado do projeto: olhando só para
ela, parecia que o front tinha seis componentes. Este arquivo existe para que
isso não se repita. A pasta segue aqui por precaução histórica e pode ser
removida quando alguém confirmar que nada dentro dela falta em `app/`.
