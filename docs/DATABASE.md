# Banco de dados

Este documento descreve o schema criado por `supabase/migrations/20261111044354_init_schema.sql` (a única migration até agora). Tudo aqui foi extraído da migration e conferido contra o banco local. Para a visão geral de como o app usa o banco, veja [ARCHITECTURE.md](ARCHITECTURE.md).

## Conceitos

- **Workspace**: a unidade de isolamento. Todo dado de trabalho pertence a um workspace.
- **Membro** (`members`): a identidade de uma pessoa _dentro_ de um workspace. Uma conta (`auth.users`) pode ter um membro em vários workspaces. Membro com `user_id` nulo é um convite pendente: a linha é vinculada à conta quando a pessoa entra com o mesmo e-mail já confirmado (`claim_invitations`).
- **Papel** (`members.role`): `owner`, `admin`, `member` ou `guest`. Vale para o workspace inteiro.
- **Status** (`members.status`): `active`, `invited` ou `deactivated`. Só membros `active` com conta vinculada têm acesso. Todas as funções de autorização exigem `status = 'active'`.
- **Permissão por projeto** (`project_members.permission`): refina o acesso a um projeto. Veja [Níveis de permissão por projeto](#níveis-de-permissão-por-projeto).

## Relações

```
auth.users 1──1 profiles
    │
    └─ (user_id, opcional) ─┐
                            │
workspaces 1──* members ────┘            members.team_id ──> teams (set null)
    │              │
    │              ├──1 member_state         (estado pessoal)
    │              ├──* task_favorites       (pessoal)
    │              ├──* project_favorites    (pessoal)
    │              └──* notifications        (recipient_id)
    │
    ├──* teams
    ├──* projects ──* project_members *──1 members   (permissão por projeto)
    │       │ lead_id ──> members, team_id ──> teams
    │       ├──* tasks ──* subtasks
    │       │      ├──* task_dependencies (task_id, depends_on_id: ambos em tasks)
    │       │      ├──* comments
    │       │      └──* files (task_id, opcional: anexo)
    │       ├──* files            (aba Files do projeto; conteúdo no Storage)
    │       ├──* events           (project_id opcional)
    │       └──* saved_views
    ├──* activity                 (actor_id ──> members; task_id/project_id opcionais)
    └──* events                   (também podem existir sem projeto)
```

Toda tabela de dados tem `workspace_id`. Nas tabelas filhas, um trigger sobrescreve o valor enviado pelo cliente com o `workspace_id` do pai, e outro confere que as referências a pessoas, times e tarefas são do mesmo workspace (veja [Triggers](#triggers)). A autoria (`created_by`, `uploaded_by`) é preenchida por trigger e não vem do cliente.

## Tabelas

Convenções: `id` é `uuid` (gerado no navegador pelo app; o banco tem `gen_random_uuid()` como padrão). Colunas `created_at`/`updated_at` são `timestamptz`. Quase todo texto tem `CHECK` de tamanho; os limites estão na migration.

### Identidade e workspaces

| Tabela         | Finalidade                                                                                 | Colunas principais                                                                                                                                               | Na exclusão                                                                                                                                                                                                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profiles`     | Dados pessoais da conta. Criado por trigger quando o usuário é criado em `auth.users`.     | `id` (= `auth.users.id`), `email`, `full_name`, `prefs` (jsonb), `notif_prefs` (jsonb). Pela API só `full_name`, `prefs` e `notif_prefs` podem ser alterados     | Apagado em cascata quando a conta é apagada.                                                                                                                                                                                                                                                                                                 |
| `workspaces`   | Espaço de trabalho.                                                                        | `name` (1 a 80), `slug` (único, `^[a-z0-9][a-z0-9-]{0,62}$`), `color`, `created_by`                                                                              | Apaga em cascata tudo que pertence a ele (membros, projetos, tarefas, comentários, atividade...). **Não apaga arquivos do Storage**: o app remove os objetos logo depois de excluir o workspace.                                                                                                                                             |
| `members`      | Pessoa dentro de um workspace.                                                             | `workspace_id`, `user_id` (nulo = convite), `email` (minúsculo), `name`, `role`, `status`, `team_id`, `title`, `color`, `timezone`, `last_seen_at`, `invited_by` | Some com o workspace. Ao apagar a conta, `user_id` vira nulo e o `status` passa a `deactivated` (a linha permanece, preservando autoria e histórico). Ao apagar o membro: atribuições, `lead_id`, `uploaded_by`, `author_id` e `actor_id` ficam nulos; favoritos, estado pessoal, notificações recebidas e vínculos de projeto são apagados. |
| `member_state` | Estado pessoal no workspace (ordem dos projetos, buscas recentes, configuração das views). | `member_id` (PK), `state` (jsonb)                                                                                                                                | Some com o membro ou com o workspace.                                                                                                                                                                                                                                                                                                        |
| `teams`        | Times do workspace.                                                                        | `name`, `icon`, `color`, `description`                                                                                                                           | `members.team_id` e `projects.team_id` ficam nulos.                                                                                                                                                                                                                                                                                          |

Restrições relevantes de `members`: `unique (workspace_id, email)` e `unique (workspace_id, user_id)`.

### Projetos e tarefas

| Tabela              | Finalidade                                                                        | Colunas principais                                                                                                                                                                                                                                                                                                                                                              | Na exclusão                                                                                                                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `projects`          | Projeto.                                                                          | `key` (`^[A-Z0-9]{1,10}$`), `name`, `status` (`planning`, `active`, `risk`, `hold`, `complete`), `team_id`, `lead_id`, `start_date`, `due_date`, `is_private`, `milestones` (jsonb array), `task_seq`, `archived_at`, `created_by`                                                                                                                                              | Apaga em cascata vínculos, tarefas, arquivos (registros), eventos, visões salvas e notificações do projeto. O histórico (`activity`) é preservado, com o nome do projeto. `lead_id` e `team_id` ficam nulos se o membro/time sumir. |
| `project_members`   | Quem participa de um projeto e com qual permissão.                                | PK `(project_id, member_id)`, `permission` (`Can view`, `Can comment`, `Can edit`, `Full access` ou nulo)                                                                                                                                                                                                                                                                       | Some com o projeto ou com o membro.                                                                                                                                                                                                 |
| `tasks`             | Tarefa.                                                                           | `project_id`, `key` (atribuída pelo banco, única no workspace), `title`, `description` (HTML), `status` (`backlog`, `todo`, `progress`, `review`, `done`), `prev_status`, `priority` (`urgent`, `high`, `medium`, `low`, `none`), `assignee_id`, `start_date`, `due_date`, `estimate`, `labels` (text[]), `recurrence`, `position`, `completed_at`, `archived_at`, `created_by` | Apaga subtarefas, dependências (nos dois sentidos), comentários, notificações e favoritos da tarefa. O histórico (`activity`) é preservado. Arquivos anexados **permanecem** no projeto (`files.task_id` vira nulo).                |
| `subtasks`          | Subtarefas.                                                                       | `task_id`, `title`, `done`, `assignee_id`, `due_date`, `note`, `position`                                                                                                                                                                                                                                                                                                       | Some com a tarefa.                                                                                                                                                                                                                  |
| `task_dependencies` | "Tarefa A depende da B".                                                          | PK `(task_id, depends_on_id)`, `check (task_id <> depends_on_id)`                                                                                                                                                                                                                                                                                                               | Some se qualquer uma das tarefas for apagada.                                                                                                                                                                                       |
| `files`             | Um registro por arquivo. Se `task_id` está preenchido, é também anexo da tarefa.  | `project_id`, `task_id`, `name`, `kind`, `mime`, `size_bytes`, `storage_path`, `uploaded_by` (membro)                                                                                                                                                                                                                                                                           | **O objeto no Storage não é apagado pelo banco.** O app remove o objeto ao excluir o arquivo (e ao excluir o workspace); falha no cliente pode deixar objetos órfãos.                                                               |
| `comments`          | Comentários de tarefa.                                                            | `task_id`, `author_id`, `body`, `reactions` (jsonb objeto), `edited_at`                                                                                                                                                                                                                                                                                                         | Some com a tarefa. `author_id` fica nulo se o autor sumir.                                                                                                                                                                          |
| `events`            | Eventos do calendário, de um projeto ou do workspace inteiro (`project_id` nulo). | `project_id`, `title`, `event_date`, `event_time` (`''` ou `HH:MM`)                                                                                                                                                                                                                                                                                                             | Some com o projeto.                                                                                                                                                                                                                 |
| `saved_views`       | Visões salvas de um projeto, compartilhadas com quem vê o projeto.                | `project_id`, `name`, `type`, `config` (jsonb)                                                                                                                                                                                                                                                                                                                                  | Some com o projeto.                                                                                                                                                                                                                 |

### Atividade, notificações e favoritos

| Tabela              | Finalidade                                                                                             | Colunas principais                                                                                                                   | Na exclusão                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `activity`          | Histórico ("fulano moveu a tarefa..."). Só inserção pelo cliente.                                      | `actor_id`, `verb`, `task_id`, `project_id`, `extra`, `subject`, `project_name`, `restricted`                                        | Some só com o workspace. Sobrevive à exclusão da tarefa e do projeto (veja Histórico de atividade). `actor_id` fica nulo se o membro sumir. |
| `notifications`     | Caixa de entrada. **Criada somente por triggers** (atribuição, menção, comentário, mudança de status). | `recipient_id`, `actor_id`, `type` (`mention`, `assign`, `comment`, `update`), `task_id`, `project_id`, `text`, `snippet`, `read_at` | Some com o destinatário, a tarefa, o projeto ou o workspace.                                                                                |
| `task_favorites`    | Favoritos pessoais de tarefas.                                                                         | PK `(member_id, task_id)`                                                                                                            | Some com o membro ou a tarefa.                                                                                                              |
| `project_favorites` | Favoritos pessoais de projetos.                                                                        | PK `(member_id, project_id)`                                                                                                         | Some com o membro ou o projeto.                                                                                                             |

## Funções

### Schema `private` (não exposto pela API)

O schema `private` não está em `schemas` da Data API (`supabase/config.toml` lista só `public` e `graphql_public`). O papel `authenticated` tem `usage` no schema e `execute` nas funções (necessário porque as políticas RLS as chamam), e `anon` não tem nada. Todas as funções abaixo usam `set search_path = ''`.

| Função                                            | Tipo             | O que faz                                                                                                                                                                                            |
| ------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `my_member_id(ws)`                                | definer, stable  | Id do membro ativo do usuário atual no workspace, ou nulo.                                                                                                                                           |
| `my_role(ws)`                                     | definer, stable  | Papel do usuário atual no workspace (só membro ativo), ou nulo.                                                                                                                                      |
| `is_member(ws)`                                   | definer, stable  | O usuário atual é membro ativo do workspace?                                                                                                                                                         |
| `can_write(ws)`                                   | definer, stable  | Papel `owner`, `admin` ou `member`.                                                                                                                                                                  |
| `is_admin(ws)`                                    | definer, stable  | Papel `owner` ou `admin`.                                                                                                                                                                            |
| `project_perm(pid)`                               | definer, stable  | Nível de acesso (0 a 4) do usuário atual ao projeto. Veja a seção abaixo.                                                                                                                            |
| `member_can_see_project(mid, pid)`                | definer, stable  | O mesmo critério de visibilidade de `project_perm`, para um membro qualquer (usado para decidir a quem entregar notificações).                                                                       |
| `in_workspace(mid, ws)`                           | definer, stable  | O membro pertence ao workspace? (verdadeiro para `mid` nulo).                                                                                                                                        |
| `task_perm(tid)`                                  | definer, stable  | `project_perm` do projeto da tarefa (0 se a tarefa não existe).                                                                                                                                      |
| `storage_perm(object_name)`                       | definer, stable  | Nível de acesso ao projeto codificado no caminho do objeto (`{workspace}/{projeto}/{arquivo}/{nome}`); 0 se o caminho for inválido ou o projeto não pertencer ao workspace.                          |
| `touch_updated_at()`                              | trigger          | Atualiza `updated_at`.                                                                                                                                                                               |
| `set_ws_from_project()` / `_task()` / `_member()` | trigger, definer | Forçam `workspace_id` = o do pai.                                                                                                                                                                    |
| `guard_member_write()`                            | trigger, definer | Regras de escrita em `members` (veja Triggers).                                                                                                                                                      |
| `guard_project_update()`                          | trigger, definer | Regras de update em `projects` (veja Triggers).                                                                                                                                                      |
| `check_same_workspace()`                          | trigger, definer | Rejeita referências a membros, times ou tarefas de outro workspace (erro `23514`).                                                                                                                   |
| `stamp_author()`                                  | trigger, definer | Preenche `created_by` / `uploaded_by` com o usuário da sessão e impede que mudem depois.                                                                                                             |
| `member_account_removed()`                        | trigger          | Quando a conta some (`user_id` vira nulo), marca o membro como `deactivated`.                                                                                                                        |
| `guard_comment_update()`                          | trigger, definer | Só o autor altera o texto de um comentário.                                                                                                                                                          |
| `status_name(s)`                                  | immutable        | Nome legível do status, usado nas notificações.                                                                                                                                                      |
| `notify(...)`                                     | definer          | Insere uma notificação, respeitando `profiles.notif_prefs` (chave `inapp_<tipo>` = `false` silencia), ignorando o próprio autor e entregando só a quem enxerga o projeto (`member_can_see_project`). |
| `notify_task_change()`, `notify_comment()`        | trigger, definer | Geram notificações de tarefa e de comentário/menção.                                                                                                                                                 |
| `handle_new_user()`                               | trigger, definer | Cria o `profiles` quando nasce uma linha em `auth.users`.                                                                                                                                            |
| `claim_invitations()`                             | definer          | Vincula convites pendentes (mesmo e-mail, **e-mail confirmado**) à conta atual e ativa o membro. Devolve quantos vínculos fez.                                                                       |
| `slugify(txt)`                                    | immutable        | Gera o slug a partir de um texto.                                                                                                                                                                    |
| `create_workspace(name, slug, color)`             | definer          | Cria workspace, o membro `owner` ativo e o `member_state`. Gera slug único (`nome`, `nome-2`...). Limite de 25 workspaces como dono por conta.                                                       |
| `workspace_slug_available(slug)`                  | definer, stable  | O slug (após `slugify`) está livre?                                                                                                                                                                  |
| `touch_presence(ws)`                              | definer          | Atualiza `last_seen_at` do membro atual.                                                                                                                                                             |

`claim_invitations`, `create_workspace` e `touch_presence` ligam a variável de sessão `app.bypass_member_guard` durante a execução para passar pelo trigger de `members`. Essa proteção só vale enquanto nenhuma função exposta pela API permitir ao cliente definir variáveis de sessão arbitrárias.

### Wrappers em `public` (chamados pelo app via `supabase.rpc`)

São `security invoker` e só repassam para a função `private` de mesmo nome. `execute` é concedido apenas a `authenticated`; `anon` e `public` não têm.

| Função pública                              | Chamada em                  |
| ------------------------------------------- | --------------------------- |
| `claim_invitations()`                       | login (`enterSession`)      |
| `create_workspace(p_name, p_slug, p_color)` | onboarding e novo workspace |
| `workspace_slug_available(p_slug)`          | formulário de workspace     |
| `touch_presence(ws)`                        | ao abrir um workspace       |

## Triggers

| Trigger                                                                                                                                            | Tabela                                                          | Quando                                                    | Efeito                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `*_touch`                                                                                                                                          | `profiles`, `workspaces`, `members`, `projects`, `member_state` | antes de update                                           | Atualiza `updated_at`.                                                                                                                                       |
| `tasks_set_ws`, `files_set_ws`, `events_set_ws`, `saved_views_set_ws`, `project_members_set_ws`, `project_favorites_set_ws`                        | tabelas com `project_id`                                        | antes de insert, ou update de `project_id`/`workspace_id` | `workspace_id` := o do projeto.                                                                                                                              |
| `subtasks_set_ws`, `task_dependencies_set_ws`, `comments_set_ws`, `task_favorites_set_ws`                                                          | tabelas com `task_id`                                           | idem                                                      | `workspace_id` := o da tarefa.                                                                                                                               |
| `member_state_set_ws`                                                                                                                              | `member_state`                                                  | idem                                                      | `workspace_id` := o do membro.                                                                                                                               |
| `*_z_same_ws` (`tasks`, `subtasks`, `projects`, `project_members`, `members`, `task_dependencies`, `files`, `task_favorites`, `project_favorites`) | as tabelas indicadas                                            | antes de insert ou update                                 | Rejeita referência a outro workspace (veja abaixo). O prefixo `z` faz rodar depois dos `*_set_ws`.                                                           |
| `projects_stamp`, `tasks_stamp`, `events_stamp`, `saved_views_stamp`, `files_z_stamp`                                                              | as tabelas indicadas                                            | antes de insert ou update                                 | `created_by` := usuário da sessão no insert (`files.uploaded_by` := membro da sessão); não muda depois.                                                      |
| `projects_guard`                                                                                                                                   | `projects`                                                      | antes de update                                           | Ver abaixo.                                                                                                                                                  |
| `members_account_removed`                                                                                                                          | `members`                                                       | antes de update de `user_id`                              | `user_id` virando nulo => `status = 'deactivated'`.                                                                                                          |
| `members_guard`                                                                                                                                    | `members`                                                       | antes de insert, update e delete                          | Ver abaixo.                                                                                                                                                  |
| `comments_guard`                                                                                                                                   | `comments`                                                      | antes de update                                           | `task_id`, `author_id` e `created_at` não mudam; só o autor altera `body` e `edited_at` (qualquer pessoa com acesso de comentário pode alterar `reactions`). |
| `tasks_notify`                                                                                                                                     | `tasks`                                                         | depois de insert, ou update de `assignee_id`/`status`     | Notifica o responsável: atribuição, conclusão ("completed") ou mudança de coluna. Não notifica tarefas arquivadas nem o próprio autor.                       |
| `comments_notify`                                                                                                                                  | `comments`                                                      | depois de insert                                          | Notifica quem foi mencionado (`@Nome`, comparação por texto com o nome do membro) e, se for outra pessoa, o responsável da tarefa.                           |
| `on_auth_user_created`                                                                                                                             | `auth.users`                                                    | depois de insert                                          | Cria o `profiles` (nome vem de `full_name` ou `name` dos metadados, senão do começo do e-mail).                                                              |
| `tasks_z_key`                                                                                                                                      | `tasks`                                                         | antes de insert ou update                                 | Atribui `key` a partir do contador do projeto (`assign_task_key`). Ver abaixo.                                                                               |
| `tasks_keep_history`                                                                                                                               | `tasks`                                                         | antes de delete                                           | Desvincula o histórico da tarefa e registra a exclusão (`keep_task_history`). Ver abaixo.                                                                    |
| `projects_keep_history`                                                                                                                            | `projects`                                                      | antes de delete                                           | Desvincula o histórico do projeto, guarda o nome dele e registra a exclusão (`keep_project_history`). Ver abaixo.                                            |

Regras do `members_guard` (não se aplicam a chamadas sem usuário, como o SQL do painel, nem às funções que ligam `app.bypass_member_guard`):

- **Insert**: só convite pendente (`user_id` nulo, `status = 'invited'`, papel diferente de `owner`). Convidar `admin` exige ser admin. `invited_by` é preenchido com o usuário atual.
- **Update**: `workspace_id` e `user_id` não mudam. E-mail só muda em convite pendente e por admin. Papel e status só mudam por admin, nunca de ou para `owner`, e um membro sem conta não pode ser ativado. Mudar `team_id` exige `can_write`. `last_seen_at` e `invited_by` não mudam por aqui.
- **Delete**: o `owner` não pode ser removido; a linha dele só sai junto com o workspace, quando o próprio dono exclui o workspace.
- **Dados de exibição**: `name`, `title`, `color` e `timezone` de um membro só mudam pelo próprio membro ou por admin. Os demais com `can_write` só mexem na alocação de time.

Regras do `projects_guard` (update de `projects`):

- `task_seq` nunca diminui, venha o valor de onde vier.
- `workspace_id` nunca muda (vale também para chamadas sem usuário).
- `lead_id` e `is_private` só mudam por quem tem nível 4 no projeto.

Regras de `*_z_same_ws` (`check_same_workspace`):

- `tasks.assignee_id`, `subtasks.assignee_id`, `projects.lead_id`, `project_members.member_id`, `task_favorites.member_id` e `project_favorites.member_id` precisam ser membros do mesmo workspace da linha.
- `projects.team_id` e `members.team_id` precisam ser times do mesmo workspace.
- `task_dependencies.depends_on_id` precisa ser tarefa do mesmo workspace.
- `files.task_id`, se preenchido, precisa ser tarefa do mesmo projeto do arquivo.

Chave de tarefa (`tasks_z_key`):

- No insert, a chave é `<sigla do projeto>-<n>`, com `n` vindo de `projects.task_seq` incrementado na mesma transação. O `update` do contador trava a linha do projeto, então criações simultâneas no mesmo projeto entram em fila e recebem números diferentes. O valor de `key` enviado pelo cliente é ignorado.
- A chave é única no workspace (índice `tasks_workspace_key_uidx`). Se dois projetos têm a mesma sigla, ou a sigla mudou, o trigger pula os números já usados.
- No update, a chave não muda, exceto quando a tarefa vai para outro projeto: aí recebe uma chave do projeto de destino.
- O app mostra uma chave provisória ao criar a tarefa e a troca pela definitiva quando a resposta do insert chega (colunas `server` em `src/data/mappers.js`).

Histórico de atividade (`tasks_keep_history`, `projects_keep_history`, `activity_set_refs`):

- `activity.subject` guarda o título da tarefa (ou o nome do projeto) a que o registro se refere. É preenchido pelo banco no insert; o cliente não escolhe `subject`, `project_name` nem `restricted`.
- **Tarefa excluída**: os registros dela ficam, com `task_id` nulo e `subject` igual ao título final, ainda ligados ao projeto. Entra um registro `deleted` em nome de quem excluiu, com a chave da tarefa em `extra`.
- **Projeto excluído**: os registros dele ficam, com `project_id` e `task_id` nulos, `project_name` igual ao nome do projeto e `restricted` igual a `is_private`. Entra um registro `deleted project`. As tarefas que vão junto não geram registros `deleted` individuais.
- **Workspace excluído**: nada é guardado; o histórico vai junto.
- As chaves estrangeiras `activity.task_id` e `activity.project_id` continuam `on delete cascade`. Os triggers desvinculam os registros antes da exclusão, então a cascata não encontra nada. Se um dia esses triggers forem desligados (por exemplo com `session_replication_role = replica`), a cascata volta a apagar o histórico.

Autoria (`*_stamp`): o cliente não escolhe `created_by` (projetos, tarefas, eventos, visões salvas) nem `uploaded_by` (arquivos). O valor enviado é ignorado. Nada disso se aplica a chamadas sem usuário de sessão (SQL do painel, chave secreta).

## Níveis de permissão por projeto

`private.project_perm(pid)` devolve um inteiro. As políticas comparam com um limiar.

| Nível | Nome         | Pode                                                                                                                                 |
| ----- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| 0     | sem acesso   | Nada. O projeto e tudo dentro dele ficam invisíveis.                                                                                 |
| 1     | ver          | Ler projeto, tarefas, comentários, arquivos e visões salvas.                                                                         |
| 2     | comentar     | Ver e comentar.                                                                                                                      |
| 3     | editar       | Editar projeto, tarefas, subtarefas, arquivos e visões salvas; enviar arquivos; adicionar pessoas ao projeto com a permissão padrão. |
| 4     | acesso total | Tudo do nível 3 e **excluir o projeto**, mudar líder e privacidade, conceder, alterar e revogar permissões de outras pessoas.        |

Como o nível é calculado, nesta ordem (a primeira regra que bater vence):

1. **0** se o usuário não é membro ativo do workspace do projeto.
2. **0** se não for `owner`, não for o líder (`lead_id`), não for o criador (`created_by`) com papel diferente de `guest`, não tiver linha em `project_members` e (o projeto for privado **ou** o papel for `guest`).
3. **4** se for `owner` ou `admin`, líder (`lead_id`) ou criador com papel diferente de `guest`.
4. Pela coluna `permission` da linha em `project_members`: `Full access` = 4, `Can edit` = 3, `Can comment` = 2, `Can view` = 1.
5. Sem permissão explícita (linha com `permission` nulo, ou membro de projeto aberto sem linha): **2** para `guest`, **3** para os demais.

Consequências práticas:

| Situação                                       | owner | admin | member     | guest      |
| ---------------------------------------------- | ----- | ----- | ---------- | ---------- |
| Projeto aberto, sem linha em `project_members` | 4     | 4     | 3          | 0          |
| Projeto privado, sem linha e sem ser criador   | **4** | **0** | 0          | 0          |
| Projeto privado/aberto, linha sem `permission` | 4     | 4     | 3          | 2          |
| Linha com `permission` explícita               | 4     | 4     | a da linha | a da linha |

Atenção: o `owner` enxerga e administra **todos** os projetos, inclusive os privados, para que nenhum projeto fique órfão. O `admin` **não** enxerga projetos privados dos quais não participa. Um criador que for rebaixado a `guest` perde o atalho de criador, tanto para ler quanto para escrever. O líder do projeto sempre o enxerga, mesmo sem linha em `project_members`. Menções em comentários casam o nome inteiro (`@Ana Lima` não notifica uma pessoa chamada `Ana Li`).

Quem concede permissões em `project_members`:

- nível 4: insere com qualquer permissão, altera a permissão de qualquer pessoa e remove qualquer pessoa;
- nível 3: só adiciona pessoas com `permission` nula (o padrão do papel: 3 para `member`, 2 para `guest`); não altera nem remove;
- qualquer pessoa na lista pode remover a si mesma (sair do projeto).

Por isso, na prática, o nível 3 não consegue se promover a nível 4.

## Política de acesso (RLS)

Todas as tabelas de `public` têm RLS ligado. O papel `anon` não tem privilégio em nenhuma tabela (`revoke all` na migration). O papel `authenticated` recebe apenas os privilégios abaixo, e a política decide as linhas.

Legenda: **sim** = permitido; **não** = negado; **próprio** = só a própria linha; **perm ≥ N** = depende do [nível no projeto](#níveis-de-permissão-por-projeto).

### Tabelas de escopo de workspace

| Tabela / operação                     | owner   | admin   | member             | guest   | Observações                                                                                                                                                         |
| ------------------------------------- | ------- | ------- | ------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `profiles` select/update              | próprio | próprio | próprio            | próprio | Update só das colunas `full_name`, `prefs` e `notif_prefs` (o e-mail não é editável pela API). Sem insert nem delete.                                               |
| `workspaces` select                   | sim     | sim     | sim                | sim     | Só dos workspaces em que é membro ativo.                                                                                                                            |
| `workspaces` update                   | sim     | sim     | não                | não     |                                                                                                                                                                     |
| `workspaces` delete                   | sim     | não     | não                | não     | Insert só via `create_workspace`.                                                                                                                                   |
| `members` select                      | sim     | sim     | sim                | sim     | Também a própria linha, mesmo desativado.                                                                                                                           |
| `members` insert (convite)            | sim     | sim     | sim                | não     | Só convite pendente; convidar admin exige admin.                                                                                                                    |
| `members` update                      | sim     | sim     | sim                | próprio | Trigger: papel, status e e-mail só admin; `team_id` exige `can_write`; `name`, `title`, `color` e `timezone` só o próprio membro ou admin.                          |
| `members` delete                      | sim     | sim     | convites que criou | não     | Nunca o `owner`. A política de delete: admin, ou convite pendente feito pelo próprio usuário.                                                                       |
| `member_state` (tudo)                 | próprio | próprio | próprio            | próprio |                                                                                                                                                                     |
| `teams` select                        | sim     | sim     | sim                | sim     |                                                                                                                                                                     |
| `teams` insert/update/delete          | sim     | sim     | sim                | não     |                                                                                                                                                                     |
| `activity` select                     | sim     | sim     | sim                | sim     | De projeto visível (perm ≥ 1), ou sem projeto. Registros de projeto excluído: quem fez a ação, o `owner` e, se o projeto não era privado, os demais não convidados. |
| `activity` insert                     | sim     | sim     | sim                | sim     | Só em nome próprio (`actor_id`) e com perm ≥ 2 no projeto; projeto e workspace vêm da tarefa (trigger). Sem update/delete.                                          |
| `notifications` select/update/delete  | próprio | próprio | próprio            | próprio | Update só da coluna `read_at`. Sem insert pela API.                                                                                                                 |
| `events` select                       | sim     | sim     | sim                | sim     | Sem projeto, ou projeto visível.                                                                                                                                    |
| `events` insert/update/delete         | sim     | sim     | sim                | não     | Se tiver projeto: perm ≥ 3.                                                                                                                                         |
| `task_favorites`, `project_favorites` | próprio | próprio | próprio            | próprio | Só do próprio membro e de itens visíveis (perm ≥ 1).                                                                                                                |

### Tabelas de escopo de projeto (o acesso depende do nível, não só do papel)

| Tabela              | select                                      | insert                                                             | update                                                            | delete                       |
| ------------------- | ------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------- | ---------------------------- |
| `projects`          | perm ≥ 1 (ou criador) e membro do workspace | `can_write` (guest não cria); `created_by` é carimbado por trigger | perm ≥ 3 (líder e privacidade: perm ≥ 4; `workspace_id` não muda) | perm ≥ 4                     |
| `project_members`   | projeto visível                             | perm ≥ 4, ou perm ≥ 3 com `permission` nula                        | perm ≥ 4                                                          | perm ≥ 4, ou a própria linha |
| `tasks`             | projeto visível                             | perm ≥ 3                                                           | perm ≥ 3                                                          | perm ≥ 3                     |
| `subtasks`          | tarefa visível                              | perm ≥ 3 na tarefa                                                 | perm ≥ 3 na tarefa                                                | perm ≥ 3 na tarefa           |
| `task_dependencies` | as duas tarefas visíveis                    | perm ≥ 3 em `task_id` e ≥ 1 em `depends_on_id`                     | perm ≥ 3 em `task_id` (e ≥ 1 no destino)                          | perm ≥ 3 em `task_id`        |
| `files`             | projeto visível                             | perm ≥ 3                                                           | perm ≥ 3                                                          | perm ≥ 3                     |
| `comments`          | tarefa visível                              | perm ≥ 2 e `author_id` = o próprio membro                          | perm ≥ 2 (texto só pelo autor, por trigger)                       | o autor, ou owner/admin      |
| `saved_views`       | projeto visível                             | perm ≥ 3                                                           | perm ≥ 3                                                          | perm ≥ 3                     |

Resumo por papel, nos casos comuns:

| Pode...                           | owner  | admin                    | member                   | guest                                                           |
| --------------------------------- | ------ | ------------------------ | ------------------------ | --------------------------------------------------------------- |
| Criar projeto                     | sim    | sim                      | sim                      | não                                                             |
| Ver projeto aberto                | sim    | sim                      | sim                      | só se estiver em `project_members`                              |
| Ver projeto privado               | sempre | só se participa ou criou | só se participa ou criou | só se estiver em `project_members`                              |
| Editar tarefas num projeto aberto | sim    | sim                      | sim                      | só com `Can edit` ou `Full access`                              |
| Comentar                          | sim    | sim                      | sim                      | sim, a partir de `Can comment` (ou sem permissão explícita = 2) |
| Excluir projeto                   | sim    | sim (se vê o projeto)    | só com nível 4           | só com `Full access`                                            |
| Excluir workspace                 | sim    | não                      | não                      | não                                                             |

## Storage

- **Bucket**: `files`, **privado** (`public = false`), limite de 52428800 bytes (50 MiB) por arquivo. A migration cria o bucket com `insert ... on conflict do update`, então reaplicá-la restaura essas duas propriedades.
- **Caminho do objeto**: `{workspace_id}/{project_id}/{file_id}/{nome}`, com `nome` sanitizado pelo app (letras, números, `.`, `_`, `-`). O caminho é guardado em `files.storage_path`.
- **Políticas** (em `storage.objects`, papel `authenticated`, bucket `files`), todas baseadas em `private.storage_perm(name)`, que lê o projeto do caminho e devolve o nível de acesso:
  - `dash_files_select`: nível ≥ 1 (ler, gerar URL assinada, copiar origem)
  - `dash_files_insert`, `dash_files_update`, `dash_files_delete`: nível ≥ 3
- **Leitura pelo app**: URLs assinadas de 1 hora (`createSignedUrl`). Quem tiver a URL assinada consegue baixar até ela expirar, mesmo sem login.
- **Limite global**: o limite por bucket não pode passar do limite global de upload do projeto. No plano gratuito o limite global é de 50 MB e não pode ser aumentado ([documentação](https://supabase.com/docs/guides/storage/uploads/file-limits)).
- **Órfãos**: apagar linhas de `files` (inclusive em cascata) não apaga o objeto. O app remove os objetos ao excluir um arquivo ou um workspace; se isso falhar, o objeto fica no bucket.

## Realtime

A migration adiciona à publicação `supabase_realtime` as tabelas: `workspaces`, `teams`, `members`, `projects`, `project_members`, `tasks`, `subtasks`, `task_dependencies`, `files`, `comments`, `activity`, `notifications`, `events`, `saved_views`. Ficam de fora (pessoais): `profiles`, `member_state`, `task_favorites`, `project_favorites`.

O Realtime (Postgres Changes) autoriza cada evento contra cada assinante, então as políticas RLS acima valem para inserções e atualizações. Exclusões são diferentes: a documentação do Supabase diz que o RLS não é aplicado a `DELETE` e que eventos de exclusão só podem ser filtrados com `replica identity full`. As tabelas usam a identidade padrão, então o evento de exclusão carrega só a chave primária. Por isso o app assina, em cada tabela, `INSERT` e `UPDATE` com filtro `workspace_id=eq.<id>` (`id=eq.<id>` em `workspaces`) e `DELETE` **sem filtro**. Ao receber um evento que não seja eco da própria gravação (chaves desconhecidas são ignoradas), recarrega o workspace. Efeito colateral: o navegador recebe as chaves primárias das exclusões de qualquer workspace, o que não revela conteúdo.

## Criar uma nova migration

Nunca edite uma migration já aplicada em produção: crie uma nova.

1. Gere o arquivo (o prefixo é um timestamp):

   ```bash
   supabase migration new nome_curto_da_mudanca
   ```

   Isso cria `supabase/migrations/<timestamp>_nome_curto_da_mudanca.sql`, vazio.

2. Escreva o SQL. Para toda tabela nova em `public`: ligue RLS, crie as políticas, dê os `grant` só ao papel `authenticated` e, se o app precisa receber mudanças dela, adicione à publicação `supabase_realtime`. Funções com `security definer` vão no schema `private`, com `set search_path = ''`.

3. Teste no banco local (precisa do `supabase start`). Este comando **apaga os dados locais** e reaplica todas as migrations do zero:

   ```bash
   supabase db reset
   ```

   Depois rode `npm run test:integration` para conferir RLS, triggers e Storage contra o banco local (veja [SETUP.md](SETUP.md)).

   Cenários escritos em SQL puro ficam em `tests/sql/` e rodam contra qualquer banco com o schema aplicado, dentro de uma transação que é desfeita no fim:

   ```bash
   psql "postgresql://postgres:postgres@127.0.0.1:55322/postgres" -v ON_ERROR_STOP=1 -f tests/sql/task_keys_activity_history.sql
   ```

4. Confira o que será aplicado no projeto de produção e aplique:

   ```bash
   supabase db push --dry-run   # só lista as migrations pendentes
   supabase db push             # aplica
   ```

   O projeto precisa estar ligado com `supabase link` (veja [SETUP.md](SETUP.md)).

   Quando a migration é aplicada por outro caminho (o servidor MCP do Supabase, por exemplo), ela entra no histórico com o horário da aplicação, não com o do arquivo. Ajuste a versão para o `db push` não tentar reaplicá-la:

   ```sql
   update supabase_migrations.schema_migrations set version = '<timestamp do arquivo>' where name = '<nome_curto_da_mudanca>';
   ```

   O servidor MCP recusa SQL com `drop` ou `delete` sem confirmação interativa. A migration `20261111145659` foi escrita sem esses comandos por isso (`alter policy` em vez de recriar a política; triggers em vez de trocar a ação das chaves estrangeiras).

5. Faça commit do arquivo da migration junto com o código que depende dele. Faça o deploy do front-end depois de aplicar a migration, para o app nunca falar com um schema mais antigo do que espera.

## Pontos de atenção e limitações conhecidas

As regras descritas acima já incorporam as correções feitas depois da primeira revisão das políticas (escalada de permissão em `project_members`, projeto trocando de workspace, edição de dados de outros membros, escrita de visões salvas por quem só vê, leitura por criador rebaixado a convidado, registro de atividade em tarefa alheia, e-mail do perfil editável, notificações para quem não vê o projeto, referências entre workspaces, `created_by` forjável, conta apagada). Restam os itens abaixo.

1. **Exclusões chegam sem filtro e sem conteúdo.** Veja a seção Realtime. É uma troca consciente: `replica identity full` faria o evento carregar a linha apagada inteira para todos os assinantes, inclusive quem não tem acesso ao projeto, porque o RLS não vale para exclusões.
2. **O histórico cresce sem limite.** Desde que passou a sobreviver à exclusão de tarefas e projetos, `activity` só diminui quando o workspace é excluído. Não há rotina de expurgo, e o app carrega o histórico inteiro do workspace ao abrir.
3. **Histórico de projeto excluído.** Os registros ficam visíveis conforme a regra da tabela de RLS acima, mas não podem mais ser abertos: a tarefa e o projeto não existem. O texto de `verb` e `extra` é guardado em inglês e traduzido pelo app na exibição.
4. **Objetos do Storage ficam órfãos se o cliente falhar** ao excluir arquivo, projeto ou workspace (veja Storage): não há rotina no banco para limpá-los.
5. **Responsável sem acesso ao projeto.** `assignee_id` precisa ser do mesmo workspace, mas não precisa enxergar o projeto. Ele não recebe notificações sobre o projeto (a entrega é filtrada), porém a tarefa continua apontando para ele.
6. **Nível 3 amplia a audiência.** Quem edita um projeto pode adicionar qualquer membro do workspace com a permissão padrão, o que dá nível 3 a um `member` (e 2 a um `guest`), inclusive em projeto privado. Não consegue conceder permissão explícita nem remover ninguém.
7. **`admin` não vê projetos privados alheios.** Se o criador de um projeto privado sair, quem consegue abri-lo pela API é o `owner`. Decisão de produto: o `admin` fica de fora de propósito.
