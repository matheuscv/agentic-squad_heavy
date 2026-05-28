import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export type Language =
  | 'nodejs'
  | 'python'
  | 'java'
  | 'go'
  | 'rust'
  | 'ruby'
  | 'php'
  | 'unknown';

export type StackInfo = {
  language: Language;
  buildTool: string;
  testFramework: string;
  testCommand: string;
  coverageCommand: string;
  coverageThreshold: number;
  detected: boolean;
  manifests: string[];
};

// ─── Manifests lidos do repositório ──────────────────────────────────────────

export const MANIFEST_FILES = [
  'package.json',
  'pyproject.toml',
  'setup.py',
  'requirements.txt',
  'pom.xml',
  'build.gradle.kts',
  'build.gradle',
  'go.mod',
  'Cargo.toml',
  'Gemfile',
  'composer.json',
] as const;

export type ManifestName = (typeof MANIFEST_FILES)[number];
export type ManifestMap = Record<ManifestName, string | null>;

// ─── Fallback sem detecção ────────────────────────────────────────────────────

const UNDETECTED: StackInfo = {
  language: 'unknown',
  buildTool: 'unknown',
  testFramework: 'unknown',
  testCommand: 'npm test',
  coverageCommand: 'npm run test:coverage',
  coverageThreshold: 80,
  detected: false,
  manifests: [],
};

// ─── Detectores por linguagem ─────────────────────────────────────────────────

