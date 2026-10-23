#!/bin/sh
# Runs once, when the mysql data volume is first created.
# Creates a separate database for pytest so tests never touch dev data.
set -e
mysql -uroot -p"$MYSQL_ROOT_PASSWORD" <<SQL
CREATE DATABASE IF NOT EXISTS lab_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON lab_test.* TO '${MYSQL_USER}'@'%';
FLUSH PRIVILEGES;
SQL
