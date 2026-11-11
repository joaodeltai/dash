# Padrões do repositório usados pela aba "Redes sociais"

Levantamento feito na Fase 0, lendo o código em `develop` (commit `02255e0`). Cada item aponta o arquivo que serve de modelo. Os comandos de checagem estão no fim.

## 1. Migrations e RLS

Modelo: `supabase/migrations/20261111044354_init_schema.sql` (tabela `teams` e suas políticas).

- Arquivo em `supabase/migrations/<timestamp>_<nome>.sql`, criado com `supabase migration new <nome>`. Comentários em português. Uma migration aplicada nunca é editada.
- Tabela em `public`, chave `id uuid primary key default gen_random_uuid()`, `workspace_id uuid not null references public.workspaces (id) on delete cascade`, textos com `check (char_length(...))`, datas `timestamptz not null default now()`.
- Índice em toda chave estrangeira, com nome `<tabela>_<coluna>_idx`.
- Autorização por funções `security definer` do schema `private` (não exposto pela API), todas com `set search_path = ''`:
  - `private.is_member(ws)`: membro ativo do workspace (qualquer papel).
  - `private.can_write(ws)`: papel `owner`, `admin` ou `member` (convidado não escreve).
  - `private.is_admin(ws)`: papel `owner` ou `admin`.
- Políticas com o nome `<tabela>_<operação>`, sempre `to authenticated`, uma por operação:

  ```sql
  create policy teams_select on public.teams for select to authenticated using (private.is_member(workspace_id));
  create policy teams_insert on public.teams for insert to authenticated with check (private.can_write(workspace_id));
  create policy teams_update on public.teams for update to authenticated
    using (private.can_write(workspace_id)) with check (private.can_write(workspace_id));
  create policy teams_delete on public.teams for delete to authenticated using (private.can_write(workspace_id));
  ```

- Privilégios: o papel `anon` não tem nenhum. A migration inicial faz `revoke all on all tables in schema public from anon, authenticated` e depois dá `grant` explícito ao `authenticated`. Tabela nova precisa repetir os dois passos para si mesma. No banco local o `service_role` também não tem `insert/update/delete` nas tabelas de `public`: o que uma Edge Function grava precisa de `grant` explícito a `service_role`.
- Linha filha herda o workspace do pai por trigger (`private.set_ws_from_project`, `set_ws_from_task`): o valor enviado pelo cliente é ignorado. Autoria (`created_by`) é carimbada por trigger, não escolhida pelo cliente.
- Views expostas pela API usam `with (security_invoker = true)`, para que o RLS das tabelas valha para quem consulta.
- Valores guardados ficam em inglês canônico (`status = 'error'`, papéis `owner/admin/member/guest`) e são traduzidos só na tela.
- O servidor MCP do Supabase recusa SQL com `drop` ou `delete` sem confirmação interativa (ver `docs/DATABASE.md`, "Criar uma nova migration").

## 2. Internacionalização

Modelo: `src/core/i18n.js` e `src/i18n/pt-BR/`.

- Estilo gettext: **o texto em inglês é a chave**. `tr('New task')` devolve o texto no idioma atual; em inglês devolve a própria chave. Não existe dicionário `en`: "existe em inglês" significa "a chave é o texto em inglês".
- Parâmetros: `tr('Hello {name}', { name })`. Plural: `trn('{n} task', '{n} tasks', n)`.
- Homógrafos levam contexto depois de uma barra vertical: `tr('Open|verb')`. O contexto não aparece em inglês.
- Português fica em `src/i18n/pt-BR/<área>.js` (um arquivo por área, `export default { 'chave': 'texto' }`), registrado em `src/i18n/pt-BR/index.js`. `common.js` é mesclado por último e tem prioridade.
- `tests/unit/i18n.test.js` varre `src/` (menos `src/i18n/`), extrai toda chave literal de `tr(` e `trn(` e falha se alguma não estiver no dicionário pt-BR, se um `{placeholder}` sumir ou se houver texto vazio. Chave montada em variável não é vista pelo teste: use literais.
- Datas e números: `fmtDate`, `relDate`, `ago` em `src/core/utils.js`; nomes de mês e dia em `src/core/i18n.js` (`monShort`, `shortDay`).

## 3. Tema claro e escuro

Modelo: `src/styles/tokens.css`.

- Toda cor vem de variável CSS. Claro em `:root`; escuro redefinido em `@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) }` e em `:root[data-theme='dark']`.
- Superfícies `--bg`, `--surface`, `--surface-2`, `--surface-3`; linhas `--border`, `--divider`; texto `--text`, `--text-2`, `--text-3`, `--text-4`; destaque `--accent`, `--accent-soft`; semânticas `--green`, `--amber`, `--red`, `--blue`, `--violet`, `--teal`, `--rose`, `--orange`, `--gray` e as versões `-soft`.
- Raio `--r`, `--r-lg`; fonte `--fs-xs` a `--fs-2xl`; espaçamento `--s-1` a `--s-12`; margem de página `--gutter` (24px, 16px no celular).
- Nenhuma cor hexadecimal em CSS ou HTML novo. Mistura de cores com `color-mix(in srgb, var(--x) N%, transparent)`.
- Breakpoints em `src/styles/responsive.css`: 1100px (`.grid2` vira uma coluna), 900px (barra lateral vira gaveta, `.stats` em duas colunas) e 640px (modais viram folha inferior).

## 4. Navegação e páginas

Modelo: `src/shell/render.js`, `src/shell/layout.js`, `src/pages/overview.js`.

