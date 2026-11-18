import { assertWritable, mapDbError } from './errors.js';
import { MAILBOX_DEFAULTS } from '../../shared/mailbox.js';

function ok(res) {
  if (res.error) throw mapDbError(res.error);
  return res.data;
}

/* Leituras de crm_deals pedem só estas colunas. O rascunho do lead não entra. */
export const DEAL_LOOKUP = 'id, title, stage_id, contact_id';

export function createStore(db) {
  return {
    async getMailbox(workspaceId) {
      return ok(
        await db
          .from('crm_mailboxes')
          .select('id, workspace_id, address, username, imap_host, imap_port, smtp_host, smtp_port')
          .eq('workspace_id', workspaceId)
          .maybeSingle(),
      );
    },
    async getSecret(mailboxId) {
      return ok(await db.from('crm_mailbox_secrets').select('mailbox_id, ciphertext, nonce, tag, key_version').eq('mailbox_id', mailboxId).maybeSingle());
    },
    async hasSecret(mailboxId) {
      const row = ok(await db.from('crm_mailbox_secrets').select('mailbox_id').eq('mailbox_id', mailboxId).maybeSingle());
      return !!row;
    },
    async getStatus(mailboxId) {
      return ok(
        await db.from('crm_mailbox_status').select('total_messages, unseen_messages, last_sync_at, last_error').eq('mailbox_id', mailboxId).maybeSingle(),
      );
    },
    async upsertMailbox(row) {
      assertWritable('crm_mailboxes');
      const existing = ok(await db.from('crm_mailboxes').select('id').eq('workspace_id', row.workspaceId).maybeSingle());
      const fields = {
        address: row.address,
        username: row.username,
        imap_host: row.imapHost,
        imap_port: row.imapPort,
        imap_secure: true,
        smtp_host: row.smtpHost,
        smtp_port: row.smtpPort,
        smtp_secure: true,
        pop3_host: MAILBOX_DEFAULTS.pop3Host,
        pop3_port: MAILBOX_DEFAULTS.pop3Port,
      };
      if (existing) {
        return ok(
          await db
            .from('crm_mailboxes')
            .update(fields)
            .eq('id', existing.id)
            .select('id, workspace_id, address, username, imap_host, imap_port, smtp_host, smtp_port')
            .single(),
        );
      }
      return ok(
        await db
          .from('crm_mailboxes')
          .insert({ ...fields, workspace_id: row.workspaceId, created_by: row.userId })
          .select('id, workspace_id, address, username, imap_host, imap_port, smtp_host, smtp_port')
          .single(),
      );
    },
    async upsertSecret(mailboxId, workspaceId, enc) {
      assertWritable('crm_mailbox_secrets');
      ok(
        await db.from('crm_mailbox_secrets').upsert(
          {
            mailbox_id: mailboxId,
            workspace_id: workspaceId,
            ciphertext: enc.ciphertext,
            nonce: enc.nonce,
            tag: enc.tag,
            key_version: enc.keyVersion,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'mailbox_id' },
        ),
      );
    },
    async saveError(mailboxId, workspaceId, code) {
      assertWritable('crm_mailbox_status');
      const current = ok(await db.from('crm_mailbox_status').select('total_messages, unseen_messages, last_sync_at').eq('mailbox_id', mailboxId).maybeSingle());
      ok(
        await db.from('crm_mailbox_status').upsert(
          {
            mailbox_id: mailboxId,
            workspace_id: workspaceId,
            total_messages: current?.total_messages || 0,
            unseen_messages: current?.unseen_messages || 0,
            last_sync_at: current?.last_sync_at || null,
            last_error: String(code || 'imap_read_failed').slice(0, 80),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'mailbox_id' },
        ),
      );
    },
    async loadCrm(workspaceId) {
      const contacts = ok(await db.from('crm_contacts').select('id, email').eq('workspace_id', workspaceId)) || [];
      const deals = ok(await db.from('crm_deals').select(DEAL_LOOKUP).eq('workspace_id', workspaceId)) || [];
      const sent = ok(await db.from('crm_sent_messages').select('deal_id, rfc_message_id').eq('workspace_id', workspaceId)) || [];
      return { contacts, deals, sent };
    },
    async existingMessages(mailboxId, uidValidity, uids) {
      if (!uids.length) return [];
      const rows =
        ok(
          await db
            .from('crm_inbox_messages')
            .select('imap_uid, uid_validity, needs_triage')
            .eq('mailbox_id', mailboxId)
            .eq('uid_validity', uidValidity)
            .in('imap_uid', uids),
        ) || [];
      return rows.map(row => ({ imapUid: Number(row.imap_uid), uidValidity: Number(row.uid_validity), needsTriage: row.needs_triage }));
    },
    async savePlan(mailbox, plan) {
      assertWritable('crm_inbox_messages');
      assertWritable('crm_inbox_links');
      assertWritable('crm_mailbox_status');
      const rows = plan.messages
        .filter(message => message.imapUid > 0)
        .map(message => ({
          workspace_id: mailbox.workspace_id,
          mailbox_id: mailbox.id,
          imap_uid: message.imapUid,
          uid_validity: plan.status.uidValidity,
          message_id: message.messageId || '',
          in_reply_to: message.inReplyTo || '',
          reference_ids: message.references || [],
          from_email: String(message.fromEmail || '').slice(0, 254),
          from_name: message.fromName || '',
          subject: message.subject || '',
          snippet: message.snippet || '',
          received_at: message.receivedAt,
          server_seen: !!message.serverSeen,
          needs_triage: !!message.needsTriage,
          synced_at: new Date().toISOString(),
        }));
      let saved = [];
      if (rows.length) {
        saved = ok(await db.from('crm_inbox_messages').upsert(rows, { onConflict: 'mailbox_id,uid_validity,imap_uid' }).select('id, imap_uid')) || [];
      }
      const ids = saved.map(row => row.id);
      if (ids.length) {
        ok(await db.from('crm_inbox_links').delete().in('message_id', ids));
        const byUid = new Map(saved.map(row => [Number(row.imap_uid), row.id]));
        const links = [];
        for (const message of plan.messages) {
          const messageId = byUid.get(Number(message.imapUid));
          if (!messageId) continue;
          for (const link of message.links) {
            links.push({
              workspace_id: mailbox.workspace_id,
              message_id: messageId,
              deal_id: link.dealId,
              contact_id: link.contactId,
              match_reason: link.reason,
            });
          }
        }
        if (links.length) ok(await db.from('crm_inbox_links').insert(links));
      }
      ok(
        await db.from('crm_mailbox_status').upsert(
          {
            mailbox_id: mailbox.id,
            workspace_id: mailbox.workspace_id,
            total_messages: plan.status.total,
            unseen_messages: plan.status.unseen,
            last_sync_at: new Date().toISOString(),
            last_error: '',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'mailbox_id' },
        ),
      );
    },
    async latestMessages(workspaceId) {
      return (
        ok(
          await db
            .from('crm_inbox_messages')
            .select('id, from_email, from_name, subject, snippet, received_at, server_seen, needs_triage')
            .eq('workspace_id', workspaceId)
            .order('received_at', { ascending: false })
            .limit(30),
        ) || []
      );
    },
    async triageMessages(workspaceId) {
      return (
        ok(
          await db
            .from('crm_inbox_messages')
            .select('id, from_email, from_name, subject, snippet, received_at, server_seen, needs_triage')
            .eq('workspace_id', workspaceId)
            .eq('needs_triage', true)
            .order('received_at', { ascending: false })
            .limit(50),
        ) || []
      );
    },
    async linksFor(messageIds) {
      if (!messageIds.length) return [];
      return ok(await db.from('crm_inbox_links').select('message_id, deal_id, contact_id, match_reason').in('message_id', messageIds)) || [];
    },
    async dealsByIds(ids) {
      return ok(await db.from('crm_deals').select(DEAL_LOOKUP).in('id', ids)) || [];
    },
    async contactsByIds(ids) {
      return ok(await db.from('crm_contacts').select('id, name, email').in('id', ids)) || [];
    },
    async getDeal(workspaceId, dealId) {
      return ok(await db.from('crm_deals').select(DEAL_LOOKUP).eq('workspace_id', workspaceId).eq('id', dealId).maybeSingle());
    },
    async insertApproval(row) {
      assertWritable('crm_email_approvals');
      return ok(
        await db
          .from('crm_email_approvals')
          .insert({
            workspace_id: row.workspaceId,
            deal_id: row.dealId,
            to_email: row.toEmail,
            subject: row.subject,
            body: row.body,
            body_sha256: row.bodySha256,
            approved_by: row.userId,
          })
          .select('id')
          .single(),
      );
    },
    async listApprovals(workspaceId) {
      return (
        ok(
          await db
            .from('crm_email_approvals')
            .select('id, deal_id, to_email, subject, approved_at, consumed_at')
            .eq('workspace_id', workspaceId)
            .order('approved_at', { ascending: false })
            .limit(50),
        ) || []
      );
    },
    async getApproval(workspaceId, approvalId) {
      return ok(
        await db
          .from('crm_email_approvals')
          .select('id, workspace_id, deal_id, to_email, subject, body, consumed_at')
          .eq('workspace_id', workspaceId)
          .eq('id', approvalId)
          .maybeSingle(),
      );
    },
    async markSent({ approval, rfcMessageId }) {
      assertWritable('crm_sent_messages');
      assertWritable('crm_email_approvals');
      ok(
        await db.from('crm_sent_messages').insert({
          workspace_id: approval.workspace_id,
          deal_id: approval.deal_id,
          approval_id: approval.id,
          rfc_message_id: rfcMessageId,
          to_email: approval.to_email,
        }),
      );
      ok(await db.from('crm_email_approvals').update({ consumed_at: new Date().toISOString() }).eq('id', approval.id).is('consumed_at', null));
    },
    async setTriage(workspaceId, messageId, needs) {
      assertWritable('crm_inbox_messages');
      ok(await db.from('crm_inbox_messages').update({ needs_triage: !!needs }).eq('workspace_id', workspaceId).eq('id', messageId));
    },
    async listWorkspaces() {
      const rows = ok(await db.from('crm_mailboxes').select('workspace_id')) || [];
      return rows.map(row => row.workspace_id);
    },
  };
}