interface PackageJson {
  packageManager?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export function detectNodeStack(
  pkgContent: string,
  lockfileHints: { hasYarnLock?: boolean; hasPnpmLock?: boolean } = {},
): Omit<StackInfo, 'manifests'> {
  let pkg: PackageJson;
  try {
    pkg = JSON.parse(pkgContent) as PackageJson;
  } catch {
    return { ...UNDETECTED, language: 'nodejs' };
  }

  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  const scripts = pkg.scripts ?? {};

  // ── Package manager ────────────────────────────────────────────────────────
  let buildTool = 'npm';
  if (pkg.packageManager?.startsWith('yarn') || lockfileHints.hasYarnLock) buildTool = 'yarn';
  else if (pkg.packageManager?.startsWith('pnpm') || lockfileHints.hasPnpmLock) buildTool = 'pnpm';
  else if (pkg.packageManager?.startsWith('bun')) buildTool = 'bun';

  const run = (s: string) =>
    buildTool === 'npm' ? `npm run ${s}` : `${buildTool} run ${s}`;
  const exec = (cmd: string) =>
    buildTool === 'npm' ? `npx ${cmd}` : buildTool === 'bun' ? `bunx ${cmd}` : `${buildTool} dlx ${cmd}`;

  // ── Test framework ─────────────────────────────────────────────────────────
  let testFramework = 'unknown';
  if ('vitest' in allDeps) testFramework = 'vitest';
  else if ('@jest/core' in allDeps || 'jest' in allDeps) testFramework = 'jest';
  else if ('mocha' in allDeps) testFramework = 'mocha';
  else if ('jasmine' in allDeps) testFramework = 'jasmine';
  else if ('ava' in allDeps) testFramework = 'ava';
  else if ('tap' in allDeps) testFramework = 'tap';

  // ── Test command ───────────────────────────────────────────────────────────
  const testCommand = scripts['test'] ? `${buildTool} test` : `${buildTool} test`;

  // ── Coverage command ───────────────────────────────────────────────────────
  let coverageCommand: string;
  if (scripts['test:coverage']) coverageCommand = run('test:coverage');
  else if (scripts['test:cov'])  coverageCommand = run('test:cov');
  else if (scripts['coverage'])  coverageCommand = run('coverage');
  else if (testFramework === 'vitest') coverageCommand = `${exec('vitest')} run --coverage`;
  else if (testFramework === 'jest')   coverageCommand = `${exec('jest')} --coverage`;
  else if (testFramework === 'mocha')  coverageCommand = `${exec('nyc')} ${buildTool} test`;
  else                                  coverageCommand = run('test:coverage');

  return {
    language: 'nodejs',
    buildTool,
    testFramework,
    testCommand,
    coverageCommand,
    coverageThreshold: 80,
    detected: true,
  };
}

export function detectPythonStack(
  pyprojectContent: string | null,
  hasSetupPy: boolean,
  hasRequirements: boolean,
): Omit<StackInfo, 'manifests'> {
  const src = pyprojectContent ?? '';

  // Build tool
  let buildTool = 'pip';
  if (src.includes('[tool.poetry]')) buildTool = 'poetry';
  else if (src.includes('[tool.hatch]')) buildTool = 'hatch';
  else if (src.includes('[tool.pdm]')) buildTool = 'pdm';

  // Test framework
  const testFramework =
    src.includes('pytest') || (!src && hasSetupPy) || hasRequirements
      ? 'pytest'
      : 'unittest';

  const prefix = buildTool === 'poetry' ? 'poetry run ' : buildTool === 'pdm' ? 'pdm run ' : '';
  const testCommand = `${prefix}pytest`;
  const coverageCommand = `${prefix}pytest --cov --cov-report=json`;

  return {
    language: 'python',
    buildTool,
    testFramework,
    testCommand,
    coverageCommand,
    coverageThreshold: 80,
    detected: true,
  };
}

export function detectJavaStack(
  hasPom: boolean,
  hasGradleKts: boolean,
  hasGradle: boolean,
): Omit<StackInfo, 'manifests'> {
  if (hasPom) {
    return {
      language: 'java',
      buildTool: 'maven',
      testFramework: 'junit',
      testCommand: 'mvn test',
      coverageCommand: 'mvn verify',
      coverageThreshold: 80,
      detected: true,
    };
  }
  // Prefere o wrapper local quando qualquer arquivo Gradle está presente
  const gradleWrapper = (hasGradleKts || hasGradle) && existsSync('gradlew') ? './gradlew' : 'gradle';
  return {
    language: 'java',
    buildTool: hasGradleKts ? 'gradle-kts' : 'gradle',
    testFramework: 'junit',
    testCommand: `${gradleWrapper} test`,
    coverageCommand: `${gradleWrapper} jacocoTestReport`,
    coverageThreshold: 80,
    detected: true,
  };
}

export function detectGoStack(): Omit<StackInfo, 'manifests'> {
  return {
    language: 'go',
    buildTool: 'go',
    testFramework: 'testing',
    testCommand: 'go test ./...',
    coverageCommand: 'go test -coverprofile=coverage.out ./... && go tool cover -func=coverage.out',
    coverageThreshold: 80,
    detected: true,
  };
}

export function detectRustStack(): Omit<StackInfo, 'manifests'> {
  return {
    language: 'rust',
    buildTool: 'cargo',
    testFramework: 'cargo-test',
    testCommand: 'cargo test',
    coverageCommand: 'cargo llvm-cov --json --output-path coverage.json',
    coverageThreshold: 80,
    detected: true,
  };
}

export function detectRubyStack(gemfileContent: string): Omit<StackInfo, 'manifests'> {
  const hasRspec = gemfileContent.includes('rspec');
  const hasMinitest = gemfileContent.includes('minitest');
  const framework = hasRspec ? 'rspec' : hasMinitest ? 'minitest' : 'rspec';
  return {
    language: 'ruby',
    buildTool: 'bundler',
    testFramework: framework,
    testCommand: hasRspec
      ? 'bundle exec rspec'
      : 'bundle exec ruby -Ilib:test test/**/*_test.rb',
    coverageCommand: hasRspec
      ? 'bundle exec rspec --format documentation'
      : 'bundle exec rake test',
    coverageThreshold: 80,
    detected: true,
  };
}

export function detectPhpStack(): Omit<StackInfo, 'manifests'> {
  return {
    language: 'php',
    buildTool: 'composer',
    testFramework: 'phpunit',
    testCommand: './vendor/bin/phpunit',
    coverageCommand: './vendor/bin/phpunit --coverage-json coverage.json',
    coverageThreshold: 80,
    detected: true,
  };
}

// ─── Núcleo de detecção (puro — sem I/O) ─────────────────────────────────────

export function detectFromManifests(
  contents: Partial<ManifestMap>,
  lockfileHints: { hasYarnLock?: boolean; hasPnpmLock?: boolean } = {},
): StackInfo {
  const manifests = (Object.entries(contents) as [ManifestName, string | null][])
    .filter(([, v]) => v !== null)
    .map(([k]) => k);

  // Prioridade: Node > Python > Java > Go > Rust > Ruby > PHP
  if (contents['package.json']) {
    return { ...detectNodeStack(contents['package.json']!, lockfileHints), manifests };
  }

  const hasPyproject  = !!contents['pyproject.toml'];
  const hasSetupPy    = !!contents['setup.py'];
  const hasReqs       = !!contents['requirements.txt'];
  if (hasPyproject || hasSetupPy || hasReqs) {
    return { ...detectPythonStack(contents['pyproject.toml'] ?? null, hasSetupPy, hasReqs), manifests };
  }

  const hasPom      = !!contents['pom.xml'];
  const hasGradleKts = !!contents['build.gradle.kts'];
  const hasGradle    = !!contents['build.gradle'];
  if (hasPom || hasGradleKts || hasGradle) {
    return { ...detectJavaStack(hasPom, hasGradleKts, hasGradle), manifests };
  }

  if (contents['go.mod'])      return { ...detectGoStack(),                                      manifests };
  if (contents['Cargo.toml'])  return { ...detectRustStack(),                                    manifests };
  if (contents['Gemfile'])     return { ...detectRubyStack(contents['Gemfile']!),                manifests };
  if (contents['composer.json']) return { ...detectPhpStack(),                                   manifests };

  return { ...UNDETECTED, manifests };
}

// ─── Leitor GitHub ────────────────────────────────────────────────────────────
//
// Requer process.env com GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY,
// GITHUB_APP_INSTALLATION_ID, GITHUB_OWNER, GITHUB_REPO populados.

export async function detectStackFromGitHub(branch?: string): Promise<StackInfo> {
  try {
    const { readFile } = await import('../github/client');

    // Lê todos os manifests em paralelo (null se inexistente)
    const entries = await Promise.all(
      MANIFEST_FILES.map(async (f) => [f, await readFile(f, branch)] as const),
    );

    // Lockfiles: verifica presença sem ler conteúdo
    const [yarnResult, pnpmResult] = await Promise.allSettled([
      readFile('yarn.lock', branch),
      readFile('pnpm-lock.yaml', branch),
    ]);

    return detectFromManifests(
      Object.fromEntries(entries) as Partial<ManifestMap>,
      {
        hasYarnLock: yarnResult.status === 'fulfilled' && yarnResult.value !== null,
        hasPnpmLock: pnpmResult.status === 'fulfilled' && pnpmResult.value !== null,
      },
    );
  } catch {
    return { ...UNDETECTED };
  }
}

// ─── Leitor local (filesystem) ────────────────────────────────────────────────

export function detectStackLocal(dir = process.cwd()): StackInfo {
  const read = (f: string): string | null => {
    const p = join(dir, f);
    return existsSync(p) ? readFileSync(p, 'utf-8') : null;
  };

  const entries = MANIFEST_FILES.map((f) => [f, read(f)] as const);

  return detectFromManifests(
    Object.fromEntries(entries) as Partial<ManifestMap>,
    {
      hasYarnLock: existsSync(join(dir, 'yarn.lock')),
      hasPnpmLock: existsSync(join(dir, 'pnpm-lock.yaml')),
    },
  );
}
