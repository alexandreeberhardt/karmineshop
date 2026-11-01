#!/usr/bin/env bash
set -euo pipefail

# Rebuild l'image et recree le conteneur avec le nouveau contenu.
# Usage: ./redeploy.sh   (nginx et certbot ne sont pas touches)

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
HOST_PORT="${HOST_PORT:-8116}"

cd "${PROJECT_DIR}"

HOST_PORT="${HOST_PORT}" docker compose up -d --build --force-recreate --remove-orphans
docker image prune -f >/dev/null

for i in $(seq 1 20); do
  if curl -fsS "http://127.0.0.1:${HOST_PORT}/health" >/dev/null 2>&1; then
    echo "Redeploiement OK sur http://127.0.0.1:${HOST_PORT}"
    exit 0
  fi
  sleep 1
done

echo "Erreur: le conteneur ne repond pas sur le port ${HOST_PORT}" >&2
docker compose logs --tail 50
exit 1
