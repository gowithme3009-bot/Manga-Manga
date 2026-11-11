# Suivi des 7 chantiers — Manga-Manga

Dernière mise à jour : 12 novembre 2026  
Branche : `manga-manga-v1-work`

## 1. Inventaire et ressources — EN COURS
- Les 8 images et le HTML de la maquette importée sont conservés.
- Le logo officiel est réutilisé tel quel dans l'interface.
- La bibliothèque contient aussi un ancien document HTML « les 41 fichiers » qui regroupe un projet plus ancien.
- **Décision de sécurité :** ne pas importer tel quel son workflow de publication Facebook. Cette ancienne architecture utilise l'API Meta et peut publier automatiquement ; le nouveau projet reste en publication manuelle.
- L'archive `ato.zip` elle-même n'a pas été retrouvée dans la bibliothèque consultable ; le contenu exact de l'archive originale reste à comparer.

## 2. Interface et navigation — PREMIÈRE VERSION
- Nouvelle entrée `index.html`, styles séparés et scripts séparés.
- Navigation : Vue d'ensemble, Radar, Atelier éditorial, Brouillons du jour, Médiathèque, Sources & réglages.
- Interface responsive avec logo original.
- La vérification visuelle complète sur téléphone reste à faire.

## 3. Radar RSS — PREMIÈRE VERSION OPÉRATIONNELLE
- 9 flux repris de la configuration V4 ; les 9 ont répondu correctement lors du dernier cycle de collecte.
- Le dernier cycle a recueilli 100 articles dans le radar (plafond de sortie configuré).
- Collecte RSS/Atom, liens HTTPS obligatoires, limite de taille en lecture, nettoyage HTML, classement par fraîcheur et couverture multi-sources.
- Résultats hors sujet du flux Google Actualités filtrés sur les mots-clés manga.
- La collecte est planifiée toutes les six heures et n'écrit que les fichiers de données sur cette branche.
- Les scores sont des indicateurs internes, pas une mesure officielle de popularité.

## 4. Atelier et brouillons — PREMIÈRE VERSION
- Jusqu'à 4 propositions affichées, avec un réservoir de remplaçants.
- Écarter une proposition fait apparaître la suivante.
- Les propositions automatiques sont limitées aux sources françaises pour éviter de présenter des résumés anglais comme des textes français.
- Si le flux ne fournit pas de résumé distinct, la proposition est marquée « à compléter ».
- Les brouillons personnels sont sauvegardés dans le navigateur, copiables et exportables en JSON.
- Aperçu Facebook local ; aucun envoi à Meta.

## 5. Médiathèque et sources — PREMIÈRE VERSION
- Galerie des visuels présents dans le dépôt avec liens de téléchargement.
- Liste des sources configurées et état de collecte.
- L'import de nouveaux fichiers et l'édition des sources depuis l'interface restent à développer.

## 6. Assistant IA — AIDE MANUELLE DISPONIBLE, WORKER NON CONNECTÉ
- Brief éditorial copiable vers ChatGPT (prioritaire) ou Gemini (repli manuel), avec consignes françaises et anti-invention.
- Aucun appel IA automatisé depuis le navigateur et aucune clé API côté client.
- L'intégration automatisée devra passer par un Worker sécurisé, avec limites, validation des entrées et repli propre.
- Ne pas déployer ni modifier un Worker existant sans vérifier son rôle et sans validation de l'utilisateur.
- Tant que ce point n'est pas fait, les textes restent extractifs et les traductions automatiques ne sont pas simulées.

## 7. Tests, diagnostics et documentation — EN COURS
- Tests Node.js pour le parsing RSS/Atom, le nettoyage des extraits, les limites réseau, le dédoublonnage et les propositions.
- GitHub Actions exécute les tests avant chaque collecte.
- Aucun déploiement GitHub Pages ou Cloudflare n'a été lancé.
- Étapes restantes : tests navigateur mobile/desktop, audit accessibilité, tests de persistance et vérification complète de tous les flux.

## Garde-fous
- `main` reste inchangée.
- L'ancien dépôt AutreTrend Studios reste inchangé.
- Aucun workflow de publication Facebook automatique n'est ajouté.
- Pas de fusion, de déploiement de production ni de publication sociale sans autorisation explicite.
