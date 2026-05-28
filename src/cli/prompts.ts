import { createInterface } from 'readline/promises';
import { stdin, stdout } from 'process';

let _rl: ReturnType<typeof createInterface> | null = null;

function rl() {
  if (!_rl) _rl = createInterface({ input: stdin, output: stdout });
  return _rl;
}

export function closePrompts(): void {
  _rl?.close();
  _rl = null;
}

export async function ask(label: string, defaultVal = ''): Promise<string> {
  const hint = defaultVal ? ` [${defaultVal}]` : '';
  const answer = await rl().question(`  ${label}${hint}: `);
  return answer.trim() || defaultVal;
}

export async function confirm(label: string, defaultYes = true): Promise<boolean> {
  const hint = defaultYes ? '(Y/n)' : '(y/N)';
  const answer = await rl().question(`  ${label} ${hint}: `);
  const v = answer.trim().toLowerCase();
  return v === '' ? defaultYes : v === 'y' || v === 'yes';
}

// ─── Output helpers ───────────────────────────────────────────────────────────

export const print = (msg: string) => process.stdout.write(msg + '\n');

export function step(n: number, total: number, msg: string): void {
  process.stdout.write(`\n[${n}/${total}] ${msg}\n`);
}

export const ok   = (msg: string) => process.stdout.write(`  ✓ ${msg}\n`);
export const fail = (msg: string) => process.stdout.write(`  ✗ ${msg}\n`);
export const warn = (msg: string) => process.stdout.write(`  ! ${msg}\n`);
export const info = (msg: string) => process.stdout.write(`    ${msg}\n`);
