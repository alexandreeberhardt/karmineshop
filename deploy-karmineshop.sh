#!/usr/bin/env bash
set -euo pipefail

# Usage: sudo ./deploy-karmineshop.sh
#        sudo SERVER_ALIASES="www.karmineshop.fr" ./deploy-karmineshop.sh
#
# Configuration locale (non versionnee) : copier deploy.env.example en deploy.env
# et renseigner CERTBOT_EMAIL et SERVER_IP. Les variables d'environnement
# passees en ligne de commande restent prioritaires.

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [[ -f "${PROJECT_DIR}/deploy.env" ]]; then
  _env_aliases="${SERVER_ALIASES-}"; _env_email="${CERTBOT_EMAIL-}"
  _env_ip="${SERVER_IP-}"; _env_port="${HOST_PORT-}"
  # shellcheck source=/dev/null
  source "${PROJECT_DIR}/deploy.env"
  SERVER_ALIASES="${_env_aliases:-${SERVER_ALIASES:-}}"
  CERTBOT_EMAIL="${_env_email:-${CERTBOT_EMAIL:-}}"
  SERVER_IP="${_env_ip:-${SERVER_IP:-}}"
  HOST_PORT="${_env_port:-${HOST_PORT:-}}"
fi

DOMAIN="karmineshop.fr"
SERVER_ALIASES="${SERVER_ALIASES:-}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"
COMPOSE_FILE="${PROJECT_DIR}/docker-compose.yml"
CONTAINER_NAME="karmineshop"
HOST_PORT="${HOST_PORT:-8116}"
NGINX_AVAILABLE="/etc/nginx/sites-available/${DOMAIN}"
NGINX_ENABLED="/etc/nginx/sites-enabled/${DOMAIN}"
SERVER_IP="${SERVER_IP:-}"

log() {
  printf '\n[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

fail() {
  printf '\nErreur: %s\n' "$*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fail "commande introuvable: $1"
}

port_in_use() {
  ss -ltnH | awk '{print $4}' | grep -Eq "(^|[:.])${1}$"
}

wait_for_local_http() {
  local url="$1"
  local attempts="${2:-20}"
  local delay="${3:-1}"
  local i

  for ((i=1; i<=attempts; i++)); do
    if curl -fsS "${url}" >/dev/null; then
      return 0
    fi
    sleep "${delay}"
  done

  return 1
}

check_dns() {
  local name="$1"
  local resolved

  resolved="$(getent ahostsv4 "${name}" | awk '{print $1; exit}' || true)"
  if [[ "${resolved}" != "${SERVER_IP}" ]]; then
    fail "${name} resout vers '${resolved:-rien}' au lieu de ${SERVER_IP}. Attendre la propagation DNS avant de relancer (Certbot echouerait)."
  fi
}

build_certbot_args() {
  CERTBOT_DOMAIN_ARGS=(-d "${DOMAIN}")
  if [[ -n "${SERVER_ALIASES}" ]]; then
    for alias in ${SERVER_ALIASES}; do
      CERTBOT_DOMAIN_ARGS+=(-d "${alias}")
    done
  fi
}

render_nginx_config() {
  local target_file="$1"
  local server_names="${DOMAIN}"

  if [[ -n "${SERVER_ALIASES}" ]]; then
    server_names+=" ${SERVER_ALIASES}"
  fi

  cat > "${target_file}" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${server_names};

    location / {
        proxy_pass http://127.0.0.1:${HOST_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF
}

[[ "${EUID}" -eq 0 ]] || fail "ce script doit etre lance avec sudo: sudo $0"
[[ -n "${CERTBOT_EMAIL}" ]] || fail "CERTBOT_EMAIL non defini (voir deploy.env.example)"
[[ -n "${SERVER_IP}" ]] || fail "SERVER_IP non defini (voir deploy.env.example)"

require_cmd docker
require_cmd nginx
require_cmd ss
require_cmd curl
require_cmd certbot

[[ -d "${PROJECT_DIR}" ]] || fail "dossier projet introuvable: ${PROJECT_DIR}"
[[ -f "${COMPOSE_FILE}" ]] || fail "fichier Compose introuvable: ${COMPOSE_FILE}"

log "Verification DNS"
check_dns "${DOMAIN}"
if [[ -n "${SERVER_ALIASES}" ]]; then
  for alias in ${SERVER_ALIASES}; do
    check_dns "${alias}"
  done
fi

if port_in_use "${HOST_PORT}"; then
  if ! docker ps --format '{{.Names}}\t{{.Ports}}' | grep -Eq "^${CONTAINER_NAME}[[:space:]].*:${HOST_PORT}->"; then
    fail "le port ${HOST_PORT} est deja utilise. Relancer avec un autre port, par exemple: sudo HOST_PORT=8117 $0"
  fi
fi

if grep -rqs "127.0.0.1:${HOST_PORT};" /etc/nginx/sites-available/ --exclude="${DOMAIN}"; then
  fail "le port ${HOST_PORT} est deja reference par un autre vhost nginx"
fi

nginx_tmp="$(mktemp)"
trap 'rm -f "${nginx_tmp}"' EXIT

render_nginx_config "${nginx_tmp}"
build_certbot_args

log "Validation de la configuration Docker Compose"
HOST_PORT="${HOST_PORT}" docker compose --project-directory "${PROJECT_DIR}" -f "${COMPOSE_FILE}" config >/dev/null

log "Build et lancement du site depuis ${PROJECT_DIR}"
HOST_PORT="${HOST_PORT}" docker compose --project-directory "${PROJECT_DIR}" -f "${COMPOSE_FILE}" up -d --build

log "Verification du conteneur ${CONTAINER_NAME}"
docker ps --filter "name=^/${CONTAINER_NAME}$"

log "Verification locale sur http://127.0.0.1:${HOST_PORT}"
wait_for_local_http "http://127.0.0.1:${HOST_PORT}/health" 20 1 || fail "le conteneur ne repond pas sur http://127.0.0.1:${HOST_PORT}"
curl -I "http://127.0.0.1:${HOST_PORT}"

if [[ -f "${NGINX_AVAILABLE}" ]] && grep -q "managed by Certbot" "${NGINX_AVAILABLE}"; then
  log "Vhost ${NGINX_AVAILABLE} deja gere par Certbot, il n'est pas ecrase"
else
  log "Installation du vhost nginx ${NGINX_AVAILABLE}"
  install -m 0644 "${nginx_tmp}" "${NGINX_AVAILABLE}"
fi
if [[ ! -e "${NGINX_ENABLED}" ]]; then
  ln -s "${NGINX_AVAILABLE}" "${NGINX_ENABLED}"
fi

log "Test et reload nginx avant Certbot"
nginx -t
systemctl reload nginx

log "Emission ou renouvellement du certificat Let's Encrypt"
certbot --nginx --redirect --non-interactive --agree-tos -m "${CERTBOT_EMAIL}" "${CERTBOT_DOMAIN_ARGS[@]}"

log "Test final nginx"
nginx -t
systemctl reload nginx

log "Verification HTTPS publique"
curl -I "https://${DOMAIN}"

if [[ -n "${SERVER_ALIASES}" ]]; then
  for alias in ${SERVER_ALIASES}; do
    curl -I "https://${alias}"
  done
fi

log "Deploiement termine: https://${DOMAIN}"
