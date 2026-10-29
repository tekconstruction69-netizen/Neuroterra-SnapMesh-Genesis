'use strict';

/**
 * P1 — vérificateur d'export public (aucune publication effectuée).
 * Signale tout ce qui ne doit JAMAIS partir : clés (.key hors dossiers
 * temporaires de tests), .env, venv et node_modules versionnables,
 * motifs de secrets dans les sources et journaux. Exit 1 si violation.
 * Usage : node scripts/check-export-public.js
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.venv', '.git', '.tmp-int', '.tmp-unit']);
const SECRET_PATTERNS = [
  /MUSE_API_KEY\s*=\s*["']?[A-Za-z0-9-_]{8,}/,
  /api[_-]?key\s*[:=]\s*["']?[A-Za-z0-9-_]{12,}/i,
  /-----BEGIN (PRIVATE KEY|RSA PRIVATE KEY|EC PRIVATE KEY|OPENSSH PRIVATE KEY)-----/,
  /x-genesis-token["']?\s*[:=]\s*["']?[0-9a-f]{32,}/i,
];

const violations = [];

function walk(dir, rel) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.tmp-')) continue;
      walk(full, r);
      continue;
    }
    // Clés hors répertoires temporaires de tests.
    if (e.name.endsWith('.key') && !rel.split('/').some((p) => p.startsWith('.tmp-'))) {
      violations.push(`clé exposée : ${r}`);
      continue;
    }
    if (e.name === '.env' || e.name.endsWith('.env')) {
      violations.push(`fichier env : ${r}`);
      continue;
    }
    // Contenu : sources, docs, scripts, journaux versionnables.
    if (/\.(js|json|md|ps1|txt|html)$/.test(e.name) && !r.startsWith('bench-logs/validation-') && !r.startsWith('bench-logs/nt')) {
      let s;
      try {
        s = fs.readFileSync(full, 'utf8');
      } catch {
        continue;
      }
      // Ligne à ligne : les placeholders évidents (tests/docs) ne
      // sont jamais des secrets, les autres lignes restent scannées.
      const lines = s.split('\n');
      for (const pat of SECRET_PATTERNS) {
        const hit = lines.some(
          (ln) => pat.test(ln) && !/factice|placeholder|changeme|example|travis|xxx|test-cle|cle-test/i.test(ln)
        );
        if (hit) {
          violations.push(`motif secret (${pat.source.slice(0, 30)}…) : ${r}`);
          break;
        }
      }
    }
  }
}

// Journaux de validation versionnables : scan ciblé (même règle ligne).
for (const f of fs.readdirSync(path.join(ROOT, 'bench-logs'))) {
  if (!/\.log\.txt$/.test(f)) continue;
  const s = fs.readFileSync(path.join(ROOT, 'bench-logs', f), 'utf8');
  const lines = s.split('\n');
  for (const pat of SECRET_PATTERNS) {
    const hit = lines.some(
      (ln) => pat.test(ln) && !/factice|placeholder|changeme|example|travis|xxx|test-cle|cle-test/i.test(ln)
    );
    if (hit) {
      violations.push(`motif secret dans journal : bench-logs/${f}`);
      break;
    }
  }
}

walk(ROOT, '');

// Garde-fou .gitignore : ces motifs doivent y figurer.
const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
for (const must of ['*.key', 'node_modules/', '.venv/', '.env']) {
  if (!gi.includes(must)) violations.push(`.gitignore incomplet : manque ${must}`);
}

if (violations.length) {
  console.log(`EXPORT NON PROPRE : ${violations.length} violation(s)`);
  for (const v of violations) console.log(` - ${v}`);
  process.exit(1);
} else {
  console.log('EXPORT PROPRE : aucune clé, env, dépendance ou secret détecté (hors .tmp, node_modules, .venv).');
}
