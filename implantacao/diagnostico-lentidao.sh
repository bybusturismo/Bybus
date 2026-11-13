#!/usr/bin/env bash
# Diagnóstico de lentidão (13/11/2026). Só LÊ: não altera nada. Não mostra dados de clientes, IPs nem números de registros
# (os códigos nas URLs viram ":id").
# Uso (no servidor): bash /opt/bybus/implantacao/diagnostico-lentidao.sh
set -uo pipefail
cd /opt/bybus
DC="docker compose -f implantacao/docker-compose.yml"
echo "== Servidor agora =="; uptime; free -h | head -2; df -h / | tail -1
echo; echo "== Uso por serviço (CPU e memória) =="; docker stats --no-stream --format '{{.Name}}  CPU {{.CPUPerc}}  Mem {{.MemUsage}}'
echo; echo "== Atualizações automáticas nos últimos 2 dias (horário do servidor, UTC) =="
grep -E "$(date -u +%Y-%m-%d)|$(date -u -d yesterday +%Y-%m-%d)" /var/log/bybus-atualizacao.log 2>/dev/null | tail -15 || echo "(sem registro)"
echo; echo "== Pedidos lentos ao sistema nos últimos 2 dias (horário de Brasília) =="
$DC logs api --since 48h --no-log-prefix 2>/dev/null | python3 -c '
import sys, json, re, datetime, collections
fuso = datetime.timezone(datetime.timedelta(hours=-3))
urls, lentos, porHora, erros = {}, [], collections.Counter(), collections.Counter()
for linha in sys.stdin:
    try: j = json.loads(linha)
    except Exception: continue
    rid = j.get("reqId")
    if j.get("msg") == "incoming request" and isinstance(j.get("req"), dict):
        u = re.sub(r"[0-9a-f]{8}-[0-9a-f-]{27}", ":id", j["req"].get("url", "").split("?")[0])
        u = re.sub(r"/\d+(?=/|$)", "/:n", u)
        urls[rid] = j["req"].get("method", "") + " " + u
    t = datetime.datetime.fromtimestamp(j.get("time", 0) / 1000, fuso)
    if j.get("msg") == "request completed" and (j.get("responseTime") or 0) >= 2000:
        lentos.append((j["responseTime"], t.strftime("%d/%m %H:%M:%S"), urls.get(rid, "?"), (j.get("res") or {}).get("statusCode")))
        porHora[t.strftime("%d/%m %Hh")] += 1
    if (j.get("level") or 0) >= 50:
        erros[(t.strftime("%d/%m %Hh"), str(j.get("msg", ""))[:80])] += 1
print("Pedidos com 2 segundos ou mais, por hora:")
for h, n in sorted(porHora.items()): print(f"  {h}: {n}")
print("Os 20 mais lentos:")
for ms, t, u, st in sorted(lentos, reverse=True)[:20]: print(f"  {t}  {ms/1000:6.1f} s  {st}  {u}")
print("Erros do servidor por hora:")
for (h, m), n in sorted(erros.items()): print(f"  {h}: {n}x {m}")
' || echo "(não consegui ler o registro do sistema)"
echo; echo "== Banco: consultas em andamento há mais de 5 s =="
$DC exec -T db psql -U bybus -d bybus -At -c "SELECT now()-query_start AS tempo, state, left(regexp_replace(query, '\s+', ' ', 'g'), 80) FROM pg_stat_activity WHERE state <> 'idle' AND now()-query_start > interval '5 seconds';"
echo; echo "Pronto. Mande um print de tudo para o Claude."
