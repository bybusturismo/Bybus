#!/usr/bin/env bash
# Instala o atualizador automático (rodar UMA vez no servidor, como root): systemd confere a área "producao" a cada 1 minuto (dono, 17/11/2026: publicar logo após o "pode publicar").
set -euo pipefail
cat > /etc/systemd/system/bybus-atualizar.service <<'UNIT'
[Unit]
Description=Bybus Gestão: atualização automática a partir da área "producao"
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/bin/bash /opt/bybus/implantacao/atualizar-auto.sh
UNIT
cat > /etc/systemd/system/bybus-atualizar.timer <<'UNIT'
[Unit]
Description=Bybus Gestão: confere atualização a cada 1 minuto

[Timer]
OnBootSec=2min
OnUnitActiveSec=1min
Persistent=true

[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now bybus-atualizar.timer
touch /var/log/bybus-atualizacao.log
echo "PRONTO: atualizador automático ligado. Registro em /var/log/bybus-atualizacao.log"
