'use strict';

/**
 * Tests d'intégration M1 : vrais processus `snapmesh-node` sur loopback.
 * - pairs manuels (repli sans découverte),
 * - découverte LAN réelle (broadcast UDP, 3 nœuds, mesure du délai),
 * - kill brutal -> suspect -> dead -> redémarrage même identité,
 * - robustesse : trame poubelle sur TCP, le nœud survit.
 *
 * Aucun nœud simulé : chaque pair est un processus indépendant.
 */

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const BIN = path.join(__dirname, '..', 'bin', 'snapmesh-node.js');
const children = [];
after(() => {
  for (const c of children) {
    try {
      c.kill('SIGKILL');
    } catch {}
  }
});

const workdir = path.join(__dirname, '.tmp-int');
// Zone d'exécution des nœuds enfants (clés persistées) : dans le projet,
// car le Temp système est interdit par le sandbox.
fs.mkdirSync(workdir, { recursive: true });

const STATUS_GAP = 500; // statut loin des ports TCP (+100 réservé à l'usage réel)

function launch(name, tcpPort, extraArgs = []) {
  const child = spawn(process.execPath, [BIN, '--name', name, '--port', String(tcpPort), '--status-port', String(tcpPort + STATUS_GAP), ...extraArgs], {
    cwd: workdir,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  child.output = () => out;
  return child;
}

function status(statusPort) {
  return new Promise((resolve, reject) => {
    const req = require('node:http').get(`http://127.0.0.1:${statusPort}/status`, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(2000, () => req.destroy(new Error('status-timeout')));
  });
}

async function waitFor(fn, { timeoutMs = 15000, label = 'condition' } = {}) {
  const t0 = Date.now();
  for (;;) {
    try {
      const v = await fn();
      if (v) return { value: v, waitedMs: Date.now() - t0 };
    } catch {}
    if (Date.now() - t0 > timeoutMs) {
      throw new Error(`timeout (${timeoutMs} ms) : ${label}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

const P = (tcp) => tcp + STATUS_GAP;

// ---------- pairs manuels + kill + reconnexion ----------

test('pairs manuels : connexion, kill brutal, dead, reconnexion même identité', async () => {
  const A = 48111;
  const B = 48112;
  const a = launch('manuel-a', A, ['--no-discovery', '--quiet']);
  const b = launch('manuel-b', B, ['--no-discovery', '--quiet', '--peers', `127.0.0.1:${A}`]);
  void a;
  void b;

  // Connexion établie des deux côtés.
  await waitFor(async () => (await status(P(A))).peers.length === 1, { label: 'A voit B' });
  const sb = await waitFor(async () => {
    const s = await status(P(B));
    return s.peers.length === 1 ? s : null;
  }, { label: 'B voit A' });
  const idB = sb.value.self.id;
  assert.equal(sb.value.peers[0].state, 'connected');

  // Kill brutal (SIGKILL : pas de BYE) -> suspect puis dead côté A.
  b.kill('SIGKILL');
  const susp = await waitFor(async () => {
    const s = await status(P(A));
    return s.peers[0]?.state === 'suspect' ? s : null;
  }, { timeoutMs: 8000, label: 'A marque B suspect' });
  assert.ok(susp.waitedMs >= 2000, 'suspect trop rapide : suspicion non crédible');
  await waitFor(async () => (await status(P(A))).peers.length === 0, {
    timeoutMs: 10000,
    label: 'A déclare B dead',
  });
  const hist = (await status(P(A))).peers;
  assert.equal(hist.length, 0, 'un mort sort de la vue live');

  // Redémarrage avec le même fichier clé -> même identité, reconnexion.
  const b2 = launch('manuel-b', B, ['--no-discovery', '--quiet', '--peers', `127.0.0.1:${A}`]);
  void b2;
  const back = await waitFor(async () => {
    const s = await status(P(A));
    return s.peers.length === 1 && s.peers[0].state === 'connected' ? s : null;
  }, { timeoutMs: 12000, label: 'B reconnecté' });
  assert.equal(back.value.peers[0].id, idB, 'identité persistée après redémarrage');
});

// ---------- découverte LAN réelle ----------

test('découverte LAN : 3 nœuds se trouvent sans configuration', async () => {
  const ports = [48121, 48122, 48123];
  ports.forEach((p, i) => launch(`dec-${i}`, p, ['--quiet']));
  const t0 = Date.now();
  for (const p of ports) {
    await waitFor(async () => (await status(P(p))).peers.length === 2, {
      timeoutMs: 15000,
      label: `nœud ${p} voit 2 pairs`,
    });
  }
  const elapsed = Date.now() - t0;
  console.log(`    découverte 3 nœuds en ${elapsed} ms (objectif O1 < 10 000 ms)`);
  assert.ok(elapsed < 10000, `O1 manqué : ${elapsed} ms`);
});

// ---------- robustesse ----------

test('nt-id : défi de session réussi des deux côtés', async () => {
  const D = ['--discovery-port', '47861', '--no-discovery'];
  launch('sess-a', 48161, [...D, '--peers', '127.0.0.1:48162']);
  launch('sess-b', 48162, [...D, '--peers', '127.0.0.1:48161']);
  const both = await waitFor(async () => {
    const a = await status(P(48161));
    const b = await status(P(48162));
    const va = a.peers.length === 1 && a.peers[0].sessionVerified === true;
    const vb = b.peers.length === 1 && b.peers[0].sessionVerified === true;
    return va && vb ? true : null;
  }, { timeoutMs: 15000, label: 'sessions vérifiées mutuellement' });
  assert.ok(both);
});

test('nt-cap : profil signé visible et RTT estimé alimenté en live', async () => {
  const D = ['--discovery-port', '47863', '--no-discovery'];
  launch('cap-a', 48166, [...D, '--peers', '127.0.0.1:48167']);
  launch('cap-b', 48167, [...D, '--peers', '127.0.0.1:48166']);
  const s = await waitFor(async () => {
    const st = await status(P(48166));
    if (st.peers.length !== 1 || !st.peers[0].caps) return null;
    const p = st.peers[0];
    return p.caps.v === 2 && p.caps.net && typeof p.caps.net.rttMs === 'number' ? st : null;
  }, { timeoutMs: 15000, label: 'profil NT-CAP + RTT' });
  const c = s.value.peers[0].caps;
  assert.ok(c.cpu.threads >= 1);
  assert.equal(c.gpu.available, false, 'GPU non inventé');
  assert.ok(c.net.rttMs >= 0 && c.net.rttMs < 60000);
});

test('nt-id : auto-révocation -> pair déconnecté et rejointe refusée', async () => {
  const D = ['--discovery-port', '47862', '--no-discovery'];
  const keyB = 'data-rev-b.key';
  launch('rev-a', 48163, [...D, '--peers', '127.0.0.1:48164']);
  launch('rev-b', 48164, [...D, '--peers', '127.0.0.1:48163', '--key', `./${keyB}`]);
  await waitFor(async () => (await status(P(48163))).peers.length === 1, { label: 'A voit B' });
  // Même identité que B, en révocateur : prévient A puis quitte.
  launch('rev-evil', 48165, [...D, '--peers', '127.0.0.1:48163', '--key', `./${keyB}`, '--revoke', 'clé compromise']);
  await waitFor(async () => (await status(P(48163))).peers.length === 0, { timeoutMs: 12000, label: 'A a exclu B révoqué' });
  const hist = await status(P(48163));
  assert.equal(hist.peers.length, 0);
  // B d'origine tente de revenir : HELLO rejeté (révoqué).
  await new Promise((r) => setTimeout(r, 4000));
  const still = await status(P(48163));
  assert.equal(still.peers.length, 0, 'le révoqué ne rejoint plus');
});

test('robustesse : pair hostile (null, types, sig falsifiée, trame géante), le nœud survit', async () => {
  const N = 48141;
  launch('hostile-cible', N, ['--no-discovery', '--quiet', '--discovery-port', '47849']);
  await waitFor(async () => {
    await status(P(N));
    return true;
  }, { label: 'nœud démarré' });
  const net = require('node:net');
  const raw = (writes) =>
    new Promise((resolve) => {
      const done = () => resolve();
      const guard = setTimeout(() => {
        try { s.destroy(); } catch {}
        done(); // un stall échoue le test en aval, ne pend jamais
      }, 10000);
      if (guard.unref) guard.unref();
      const s = net.connect(N, '127.0.0.1', async () => {
        for (const w of writes) {
          try {
            if (s.destroyed) break; // le nœud a coupé : comportement attendu
            await new Promise((res, rej) => s.write(w, (e) => (e ? rej(e) : res())));
          } catch {
            break; // écriture sur socket fermé par le nœud : attendu
          }
          await new Promise((r) => setTimeout(r, 50));
        }
        setTimeout(() => s.destroy(), 200);
        s.on('close', () => {
          clearTimeout(guard);
          done();
        });
      });
      s.on('error', () => {}); // RST du nœud : attendu, pas une erreur de test
    });
  await raw(['null\n', '[1,2]\n', '42\n', '"str"\n', 'PAS-DU-JSON\n']);
  // HELLO à signature falsifiée (clé réelle, charge altérée après signature).
  const { Identity } = require('../src/identity');
  const { seal } = require('../src/protocol');
  const id = Identity.generate();
  const hello = seal(id, 'HELLO', { name: 'menteur' });
  hello.payload.name = 'usurpateur';
  await raw([JSON.stringify(hello) + '\n']);
  // Trame géante (2 Mo) : rejetée par la limite, connexion coupée.
  await raw([`{"a":"${'x'.repeat(2 * 1024 * 1024)}"}\n`]);
  await new Promise((r) => setTimeout(r, 500));
  const s = await status(P(N)); // le nœud répond toujours
  assert.equal(s.self.tcpPort, N);
  assert.ok(s.peers.every((p) => p.name !== 'menteur' && p.name !== 'usurpateur'));
});

test('robustesse : HELLO valide fragmenté (UTF-8 coupé) accepté et pair rattaché', async () => {
  const N = 48142;
  launch('frag-cible', N, ['--no-discovery', '--quiet', '--discovery-port', '47849']);
  await waitFor(async () => {
    await status(P(N));
    return true;
  }, { label: 'nœud démarré' });
  const { Identity } = require('../src/identity');
  const { seal } = require('../src/protocol');
  const id = Identity.generate();
  const hello = seal(id, 'HELLO', { name: 'frag-é', caps: {}, tcpPort: N });
  const raw = Buffer.from(JSON.stringify(hello) + '\n', 'utf8');
  const cut = raw.indexOf(Buffer.from([0xc3])) + 1; // milieu du 'é'
  const net = require('node:net');
  await new Promise((resolve) => {
    const s = net.connect(N, '127.0.0.1', () => {
      s.write(raw.slice(0, cut));
      setTimeout(() => {
        s.write(raw.slice(cut));
        setTimeout(() => s.destroy(), 300);
        s.on('close', resolve);
      }, 100);
    });
  });
  await new Promise((r) => setTimeout(r, 500));
  const s = await status(P(N));
  assert.ok(s.peers.some((p) => p.id === id.id), 'pair au nom accentué rattaché malgré fragmentation');
});

test('robustesse : trame poubelle sur TCP, le nœud survit', async () => {
  const N = 48131;
  launch('robuste', N, ['--no-discovery', '--quiet']);
  await waitFor(async () => {
    await status(P(N));
    return true;
  }, { label: 'nœud démarré' });
  const net = require('node:net');
  await new Promise((resolve) => {
    const s = net.connect(N, '127.0.0.1', () => {
      s.write('CECI N\'EST PAS DU JSON\n\x00\xff\n');
      setTimeout(() => s.destroy(), 200);
      s.on('close', resolve);
    });
  });
  await new Promise((r) => setTimeout(r, 500));
  const s = await status(P(N)); // le nœud répond toujours
  assert.equal(s.self.tcpPort, N);
});
