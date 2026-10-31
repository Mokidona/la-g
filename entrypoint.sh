#!/bin/sh
# Том /data (named volume или bind mount) Docker создаёт от root, а приложение
# работает под непривилегированным пользователем node. Поэтому контейнер
# стартует от root, забирает владение каталогом данных и только потом отдаёт
# управление серверу от имени node.
set -e

DATA_DIR="${DATA_DIR:-/data}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR/uploads"
  chown -R node:node "$DATA_DIR" 2>/dev/null || true
  exec su-exec node "$@"
fi

# На случай запуска с уже заданным пользователем (docker run --user node).
mkdir -p "$DATA_DIR/uploads" 2>/dev/null || true
exec "$@"
