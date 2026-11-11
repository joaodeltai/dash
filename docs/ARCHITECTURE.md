# Arquitetura

Dash é o Gr8r Studio (front-end em JavaScript puro, sem framework) ligado a um backend Supabase: Postgres com RLS, Auth, Storage e Realtime. Não há servidor próprio: o navegador fala direto com o Supabase, e toda a autorização é feita no banco.

## Visão geral

```
navegador (Vite, ES modules)
  ├─ páginas / views / overlays   renderizam HTML a partir do estado S
  ├─ actions/*                    mutam S.data de forma síncrona e chamam save()
  ├─ core/store.js                estado S (data, prefs, views, ui) e save()
  └─ data/
       ├─ supabase.js             cliente Supabase (variáveis VITE_*)
       ├─ mappers.js              estado em memória ⇄ linhas do banco (puro, testável)
       ├─ sync.js                 motor de sincronização por diferença
       └─ backend.js              sessão, carga do workspace, realtime, storage, auth

Supabase
  ├─ Auth        e-mail e senha (OAuth opcional), confirmação de e-mail, recuperação de senha
  ├─ Postgres    tabelas normalizadas + RLS + triggers (supabase/migrations)
  ├─ Storage     bucket privado `files`
  └─ Realtime    mudanças de outros membros e dispositivos
```

## Por que um motor de sincronização

O app original guarda tudo em um objeto (`S.data`) e ~200 ações mutam esse objeto diretamente antes de redesenhar a tela. Em vez de reescrever cada ação como chamada de API, a persistência foi colocada em um único ponto:

1. A ação muta `S.data` e chama `save()` (como antes). A tela responde na hora.
2. `save()` agenda um ciclo do motor (`data/sync.js`).
3. O ciclo executa `normalize()` (conserta o estado para espelhar as regras do banco), `flatten()` (estado → linhas por tabela) e `diff()` contra a **baseline**, que é a última versão sabidamente gravada.
4. Só as diferenças são enviadas: `insert` das linhas novas, `update` apenas das colunas alteradas, `delete` das removidas. Depois de cada envio a baseline é atualizada.

Consequências práticas:

- **Toda mutação persiste**, inclusive as que o código original esquecia de salvar, porque o que conta é o estado, não a ação.
- **Desfazer funciona**: exclusões esperam alguns segundos antes de ir ao banco (`DELETE_HOLD_MS`). O "Undo" restaura o estado anterior e a exclusão simplesmente deixa de existir no diff. Ao esconder ou fechar a aba, tudo o que está pendente é enviado na hora.
- **Edição concorrente** é resolvida por coluna: duas pessoas alterando campos diferentes da mesma tarefa não se sobrescrevem.
- **Erros**: falha de rede deixa as mudanças na fila, mostra a barra "offline" e tenta de novo com espera crescente. Mudança recusada pelo banco (permissão, restrição) gera um aviso e o workspace é recarregado, descartando a edição local.
- **Outros usuários**: eventos do Realtime disparam uma recarga do workspace, exceto quando são eco das nossas próprias gravações. A recarga nunca acontece com mudanças locais pendentes. Eventos de exclusão só trazem a chave primária e não podem ser filtrados por workspace com a replica identity padrão; por isso o app assina `DELETE` sem filtro por tabela e ignora chaves que não conhece (veja a seção Realtime de [DATABASE.md](DATABASE.md)).

## Fluxo de inicialização

`main.js` chama `boot()` (`data/backend.js`):

1. Sem variáveis do Supabase: tela "Connect a database".
2. `auth.getSession()`. Sem sessão: tela de login. Link de recuperação de senha: tela de nova senha.
3. Com sessão: `claim_invitations()` vincula convites pendentes do mesmo e-mail, carrega o perfil e os workspaces do usuário.
4. Sem workspace: onboarding (cria o workspace pela função `create_workspace`).
5. Com workspace: `openWorkspace()` busca todas as tabelas em paralelo (paginadas), `hydrate()` monta `S.data`, a baseline é definida e a interface é desenhada.

A sessão fica no `localStorage` do navegador (gerenciada pelo supabase-js) e é renovada automaticamente, então recarregar a página volta direto ao workspace.

## Estado em memória ⇄ banco

