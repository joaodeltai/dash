import { afterEach, describe, expect, it } from 'vitest';
import { MISSING_DECIDER_EMAIL, emailDraftCard, parseEmailDraft } from '../../src/core/email-draft.js';
import { setLang } from '../../src/core/i18n.js';

afterEach(() => setLang('en'));

const emailBody = [
  '[RASCUNHO — NÃO ENVIADO]',
  '',
  '--- Versão A ---',
  'Assunto: Primeira',
  '',
  'Oi, Lia.',
  '',
  '--- Versão B ---',
  'Assunto: Segunda',
  '',
  'Oi de novo.',
].join('\n');

function draft(over = {}) {
  const versoes = over.versoes || [
    { rotulo: 'A', assunto: 'Primeira', corpo: emailBody, canal: 'email' },
    { rotulo: 'B', assunto: '', corpo: 'Oi pelo LinkedIn.\nSegunda linha.', canal: 'linkedin' },
  ];
  const active = versoes.find(v => v.rotulo === (over.versao_ativa || 'A')) || versoes[0];
  return {
    assunto: active?.assunto ?? '',
    email_decisor: 'lia@acme.com.br',
    corpo: active?.corpo ?? '',
    versao_ativa: active?.rotulo || '',
    versoes,
    ...over,
  };
}

describe('parseEmailDraft', () => {
  it('accepts the fixed shape and returns it unchanged', () => {
    const value = draft();
    expect(parseEmailDraft(value)).toEqual(value);
    expect(parseEmailDraft(JSON.stringify(value))).toEqual(value);
  });

  it('accepts an empty draft and the missing-email marker', () => {
    const empty = { assunto: '', email_decisor: MISSING_DECIDER_EMAIL, corpo: '', versao_ativa: '', versoes: [] };
    expect(parseEmailDraft(empty)).toEqual(empty);
    expect(parseEmailDraft(null)).toBeNull();
    expect(parseEmailDraft('')).toBeNull();
  });

  it('accepts version B as the active one when the top fields match it', () => {
    const value = draft({ versao_ativa: 'B' });
    expect(parseEmailDraft(value)?.versao_ativa).toBe('B');
    expect(parseEmailDraft(value)?.corpo).toBe('Oi pelo LinkedIn.\nSegunda linha.');
  });

  it('rejects a shape the check constraint would reject', () => {
    expect(parseEmailDraft({ assunto: 'só isso' })).toBeNull();
    expect(parseEmailDraft({ ...draft(), extra: true })).toBeNull();
    expect(parseEmailDraft({ ...draft(), assunto: 'outro' })).toBeNull();
    expect(parseEmailDraft({ ...draft(), email_decisor: 'sem-arroba' })).toBeNull();
    expect(parseEmailDraft({ ...draft(), email_decisor: 'lia @acme.com' })).toBeNull();
    const swapped = draft();
    swapped.versoes = [swapped.versoes[1], swapped.versoes[0]];
    expect(parseEmailDraft(swapped)).toBeNull();
    const whatsapp = draft();
    whatsapp.versoes = [{ rotulo: 'A', assunto: 'Primeira', corpo: emailBody, canal: 'whatsapp' }];
    whatsapp.versao_ativa = 'A';
    expect(parseEmailDraft(whatsapp)).toBeNull();
    expect(parseEmailDraft({ ...draft(), assunto: 'linha\n2' })).toBeNull();
  });
});

describe('email draft card', () => {
  it('shows the draft in Portuguese, with the body breaks and both versions', () => {
    setLang('pt-BR');
    const html = emailDraftCard(draft(), { dealId: 'deal-1' });
    expect(html).toContain('Rascunho');
    expect(html).toContain('Não enviado');
    expect(html).toContain('Primeira');
    expect(html).toContain('lia@acme.com.br');
    expect(html).toContain('Oi, Lia.');
    expect(html).toContain('Oi de novo.');
    expect(html).toContain('data-v="A"');
    expect(html).toContain('data-v="B"');
    expect(html).toContain('E-mail');
    expect(html).toContain('LinkedIn');
    expect(html).toContain('aria-selected="true"');
    expect(html.match(/data-a="/g)?.map(s => s)).toEqual(['data-a="', 'data-a="']);
    expect(html).not.toMatch(/data-a="(?!pickDraftVersion)/);
    expect(html).not.toContain('type="submit"');
    expect(html).toContain('Oi, Lia.\n');
  });

  it('switches the subject and the body to the chosen version', () => {
    setLang('pt-BR');
    const html = emailDraftCard(draft(), { dealId: 'deal-1', selected: 'B' });
    expect(html).toContain('Sem assunto');
    expect(html).toContain('Oi pelo LinkedIn.\nSegunda linha.');
    expect(html).not.toContain('>Primeira<');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('data-v="B"');
  });

  it('renders the empty states and escapes the body', () => {
    setLang('pt-BR');
    const empty = emailDraftCard(null, { dealId: 'deal-1' });
    expect(empty).toContain('Nenhum rascunho de e-mail neste lead.');
    expect(empty).not.toContain('data-a=');
    const bare = emailDraftCard({ assunto: '', email_decisor: MISSING_DECIDER_EMAIL, corpo: '', versao_ativa: '', versoes: [] }, { dealId: 'deal-1' });
    expect(bare).toContain('Este rascunho não tem versões.');
    expect(bare).toContain(MISSING_DECIDER_EMAIL);
    expect(bare).toContain('is-missing');
    const nasty = draft({
      versoes: [{ rotulo: 'A', assunto: '<b>Assunto</b>', corpo: '<script>alert(1)</script>', canal: 'email' }],
    });
    const html = emailDraftCard(nasty, { dealId: 'deal-1' });
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&lt;b&gt;Assunto&lt;/b&gt;');
    expect(html).not.toContain('<script>');
  });
});