- App de página única sem framework. Estado em `S` (`src/core/store.js`); uma página é uma função que devolve uma string HTML; `render()` troca o conteúdo de `#app` e `#layer`.
- Registrar uma página exige quatro pontos:
  1. `ROUTE_NAMES` e `ROUTE_ICONS` em `src/shell/render.js` (nome em inglês, que também vira título da aba e trilha);
  2. o mapa `P` de `renderPage()` em `src/shell/layout.js`;
  3. um `sItem('<rota>', tr('<Nome>'), '<ícone>')` no grupo da barra lateral, também em `layout.js`;
  4. `import './<módulo>.js'` em `src/main.js` (os módulos registram ações e ouvintes ao carregar).
- Endereço: `#/<rota>` (`routeHash`/`parseHash`). No celular a barra lateral abre pelo botão "Mais".
- Ícones: `ic('<nome-lucide>', tamanho)`. O Vite inclui no pacote só os ícones Lucide cujo nome aparece entre aspas em `src/`.
- Eventos: delegação em `src/actions/events.js`. `data-a="<ação>"` chama `A.<ação>(el, e)`; `data-in="<nome>"` chama `IN.<nome>(el)` em `input`/`change`; `<form data-submit="<ação>">` chama `A.<ação>`. As tabelas `A` e `IN` vêm de `src/actions/actions.js` e cada módulo acrescenta as suas (modelo: `src/actions/teams.js`).
- Dados do app principal passam pelo motor de sincronização (`src/data/sync.js`). O cliente Supabase é `sb`, e o workspace aberto é `ctx.wsId`, ambos em `src/data/supabase.js`.

## 5. Componentes e classes

- Página: `<div class="page">`, cabeçalho `<div class="ph"><div><h1>…</h1><p>…</p></div><div class="acts">…</div></div>`.
- Painel: `<section class="panel"><div class="panel-h"><h2>…</h2><div class="acts">…</div></div><div class="panel-b">…</div></section>`. Duas colunas: `.grid2`; pilha: `.stack`.
- Números de destaque: `.stats > .stat` com `.k` (rótulo), `.v` (valor), `.d` (detalhe; `.up` verde, `.bad` vermelho).
- Botões: `.btn` com `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-danger-ghost`, tamanho `.btn-sm`; só ícone: `.ibtn`.
- Formulário: `.field > label.label + input.input` (ou `select.select`, que vira o dropdown do sistema), ajuda `.hint`, erro `.err` com `role="alert"` e `.input.is-error`.
- Alternância: `.seg > button.on`. Abas: `.tabs > .tab.on`. Etiqueta: `.badge` com `.green`, `.amber`, `.red`, `.gray`.
- Aviso: `<div class="alert warn|danger|info|ok">${ic(...)}<span>…</span></div>`.
- Estado vazio: `empty(ícone, título, texto, botão)` de `src/ui/helpers.js`.
- Modal: `.scrim` + `.modal-wrap > .modal` com `.modal-h`, `.modal-b`, `.modal-f` (`src/styles/overlays.css`). Os tipos de modal do app são um `switch` em `src/overlays/modals.js`; confirmação destrutiva usa `confirmDlg` de `src/actions/actions.js`.
- Avisos rápidos: `toast(msg, { kind: 'err' })` de `src/ui/toast.js`.
- Texto do usuário sempre passa por `esc()` antes de entrar no HTML.
- Permissão na tela: `canCreate()` (não convidado) e `isAdmin()` de `src/core/store.js`.
- CSS: um arquivo por área em `src/styles/`, classes curtas em minúsculas, formatado pelo Prettier.

## 6. Build, qualidade e testes

| Comando                                                    | O que faz                                                                      |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `npm run build`                                            | Build de produção com Vite, em `dist/`. É o comando de build desta entrega.    |
| `npm run lint`                                             | ESLint em todos os `.js`.                                                      |
| `npm run format:check`                                     | Prettier (largura 160, aspas simples) em `.js`, `.ts`, `.css`, `.md`, `.json`. |
| `npm test`                                                 | Testes unitários (Vitest, sem rede).                                           |
| `npm run test:integration`                                 | supabase-js contra o Supabase local (precisa de `supabase start`).             |
| `psql "$DB" -v ON_ERROR_STOP=1 -f tests/sql/<arquivo>.sql` | Cenários SQL como usuários simulados, dentro de transação desfeita no fim.     |

- A CI (`.github/workflows/ci.yml`) roda `lint`, `format:check`, `test` e `build`.
- Supabase local deste projeto: API em `http://127.0.0.1:55321`, banco em `postgresql://postgres:postgres@127.0.0.1:55322/postgres`, contêiner `supabase_db_dash`. Outro projeto (`langlead`) usa as portas 5432x na mesma máquina e não pode ser parado nem reiniciado.
- Cenário SQL (modelo: `tests/sql/task_keys_activity_history.sql`): `begin; do $test$ … $test$; rollback;`. Simula um usuário com `set_config('request.jwt.claims', …, true)` e `set local role authenticated`, junta falhas num vetor e termina com `NOTICE: PASS` ou com erro.

## 7. Onde a aba "Redes sociais" se afasta do padrão, e por quê

A regra desta entrega é não alterar arquivo existente além do necessário para registrar a aba (navegação e i18n). Por isso:

- **Dados fora do motor de sincronização.** A aba lê e grava direto com `sb.from('social_…')`, num módulo próprio, em vez de entrar em `src/data/mappers.js` e `src/data/sync.js`.
- **CSS importado pelo módulo da página**, não por `src/styles/index.css`.
- **Diálogos desenhados pela própria página**, com as mesmas classes de modal, em vez de novos `case` em `src/overlays/modals.js`. Confirmações continuam usando `confirmDlg`.
- **Documentação em `docs/social/`**, sem tocar em `README.md` nem em `docs/*.md`.

Arquivos existentes alterados: `src/shell/render.js`, `src/shell/layout.js`, `src/main.js` e `src/i18n/pt-BR/index.js`.
