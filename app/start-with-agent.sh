#!/bin/bash
set -a
# shellcheck disable=SC1091
[ -f /etc/chunyu-doctor.env ] && . /etc/chunyu-doctor.env
[ -f /var/www/chunyu-doctor-review/app/.env.agent ] && . /var/www/chunyu-doctor-review/app/.env.agent
set +a
export PORT=3200
export DB_PATH=/var/lib/chunyu-doctor/data.db
export DIALOGUE_AGENT_ENABLED=1
export AGENT_DRY_RUN=0
cd /var/www/chunyu-doctor-review/app
exec /usr/bin/node server.js
