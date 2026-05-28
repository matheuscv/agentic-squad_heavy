import { describe, it, expect } from 'vitest';
import {
  detectFromManifests,
  detectNodeStack,
  detectPythonStack,
  detectJavaStack,
  detectGoStack,
  detectRustStack,
  detectRubyStack,
  detectPhpStack,
} from './stack-detector';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const PKG_VITEST = JSON.stringify({
  scripts: { test: 'vitest run', 'test:coverage': 'vitest run --coverage' },
  devDependencies: { vitest: '^3.0.0', '@vitest/coverage-v8': '^3.0.0' },
});

const PKG_JEST = JSON.stringify({
  scripts: { test: 'jest', 'test:coverage': 'jest --coverage' },
  devDependencies: { jest: '^29.0.0', '@types/jest': '^29.0.0' },
});

const PKG_MOCHA = JSON.stringify({
  scripts: { test: 'mocha', coverage: 'nyc mocha' },
  devDependencies: { mocha: '^10.0.0', nyc: '^15.0.0' },
});

const PKG_YARN = JSON.stringify({
  packageManager: 'yarn@4.0.0',
  scripts: { test: 'vitest run' },
  devDependencies: { vitest: '^3.0.0' },
});

const PKG_PNPM = JSON.stringify({
  packageManager: 'pnpm@9.0.0',
  scripts: { test: 'jest', 'test:cov': 'jest --coverage' },
  devDependencies: { jest: '^29.0.0' },
});

const PKG_PLAIN = JSON.stringify({
  scripts: { test: 'node test.js' },
});

const PYPROJECT_POETRY = `
[tool.poetry]
name = "my-app"
version = "1.0.0"

[tool.poetry.dev-dependencies]
pytest = "^7.0"
pytest-cov = "^4.0"

[tool.pytest.ini_options]
testpaths = ["tests"]
`;

const PYPROJECT_PDM = `
[project]
name = "my-app"

[tool.pdm]
python = "3.11"

[tool.pytest.ini_options]
testpaths = ["tests"]
`;

const PYPROJECT_PLAIN = `
[build-system]
requires = ["setuptools"]
`;

const GEMFILE_RSPEC = `
source "https://rubygems.org"
gem "rails"
gem "rspec-rails", group: :test
`;

const GEMFILE_MINITEST = `
source "https://rubygems.org"
gem "rails"
gem "minitest", group: :test
`;

// ─── Node.js ──────────────────────────────────────────────────────────────────

describe('detectNodeStack', () => {
  it('detecta vitest + npm + coverage script existente', () => {
    const r = detectNodeStack(PKG_VITEST);
    expect(r.language).toBe('nodejs');
    expect(r.buildTool).toBe('npm');
    expect(r.testFramework).toBe('vitest');
    expect(r.testCommand).toBe('npm test');
    expect(r.coverageCommand).toBe('npm run test:coverage');
  });

  it('detecta jest + npm', () => {
    const r = detectNodeStack(PKG_JEST);
    expect(r.testFramework).toBe('jest');
    expect(r.coverageCommand).toBe('npm run test:coverage');
  });

  it('detecta mocha e infere coverage com nyc', () => {
    const r = detectNodeStack(PKG_MOCHA);
    expect(r.testFramework).toBe('mocha');
    expect(r.coverageCommand).toBe('npm run coverage');
  });

  it('detecta yarn via packageManager', () => {
    const r = detectNodeStack(PKG_YARN);
    expect(r.buildTool).toBe('yarn');
    expect(r.testCommand).toBe('yarn test');
    expect(r.coverageCommand).toContain('vitest');
  });

  it('detecta pnpm e usa test:cov', () => {
    const r = detectNodeStack(PKG_PNPM);
    expect(r.buildTool).toBe('pnpm');
    expect(r.coverageCommand).toBe('pnpm run test:cov');
  });

  it('detecta yarn via lockfile hint (sem packageManager)', () => {
    const r = detectNodeStack(PKG_PLAIN, { hasYarnLock: true });
    expect(r.buildTool).toBe('yarn');
  });

  it('detecta pnpm via lockfile hint', () => {
    const r = detectNodeStack(PKG_PLAIN, { hasPnpmLock: true });
    expect(r.buildTool).toBe('pnpm');
  });

  it('infere cobertura do vitest quando não há script', () => {
    const pkg = JSON.stringify({ devDependencies: { vitest: '^3.0.0' } });
    const r = detectNodeStack(pkg);
    expect(r.testFramework).toBe('vitest');
    expect(r.coverageCommand).toContain('--coverage');
  });

  it('infere cobertura do jest quando não há script', () => {
    const pkg = JSON.stringify({ devDependencies: { jest: '^29.0.0' } });
    const r = detectNodeStack(pkg);
    expect(r.coverageCommand).toContain('jest');
    expect(r.coverageCommand).toContain('--coverage');
  });

  it('retorna detected=false para JSON inválido', () => {
    const r = detectNodeStack('não é json');
    expect(r.detected).toBe(false);
    expect(r.language).toBe('nodejs');
  });
});

