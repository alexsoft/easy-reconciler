#!/bin/sh
set -e
echo "waiting for postgres..."
until node -e "require('pg').Pool && new (require('pg').Pool)({connectionString: process.env.DATABASE_URL}).query('select 1').then(()=>process.exit(0)).catch(()=>process.exit(1))"; do
  sleep 1
done
echo "running migrations..."
pnpm db:migrate
echo "running seed..."
pnpm db:seed
echo "starting server..."
pnpm start
