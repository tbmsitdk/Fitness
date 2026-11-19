import { describe, it, expect } from 'vitest';
import { describeAiError } from '@/lib/ai-errors';

describe('describeAiError', () => {
  it('names an empty credit balance (the real failure behind repeated "could not read" errors)', () => {
    const e = { status: 400, message: '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}',
      error: { error: { message: 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.' } } };
    const f = describeAiError(e, 'generic');
    expect(f.kind).toBe('credits');
    expect(f.message).toContain('out of credits');
    expect(f.status).toBe(402);
  });
  it('recognises a rejected key, rate limiting and overload', () => {
    expect(describeAiError({ status: 401, message: 'invalid x-api-key' }, 'g').kind).toBe('auth');
    expect(describeAiError({ status: 429, message: 'rate' }, 'g').kind).toBe('rate_limit');
    expect(describeAiError({ status: 529, message: 'Overloaded' }, 'g').kind).toBe('overloaded');
  });
  it('keeps the caller message for anything else, including non-error values', () => {
    expect(describeAiError(new Error('boom'), 'generic')).toMatchObject({ kind: 'other', message: 'generic', status: 500 });
    expect(describeAiError(null, 'generic').message).toBe('generic');
  });
});
