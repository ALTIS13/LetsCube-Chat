#!/bin/bash
# Slice 1's third gate: ten audio publishers for ten minutes, with the cost to
# the box measured rather than assumed — and, crucially, the production
# database's latency measured before and during, because the whole objection to
# putting an SFU on this host is that it shares a box with Postgres.
set -u
cd /srv/letscube/voice-probe

PHASE="${1:-before}"
SAMPLES="${2:-20}"

# A fixed, indexed read of the production database, timed the same way each time.
db_p95() {
  local times=()
  for i in $(seq 1 "$SAMPLES"); do
    local start=$(date +%s%N)
    docker exec supabase-db psql -U supabase_admin -d postgres -Atc \
      "select count(*) from public.messages where deleted_at is null;" > /dev/null 2>&1
    local end=$(date +%s%N)
    times+=( $(( (end - start) / 1000000 )) )
  done
  printf '%s\n' "${times[@]}" | sort -n | awk '{a[NR]=$1} END {printf "p50=%dms p95=%dms max=%dms n=%d\n", a[int(NR*0.5)+0], a[int(NR*0.95)], a[NR], NR}'
}

echo "== $PHASE =="
echo -n "database: "
db_p95
echo -n "load: "
uptime | sed 's/.*load average/load average/'
echo "livekit container:"
docker stats --no-stream --format '  {{.Name}} cpu={{.CPUPerc}} mem={{.MemUsage}}' letscube-voice-probe 2>/dev/null
echo "supabase-db container:"
docker stats --no-stream --format '  {{.Name}} cpu={{.CPUPerc}} mem={{.MemUsage}}' supabase-db 2>/dev/null
