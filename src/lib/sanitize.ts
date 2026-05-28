// Padrões de prompt injection conhecidos — substitui por [REDACTED] antes de passar ao LLM.

const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(previous|prior|above|all)\s+instructions?/gi,
  /disregard\s+(previous|prior|above|all)\s+instructions?/gi,
  /<\s*\/?\s*(system|assistant|human)\s*>/gi,
  /\[INST\]|\[\/INST\]/gi,
  /<<SYS>>|<\/SYS>/gi,
  /\bpretend\s+(you\s+are|to\s+be)\b/gi,
  /\byou\s+are\s+now\b/gi,
];

const MAX_CHARS = 10_000;

export function sanitizeForLlm(input: string): string {
  if (typeof input !== 'string') return '';
  let s = input;
  for (const p of INJECTION_PATTERNS) {
    s = s.replace(p, '[REDACTED]');
  }
  if (s.length > MAX_CHARS) {
    s = s.slice(0, MAX_CHARS) + '\n\n[... truncado — input excedeu limite de segurança ...]';
  }
  return s;
}
