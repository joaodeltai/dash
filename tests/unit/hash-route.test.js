import { describe, expect, it } from 'vitest';
import { parseHash, routeHash } from '../../src/core/hash-route.js';

const known = route => ['home', 'crm', 'inbox', 'settings', 'content'].includes(route);

describe('crm mailbox route', () => {
  it('keeps the email screen at #/crm/email', () => {
    expect(routeHash('crm', { tab: 'email' })).toBe('#/crm/email');
    expect(routeHash('crm', { tab: 'pipeline' })).toBe('#/crm');
    expect(routeHash('crm', {})).toBe('#/crm');
    expect(parseHash('#/crm/email', known)).toEqual({ route: 'crm', params: { tab: 'email' } });
    expect(parseHash('#/crm', known)).toEqual({ route: 'crm', params: {} });
    expect(parseHash('#/crm/companies', known)).toEqual({ route: 'crm', params: { tab: 'companies' } });
  });

  it('routes the content area, a tab and a piece', () => {
    expect(routeHash('content', { tab: 'ideas' })).toBe('#/content');
    expect(routeHash('content', {})).toBe('#/content');
    expect(routeHash('content', { tab: 'board' })).toBe('#/content/board');
    expect(routeHash('content', { id: 'piece-1' })).toBe('#/content/item/piece-1');
    expect(parseHash('#/content', known)).toEqual({ route: 'content', params: {} });
    expect(parseHash('#/content/plan', known)).toEqual({ route: 'content', params: { tab: 'plan' } });
    expect(parseHash('#/content/item/piece-1', known)).toEqual({ route: 'content', params: { id: 'piece-1' } });
  });

  it('leaves project links alone', () => {
    expect(routeHash('project', { id: 'p1', tab: 'board' })).toBe('#/project/p1/board');
    expect(parseHash('#/project/p1/board', known)).toEqual({ route: 'project', params: { id: 'p1', tab: 'board' } });
    expect(parseHash('#/nope', known)).toBeNull();
  });
});
