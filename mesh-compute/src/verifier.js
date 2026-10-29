'use strict';

/**
 * Vérificateur : décide du résultat d'une tâche à partir des RESULT reçus.
 *
 * Règle : redondance 1 -> re-calcul local (vérification indépendante) ;
 * redondance n ≥ 2 -> accord d'au moins ceil(2n/3) exécutants (quorum 2/3
 * pour n = 3). Les dissidents sont SIGNALÉS (fraude suspectée), jamais
 * exclus automatiquement du réseau en M2.
 *
 * AVERTISSEMENT HONNÊTE : un accord 2/3 détecte les fautes aléatoires et
 * un menteur isolé, mais ne prouve pas cryptographiquement l'exactitude
 * du calcul et ne résiste pas à des nœuds collusifs majoritaires.
 */

function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Seuil d'accord : ceil(2n/3), soit 2 pour n = 3. */
function quorumThreshold(n) {
  return Math.ceil((2 * n) / 3);
}

/**
 * @param {Array<{executorId:string,result:any}>} results reçus (dédupliqués)
 * @param {number} redundancy redondance demandée
 * @returns {{outcome:'agreed'|'disagree'|'insufficient', value:any,
 *            agreeing:string[], dissenting:string[], needed:number}}
 */
function decide(results, redundancy) {
  const needed = redundancy >= 2 ? quorumThreshold(redundancy) : 1;
  if (!results.length) {
    return { outcome: 'insufficient', value: null, agreeing: [], dissenting: [], needed };
  }
  // Groupe majoritaire : valeur portée par le plus d'exécutants.
  const groups = new Map(); // json -> {value, ids}
  for (const r of results) {
    const k = JSON.stringify(r.result);
    if (!groups.has(k)) groups.set(k, { value: r.result, ids: [] });
    groups.get(k).ids.push(r.executorId);
  }
  const best = [...groups.values()].sort((a, b) => b.ids.length - a.ids.length)[0];
  const agreeing = best.ids;
  const dissenting = results.map((r) => r.executorId).filter((id) => !agreeing.includes(id));
  if (agreeing.length >= needed) {
    return { outcome: 'agreed', value: best.value, agreeing, dissenting, needed };
  }
  return { outcome: results.length >= redundancy ? 'disagree' : 'insufficient',
    value: null, agreeing, dissenting, needed };
}

module.exports = { decide, quorumThreshold, same };
