# Instalação e configuração

Este guia leva do zero até o app publicado na Vercel, usando um projeto Supabase de produção. Não pressupõe conhecimento do código. Visão geral da arquitetura: [ARCHITECTURE.md](ARCHITECTURE.md). Schema do banco: [DATABASE.md](DATABASE.md).

Sumário:

1. [Pré-requisitos](#1-pré-requisitos)
2. [Desenvolvimento local](#2-desenvolvimento-local)
3. [Produção: Supabase](#3-produção-supabase)
4. [Produção: Vercel](#4-produção-vercel)
5. [Cabeçalhos de segurança e CSP](#5-cabeçalhos-de-segurança-e-csp)
6. [O que depende de você](#6-o-que-depende-de-você)
7. [Solução de problemas](#7-solução-de-problemas)

## 1. Pré-requisitos

| O quê                 | Para quê                                                 | Como obter                                                                                                                                                                       |
| --------------------- | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Node.js 22            | Rodar o app e as ferramentas. A versão está em `.nvmrc`. | Com [nvm](https://github.com/nvm-sh/nvm): `nvm install` e depois `nvm use` na pasta do projeto. O `package.json` aceita Node 18 ou mais novo, mas o CI usa a versão do `.nvmrc`. |
| Docker                | O Supabase local roda em contêineres.                    | Docker Desktop ou outro runtime compatível, ligado antes de `supabase start`.                                                                                                    |
| Supabase CLI          | Subir o Supabase local e enviar as migrations.           | macOS e Linux: `brew install supabase/tap/supabase`. Outras opções: [documentação do CLI](https://supabase.com/docs/guides/local-development/cli/getting-started).               |
| Conta Supabase        | Projeto de produção.                                     | [supabase.com](https://supabase.com)                                                                                                                                             |
| Conta Vercel          | Publicar o site.                                         | [vercel.com](https://vercel.com), ligada à sua conta do GitHub.                                                                                                                  |
| Vercel CLI (opcional) | Configurar variáveis e publicar pelo terminal.           | `npm install -g vercel`. Tudo que o CLI faz aqui também dá para fazer pelo painel.                                                                                               |

Conferir:

```bash
node -v          # v22.x
docker --version
supabase --version
```

Instale as dependências do projeto uma vez:

```bash
npm ci
```

## 2. Desenvolvimento local

O app não tem servidor próprio: o navegador fala direto com o Supabase. No desenvolvimento, o Supabase roda na sua máquina, com o mesmo schema de produção.

### 2.1. Subir o Supabase local

```bash
supabase start
```

Na primeira vez baixa as imagens Docker (demora). Ao terminar, mostra as URLs e chaves. Para ver de novo a qualquer momento: `supabase status`.

As portas deste projeto estão em `supabase/config.toml` e **não são as padrão do Supabase** (54321 a 54329). Foram deslocadas para a faixa 553xx para que este projeto rode ao mesmo tempo que outro projeto Supabase local, que normalmente ocupa as portas padrão.

| Serviço                              | Porta | Endereço                                                  |
| ------------------------------------ | ----- | --------------------------------------------------------- |
| API (REST, Auth, Storage, Realtime)  | 55321 | `http://127.0.0.1:55321`                                  |
| Banco Postgres                       | 55322 | `postgresql://postgres:postgres@127.0.0.1:55322/postgres` |
| Studio (painel local)                | 55323 | `http://127.0.0.1:55323`                                  |
| Mailpit (e-mails de teste)           | 55324 | `http://127.0.0.1:55324`                                  |
| Banco "sombra" (usado por `db diff`) | 55320 | interno                                                   |

Outras portas configuradas: analytics 55327, pooler 55329 (desligado) e inspetor das Edge Functions 8084.

A configuração local já reflete a de produção onde importa: confirmação de e-mail ligada, senha mínima de 10 caracteres, cadastro aberto, `site_url` `http://localhost:5173` e redirecionamentos permitidos para `localhost` e `127.0.0.1` nas portas 5173 (dev) e 4173 (`npm run preview`).

### 2.2. Variáveis de ambiente (`.env.local`)

O front-end lê três variáveis, todas com prefixo `VITE_`:

| Variável                        | Obrigatória | Valor local                                                   |
| ------------------------------- | ----------- | ------------------------------------------------------------- |
| `VITE_SUPABASE_URL`             | sim         | `API_URL` de `supabase status`                                |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | sim         | `PUBLISHABLE_KEY` de `supabase status` (`sb_publishable_...`) |
| `VITE_AUTH_PROVIDERS`           | não         | deixe vazio (só e-mail e senha)                               |

Crie o arquivo a partir do modelo e preencha os dois primeiros valores:

```bash
cp .env.example .env.local
```

Ou gere os dois valores direto do Supabase local (sobrescreve o arquivo):

```bash
supabase status -o env | sed -n 's/^API_URL=/VITE_SUPABASE_URL=/p;s/^PUBLISHABLE_KEY=/VITE_SUPABASE_PUBLISHABLE_KEY=/p' > .env.local
```

`.env.local` não vai para o Git (`.gitignore` ignora `.env*`, exceto `.env.example`). O Vite lê o arquivo só ao iniciar: depois de mudar, reinicie o `npm run dev`.

### 2.3. Rodar o app

```bash
npm run dev
```

Abra `http://localhost:5173`. Crie uma conta pela tela de cadastro.

### 2.4. Onde ver os e-mails de confirmação

Com a confirmação de e-mail ligada, o cadastro envia um e-mail com um link. Localmente nenhum e-mail sai da sua máquina: todos ficam no Mailpit, em `http://127.0.0.1:55324`. Abra a mensagem e clique no link; ele leva de volta a `http://localhost:5173`. O mesmo vale para recuperação de senha.

### 2.5. Zerar o banco local

Reaplica todas as migrations em um banco novo. **Apaga todos os dados locais** (contas, workspaces, arquivos):

```bash
supabase db reset
```

Para parar o Supabase local: `supabase stop` (mantém os dados) ou `supabase stop --no-backup` (descarta os dados).

### 2.6. Testes e verificações

```bash
npm run lint           # ESLint
npm run format:check   # Prettier (sem alterar arquivos)
npm test               # testes unitários (não precisam de rede nem de Supabase)
npm run test:integration   # RLS, triggers, RPCs e Storage contra o Supabase local
```

`npm run test:integration` precisa do Supabase local no ar (`supabase start`). Ele lê as chaves de `supabase status`, cria e apaga usuários e workspaces de teste, e se recusa a rodar contra qualquer endereço que não seja local. Se a API local não responder, os testes são ignorados com um aviso. Ele **não** roda no CI, porque depende de Docker e do stack local.

## 3. Produção: Supabase

### 3.1. Criar o projeto

No [painel do Supabase](https://supabase.com/dashboard), crie uma organização (se ainda não tiver) e um projeto novo. Anote:

- **Senha do banco** definida na criação (você vai precisar dela no passo 3.2; guarde em um gerenciador de senhas).
- **Project ref**: o identificador que aparece na URL do painel, `https://supabase.com/dashboard/project/<project-ref>`.

Se você quiser separar produção de testes, crie dois projetos (por exemplo, um para Production e outro para os previews da Vercel) e repita os passos 3.2 a 3.6 em cada um. Veja a decisão em [seção 6](#6-o-que-depende-de-você).

### 3.2. Ligar o repositório ao projeto e aplicar as migrations

Na raiz do repositório:

```bash
supabase login                              # abre o navegador para autorizar o CLI
supabase link --project-ref <project-ref>   # pede a senha do banco
supabase db push --dry-run                  # lista o que será aplicado, sem aplicar
supabase db push                            # aplica as migrations de supabase/migrations
```

`link` não altera o projeto remoto, só grava a ligação localmente (em `supabase/.temp`, ignorado pelo Git). O `db push` aplica `20261111044354_init_schema.sql`: tabelas, RLS, funções, triggers, o bucket `files`, as políticas de Storage e a publicação do Realtime. Num projeto novo e vazio não há nada a puxar antes. Confirme que ficou tudo em dia:

```bash
supabase migration list    # a coluna Remote deve mostrar a migration aplicada
```

`db push` **não** executa dados de exemplo; este projeto não tem `seed.sql` e o seed está desativado em `supabase/config.toml`.

### 3.3. Conferir que a migration criou o bucket `files`

No painel, abra o **SQL Editor** e rode:

```sql
select id, public, file_size_limit from storage.buckets;
```

O resultado esperado é uma linha: `files`, `public = false`, `file_size_limit = 52428800` (50 MiB). O bucket também aparece na página de Storage do painel. Ainda no SQL Editor, confirme as políticas do bucket:

```sql
select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname like 'dash_files_%';
```

Devem aparecer quatro: `dash_files_select`, `dash_files_insert`, `dash_files_update` e `dash_files_delete`.

Duas conferências adicionais:

- **Limite de upload.** O limite por bucket (50 MiB) não pode ultrapassar o limite global de upload do projeto. No plano gratuito o limite global é de 50 MB e não pode ser aumentado; em planos pagos ele é configurável na página de configurações de Storage do painel. Fonte: [Storage file limits](https://supabase.com/docs/guides/storage/uploads/file-limits).
- **Schema `private` não exposto.** Nas configurações da Data API do projeto, a lista de schemas expostos deve ter só `public` (e `graphql_public`). Se o schema `private` aparecer ali, tire-o: ele guarda funções com privilégio elevado.

### 3.4. Authentication: URL Configuration

Esta é a configuração que mais causa problemas se for esquecida. Na área de **Authentication** do painel, abra a página **URL Configuration** e preencha:

- **Site URL**: o endereço de produção do app, por exemplo `https://SEU-DOMINIO` (sem `localhost`). É o destino padrão dos links dos e-mails quando nenhum outro é informado. Se você ainda não tem domínio próprio, use o endereço de produção que a Vercel gerar no passo 4 (formato `https://<projeto>-<escopo>.vercel.app`) e volte aqui depois de publicar.
- **Redirect URLs**: uma lista de permissões. Todo endereço para onde um link de e-mail ou de login social pode levar o usuário precisa casar com uma entrada. O app envia o endereço da página em que o usuário está (`origem + caminho`), então a lista precisa incluir cada origem em que o app roda.

Entradas sugeridas:

```
https://SEU-DOMINIO/**
https://*-<SLUG-DA-SUA-CONTA-VERCEL>.vercel.app/**
```

A primeira cobre produção. A segunda cobre os endereços de preview e de branch da Vercel, que têm o formato `<projeto>-<hash>-<escopo>.vercel.app` e `<projeto>-git-<branch>-<escopo>.vercel.app` ([URLs geradas pela Vercel](https://vercel.com/docs/deployments/generated-urls)); `<escopo>` é o _slug_ da sua conta ou time na Vercel. Para testar localmente contra produção, acrescente `http://localhost:5173/**`, mas não é recomendado.

Formato dos curingas, conforme a [documentação do Supabase](https://supabase.com/docs/guides/auth/redirect-urls):

| Padrão | Casa com                                                                               |
| ------ | -------------------------------------------------------------------------------------- |
| `*`    | qualquer sequência de caracteres que não sejam separadores (`.` e `/` são separadores) |
| `**`   | qualquer sequência de caracteres                                                       |
| `?`    | um único caractere que não seja separador                                              |

Por isso o `*` de `*-<slug>.vercel.app` casa com `meuapp-abc123-<slug>` (os hifens não são separadores) mas não atravessa pontos, e o `**` no fim do caminho casa com qualquer caminho. A documentação recomenda o caminho exato em produção sempre que possível. O padrão `https://*-<slug>.vercel.app/**` casa com **todos** os projetos Vercel da sua conta, não só este; se isso incomodar, use o endereço exato de cada preview que precise testar.

### 3.5. Authentication: regras de cadastro e senha

Na área de **Authentication** do painel (configurações gerais e provedores; os nomes exatos dos menus mudam, então siga as páginas de documentação citadas):

- **Cadastro de novos usuários**: deixe **ligado** ("Allow new users to sign up"). Se for desligado, só quem já tem conta consegue entrar, e convidar alguém para um workspace deixa de funcionar, porque o convidado precisa criar a conta. Fonte: [configuração geral de Auth](https://supabase.com/docs/guides/auth/general-configuration).
- **Confirmação de e-mail** ("Confirm email", no provedor Email): deixe **ligada**. O app foi feito para isso: depois do cadastro mostra "Verify your email" e só abre o workspace quando o e-mail é confirmado. Vincular convites a uma conta também exige e-mail confirmado.
- **Política de senha**: defina o **comprimento mínimo em 10 caracteres**, igual ao app (o formulário exige 10 ou mais caracteres e ao menos um número ou símbolo). Os requisitos de caracteres do Supabase são opcionais; se você exigir algo além de "número ou símbolo" no servidor (por exemplo letras maiúsculas e minúsculas), o app aceitará a senha no formulário e o servidor vai recusá-la com uma mensagem genérica de senha fraca. Recomendação: mínimo de 10 e nenhum requisito extra de caracteres. A proteção contra senhas vazadas ("leaked password protection") só existe no plano Pro ou superior. Fonte: [segurança de senha](https://supabase.com/docs/guides/auth/password-security).

### 3.6. SMTP próprio (obrigatório para produção)

O serviço de e-mail embutido do Supabase **não serve para produção**. Segundo a [documentação](https://supabase.com/docs/guides/auth/auth-smtp):

- só entrega para endereços que fazem parte do time do projeto; para qualquer outro endereço a entrega é recusada com o erro "Email address not authorized";
- é limitado a **2 mensagens por hora**, valor que "pode mudar sem aviso";
- é oferecido "apenas no melhor esforço", sem garantia de entrega nem de disponibilidade;
- "não se destina a uso em produção", apenas a exploração e testes com membros do time.

Na prática, sem SMTP próprio, os usuários reais não recebem o e-mail de confirmação e o cadastro trava na tela "Verify your email".

Configure um provedor SMTP (a documentação lista Resend, AWS SES, Postmark, Twilio SendGrid, ZeptoMail e Brevo) na página de SMTP das configurações de Authentication do painel (rota `/auth/smtp` do projeto). Você informa servidor, porta, usuário, senha, e-mail e nome do remetente. A documentação também recomenda: usar um domínio próprio, configurar SPF, DKIM e DMARC, separar e-mails de autenticação dos de marketing e ter um serviço SMTP reserva.

Depois de ligar o SMTP próprio, o Supabase aplica por padrão um limite baixo de **30 mensagens por hora**, para proteger o serviço novo. Ele pode ser ajustado na página de limites de taxa (Rate Limits) de Authentication.

### 3.7. Onde pegar a URL do projeto e a publishable key

- **URL do projeto**: `https://<project-ref>.supabase.co`. Aparece no diálogo **Connect** do projeto.
- **Publishable key** (`sb_publishable_...`): aparece no mesmo diálogo **Connect** e na lista de **API Keys** das configurações do projeto.

A publishable key é pública por natureza: "segura para expor" em páginas web e código-fonte, porque a proteção dos dados vem do RLS ([documentação das chaves](https://supabase.com/docs/guides/api/api-keys)). A **secret key** (`sb_secret_...`, ou a `service_role` legada) ignora o RLS e **nunca** pode ir para o navegador, para o Git, nem para qualquer variável `VITE_`. Este app não usa nenhuma das duas. A antiga `anon key` ainda funciona e o app também a aceita em `VITE_SUPABASE_PUBLISHABLE_KEY`, mas use a publishable key.

### 3.8. Provedores OAuth (opcional)

Por padrão o app só oferece e-mail e senha. Para mostrar "Continuar com Google/Microsoft/Apple":

1. Ative o provedor em Authentication → Providers do painel e preencha as credenciais dele. A página do provedor mostra a **Callback URL** que você deve cadastrar no console do Google/Azure/Apple. Passo a passo por provedor: [documentação de login social](https://supabase.com/docs/guides/auth/social-login). Cada provedor exige uma conta de desenvolvedor própria (veja [seção 6](#6-o-que-depende-de-você)).
2. Confira que os endereços do app estão em Redirect URLs (passo 3.4).
3. Defina `VITE_AUTH_PROVIDERS` com os provedores desejados, separados por vírgula. Valores aceitos pelo app: `google`, `azure` (botão "Microsoft") e `apple`. Exemplo: `google,azure`. Vazio = só e-mail e senha.

Ligar a variável sem ativar o provedor no Supabase faz o botão aparecer e falhar ao clicar. `VITE_AUTH_PROVIDERS` é lida no build: mudar o valor exige novo deploy.

### 3.9. Conferir as configurações de Auth

O Supabase publica as configurações de Auth em um endereço público. Substitua pelos seus valores:

```bash
curl -s "https://<project-ref>.supabase.co/auth/v1/settings" -H "apikey: <PUBLISHABLE_KEY>"
```

Confira no JSON: `"disable_signup": false` (cadastro aberto) e `"mailer_autoconfirm": false` (confirmação de e-mail exigida). Rodado contra o Supabase local, o comando devolve esses mesmos valores.

## 4. Produção: Vercel

O app é um site estático: a Vercel roda `npm run build` e serve a pasta `dist/`. Isso já está em `vercel.json` (`framework: vite`). O roteamento do app usa o _hash_ da URL (`#inbox`), então não são necessárias regras de reescrita.

### 4.1. Criar e ligar o projeto

> **Situação em 11/11/2026: este passo já foi feito.** O projeto `dash` existe na conta Vercel `deltaitecnologia-gmailcom's projects`, está conectado ao repositório `joaodeltai/dash` (branch de produção `main`; as demais geram preview) e a pasta local já está ligada a ele (`.vercel/`, fora do Git). O endereço de produção é `https://dash-liart-ten.vercel.app`. O projeto Supabase de produção também já existe, com a migration inicial aplicada (passo 3.2), e as variáveis do passo 4.2 estão definidas na Vercel em Production e Preview. O que continua manual, no painel do Supabase: Site URL e Redirect URLs (3.4), regras de cadastro e senha (3.5) e um SMTP próprio (3.6). O texto abaixo fica como referência para recriar o projeto do zero.

Pelo painel: em [vercel.com/new](https://vercel.com/new), importe o repositório `joaodeltai/dash` do GitHub. A Vercel detecta Vite e usa as configurações de `vercel.json`. Em Git nas configurações do projeto, a **Production Branch** deve ser `main`; qualquer outra branch gera preview ([documentação](https://vercel.com/docs/git#production-branch)).

Pelo terminal, alternativa:

```bash
vercel login
vercel link     # liga esta pasta a um projeto Vercel (existente ou novo)
```

**Importante:** configure as variáveis (passo 4.2) antes do primeiro deploy, ou faça um novo deploy depois. Sem elas o build sai sem credenciais e o app mostra a tela "Connect a database".

### 4.2. Variáveis de ambiente

| Variável                        | Production | Preview  | Valor                                                            |
| ------------------------------- | ---------- | -------- | ---------------------------------------------------------------- |
| `VITE_SUPABASE_URL`             | sim        | sim      | `https://<project-ref>.supabase.co`                              |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | sim        | sim      | `sb_publishable_...` do projeto correspondente                   |
| `VITE_AUTH_PROVIDERS`           | opcional   | opcional | ex.: `google,azure`; omita ou deixe vazia para só e-mail e senha |

**As três são públicas, e isso é de propósito.** O Vite copia para dentro do JavaScript publicado toda variável com prefixo `VITE_` no momento do build; qualquer visitante consegue lê-las no código do site. Por isso:

- só coloque em `VITE_*` o que pode ser público (URL e publishable key; a segurança dos dados está no RLS do banco);
- **nunca** crie uma variável `VITE_` com a secret key, a `service_role`, a senha do banco ou qualquer token;
- como o valor é gravado no build, mudar uma variável na Vercel **não afeta deploys já feitos**: é preciso fazer um novo deploy ([documentação](https://vercel.com/docs/environment-variables)).

Na Vercel cada variável tem um tipo: _Config_ (legível depois de salva) ou _Secret_ (só escrita). Como estas três são públicas, use **Config**.

**Pelo painel**: no projeto, **Settings → Environment Variables**; para cada variável escolha os ambientes (Production e/ou Preview).

**Pelo CLI** (versão recente do Vercel CLI; atualize com `npm install -g vercel@latest`). O CLI pede o valor no terminal:

```bash
vercel env add VITE_SUPABASE_URL --environment production --no-sensitive
vercel env add VITE_SUPABASE_PUBLISHABLE_KEY --environment production --no-sensitive
vercel env add VITE_SUPABASE_URL --environment preview --no-sensitive
vercel env add VITE_SUPABASE_PUBLISHABLE_KEY --environment preview --no-sensitive
vercel env list
```

Em versões mais antigas do CLI o ambiente é argumento posicional (`vercel env add NOME production`); `vercel env add --help` mostra o formato da sua versão. Referência: [`vercel env`](https://vercel.com/docs/cli/env).

**Preview e produção no mesmo projeto Supabase?** Se Preview e Production usarem o mesmo projeto Supabase, quem testar um preview grava no banco de produção. O mais seguro é um segundo projeto Supabase para Preview (com as migrations aplicadas, passos 3.2 a 3.6) e as variáveis de Preview apontando para ele. A decisão é sua.

### 4.3. Deploy

- **Preview**: automático em todo push de uma branch que não seja a de produção e em pull requests; cada um recebe um endereço próprio. Pelo CLI: `vercel`.
- **Produção**: automático em todo push na `main`. Pelo CLI: `vercel --prod`.

Os previews podem estar protegidos por login da Vercel (a "Deployment Protection" do projeto; ver [documentação](https://vercel.com/docs/deployment-protection)); se o preview pedir login da Vercel, é isso.

Depois do primeiro deploy de produção, copie o endereço final e **volte ao passo 3.4** para conferir Site URL e Redirect URLs. Se for usar domínio próprio, adicione-o à Vercel e troque o Site URL e a Redirect URL de produção.

### 4.4. Validar depois de publicar

Faça com uma conta de teste, no endereço de produção:

1. A tela de **login** abre (não a tela "Connect a database").
2. **Cadastro**: crie uma conta. O app mostra "Verify your email".
3. **Confirmação**: o e-mail chega (confira o spam) e o link abre o app no **endereço de produção** (não em `localhost`, não com erro de redirecionamento).
4. **Onboarding**: informe o nome do workspace e conclua; o workspace abre.
5. **Criar tarefa**: crie um projeto e uma tarefa.
6. **Recarregar** a página (F5): a sessão continua e a tarefa está lá.
7. **Upload de arquivo**: envie um arquivo em um projeto (a aba Files). Uma imagem deve mostrar a miniatura; "Download" deve baixar o arquivo.
8. **Cabeçalhos**: `curl -sI https://SEU-DOMINIO | grep -i -E 'content-security-policy|x-frame-options'` mostra os dois. No console do navegador não deve haver violações de CSP.
9. Opcional: confira as configurações de Auth com o `curl` do passo 3.9.

## 5. Cabeçalhos de segurança e CSP

`vercel.json` envia estes cabeçalhos em todas as respostas:

| Cabeçalho                        | Valor                                                                              | Para quê                                                                                          |
| -------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `Content-Security-Policy`        | ver abaixo                                                                         | Limita de onde a página carrega scripts, estilos, fontes, imagens e conexões.                     |
| `X-Content-Type-Options`         | `nosniff`                                                                          | O navegador respeita o tipo declarado dos arquivos.                                               |
| `X-Frame-Options`                | `DENY`                                                                             | Impede que o app seja exibido dentro de um `iframe` de outro site (reforço de `frame-ancestors`). |
| `Referrer-Policy`                | `strict-origin-when-cross-origin`                                                  | Não vaza caminhos para outros sites.                                                              |
| `Permissions-Policy`             | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()` | O app não usa esses recursos; ficam desligados.                                                   |
| `Cache-Control` (só `/assets/*`) | `public, max-age=31536000, immutable`                                              | Os arquivos em `/assets` têm hash no nome e nunca mudam; podem ficar em cache por um ano.         |

A CSP:

| Diretiva          | Valor                                                 | Motivo                                                                                                                                                                      |
| ----------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `default-src`     | `'self'`                                              | Padrão: só o próprio site.                                                                                                                                                  |
| `script-src`      | `'self'`                                              | O app só carrega o próprio JavaScript; não há script inline.                                                                                                                |
| `style-src`       | `'self' 'unsafe-inline' https://fonts.googleapis.com` | O HTML gerado pelo app usa atributos `style` em toda parte, o que exige `'unsafe-inline'` em estilos (scripts continuam bloqueados). A folha de fontes vem do Google Fonts. |
| `font-src`        | `'self' https://fonts.gstatic.com`                    | Arquivos das fontes Geist e Geist Mono (Google Fonts, conforme `index.html`).                                                                                               |
| `img-src`         | `'self' data: blob: https://*.supabase.co`            | Miniaturas de arquivos (URLs assinadas do Storage do Supabase) e imagens `data:`/`blob:`.                                                                                   |
| `connect-src`     | `'self' https://*.supabase.co wss://*.supabase.co`    | API, Auth, Storage (HTTPS) e Realtime (WebSocket) do Supabase.                                                                                                              |
| `object-src`      | `'none'`                                              | Sem plugins.                                                                                                                                                                |
| `base-uri`        | `'self'`                                              | Impede trocar a base de URLs relativas.                                                                                                                                     |
| `form-action`     | `'self'`                                              | Formulários só enviam para o próprio site.                                                                                                                                  |
| `frame-ancestors` | `'none'`                                              | Ninguém pode embutir o app em um `iframe`.                                                                                                                                  |

Abrir ou baixar um arquivo usa uma URL assinada em outra aba ou em um link de download; isso é navegação e não passa pela CSP. Se um dia o app passar a exibir PDFs ou vídeos dentro da página (`iframe`, `<video>`), será preciso acrescentar `frame-src` e `media-src` para `https://*.supabase.co`.

**Domínio próprio no Supabase.** Se o projeto Supabase usar um domínio personalizado (por exemplo `api.seudominio.com` em vez de `<ref>.supabase.co`), a CSP **precisa incluir esse domínio** em `connect-src` (HTTPS e `wss://`) e em `img-src`; sem isso o navegador bloqueia todas as chamadas e o app fica sem dados. Edite o valor de `Content-Security-Policy` em `vercel.json`, por exemplo:

```
connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.seudominio.com wss://api.seudominio.com
img-src 'self' data: blob: https://*.supabase.co https://api.seudominio.com
```

O mesmo vale se uma nova fonte, CDN ou serviço externo for adicionado ao app.

A CSP foi testada contra um build de produção servido com estes mesmos cabeçalhos: login, abertura do workspace e Realtime funcionaram sem nenhuma violação no console.

## 6. O que depende de você

Credenciais e decisões que só o dono do projeto pode fornecer. Nada disso deve ser escrito no repositório.

| Item                               | O que é                                                                                                                                                                   | Onde entra                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Conta e organização no Supabase    | Criar o projeto de produção (região, nome) e escolher o plano.                                                                                                            | Passo 3.1                                                            |
| Senha do banco                     | Definida na criação do projeto. Guardar em um gerenciador de senhas.                                                                                                      | `supabase link` (3.2)                                                |
| Autorização do CLI                 | `supabase login` abre o navegador para você autorizar.                                                                                                                    | Passo 3.2                                                            |
| Project ref, URL e publishable key | Copiados do painel do Supabase.                                                                                                                                           | Variáveis da Vercel (4.2)                                            |
| Um ou dois projetos Supabase       | Decisão: Preview e Production compartilham o banco ou cada um tem o seu.                                                                                                  | 3.1 e 4.2                                                            |
| Domínio de produção                | Endereço final do app (`*.vercel.app` ou domínio próprio, que exige configurar DNS).                                                                                      | Site URL e Redirect URLs (3.4); CSP se o domínio for do Supabase (5) |
| Cadastro aberto ou fechado         | Decisão. Fechado impede também o cadastro de convidados.                                                                                                                  | 3.5                                                                  |
| Provedor SMTP                      | Conta, domínio de envio, registros DNS (SPF, DKIM, DMARC), servidor, usuário, senha, remetente.                                                                           | 3.6                                                                  |
| Credenciais OAuth (opcional)       | Client ID e Secret de Google, Microsoft (Azure) e/ou Apple; cada um exige conta de desenvolvedor própria.                                                                 | 3.8                                                                  |
| Conta Vercel e acesso ao GitHub    | Importar o repositório `joaodeltai/dash`.                                                                                                                                 | 4.1                                                                  |
| Slug da conta Vercel               | Para o padrão de Redirect URL dos previews.                                                                                                                               | 3.4                                                                  |
| Licença                            | O projeto original não tem licença. Antes de uso comercial ou redistribuição, acompanhe as issues citadas no [README](../README.md#licença) ou peça autorização ao autor. | Fora do código                                                       |

## 7. Solução de problemas

### Tela "Connect a database"

O app foi construído sem `VITE_SUPABASE_URL` e/ou `VITE_SUPABASE_PUBLISHABLE_KEY`.

- **Local**: confira o `.env.local` (nome exato, valores preenchidos, sem espaços) e **reinicie** o `npm run dev`: o Vite só lê o arquivo ao iniciar.
- **Vercel**: as variáveis precisam existir no ambiente do deploy (Production para a `main`, Preview para as outras branches). Variáveis novas só valem para **novos** deploys: faça um redeploy. Confira com `vercel env list`.

### O e-mail de confirmação não chega

- **Local**: não sai e-mail nenhum; abra o Mailpit em `http://127.0.0.1:55324`.
- **Produção, serviço embutido**: só entrega para endereços do time do projeto e no máximo 2 por hora. Configure SMTP próprio (passo 3.6).
- **Produção, SMTP próprio**: confira usuário, senha, porta e remetente; veja o spam; o provedor pode exigir domínio de envio verificado (SPF, DKIM). O limite padrão após ligar SMTP próprio é de 30 mensagens por hora. Os logs de Auth do painel mostram o erro do envio.
- O app mostra "Too many attempts" quando o Supabase recusa por limite de taxa. Espere alguns minutos.
- A tela "Verify your email" tem o botão de reenviar.

### O link de confirmação abre e dá erro de redirecionamento

O endereço para onde o link leva não está na lista de permissões do Supabase.

- Confira Site URL e Redirect URLs (passo 3.4) e se incluem exatamente a origem em que o cadastro foi feito, inclusive o `https://` e o prefixo dos previews da Vercel. O `redirectTo` enviado pelo app precisa casar com uma entrada da lista ([documentação](https://supabase.com/docs/guides/auth/redirect-urls)).
- Um Site URL ainda apontando para `localhost` faz os links de produção irem para `localhost`.
- O link expira; peça outro com o botão de reenviar. Um link que já foi aberto também deixa de valer. O app mostra o motivo na tela de login quando o Supabase o informa.

### Erro de permissão ao salvar

O app mostra "Couldn't save your last change. You don't have permission to do that." e recarrega o workspace, descartando a edição. Isso vem do banco (RLS), não do app.

- Pelo papel e pelo nível no projeto: um `guest` não cria tarefas; "Can view" não edita; "Can comment" só comenta. Veja as matrizes em [DATABASE.md](DATABASE.md#política-de-acesso-rls).
- Projeto privado do qual você não participa: ele fica invisível para você, mesmo sendo `admin`. Só o `owner` do workspace enxerga todos os projetos.
- Conta desativada no workspace (`status = deactivated`).
- Sessão expirada: o app avisa e pede novo login.
- Migrations não aplicadas no projeto: o erro aparece como tabela ou função inexistente. Rode `supabase db push` (passo 3.2).
- Para investigar: o console do navegador registra `[sync] change rejected` com tabela, operação e código do erro (`42501` = permissão negada).

### Tudo bloqueado no console depois de publicar (erros de CSP)

O console mostra "violates the following Content Security Policy directive". Confira se o projeto Supabase usa um domínio próprio (seção 5) ou se foi adicionado um recurso externo novo.

### Upload recusado

O limite é 50 MiB por arquivo, e o limite global de upload do projeto também precisa permitir isso (plano gratuito: 50 MB). Veja o passo 3.3.

### Problemas no Supabase local

- `supabase start` falha: confira se o Docker está ligado e se as portas 55320 a 55329 estão livres (`supabase/config.toml`).
- Estado estranho do banco local: `supabase db reset` (apaga os dados locais).
- `npm run test:integration` ignorado: o Supabase local não está respondendo em `http://127.0.0.1:55321`.
