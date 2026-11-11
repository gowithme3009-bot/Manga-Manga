# Manga-Manga Studios

Studio éditorial manga et anime : veille multi-sources, classement des sujets, brouillons locaux et validation humaine.

## Statut actuel

Projet en construction sur la branche `manga-manga-v1-work`. La maquette historique est conservée dans `AutreTrend Studios — Vue d'ensemble.html`.

## Fonctions déjà amorcées

- Interface responsive en français.
- Radar RSS/Atom avec normalisation, dédoublonnage et score indicatif basé sur la fraîcheur et la couverture multi-sources.
- Brouillons enregistrés dans le navigateur, aperçu de publication et export JSON.
- Tests automatisés du collecteur.
- Workflow GitHub Actions de collecte uniquement.

## Sécurité et limites

- Aucun jeton Facebook ou clé IA dans le navigateur ou le dépôt.
- Aucun appel à l'API Facebook et aucune publication automatique.
- Les sources RSS sont désactivées par défaut. Renseigner uniquement des URL de flux officielles vérifiées dans `data/sources.json`, après vérification des conditions d'utilisation.
- Le score de tendance est un indicateur technique, pas une mesure officielle de popularité.
- Les brouillons restent dans le stockage local de l'appareil ; exporter régulièrement les brouillons pour les sauvegarder.
- L'IA reste désactivée tant qu'un endpoint sécurisé et ses limites d'usage n'ont pas été testés.

## Développement

Prérequis : Node.js 20 ou plus.

```sh
npm test
npm run check
npm run collect
```

## Les 7 chantiers

1. Inventaire et validation des ressources source.
2. Interface et navigation.
3. Radar RSS et classement des tendances.
4. Atelier éditorial, brouillons et aperçus.
5. Bibliothèque et gestion des sources.
6. Assistant IA sécurisé et facultatif.
7. Tests, diagnostics et documentation.

La fusion vers `main`, le déploiement de production et toute publication Facebook restent soumis à une validation explicite.
