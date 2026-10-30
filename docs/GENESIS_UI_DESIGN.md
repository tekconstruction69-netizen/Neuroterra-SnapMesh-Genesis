# GENESIS — Référence design UI

> Référence : `Image ChatGPT 29 oct. 2026, 21_26_45.png` (racine, PNG le
> plus récent du dépôt). Tout ce qui suit en découle ; rien n'est simulé.

## Direction artistique

Nuit bleu nuit presque noire, profondeur par halos radiaux, néons
émeraude/turquoise/bleu/violet, accents dorés rares (valeur, alertes
douces). Puce 3D centrale lumineuse entourée d'orbites de ressources.
Interface mobile d'abord (pleine largeur, cartes 2×2), respirant sur PC
(max 1060 px, cartes 4 colonnes). Zéro texte technique sur l'accueil.

## Palette

- Fond `--bg: #04070f`, panneaux `#0a1424` → `#0d1b31`, lignes `#1d3a5f`.
- Émeraude `#2fe89a` (action principale, CPU), turquoise `#2fd8e8`
  (information, liens), bleu `#3f8cff` (mémoire/réseau), violet `#9a6bff`
  (thermique), or `#f2c14e` (valeur rare, badges), danger `#ff5d73`
  (STOP uniquement). Texte `#eaf4ff`, secondaire `#9db4d0`.

## Typographie

Pile système (`Segoe UI`, système, Apple) : lisible partout, aucun
chargement. Hiérarchie : titre page 1,35 rem, carte 0,92/1,02 rem,
notes 0,88 rem en secondaire.

## Composants

- **CTA principal** : pilule pleine largeur, dégradé émeraude→turquoise,
  halo vert, icône cadre-scan à gauche, chevron à droite, texte blanc
  épais. Variante STOP : dégradé rouge. Secondaire : même forme, plus
  petit, fond uni sombre.
- **Cartes ressources** : coins arrondis, bordure teintée par ressource
  (CPU vert, GPU or, mémoire bleu, thermique violet), icône en haut à
  gauche, valeur lisible, courbe discrète en bas, badge d'étiquette
  (Détecté/Mesuré/Estimé/Non disponible). Verrouillées : valeurs floutées
  + cadenas centré, jamais de fausse valeur.
- **Navigation** : barre basse fixe, 3 onglets (Accueil, Vision, Mon
  appareil). Wallet, Invest et la page « Plus » sont masqués de la barre
  mais leur code reste dans le projet pour intégration ultérieure.
- **États** : analyse (bouton → progression textuelle), prêt (cartes
  déverrouillées + DÉMARRER), actif/contribution (animations coupées),
  pause protection (libellé + raison), stop (état + raison), indisponible
  (texte exact, jamais de simulation).
- **Réglages** : commutateurs natifs, curseur batterie 10–100 % (défaut
  25 %), listes déroulantes pour bornes, préférences persistées localement.

## Mobile / desktop

Mobile : cartes 2 colonnes, barre basse avec zone sûre iOS, cible
tactile ≥ 40 px. Desktop : cartes 4 colonnes, puce agrandie, contenu
centré. PWA : manifeste + icônes réels ; iOS = premier plan seulement.

## Règles de simplicité

Parcours en 5 temps : autoriser → analyser → résultats utiles → mode →
démarrer/arrêter. Accueil : aucun JSON, aucun journal, aucun identifiant
long, aucun paramètre de calcul, aucune description de protocole. Tout le
technique vit dans « Diagnostics avancés » et « Mon appareil ».
Masquer : Wallet/Invest (barre), valeurs non mesurées (remplacées par
« Non disponible »). Réduire : textes d'aide à une ligne. Supprimer :
rien de fonctionnel.
## État au 2026-10-29
- Changé : CTA pilule lumineuse avec icône et chevron, cartes verrouillées
  floutées à accents par ressource, analyse devenant relance secondaire,
  Vision enrichie du texte officiel (IA verte, ressources dormantes).
- Onglets : Accueil, Vision, Mon appareil (tableau + Mon compte et
  réglages fusionnés). Masqués sans suppression : Wallet, Invest, Plus
  (dont Récompenses « Bientôt disponible »).
- Pages provisoires : Plus (contenus d'attente honnêtes), Diagnostics
  avancés (technique repliée, conservée pour le hackathon).
- Reste à faire : validation locale cliquée, test sur 2 PC, test iPhone,
  puis seulement publication (ordre validé : design → local → 2 PC →
  iPhone → publication).