// ─── Python ───────────────────────────────────────────────────────────────────

describe('detectPythonStack', () => {
  it('detecta poetry + pytest via pyproject.toml', () => {
    const r = detectPythonStack(PYPROJECT_POETRY, false, false);
    expect(r.language).toBe('python');
    expect(r.buildTool).toBe('poetry');
    expect(r.testFramework).toBe('pytest');
    expect(r.testCommand).toBe('poetry run pytest');
    expect(r.coverageCommand).toContain('poetry run pytest --cov');
  });

  it('detecta pdm via pyproject.toml', () => {
    const r = detectPythonStack(PYPROJECT_PDM, false, false);
    expect(r.buildTool).toBe('pdm');
    expect(r.testCommand).toBe('pdm run pytest');
  });

  it('detecta pip via pyproject.toml sem ferramenta específica', () => {
    const r = detectPythonStack(PYPROJECT_PLAIN, false, false);
    expect(r.buildTool).toBe('pip');
    expect(r.testCommand).toBe('pytest');
  });

  it('detecta pip via setup.py', () => {
    const r = detectPythonStack(null, true, false);
    expect(r.language).toBe('python');
    expect(r.testFramework).toBe('pytest');
    expect(r.testCommand).toBe('pytest');
  });

  it('detecta pip via requirements.txt', () => {
    const r = detectPythonStack(null, false, true);
    expect(r.language).toBe('python');
    expect(r.detected).toBe(true);
  });
});

// ─── Java ─────────────────────────────────────────────────────────────────────

describe('detectJavaStack', () => {
  it('detecta Maven via pom.xml', () => {
    const r = detectJavaStack(true, false, false);
    expect(r.language).toBe('java');
    expect(r.buildTool).toBe('maven');
    expect(r.testCommand).toBe('mvn test');
    expect(r.coverageCommand).toBe('mvn verify');
  });

  it('detecta Gradle via build.gradle', () => {
    const r = detectJavaStack(false, false, true);
    expect(r.buildTool).toBe('gradle');
    expect(r.testCommand).toContain('test');
    expect(r.coverageCommand).toContain('jacocoTestReport');
  });

  it('detecta Gradle Kotlin DSL via build.gradle.kts', () => {
    const r = detectJavaStack(false, true, false);
    expect(r.buildTool).toBe('gradle-kts');
  });

  it('Maven tem prioridade sobre Gradle quando ambos presentes', () => {
    const r = detectJavaStack(true, false, true);
    expect(r.buildTool).toBe('maven');
  });
});

// ─── Go / Rust / Ruby / PHP ───────────────────────────────────────────────────

describe('detectGoStack', () => {
  it('retorna comandos corretos', () => {
    const r = detectGoStack();
    expect(r.language).toBe('go');
    expect(r.testCommand).toBe('go test ./...');
    expect(r.coverageCommand).toContain('coverprofile');
  });
});

describe('detectRustStack', () => {
  it('retorna comandos corretos', () => {
    const r = detectRustStack();
    expect(r.language).toBe('rust');
    expect(r.testCommand).toBe('cargo test');
    expect(r.coverageCommand).toContain('llvm-cov');
  });
});

describe('detectRubyStack', () => {
  it('detecta rspec', () => {
    const r = detectRubyStack(GEMFILE_RSPEC);
    expect(r.language).toBe('ruby');
    expect(r.testFramework).toBe('rspec');
    expect(r.testCommand).toContain('rspec');
  });

  it('detecta minitest', () => {
    const r = detectRubyStack(GEMFILE_MINITEST);
    expect(r.testFramework).toBe('minitest');
    expect(r.testCommand).not.toContain('rspec');
  });

  it('usa rspec como padrão quando não há indicadores', () => {
    const r = detectRubyStack('source "https://rubygems.org"');
    expect(r.testFramework).toBe('rspec');
  });
});

