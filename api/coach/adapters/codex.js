/* The CLI can execute model tools as the same uid that reads its credential cache.
 * A read-only sandbox and a privilege drop do not protect that cache or its environment.
 * Keep saved configuration for recovery, but do not start this runtime until an enforced
 * tool-free boundary exists. The OpenAI HTTP provider remains available. */
export const DISABLED_REASON = 'Coach jobs are disabled: Codex CLI tool isolation is not verified; use the OpenAI API or an OpenAI-compatible endpoint';

export default {
  id: 'codex',
  spawns: true,
  cli: 'codex',
  disabledReason: DISABLED_REASON,

  async check() {
    return { ok: false, error: DISABLED_REASON };
  },

  async invoke() {
    return { code: -1, text: '', stderr: DISABLED_REASON, timedOut: false, spawnError: true };
  }
};
