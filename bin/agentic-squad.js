#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const subcommand = process.argv[2];
const rest = process.argv.slice(3);

const tsx = path.resolve(__dirname, '..', 'node_modules', '.bin', 'tsx');

const COMMANDS = {
  init:      path.resolve(__dirname, '..', 'scripts', 'init.ts'),
  changelog: path.resolve(__dirname, '..', 'scripts', 'changelog.ts'),
  migrate:   path.resolve(__dirname, '..', 'scripts', 'migrate.ts'),
};

if (!subcommand || subcommand === '--help' || subcommand === '-h') {
  console.log(`
agentic-squad — Squad 100% Agêntica

Uso:
  agentic-squad init            Wizard de configuração interativo
  agentic-squad changelog       Gera CHANGELOG.md com base nos commits
  agentic-squad migrate <cmd>   Controle de migrações de schema

Exemplos:
  agentic-squad init
  agentic-squad changelog --dry-run
  agentic-squad migrate status
  agentic-squad migrate run
`);
  process.exit(0);
}

const script = COMMANDS[subcommand];

if (!script) {
  console.error(`Subcomando desconhecido: "${subcommand}"`);
  console.error('Use "agentic-squad --help" para ver os comandos disponíveis.');
  process.exit(1);
}

const result = spawnSync(tsx, [script, ...rest], { stdio: 'inherit' });
process.exit(result.status ?? 0);
