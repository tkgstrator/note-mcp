#!/bin/sh
set -eu

# Compose の専用 volume を workspace ユーザーが利用できるようにする。
sudo chown "$(id -un):$(id -gn)" node_modules
bun install --frozen-lockfile --ignore-scripts
