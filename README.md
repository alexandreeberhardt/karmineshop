# Karmine Shop (site non officiel)

Page d'attente pour [karmineshop.fr](https://karmineshop.fr), un site communautaire
**non officiel**, ni affilié à la Karmine Corp ni approuvé par elle.

## Stack

- `server.js` : petit serveur HTTP Node.js (aucune dépendance) qui sert `public/`
  et expose `/health`.
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
