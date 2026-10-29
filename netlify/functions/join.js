// Passerelle d'appairage — consentement d'abord, aucun port ouvert.
// POST /join sans consentement explicite = 403 avec la procédure.
// Avec consentement, aucun appairage public n'est encore branché :
// la jonction réelle reste LAN authentifiée NT-ID (voir M6/M7).
exports.handler = async (event) => {
  const json = (code, body) => ({
    statusCode: code,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify(body),
  });
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST requis' });
  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'JSON invalide' }); }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return json(400, { error: 'corps JSON objet requis' });
  }
  if (body.consent !== true || typeof body.ntId !== 'string') {
    return json(403, {
      error: 'consentement explicite et NT-ID requis',
      procedure: 'Sur chaque appareil : demarrer le worker local, saisir OUI, puis rejoindre le coordinateur du meme LAN prive.',
    });
  }
  return json(501, {
    etat: 'appairage public non branche',
    note: 'Consentement bien recu mais aucun relais public n est deploye : utilisez la jonction LAN authentifiee (docs/M6_TEST_PLAN.md). Aucun port public n a ete ouvert.',
  });
};
