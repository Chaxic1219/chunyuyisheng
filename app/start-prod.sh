#!/bin/bash
set -a
# shellcheck disable=SC1091
source /etc/chunyu-doctor.env
set +a
export PORT=3200
export DB_PATH=/var/lib/chunyu-doctor/data.db
cd /var/www/chunyu-doctor-review/app
exec /usr/bin/node server.js
