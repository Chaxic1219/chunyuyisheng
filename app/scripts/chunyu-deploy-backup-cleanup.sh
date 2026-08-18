#!/bin/bash
# 春雨 · 部署备份自动清理
# 清理范围：
#   1. /var/www/chunyu-doctor-review/backup-code-*  (部署代码快照)
#   2. /var/www/chunyu-doctor-review/backup-data-*  (部署数据快照)
#   3. /opt/chunyu-doctor/releases/*                (旧发布目录)
#   4. /root/chunyu-before-*.tar.gz                 (早期手动备份)
# 绝不触碰：生产库 /var/lib/chunyu-doctor/data.db、/root/chunyu-backup-* 目录
set -euo pipefail

BASE="${CHUNYU_DEPLOY_BACKUP_BASE:-/var/www/chunyu-doctor-review}"
RELEASES_DIR="${CHUNYU_RELEASES_DIR:-/opt/chunyu-doctor/releases}"
KEEP_CODE="${CHUNYU_DEPLOY_KEEP_CODE:-10}"
KEEP_DATA="${CHUNYU_DEPLOY_KEEP_DATA:-15}"
KEEP_RELEASES="${CHUNYU_KEEP_RELEASES:-5}"
MAX_DAYS="${CHUNYU_DEPLOY_BACKUP_MAX_DAYS:-21}"
DRY_RUN="${CHUNYU_DEPLOY_BACKUP_DRY_RUN:-0}"
LOG_TAG="[chunyu-deploy-cleanup]"
LOG_FILE="/var/log/chunyu-backup-cleanup.log"

ts(){ date '+%F %T'; }
log(){ local msg="$(ts) $LOG_TAG $*"; echo "$msg"; echo "$msg" >> "$LOG_FILE" 2>/dev/null || true; }

clamp(){ local v=$1 min=$2; v=$((v + 0)); (( v < min )) && v=$min; echo $v; }
KEEP_CODE=$(clamp "$KEEP_CODE" 3)
KEEP_DATA=$(clamp "$KEEP_DATA" 3)
KEEP_RELEASES=$(clamp "$KEEP_RELEASES" 3)
MAX_DAYS=$(clamp "$MAX_DAYS" 7)

FREED_BYTES=0
remove_path(){
  local p="$1"
  if [[ "$DRY_RUN" == "1" ]]; then
    local sz; sz=$(du -sb "$p" 2>/dev/null | cut -f1) || sz=0
    log "DRY_RUN would remove $p (${sz}B)"
    FREED_BYTES=$((FREED_BYTES + sz))
    return 0
  fi
  local sz; sz=$(du -sb "$p" 2>/dev/null | cut -f1) || sz=0
  rm -rf -- "$p"
  FREED_BYTES=$((FREED_BYTES + sz))
  log "removed $p (${sz}B)"
}

# --- 1. backup-code-* dirs ---
if [[ -d "$BASE" ]]; then
  mapfile -t CODE_ALL < <(ls -1dt "$BASE"/backup-code-* 2>/dev/null || true)
  CODE_TOTAL=${#CODE_ALL[@]}
  if (( CODE_TOTAL > KEEP_CODE )); then
    for ((i=KEEP_CODE; i<CODE_TOTAL; i++)); do
      remove_path "${CODE_ALL[$i]}"
    done
  fi
  while IFS= read -r -d '' p; do
    skip=0
    for ((i=0; i<KEEP_CODE && i<CODE_TOTAL; i++)); do
      [[ "${CODE_ALL[$i]}" == "$p" ]] && { skip=1; break; }
    done
    (( skip )) && continue
    remove_path "$p"
  done < <(find "$BASE" -maxdepth 1 -type d -name 'backup-code-*' -mtime +"$MAX_DAYS" -print0 2>/dev/null)
fi

# --- 2. backup-data-*.db files ---
if [[ -d "$BASE" ]]; then
  mapfile -t DATA_ALL < <(ls -1t "$BASE"/backup-data-* 2>/dev/null || true)
  DATA_TOTAL=${#DATA_ALL[@]}
  if (( DATA_TOTAL > KEEP_DATA )); then
    for ((i=KEEP_DATA; i<DATA_TOTAL; i++)); do
      remove_path "${DATA_ALL[$i]}"
    done
  fi
  while IFS= read -r -d '' p; do
    skip=0
    for ((i=0; i<KEEP_DATA && i<DATA_TOTAL; i++)); do
      [[ "${DATA_ALL[$i]}" == "$p" ]] && { skip=1; break; }
    done
    (( skip )) && continue
    remove_path "$p"
  done < <(find "$BASE" -maxdepth 1 -type f -name 'backup-data-*' -mtime +"$MAX_DAYS" -print0 2>/dev/null)
fi

# --- 3. /opt/chunyu-doctor/releases/* (旧发布目录) ---
if [[ -d "$RELEASES_DIR" ]]; then
  mapfile -t REL_ALL < <(ls -1dt "$RELEASES_DIR"/*/ 2>/dev/null || true)
  REL_TOTAL=${#REL_ALL[@]}
  if (( REL_TOTAL > KEEP_RELEASES )); then
    log "releases: $REL_TOTAL found, keeping newest $KEEP_RELEASES"
    for ((i=KEEP_RELEASES; i<REL_TOTAL; i++)); do
      remove_path "${REL_ALL[$i]}"
    done
  fi
fi

# --- 4. /root/chunyu-before-*.tar.gz (超过 MAX_DAYS 天的早期手动备份) ---
while IFS= read -r -d '' p; do
  remove_path "$p"
done < <(find /root -maxdepth 1 -name 'chunyu-before-*.tar.gz' -mtime +"$MAX_DAYS" -print0 2>/dev/null)

# --- summary ---
CODE_LEFT=$(ls -1d "$BASE"/backup-code-* 2>/dev/null | wc -l | tr -d ' ')
DATA_LEFT=$(ls -1 "$BASE"/backup-data-* 2>/dev/null | wc -l | tr -d ' ')
REL_LEFT=$(ls -1d "$RELEASES_DIR"/*/ 2>/dev/null | wc -l | tr -d ' ')
FREED_MB=$((FREED_BYTES / 1048576))
log "done code=$CODE_LEFT/$KEEP_CODE data=$DATA_LEFT/$KEEP_DATA releases=$REL_LEFT/$KEEP_RELEASES freed=${FREED_MB}MB max_days=$MAX_DAYS dry=$DRY_RUN"
