# note-mcp

note.com の**下書き**を操作する MCP サーバー（stdio）。TypeScript + Bun 製。

> **非公式**: note.com の内部 API（公式に公開・保証されていないもの）を利用します。
> 予告なく変更・停止される可能性があり、利用は自己責任です。note の利用規約を確認してください。

## ツール

| ツール | 内容 |
| --- | --- |
| `note_whoami` | Cookie を検証し、ログイン中のユーザーを返す |
| `note_create_draft` | `title` と `markdown` から下書きを作成・保存し、`id` / `key` / 編集 URL を返す |
| `note_update_draft` | `key` または `id` で下書きを更新（`title` / `markdown` の指定した方を置換）。`key` 指定時は未指定項目を現在の内容から引き継ぐ |
| `note_get_draft` | `key` で下書きのタイトルと本文 HTML を取得 |
| `note_list_drafts` | 自分の下書き一覧（`page` 指定、`isLastPage` / `totalCount` 付き） |
| `note_delete_draft` | `id` で下書きを削除（元に戻せない） |

編集 URL は `https://editor.note.com/notes/<key>/edit/` です。

### Markdown 変換

h1/h2 は `h2`、h3 以下は `h3` に変換します。段落、リスト、引用、コードブロック、リンク（http/https/mailto のみ）、
太字/斜体/打ち消し/インラインコードに対応します。各ブロックには `name` / `id` に同じ UUID を付与します。
画像は対象外（代替テキストのみ残す）、表や生 HTML もサポートせず、エスケープした段落として残します。

## 制約・未実装

- **公開機能は意図的に未実装**です。公開用の API は調査しておらず、誤公開を避けるため下書きの作成・更新・取得・削除に限っています。
- 下書き一覧 (`note_list_drafts`) は `GET /v2/note_list/contents?kind=note&status=draft&page=N` を使います（実機で確認済み）。
  下書きでは要素直下の `name` は常に `null` で、タイトルは `noteDraft.name`（空文字の場合あり）に入ります。
  返す `id` は要素直下の数値 id で、`note_delete_draft` にそのまま渡せます（`noteDraft.id` は別の文字列 id）。
  レスポンスの形が想定と異なる場合は、空配列にせずスキーマ不一致のエラーにします。
- 画像のアップロード・挿入には対応していません。
- テストは fetch をモックした単体テストのみで、実 API に対する自動テストはありません。

## セットアップ

認証は Cookie `_note_session_v5` の値だけを使います。

1. ブラウザで note.com にログインする。
2. DevTools の Application タブ → Cookies → `https://note.com` を開き、`_note_session_v5` の **値** をコピーする。
3. 環境変数 `NOTE_SESSION` に設定する。

代わりに `NOTE_COOKIE_FILE` に Netscape 形式の cookies.txt のパスを指定すると、そこから `_note_session_v5` を読みます
（`NOTE_SESSION` が設定されていればそちらが優先）。どちらも無ければ起動時にエラーで終了します。
Cookie の値はログやエラーに出力しません。Cookie は期限切れになるため、`401/403/422` が返ったら値を更新してください。

`cookies.txt` と `.env` は `.gitignore` 済みです。コミットしないでください。

### Docker

GHCR イメージはまだ公開していません。公開前はこのリポジトリからローカルでビルドしてください。
Dockerfile は [qtmleap/devcontainers の hono-node テンプレート](https://github.com/qtmleap/devcontainers/tree/master/examples/hono-node)
と同じ Bun のマルチステージ構成（`oven/bun:1` → `oven/bun:1-slim`）です。
非 root の `bun` ユーザーで起動し、HTTP ポートは公開しません。

```sh
docker build -t note-mcp:local .
docker run -i --rm -e NOTE_SESSION note-mcp:local
```

イメージを公開した後の起動例:

```sh
docker run -i --rm -e NOTE_SESSION ghcr.io/tkgstrator/note-mcp
```

cookies.txt を使う場合:

```sh
docker run -i --rm -e NOTE_COOKIE_FILE=/cookies.txt -v "$PWD/cookies.txt:/cookies.txt:ro" ghcr.io/tkgstrator/note-mcp
```

### Claude Code への登録

ローカルでビルドしたイメージを使う場合:

```sh
claude mcp add note -- docker run -i --rm -e NOTE_SESSION note-mcp:local
```

GHCR に公開した後はイメージ名を差し替えます:

```sh
claude mcp add note -- docker run -i --rm -e NOTE_SESSION ghcr.io/tkgstrator/note-mcp
```

### ローカル実行

```sh
bun install
NOTE_SESSION=... bun run start
```

## 開発

```sh
bun run typecheck
bun run lint     # biome check
bun run format   # biome check --write
bun test
bun run build    # dist/note-mcp (単一バイナリ)
```

テストランナーは Bun 組み込みの `bun test`（fetch をモックするだけで jsdom 等が不要なため vitest は使っていません）。

### Dev Container

[qtmleap/devcontainers の hono-node テンプレート](https://github.com/qtmleap/devcontainers/tree/master/examples/hono-node)
をベースに、Ubuntu 24.04 の Dev Container + Compose を使います。
ホストのリポジトリを `/home/vscode/app` に bind mount し、`node_modules` は専用 volume に置きます。
Bun、Node.js、Docker CLI、GitHub CLI、Claude Code、Codex CLI、act、direnv、commitguard は features で導入します。
ホストに `~/.claude`、`~/.ssh`、`~/.config/gh` を用意してから、VS Code の **Reopen in Container** で開いてください。
Codex の設定・認証は workspace 内の `.codex` を使い、ホストの `.codex` は共有しません。
`postCreateCommand.sh` が frozen install を行い、`postAttachCommand.sh` が `/usr/local/share/commitguard/setup` を実行して
GitHub 認証と guarded Git を検証します。
有効化に失敗した場合は表示された問題を解決し、同コマンドを再実行してください。
Git リポジトリと人間の GitHub アカウントでの認証が必要です。失敗を無視してコミットしないでください。

### MCP 接続のスモークテスト

```sh
bun run smoke
bun run smoke -- --binary
bun run smoke -- --docker note-mcp:local
```

ダミー認証で initialize / listTools のみを確認し、note API は呼び出しません。
Docker モードはネットワークを無効にし、終了時にこの検証が作ったコンテナだけを削除します。
30 秒で打ち切り、子プロセスを終了します。

復元先がコンテナ内の `/home/vscode/note-mcp` の場合、再ビルドで消える可能性があります。
ホストの永続領域へ保存するか、別途承認されたコミット・push を済ませてから再ビルドしてください。

## リリース

`v*` タグを push すると GitHub Actions が `ghcr.io/tkgstrator/note-mcp` へ amd64/arm64 のイメージを push します。
`GITHUB_TOKEN` では GHCR の未作成パッケージに書けないことがあるため、`write:packages` 権限の PAT を `GHCR_TOKEN` secret に設定してください。
`ubuntu-latest` が使えない場合はリポジトリ変数 `RUNNER_LABEL`（例: `self-hosted`）を設定すると runner を切り替えられます。
