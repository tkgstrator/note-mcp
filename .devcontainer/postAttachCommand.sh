#!/bin/sh
set -eu

# autoActivate=false の feature を、ワークスペースへ接続した後に有効化する。
# setup は認証と guarded Git の検証が完了するまで Git shim をブロックする。
setup=/usr/local/share/commitguard/setup
if [ ! -x "$setup" ]; then
  echo "commitguard: feature is not installed; rebuild the dev container." >&2
  exit 1
fi

if ! "$setup"; then
  echo "commitguard: activation failed; resolve the error and retry /usr/local/share/commitguard/setup." >&2
  exit 1
fi