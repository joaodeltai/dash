# Dash

Um espaço de trabalho calmo e estruturado para gerenciar projetos: página inicial, caixa de entrada, minhas tarefas, projetos com views de quadro, lista, tabela, calendário, linha do tempo e arquivos, membros, times, atividade e configurações.

Dash é um fork do [Gr8r Studio](https://github.com/gr8rstudio/gr8r-studio) (front-end em JavaScript puro com [Vite](https://vite.dev)), transformado em uma aplicação real: contas de usuário, dados persistidos e compartilhados entre pessoas, usando o [Supabase](https://supabase.com) como backend. O site é estático e é publicado na [Vercel](https://vercel.com); não há servidor próprio.

![Página inicial do app](docs/preview.png)

## Licença

O repositório original (gr8rstudio/gr8r-studio) **não tem arquivo de licença**. Há issues abertas pedindo uma, ainda sem resposta do autor: [#2](https://github.com/gr8rstudio/gr8r-studio/issues/2), [#7](https://github.com/gr8rstudio/gr8r-studio/issues/7) e [#11](https://github.com/gr8rstudio/gr8r-studio/issues/11).

Sem licença, o padrão legal é "todos os direitos reservados". O fork no GitHub é permitido pelos termos de uso do GitHub, mas o reuso e a redistribuição do código não estão formalmente autorizados. Antes de qualquer uso comercial ou redistribuição, acompanhe essas issues ou peça autorização ao autor.

Este repositório não declara licença própria: nenhuma foi inventada. Este texto não é aconselhamento jurídico.

## Funcionalidades

- Cadastro e login com e-mail e senha, confirmação de e-mail e recuperação de senha. Login com Google, Microsoft e Apple é opcional.
- Vários workspaces por conta, com papéis (`owner`, `admin`, `member`, `guest`) e convites pelo endereço de e-mail: a pessoa entra no workspace ao criar conta com aquele endereço (o app não envia mensagem de convite).
- Projetos (abertos ou privados, com permissão por pessoa), tarefas, subtarefas, dependências, comentários com menções e reações.
- Views de projeto: quadro, lista, tabela, calendário, linha do tempo, arquivos e visão geral.
- Envio de arquivos para o Storage do Supabase, anexos de tarefa, notificações, atividade, favoritos e visões salvas.
- Atualização em tempo real entre pessoas e dispositivos, indicador de conexão e envio automático das alterações pendentes.

## Stack

- JavaScript puro (módulos ES) e CSS, empacotados pelo Vite. Sem framework de UI.
- Supabase: Postgres com Row Level Security, Auth, Storage e Realtime. O navegador fala direto com o Supabase; toda a autorização está no banco.
- Vercel: hospedagem estática.
- ESLint, Prettier e Vitest (testes unitários e de integração).

## Início rápido (local)

Precisa de Node 22 (`.nvmrc`), Docker e o [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started).

```bash
npm ci
supabase start                       # Supabase local (portas 553xx, veja supabase/config.toml)
cp .env.example .env.local           # preencha com os valores de `supabase status`
npm run dev                          # http://localhost:5173
```

E-mails de confirmação ficam no Mailpit local: `http://127.0.0.1:55324`. O passo a passo completo, inclusive o deploy em produção, está em [docs/SETUP.md](docs/SETUP.md).

## Scripts

| Comando                    | O que faz                                                                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------------- |
| `npm run dev`              | Servidor de desenvolvimento em `http://localhost:5173`, com hot reload.                              |
| `npm run build`            | Build de produção em `dist/`.                                                                        |
| `npm run preview`          | Serve o build de produção localmente.                                                                |
| `npm test`                 | Testes unitários (sem rede e sem Supabase).                                                          |
| `npm run test:integration` | Testes de integração contra o Supabase local (RLS, triggers, RPCs, Storage). Exige `supabase start`. |
| `npm run lint`             | ESLint.                                                                                              |
| `npm run format`           | Prettier, reescrevendo os arquivos.                                                                  |
| `npm run format:check`     | Prettier, só conferindo (usado no CI).                                                               |

## Estrutura de pastas

```
index.html              entrada HTML; carrega src/main.js
public/favicon.svg      marca
vite.config.js          configuração do Vite, com o plugin que embute só os ícones Lucide usados
vitest.config.js        projetos de teste: unit e integration
eslint.config.js        regras de lint (ESLint flat config); formatação pelo Prettier (.prettierrc.json)
vercel.json             build, saída e cabeçalhos de segurança (CSP) da Vercel
.env.example            modelo das variáveis de ambiente (VITE_*)
.github/workflows/      CI: lint, formatação, testes unitários e build
supabase/               config.toml do Supabase local e migrations/ (schema, RLS, Storage, Realtime)
docs/                   ARCHITECTURE.md, SETUP.md, DATABASE.md e preview.png
tests/
  unit/                 lógica pura: mapeadores e motor de sincronização
  integration/          Supabase local: RLS, triggers, RPCs e Storage
src/
  main.js               entrada: importa estilos e módulos e inicia o app (boot)
  styles/
    index.css           importa todas as folhas de estilo na ordem da cascata
    tokens.css          cores, espaçamento, tipografia, raio, o --gutter compartilhado
    base.css  components.css  shell.css  panels.css  overlays.css  states.css  motion.css  responsive.css
    views/              lista, quadro, tabela, calendário, linha do tempo, projetos e arquivos
    pages/              configurações, login e onboarding
  core/                 utilitários, constantes, ícones, store (estado e consultas), tema
  data/                 única camada que fala com o Supabase
    supabase.js           cliente Supabase (variáveis VITE_*)
    backend.js            sessão, carga do workspace, Realtime, Storage, autenticação
    mappers.js            estado em memória <-> linhas do banco (puro)
    sync.js               motor de sincronização por diferença
  ui/                   helpers de renderização, avisos, dropdown, URLs assinadas de arquivos
  shell/                loop de renderização e roteador, sidebar/topbar, skeletons, motor de views
  components/           renderizador da lista de tarefas
  pages/                um módulo por rota
  views/                views de projeto: quadro, tabela, calendário, linha do tempo, arquivos, visão geral
  overlays/             gaveta da tarefa, modais, popovers, menu de contexto, paleta de comandos
  features/             times, subtarefas, arquivo morto (renderização)
  actions/              ações do usuário, eventos, atalhos, arrastar e soltar
    session.js            ações que dependem do backend: login, cadastro, onboarding, workspaces, senha
```

### Camadas

As dependências apontam para baixo:

1. `core/` não depende do resto do app.
2. `data/` persiste o estado e é o **único** lugar que fala com o Supabase. Ele lê e grava o estado de `core/store.js`.
3. `ui/`, `shell/`, `components/`, `pages/`, `views/`, `overlays/` e `features/` renderizam HTML a partir do estado.
4. `actions/` mudam o estado e redesenham. Cada módulo de ação registra seus handlers na tabela compartilhada de ações (`A`) ao carregar, por isso o `main.js` os importa depois de `actions/actions.js`.

A visão geral de como estado e banco se conectam está em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Convenções

- **Persistência:** mutou o estado, chame `save()`. Nunca fale com o Supabase fora de `src/data`. O motor de sincronização compara o estado com a última versão gravada e envia só o que mudou.
- **Renderização:** cada página ou view é uma função que devolve uma string HTML a partir do store (`S`). `render()` reconstrói o shell e mantém foco e posições de rolagem.
- **Interações:** elementos declaram `data-a="nomeDaAcao"`. `actions/events.js` delega o clique para `A.nomeDaAcao`. Inputs usam `data-in`, e handlers de blur usam `data-blur`.
- **Layout:** toda borda de página usa `var(--gutter)`, então breadcrumb, cabeçalho, barra de ferramentas, lista, tabela e quadro começam na mesma linha.
- **Dropdowns:** escreva um `<select class="select">` normal. `ui/select.js` o desenha como o menu do design system e mantém o elemento nativo como fonte da verdade.
- **Ícones:** chame `ic('nome')` com qualquer nome de ícone do [Lucide](https://lucide.dev). O plugin `virtual:icons` embute só os ícones que o código usa.

## Fluxo de branches

O projeto usa gitflow:

- `main`: produção. Cada push publica na Vercel (Production).
- `develop`: integração. Recebe as features e é o que se leva a `main` para publicar.
- `feature/*`: uma branch por mudança, criada a partir de `develop` e devolvida por pull request. Cada branch e cada pull request gera um preview na Vercel.

O CI (`.github/workflows/ci.yml`) roda em push para `main` e `develop` e em pull requests: lint, checagem de formatação, testes unitários e build. Os testes de integração não rodam no CI, porque dependem de Docker e do Supabase local; rode-os na sua máquina com `npm run test:integration` antes de abrir pull requests que mexam no banco.

Repositório do fork: <https://github.com/joaodeltai/dash>.

## Documentação

- [docs/SETUP.md](docs/SETUP.md): instalação, desenvolvimento local, produção (Supabase e Vercel), cabeçalhos de segurança e solução de problemas.
- [docs/DATABASE.md](docs/DATABASE.md): tabelas, funções, triggers, políticas de acesso por papel, Storage, Realtime e como criar migrations.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): visão geral da arquitetura e do motor de sincronização.