| Em memória (`S.data`)                                             | Banco                                                                     |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `ws`                                                              | `workspaces`                                                              |
| `members[]` (id = id do membro no workspace)                      | `members`                                                                 |
| `teams[]`                                                         | `teams`                                                                   |
| `projects[]` (`members`, `perms`, `private`, `milestones`, `seq`) | `projects`, `project_members`                                             |
| `tasks[]` (`subtasks`, `deps`, `attachments`)                     | `tasks`, `subtasks`, `task_dependencies`, `files`                         |
| `files[]`                                                         | `files` (um registro por arquivo; anexo de tarefa = `task_id` preenchido) |
| `comments[]` (`re` = reações)                                     | `comments`                                                                |
| `activity[]`                                                      | `activity` (somente inserção)                                             |
| `notifs[]`                                                        | `notifications` (criadas por triggers; o cliente só marca como lida)      |
| `events[]`, `savedViews[]`                                        | `events`, `saved_views`                                                   |
| `fav` em tarefa/projeto                                           | `task_favorites`, `project_favorites` (pessoal)                           |
| `projOrder`, `recentSearches`, `S.views`                          | `member_state.state` (pessoal)                                            |
| `S.prefs`, `notifPrefs`                                           | `profiles.prefs`, `profiles.notif_prefs` (pessoal)                        |

Os ids são UUIDs gerados no navegador (`uid()`), o que permite criar registros sem esperar o servidor.

A exceção é a **chave da tarefa** (`WEB-201`), que é decidida pelo banco para nunca repetir no workspace. O app mostra uma chave provisória no momento da criação; a resposta do insert traz a definitiva, que o motor de sincronização adota na baseline e entrega ao estado (`onServerValues` em `data/backend.js`). Na prática as duas coincidem, a não ser que outra pessoa tenha criado uma tarefa no mesmo projeto no mesmo instante. As colunas com esse comportamento são declaradas em `TABLES` (`server` e `serverOn`, em `data/mappers.js`).

## Histórico de atividade

Cada entrada guarda, além das referências à tarefa e ao projeto, o título da tarefa (`label`, coluna `subject`). Quando a tarefa é excluída, a entrada continua no histórico do projeto, sem link. Quando o projeto é excluído, as entradas passam a carregar o nome dele (`projectName`) e aparecem no histórico do workspace para quem podia vê-las. As exclusões são registradas pelo próprio banco, depois que a janela do "Undo" passa. As regras estão em [DATABASE.md](DATABASE.md).

## Idiomas

A interface existe em inglês e em português do Brasil (`core/i18n.js`). O texto em inglês é a chave: `tr('New task')` devolve a tradução quando há uma e o próprio inglês quando não há. Os dicionários ficam em `src/i18n/pt-BR/`, um arquivo por área, e `common.js` concentra o vocabulário compartilhado.

- O idioma é uma preferência (`S.prefs.lang`, `'en'` ou `'pt-BR'`): vem do navegador na primeira visita, fica em cache local para valer antes do login e é gravado em `profiles.prefs`.
- O que vai para o banco fica em inglês canônico: verbos e detalhes do histórico, texto das notificações (escrito por triggers), nomes de status, prioridades, papéis e permissões. `core/activity-text.js` e as chamadas `tr(...)` nos pontos de exibição traduzem para quem lê. Assim duas pessoas com idiomas diferentes compartilham os mesmos dados.
- Datas do histórico são gravadas em ISO e formatadas na exibição.
- Conteúdo criado em nome da pessoa (tarefas iniciais de um modelo, descrição padrão) nasce no idioma dela.

## Segurança

- A chave usada no navegador é a **publishable key**, pública por natureza. Nenhuma chave secreta existe no front-end nem no repositório.
- Todas as tabelas têm **RLS**. O papel `anon` não tem privilégio algum. Detalhes das regras em [DATABASE.md](DATABASE.md).
- Funções `security definer` ficam no schema `private`, que não é exposto pela API.
- Notificações, vínculo de convites e criação de workspace acontecem no banco, não no cliente. Autoria (`created_by`, `uploaded_by`) também é carimbada por trigger, e referências entre workspaces são rejeitadas pelo banco.
- O HTML da descrição de tarefas é sanitizado antes de ser exibido.

## Camadas do front-end

A estrutura original foi preservada (`core`, `ui`, `shell`, `components`, `pages`, `views`, `overlays`, `features`, `actions`). O que mudou:

- `core/store.js` não carrega mais dados de exemplo nem grava o workspace no `localStorage` (só preferências visuais, para aplicar o tema antes do login).
- `actions/session.js` contém as ações que dependem do backend (login, cadastro, onboarding, workspaces, senha).
- `data/` é novo e é o único lugar que fala com o Supabase.
- `core/i18n.js`, `core/activity-text.js` e `src/i18n/` são novos e cuidam do idioma.
