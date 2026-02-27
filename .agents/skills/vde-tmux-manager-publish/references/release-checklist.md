# vde-tmux-manager Release Checklist

## 1. 状態確認

```bash
git status --short
node -p "require('./package.json').version"
npm view vde-tmux-manager version dist-tags --json
```

## 2. Preflight

```bash
corepack enable
corepack prepare pnpm@10.28.2 --activate
pnpm install --frozen-lockfile
pnpm run ci
pnpm build
```

## 3. バージョン更新とコミット

```bash
npm version <version> --no-git-tag-version
git add package.json
git commit -m "Bump version to <version>"
```

必要なら、`package.json` 以外の意図した差分も個別に `git add` する。

## 4. タグ作成と push

```bash
git tag v<version>
git push origin HEAD
git push origin v<version>
```

## 5. Publish Workflow 監視

```bash
gh run list --workflow publish.yml --limit 5
gh run watch <run-id>
gh run view <run-id> --log-failed
```

## 6. 公開確認

```bash
npm view vde-tmux-manager version dist-tags --json
```

期待バージョンが `latest` に反映されていれば完了。
