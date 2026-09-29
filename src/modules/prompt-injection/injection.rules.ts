export interface InjectionRule {
  id: string;
  pattern: RegExp;
  subtype: string;
  confidence: number;
  reason: string;
}

/**
 * Rule-based patterns for detecting prompt injection attempts.
 * Each rule has a regex pattern, subtype classification, base confidence, and human-readable reason.
 */
export const injectionRules: InjectionRule[] = [
  // Instruction override patterns
  {
    id: 'instruction_override_1',
    pattern:
      /ignore\s+(all\s+)?(previous|prior|above|earlier|preceding)\s+(instructions?|prompts?|rules?|directions?|guidelines?)/i,
    subtype: 'instruction_override',
    confidence: 0.95,
    reason: 'Input attempts to override higher-priority instructions.',
  },
  {
    id: 'instruction_override_2',
    pattern:
      /disregard\s+(all\s+)?(previous|prior|above|earlier|preceding)\s+(instructions?|prompts?|rules?|directions?)/i,
    subtype: 'instruction_override',
    confidence: 0.95,
    reason: 'Input attempts to disregard prior instructions.',
  },
  {
    id: 'instruction_override_3',
    pattern: /forget\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|context|rules?)/i,
    subtype: 'instruction_override',
    confidence: 0.90,
    reason: 'Input attempts to erase prior instruction context.',
  },
  {
    id: 'instruction_override_4',
    pattern: /override\s+(the\s+)?(system|original|initial|default)\s+(prompt|instructions?|rules?|behavior)/i,
    subtype: 'instruction_override',
    confidence: 0.93,
    reason: 'Input attempts to override system-level instructions.',
  },
  {
    id: 'instruction_override_5',
    pattern: /do\s+not\s+follow\s+(any\s+)?(previous|prior|original|system)\s+(instructions?|rules?|guidelines?)/i,
    subtype: 'instruction_override',
    confidence: 0.92,
    reason: 'Input instructs the model to not follow prior rules.',
  },

  // System prompt extraction
  {
    id: 'system_prompt_extraction_1',
    pattern: /reveal\s+(the\s+)?(system\s+prompt|system\s+message|initial\s+prompt|hidden\s+instructions?)/i,
    subtype: 'system_prompt_extraction',
    confidence: 0.92,
    reason: 'Input attempts to extract the system prompt.',
  },
  {
    id: 'system_prompt_extraction_2',
    pattern: /show\s+(me\s+)?(the\s+)?(hidden\s+)?(system\s+prompt|system\s+message|initial\s+prompt|hidden\s+prompt|original\s+instructions?|initial\s+instructions?|hidden\s+instructions?)/i,
    subtype: 'system_prompt_extraction',
    confidence: 0.90,
    reason: 'Input attempts to reveal hidden instructions.',
  },
  {
    id: 'system_prompt_extraction_3',
    pattern: /what\s+(is|are)\s+(your|the)\s+(system\s+prompt|system\s+instructions?|original\s+instructions?|hidden\s+instructions?)/i,
    subtype: 'system_prompt_extraction',
    confidence: 0.88,
    reason: 'Input asks about hidden system instructions.',
  },
  {
    id: 'system_prompt_extraction_4',
    pattern: /print\s+(the\s+)?(system\s+prompt|system\s+message|initial\s+prompt|hidden\s+text)/i,
    subtype: 'system_prompt_extraction',
    confidence: 0.90,
    reason: 'Input requests printing of the system prompt.',
  },
  {
    id: 'system_prompt_extraction_5',
    pattern: /output\s+(the\s+)?(system\s+prompt|hidden\s+instructions?|system\s+message)/i,
    subtype: 'system_prompt_extraction',
    confidence: 0.90,
    reason: 'Input requests output of hidden instructions.',
  },

  // Role manipulation
  {
    id: 'role_manipulation_1',
    pattern: /you\s+are\s+now\s+(a|an|the|my)\s+/i,
    subtype: 'role_manipulation',
    confidence: 0.80,
    reason: 'Input attempts to reassign the model role.',
  },
  {
    id: 'role_manipulation_2',
    pattern: /act\s+as\s+(a|an|if\s+you\s+were)\s+/i,
    subtype: 'role_manipulation',
    confidence: 0.70,
    reason: 'Input attempts to change model behavior through role-play.',
  },
  {
    id: 'role_manipulation_3',
    pattern: /pretend\s+(you\s+are|to\s+be|you're)\s+/i,
    subtype: 'role_manipulation',
    confidence: 0.75,
    reason: 'Input uses pretend directive to change model persona.',
  },
  {
    id: 'role_manipulation_4',
    pattern: /from\s+now\s+on[\s,]+you\s+(are|will|should|must)/i,
    subtype: 'role_manipulation',
    confidence: 0.85,
    reason: 'Input attempts to permanently alter model behavior.',
  },

  // Jailbreak attempts
  {
    id: 'jailbreak_1',
    pattern: /\bDAN\b.*\bdo\s+anything\s+now\b/i,
    subtype: 'jailbreak',
    confidence: 0.95,
    reason: 'DAN (Do Anything Now) jailbreak attempt detected.',
  },
  {
    id: 'jailbreak_2',
    pattern: /developer\s+mode\s+(enabled|activated|on)/i,
    subtype: 'jailbreak',
    confidence: 0.92,
    reason: 'Developer mode jailbreak attempt detected.',
  },
  {
    id: 'jailbreak_3',
    pattern: /jailbreak(ed|ing)?/i,
    subtype: 'jailbreak',
    confidence: 0.88,
    reason: 'Explicit jailbreak keyword detected.',
  },
  {
    id: 'jailbreak_4',
    pattern: /enable\s+(unrestricted|unfiltered|uncensored)\s+mode/i,
    subtype: 'jailbreak',
    confidence: 0.90,
    reason: 'Attempt to enable unrestricted mode.',
  },

  // Context manipulation
  {
    id: 'context_manipulation_1',
    pattern: /\[system\]|\[SYSTEM\]|<\|system\|>|<<SYS>>|<\|im_start\|>system/i,
    subtype: 'context_manipulation',
    confidence: 0.93,
    reason: 'Input contains system-level formatting tokens.',
  },
  {
    id: 'context_manipulation_2',
    pattern: /```system|---\s*system\s*---/i,
    subtype: 'context_manipulation',
    confidence: 0.85,
    reason: 'Input uses formatting to simulate system messages.',
  },
  {
    id: 'context_manipulation_3',
    pattern: /new\s+(system\s+)?instructions?:\s*/i,
    subtype: 'context_manipulation',
    confidence: 0.88,
    reason: 'Input introduces new system instructions.',
  },

  // Data exfiltration
  {
    id: 'data_exfiltration_1',
    pattern: /repeat\s+(everything|all|the\s+text)\s+(above|before|in\s+your\s+(context|memory|prompt))/i,
    subtype: 'data_exfiltration',
    confidence: 0.85,
    reason: 'Input attempts to extract context or training data.',
  },
  {
    id: 'data_exfiltration_2',
    pattern: /dump\s+(your\s+)?(memory|context|training\s+data|conversation)/i,
    subtype: 'data_exfiltration',
    confidence: 0.88,
    reason: 'Input requests memory/context dump.',
  },

  // Obfuscation detection
  {
    id: 'obfuscation_1',
    pattern: /i\s*g\s*n\s*o\s*r\s*e\s+.*i\s*n\s*s\s*t\s*r\s*u\s*c\s*t\s*i\s*o\s*n\s*s/i,
    subtype: 'obfuscated_injection',
    confidence: 0.85,
    reason: 'Spaced-out character obfuscation detected.',
  },
  {
    id: 'obfuscation_2',
    pattern: /1gn0r3|1nstruct10ns|syst3m|pr0mpt/i,
    subtype: 'obfuscated_injection',
    confidence: 0.80,
    reason: 'Leetspeak obfuscation detected.',
  },
  {
    id: 'obfuscation_3',
    pattern: /&#\d+;|%[0-9a-f]{2}/i,
    subtype: 'obfuscated_injection',
    confidence: 0.70,
    reason: 'HTML/URL-encoded content detected in input.',
  },

  // Multi-step manipulation
  {
    id: 'multi_step_1',
    pattern: /step\s*1[\s:]+.*ignore|first[\s,]+ignore\s+(all|any|every)/i,
    subtype: 'multi_step_attack',
    confidence: 0.85,
    reason: 'Multi-step injection pattern detected.',
  },
  {
    id: 'multi_step_2',
    pattern: /before\s+responding[\s,]+(first\s+)?(ignore|forget|discard)/i,
    subtype: 'multi_step_attack',
    confidence: 0.88,
    reason: 'Conditional injection pattern detected.',
  },

  // Bypass & safety filter disabling
  {
    id: 'bypass_filter_1',
    pattern: /bypass\s+(all\s+)?(safety|guardrails?|filters?|restrictions?|guidelines?)/i,
    subtype: 'jailbreak',
    confidence: 0.94,
    reason: 'Direct attempt to bypass safety filters or guardrails.',
  },
  {
    id: 'unrestricted_persona_1',
    pattern: /(unrestricted|unfiltered|uncensored|jailbroken)\s+(assistant|mode|model|ai|operational\s+mode)/i,
    subtype: 'jailbreak',
    confidence: 0.90,
    reason: 'Attempt to switch into unrestricted or unfiltered persona.',
  },
  {
    id: 'root_override_1',
    pattern: /(root|developer|admin|god\s+mode|system)\s+(override|shell|terminal|access|directive)/i,
    subtype: 'instruction_override',
    confidence: 0.92,
    reason: 'Simulated administrative or root override directive.',
  },
  {
    id: 'disregard_prompt_1',
    pattern: /disregard\s+(the\s+)?(prompt|rules?|guidelines?|constraints?)\s+(above|prior|preceding|before)/i,
    subtype: 'instruction_override',
    confidence: 0.95,
    reason: 'Input attempts to disregard prior prompts.',
  },
  {
    id: 'prompt_disclosure_1',
    pattern: /(output|disclose|reveal|print|show|extract)\s+(the\s+)?(complete\s+|full\s+|raw\s+|initial\s+|confidential\s+|hidden\s+)?(system\s+prompt|system\s+instructions?|system\s+message|prompt\s+text|developer\s+notes?)/i,
    subtype: 'system_prompt_extraction',
    confidence: 0.93,
    reason: 'Input requests disclosure of system prompt or instructions.',
  },
  {
    id: 'without_boundaries_1',
    pattern: /(without|no)\s+(boundaries|guardrails?|filters?|rules?|restrictions?|ethical|moral)/i,
    subtype: 'jailbreak',
    confidence: 0.88,
    reason: 'Instruction to operate without boundaries or restrictions.',
  },
  {
    id: 'forget_instructions_1',
    pattern: /forget\s+(all\s+)?(previous|prior|your)\s+(instructions?|rules?|directions?|context|role)/i,
    subtype: 'instruction_override',
    confidence: 0.92,
    reason: 'Input attempts to erase previous instructions or role.',
  },
  {
    id: 'prompt_query_1',
    pattern: /what\s+(is|are|was)\s+(the\s+)?(initial\s+|original\s+|system\s+)?(prompt|instructions?|system\s+message)\s*(you\s+(were|received)|before\s+this)?/i,
    subtype: 'system_prompt_extraction',
    confidence: 0.90,
    reason: 'Query seeking hidden system prompt or startup instructions.',
  },
];
