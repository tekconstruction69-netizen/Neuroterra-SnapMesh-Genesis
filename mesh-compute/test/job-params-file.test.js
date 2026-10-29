'use strict';

/**
 * M5 — régression "aucune ligne [job]" du test local réel (j1).
 * Cause démontrée : Start-Process (PS5.1, argv tableau) mange les
 * guillemets JSON nus -> `JSON.parse('{ns:...}')` lève
 * "Expected property name..." -> coordinateur mort avant [job].
 * Corrections : --job-params-file (aucun JSON en argv) + validation des
 * params AVANT tout socket (fail-fast). Ce test spawn le vrai CLI :
 *  - params fichier INVALIDE -> mort sur erreur JSON, AVANT listen
 *    (stdout sans "Noeud calcul", stderr JSON) ;
 *  - params fichier VALIDE -> le parse passe, mort PLUS LOIN (listen,
 *    EACCES en sandbox) : stderr SANS erreur JSON ;
 *  - preset inconnu -> exit 2 + [job-erreur].
 * Les trois sortent vite (main().catch), aucune pendaison.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const BIN = path.join(__dirname, '..', 'bin', 'compute-node.js');
const WORK = path.join(__dirname, '.tmp-m5params');

const FILES = ['good.json', 'bad.json', 'bom-good.json', 'empty.json', 'bom-args.json'];
before(() => {
  fs.mkdirSync(WORK, { recursive: true });
  fs.writeFileSync(path.join(WORK, 'good.json'), '{"ns":[20,25]}');
  fs.writeFileSync(path.join(WORK, 'bad.json'), '{ns:[20,25]}');
  // BOM UTF-8 réel : préfixe U+FEFF explicite (octets EF BB BF à
  // l'écriture). JSON valide derrière : doit être toléré (M5 j1).
  fs.writeFileSync(path.join(WORK, 'bom-good.json'), '﻿{"ns":[20,25]}');
  // Params manquants : objet valide mais sans ns.
  fs.writeFileSync(path.join(WORK, 'empty.json'), '{}');
  // BOM + args --submit valides.
  fs.writeFileSync(path.join(WORK, 'bom-args.json'), '﻿{"n":20}');
});
after(() => {
  for (const f of FILES) {
    try { fs.unlinkSync(path.join(WORK, f)); } catch {}
  }
});

function runCli(extra) {
  try {
    execFileSync('node', [BIN, '--ephemeral', '--no-discovery',
      '--port', '49901', '--status-port', '49902',
      ...extra], { cwd: WORK, timeout: 30000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { exit: 0, out: '', err: '' };
  } catch (e) {
    return { exit: e.status, out: String(e.stdout || ''), err: String(e.stderr || '') };
  }
}

test('params fichier invalide : erreur JSON avant tout socket', () => {
  const r = runCli(['--job', 'batch-fib', '--job-params-file', path.join(WORK, 'bad.json')]);
  assert.equal(r.exit, 1);
  assert.match(r.err, /JSON/, 'stderr doit signaler le JSON');
  assert.doesNotMatch(r.out, /Nœud calcul/, 'mort avant le demarrage reseau (fail-fast)');
});

test('params fichier valide : le parse passe, echec ulterieur (listen sandbox)', () => {
  const r = runCli(['--job', 'batch-fib', '--job-params-file', path.join(WORK, 'good.json')]);
  assert.equal(r.exit, 1);
  assert.doesNotMatch(r.err, /Expected property name|in JSON at position/, 'aucune erreur JSON');
  assert.match(r.err, /Démarrage impossible/, 'mort au demarrage (EACCES sandbox), pas au parse');
});

test('preset inconnu : exit 2 + [job-erreur]', () => {
  const r = runCli(['--job', 'nope', '--job-params-file', path.join(WORK, 'good.json')]);
  assert.equal(r.exit, 2);
  assert.match(r.err, /\[job-erreur\]/);
});

test('BOM UTF-8 + JSON valide : tolere, echec ulterieur (listen sandbox)', () => {
  const r = runCli(['--job', 'batch-fib', '--job-params-file', path.join(WORK, 'bom-good.json')]);
  assert.equal(r.exit, 1);
  assert.doesNotMatch(r.err, /Unexpected token|in JSON at position/, 'BOM tolere, aucune erreur JSON');
  assert.match(r.err, /Démarrage impossible/, 'mort au demarrage (EACCES sandbox), pas au parse');
});

test('BOM UTF-8 + JSON invalide : toujours rejete (jamais masque)', () => {
  const p = path.join(WORK, 'bom-bad.json');
  fs.writeFileSync(p, '﻿{ns:[1]}');
  try {
    const r = runCli(['--job', 'batch-fib', '--job-params-file', p]);
    assert.equal(r.exit, 1);
    assert.match(r.err, /JSON/, 'JSON invalide rejete meme avec BOM');
    assert.doesNotMatch(r.out, /Nœud calcul/, 'mort avant le demarrage reseau');
  } finally {
    try { fs.unlinkSync(p); } catch {}
  }
});

test('params manquants ({} sans ns) : refus motive avant socket', () => {
  const r = runCli(['--job', 'batch-fib', '--job-params-file', path.join(WORK, 'empty.json')]);
  assert.equal(r.exit, 1);
  assert.match(r.err, /ns non vide/, 'refus motive fail-fast');
  assert.doesNotMatch(r.out, /Nœud calcul/, 'mort avant le demarrage reseau');
});

test('--args-file avec BOM : tolere (mort ulterieure au listen sandbox)', () => {
  const r = runCli(['--submit', 'fib', '--args-file', path.join(WORK, 'bom-args.json')]);
  assert.equal(r.exit, 1);
  assert.doesNotMatch(r.err, /Unexpected token|in JSON at position/, 'BOM tolere sur --args-file');
});
