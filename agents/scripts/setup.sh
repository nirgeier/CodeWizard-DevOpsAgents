#!/usr/bin/env bash
set -e
cd "$(dirname "$0")/.."
python -m venv .venv
source .venv/bin/activate
pip install -U pip
pip install poetry
poetry install --no-root
cp .env.example .env 2>/dev/null || true
echo "Agents setup done. Fill .env and run migrations."
