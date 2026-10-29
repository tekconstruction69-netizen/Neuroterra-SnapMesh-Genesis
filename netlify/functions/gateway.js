// Passerelle Netlify — API HTTPS courte, sans secret, sans état.
// Ne publie aucun nœud réel tant qu'aucun service de coordination
// authentifié n'est branché : la réponse le dit explicitement.
exports.handler = async () => ({
  statusCode: 200,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify({
    service: 'snapmesh-gateway', scope: 'demonstration-statique',
    nodesLive: null, note: 'Aucun service de coordination public branché : aucun nœud réel affiché. Voir docs/M7_RAPPORT.md.',
  }),
});
