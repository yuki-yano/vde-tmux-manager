---
name: vde-tmux-manager-publish
description: vde-tmux-manager リポジトリ専用の npm 公開スキル。ユーザーが publish/release/npm公開/タグ公開/公開失敗の復旧を求めたときに使う。`package.json` の version 更新、`v*` タグ作成、`.github/workflows/publish.yml` の実行監視、npm の公開確認までを一貫して実施する。
---

# Vde Tmux Manager Publish

## Overview

- GitHub Actions の `v*` タグ公開フローを使って、`vde-tmux-manager` を npm へ安全に公開する。
- 実行中は `references/release-checklist.md` の順序を守り、失敗時は原因別に復旧する。
- ユーザーの明示的な指示がない限り、`release` ブランチ（`release/*` を含む）を新規作成しない。

## Workflow

1. 事前条件を確認する

- 作業ディレクトリをリポジトリルートに固定する。
- `git status --short` でワークツリーを確認する。
- 既存差分がある場合は、意図した差分かユーザーへ確認する。
- ユーザー指示がない場合は、作業中に `release` ブランチへ切り替えない。
- `gh` が利用可能で、`origin` が push 可能な状態を確認する。

2. 公開対象バージョンを決める

- 現在バージョンを `package.json` から確認する。
- ユーザーがバージョンを明示した場合は、その値を目標バージョン `<version>` とする。
- ユーザー指定がない場合は、現在バージョンから `patch` を 1 つ上げた値を目標バージョン `<version>` とする。
- `npm view vde-tmux-manager version dist-tags --json` で既存公開版を確認し、重複バージョンを避ける。

3. Preflight を実行する

- 以下を順番に実行する。

```bash
corepack enable
corepack prepare "$(node -p 'require("./package.json").packageManager')" --activate
pnpm install --frozen-lockfile
pnpm run ci
pnpm build
```

- 1つでも失敗したら公開を止め、原因を修正してから再開する。

4. バージョンを更新してコミットする

- `npm version <version> --no-git-tag-version` を実行する。
- `package.json` の `version` 以外に不要な差分がないか確認する。
- 必要ファイルのみ `git add` する。ignore 対象を `-f` で追加しない。
- `Bump version to <version>` でコミットする。

5. タグを作成して push する

- `git tag v<version>` を作成する。
- 以下でコミットとタグを push する。

```bash
git push origin HEAD
git push origin v<version>
```

6. Publish Workflow を監視する

- 対象ワークフロー: `.github/workflows/publish.yml`
- `v*` タグ push で `npm publish` が走ることを確認する。
- `gh run list --workflow publish.yml --limit 5` で run を特定する。
- `gh run watch <run-id>` で完了まで監視する。
- 失敗時は `gh run view <run-id> --log-failed` で失敗ログを取得する。

7. npm 公開結果を検証する

- `npm view vde-tmux-manager version dist-tags --json` で期待バージョンを確認する。
- 必要に応じて `npm install -g vde-tmux-manager@<version>` で導入確認する。
- 実行結果として以下をユーザーへ報告する。
- 公開バージョン
- 使用タグ
- GitHub Actions run の結果

## Failure Recovery

- `cannot publish over the previously published version`:
  バージョンを上げて Step 4 からやり直す。
- GitHub Actions 側の npm 認証失敗:
  npm の Trusted Publishing 設定を確認し、必要なら修正後に新しいタグで再実行する。
- `pnpm run ci` 失敗:
  修正完了まで公開作業を再開しない。
- `pnpm build` 失敗:
  `tsdown` と TypeScript の失敗箇所を確認し、`dist` が生成できる状態に直してから再試行する。

## Resources

- 実行時のコマンド順は `references/release-checklist.md` を参照する。
