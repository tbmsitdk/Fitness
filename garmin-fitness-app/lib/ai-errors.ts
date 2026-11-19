/**
 * What went wrong with an Anthropic call, in words the user can act on.
 *
 * Every failure used to read "Could not read that note", including an empty credit
 * balance, which no retry can fix and which hit every AI feature at once.
 */
export interface AiFailure { status: number; message: string; kind: 'credits' | 'auth' | 'rate_limit' | 'overloaded' | 'other' }

export function describeAiError(e: unknown, fallback: string): AiFailure {
  const err = e as { status?: number; message?: string; error?: { error?: { message?: string } } } | null;
  const status = typeof err?.status === 'number' ? err.status : 0;
  const text = `${err?.error?.error?.message ?? ''} ${err?.message ?? ''}`.toLowerCase();

  if (text.includes('credit balance is too low')) {
    return { kind: 'credits', status: 402, message: 'The Anthropic account behind this app is out of credits. Add credits at console.anthropic.com → Plans & Billing, then try again. Every AI feature is affected until then.' };
  }
  if (status === 401 || status === 403 || text.includes('invalid x-api-key') || text.includes('authentication')) {
    return { kind: 'auth', status: 502, message: 'The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in Vercel.' };
  }
  if (status === 429) {
    return { kind: 'rate_limit', status: 429, message: 'Anthropic is rate-limiting requests. Wait a minute and try again.' };
  }
  if (status === 529 || status === 503 || text.includes('overloaded')) {
    return { kind: 'overloaded', status: 503, message: 'Anthropic is overloaded right now. Try again in a minute.' };
  }
  return { kind: 'other', status: 500, message: fallback };
}
