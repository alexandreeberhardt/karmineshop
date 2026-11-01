# Karmine Shop (site non officiel)

Vitrine des créations de la communauté Karmine Corp (concepts de maillots, bracelets,
accessoires, visuels) pour [karmineshop.fr](https://karmineshop.fr), un site communautaire
**non officiel**, ni affilié à la Karmine Corp ni approuvé par elle.

Chaque visiteur peut liker une fois chaque création, sans compte.

## Stack

- `server.js` : petit serveur HTTP Node.js (aucune dépendance) qui sert `public/`,
  expose `/health` et l'API des likes :
  - `GET /api/creations` : les créations avec leur nombre de likes ;
  - `POST /api/creations/:id/like` / `DELETE …` : liker / retirer son like.
- `data/creations.json` : la liste des créations (images hébergées par X, lien vers le
  post original). Pour ajouter une création, ajouter une entrée puis redéployer.
- `likes.js` : stockage des likes dans `var/likes.json` (volume Docker
  `karmineshop-data`).

### Comment marche « un like par création, sans compte »

- Au premier like, le serveur pose un cookie anonyme `kc_voter` (HttpOnly, 400 jours).
  Le serveur ne stocke qu'un hash salé de cet identifiant, par création.
- Pour limiter la triche (navigation privée, cookies effacés), une même adresse IP
  ne peut pas compter plus de 5 likes sur une même création, et pas plus de
  30 likes/unlikes par minute. Les IP ne sont stockées que hashées.
- Les requêtes de like venant d'un autre site sont refusées (anti-CSRF).
- Le sel est lu dans `LIKES_SECRET`, sinon généré dans `var/secret` au premier lancement.
- `Dockerfile` / `docker-compose.yml` : conteneur `node:24-slim`, publié sur
  `127.0.0.1:${HOST_PORT:-8116}`.

## Lancer en local

```sh
npm start                      # http://localhost:3000
# ou
docker compose up --build      # http://127.0.0.1:8116
```

## Déploiement

1. `cp deploy.env.example deploy.env` puis renseigner `CERTBOT_EMAIL` et `SERVER_IP`.
2. Premier déploiement (Docker + vhost nginx + certificat Let's Encrypt) :
   `sudo ./deploy-karmineshop.sh`
3. Mises à jour du contenu (rebuild du conteneur uniquement) : `./redeploy.sh`