describe('detectPhpStack', () => {
  it('retorna phpunit', () => {
    const r = detectPhpStack();
    expect(r.language).toBe('php');
    expect(r.testFramework).toBe('phpunit');
    expect(r.testCommand).toContain('phpunit');
  });
});

// ─── detectFromManifests (integração dos detectores) ─────────────────────────

describe('detectFromManifests', () => {
  it('Node tem prioridade máxima', () => {
    const r = detectFromManifests({
      'package.json': PKG_VITEST,
      'pyproject.toml': PYPROJECT_POETRY,
      'pom.xml': '<project/>',
    });
    expect(r.language).toBe('nodejs');
    expect(r.detected).toBe(true);
    expect(r.manifests).toContain('package.json');
    expect(r.manifests).toContain('pyproject.toml');
  });

  it('Python quando não há package.json', () => {
    const r = detectFromManifests({ 'pyproject.toml': PYPROJECT_POETRY });
    expect(r.language).toBe('python');
  });

  it('Java/Maven quando não há Node nem Python', () => {
    const r = detectFromManifests({ 'pom.xml': '<project/>' });
    expect(r.language).toBe('java');
    expect(r.buildTool).toBe('maven');
  });

  it('Go quando apenas go.mod presente', () => {
    const r = detectFromManifests({ 'go.mod': 'module github.com/org/repo\ngo 1.22' });
    expect(r.language).toBe('go');
  });

  it('Rust quando apenas Cargo.toml presente', () => {
    const r = detectFromManifests({ 'Cargo.toml': '[package]\nname = "app"' });
    expect(r.language).toBe('rust');
  });

  it('Ruby quando apenas Gemfile presente', () => {
    const r = detectFromManifests({ 'Gemfile': GEMFILE_RSPEC });
    expect(r.language).toBe('ruby');
  });

  it('PHP quando apenas composer.json presente', () => {
    const r = detectFromManifests({ 'composer.json': '{}' });
    expect(r.language).toBe('php');
  });

  it('retorna detected=false quando nenhum manifesto reconhecido', () => {
    const r = detectFromManifests({});
    expect(r.detected).toBe(false);
    expect(r.language).toBe('unknown');
    expect(r.manifests).toHaveLength(0);
  });

  it('inclui todos os manifests encontrados na resposta', () => {
    const r = detectFromManifests({
      'package.json': PKG_VITEST,
      'go.mod': 'module x\ngo 1.22',
    });
    expect(r.manifests).toContain('package.json');
    expect(r.manifests).toContain('go.mod');
    expect(r.manifests).toHaveLength(2);
  });

  it('ignora manifests com valor null (arquivo ausente)', () => {
    const r = detectFromManifests({
      'package.json': null,
      'go.mod': 'module x\ngo 1.22',
    });
    expect(r.language).toBe('go');
    expect(r.manifests).not.toContain('package.json');
  });

  it('aplica lockfile hint para detecção de yarn', () => {
    const r = detectFromManifests(
      { 'package.json': PKG_PLAIN },
      { hasYarnLock: true },
    );
    expect(r.buildTool).toBe('yarn');
  });

  it('todos os campos obrigatórios estão presentes', () => {
    const r = detectFromManifests({ 'package.json': PKG_JEST });
    expect(r).toHaveProperty('language');
    expect(r).toHaveProperty('buildTool');
    expect(r).toHaveProperty('testFramework');
    expect(r).toHaveProperty('testCommand');
    expect(r).toHaveProperty('coverageCommand');
    expect(r).toHaveProperty('coverageThreshold');
    expect(r).toHaveProperty('detected');
    expect(r).toHaveProperty('manifests');
  });

  it('coverageThreshold é sempre um número entre 0 e 100', () => {
    const stacks = [
      { 'package.json': PKG_VITEST },
      { 'pyproject.toml': PYPROJECT_POETRY },
      { 'pom.xml': '<project/>' },
      { 'go.mod': 'module x' },
      { 'Cargo.toml': '[package]' },
      { 'Gemfile': GEMFILE_RSPEC },
    ];
    for (const manifests of stacks) {
      const r = detectFromManifests(manifests);
      expect(r.coverageThreshold).toBeGreaterThanOrEqual(0);
      expect(r.coverageThreshold).toBeLessThanOrEqual(100);
    }
  });
});
