/**
 * Security Guardrails — dual-stage input/output validation for agent safety.
 * Based on Maxim AI Bifrost gateway (2026), AI Magicx prompt injection defense, OWASP LLM Top 10.
 */

export interface GuardResult {
  safe: boolean;
  reason?: string;
  category?: string;
  confidence: number;
}

export class SecurityGuardrails {
  checkInput(input: string): GuardResult {
    const injectionPatterns = [
      { regex: /ignore\s+(all\s+)?previous\s+instructions/i, name: 'direct_override' },
      { regex: /you\s+are\s+now\s+(a|an)\s+/i, name: 'role_hijack' },
      { regex: /system\s*:\s*/i, name: 'system_prompt_injection' },
      { regex: /\[INST\]|\[\/INST\]|<<SYS>>|<\/SYS>/i, name: 'llama_format_injection' },
      { regex: /forget\s+(everything|all|your\s+instructions)/i, name: 'memory_wipe' },
      { regex: /repeat\s+(the\s+)?(system|initial)\s+(prompt|message)/i, name: 'prompt_extraction' },
      { regex: /ADMIN\s*MODE|DEVELOPER\s*MODE|GOD\s*MODE/i, name: 'mode_escalation' },
    ];
    for (const p of injectionPatterns) {
      if (p.regex.test(input)) {
        return { safe: false, reason: `Injection detected: ${p.name}`, category: 'injection', confidence: 0.9 };
      }
    }
    if (input.length > 100000) {
      return { safe: false, reason: 'Input exceeds 100K chars', category: 'overflow', confidence: 1.0 };
    }
    const suspicious = /[\u200B-\u200F\u2028-\u202F\u2060-\u206F\uFEFF]/;
    if (suspicious.test(input)) {
      return { safe: false, reason: 'Suspicious Unicode control chars', category: 'encoding', confidence: 0.7 };
    }
    return { safe: true, confidence: 1.0 };
  }

  checkOutput(output: string): GuardResult {
    const credentialPatterns = [
      { regex: /sk-[a-zA-Z0-9]{20,}/, name: 'api_key' },
      { regex: /ghp_[a-zA-Z0-9]{36}/, name: 'github_token' },
      { regex: /glpat-[a-zA-Z0-9\-]{20,}/, name: 'gitlab_token' },
      { regex: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/, name: 'private_key' },
    ];
    for (const p of credentialPatterns) {
      if (p.regex.test(output)) {
        return { safe: false, reason: `Credential leakage: ${p.name}`, category: 'data_leakage', confidence: 0.95 };
      }
    }
    const internalPaths = /\/etc\/passwd|\/etc\/shadow|\.ssh\/|\.aws\/|\.env/;
    if (internalPaths.test(output)) {
      return { safe: false, reason: 'Internal path in output', category: 'data_leakage', confidence: 0.8 };
    }
    return { safe: true, confidence: 1.0 };
  }

  check(input: string, output: string): { inputGuard: GuardResult; outputGuard: GuardResult; overallSafe: boolean } {
    const inputGuard = this.checkInput(input);
    const outputGuard = this.checkOutput(output);
    return { inputGuard, outputGuard, overallSafe: inputGuard.safe && outputGuard.safe };
  }
}
