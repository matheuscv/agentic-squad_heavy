import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: ['src/db/migrations/**', '**/*.test.ts'],
      thresholds: {
        // Cobertura mínima exigida pelo DoD da Fase 1 para a máquina de estados
        'src/orchestrator/state-machine.ts': {
          statements: 80,
          branches: 80,
          functions: 80,
          lines: 80,
        },
      },
    },
  },
});
