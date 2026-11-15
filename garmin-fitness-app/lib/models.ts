// Model ids in one place. Safe to import from client components — this file
// must never import the SDK. __tests__/model-compat.test.ts fails the build on
// retired ids anywhere in the source.

/** Coaching report, chat, deep analysis and the monthly review. */
export const COACH_MODEL = 'claude-fable-5-2';

/** Training-plan generation: structured, lower-stakes, cheaper. */
export const PLAN_MODEL = 'claude-sonnet-5-5';
