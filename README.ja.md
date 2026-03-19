# vde-tmux-manager

[English README](./README.md)

`vde-tmux-manager` は、tmux のセッション操作と statusline 描画を提供するユーティリティ CLI です。

## 機能

- fzf ベースのインタラクティブ session manager
- project path ベースの category-aware session 管理
- session/window/pane/server 対象の clean kill
- current category 内に限定した session 巡回と statusline 切り替え
- tmux statusline 用セッションセグメント生成
- tmux statusline 用 current category セグメント生成
- statusline 上の session をクリックして session 移動が可能
- YAML ベース設定
- YAML 向け JSON Schema を同梱
- 実行名は `vde-tmux-manager` と `vtm` の2つ
- statusline の前後フォント（prefix/suffix グリフ）を設定可能

## 動作要件

- Node.js `>=22`
- tmux
- fzf
- `ps` / `kill` コマンド

`fzf-tmux` は任意です。tmux 内で利用可能な場合は自動で使用します。

## インストール

グローバルインストール:

```bash
npm install -g vde-tmux-manager
```

または

```bash
pnpm add -g vde-tmux-manager
```

## コマンド

- `vtm session-manager`
- `vtm session-manager --popup`
- `vtm session-manager kill-window <target>`
- `vtm session-manager kill-pane <target>`
- `vtm project switch <path>`
- `vtm category use <name>`
- `vtm session-cycle next`
- `vtm session-cycle prev`
- `vtm session set-category <session> <category>`
- `vtm sessions refresh-category`
- `vtm statusline-category`
- `vtm statusline-sessions`
- `vtm statusline-sessions switch 2`
- `vtm --help`
- `vtm --version`

`vde-tmux-manager` は `vtm` の完全エイリアスです。

## Session Manager 操作キー

セレクタ内の主なキー操作:

- `Enter`: 選択対象へ switch / attach
- `Ctrl-T`: 新規セッション作成
- `Ctrl-Q`: 選択対象を clean kill
- `Ctrl-R`: セッション名変更
- `Ctrl-D` / `Ctrl-U`: プレビューのページ移動

## 設定

設定ファイルパス:

- `$XDG_CONFIG_HOME/vde/tmux-manager/config.yml`
- `XDG_CONFIG_HOME` 未設定時: `~/.config/vde/tmux-manager/config.yml`

設定例:

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/yuki-yano/vde-tmux-manager/refs/heads/main/schemas/config.schema.json
sessionManager:
  popup:
    enabled: true
    width: "50%"
    height: "50%"
  fzf:
    prompt: "tmux> "
    border: "rounded"
    previewWidth: "65"
    previewRefreshMs: 0
  preview:
    sessionCaptureLines: 15
    paneCaptureLines: 16
  kill:
    sendCtrlC: true
    termWaitMs: 300
    killWaitMs: 300

statuslineCategory:
  format: "[{category}]"
  colors:
    fg: "#A5A1F2"
    bg: "#352F63"

statuslineSessions:
  showIndex: false
  colors:
    baseFg: "#A5A1F2"
    baseBg: "#352F63"
    currentFg: "#1E1E2E"
    currentBg: "#B4BEFE"
    otherFg: "#C6D0F5"
  fonts:
    currentPrefix: ""
    currentSuffix: ""
    otherPrefix: ""
    otherSuffix: ""

categories:
  defaultCategory: public
  rules:
    - category: work
      ghqPatterns:
        - github.com/xxx-company/*
        - github.com/xxx-company/**
    - category: private
      pathPatterns:
        - ~/dotfiles
        - ~/private/**
        - /tmp/**
    - category: oss
      ghqPatterns:
        - github.com/yuki-yano/**
  sessionNameRules:
    - category: private
      patterns:
        - dotfiles
        - local-*
```

category 判定順序:

1. session override metadata (`@category_override`)
2. path rule
3. session name rule
4. `defaultCategory`

path rule は上から順に first-match-wins です。GHQ 配下は `github.com/org/repo` のような GHQ root 相対 path に対して `ghqPatterns` を評価し、非 GHQ path は `~` 展開後の絶対 path に対して `pathPatterns` を評価します。

`categories` を設定しない場合は、全 session が 1 つの無名 category に所属します。このとき session-cycle や statusline-sessions switch は全 session を対象に動作し、`vtm statusline-category` は何も表示しません。

Schema ファイル:

- [`schemas/config.schema.json`](./schemas/config.schema.json)

## tmux 連携例

クリックによる session 移動を使う場合は mouse を有効化:

```tmux
set -g mouse on
```

session manager を開く:

```tmux
bind-key C-f run-shell 'vtm session-manager'
```

tmux client ごとの current category を切り替える:

```tmux
bind-key C-w run-shell 'vtm category use work'
bind-key C-p run-shell 'vtm category use private'
```

`vtm category use <name>` は、その tmux client の current category を更新したあと、その client でその category 内で最後に見ていた session へ戻ります。記録がなければ category 内の先頭 session に移動し、category に session がなければ category だけ切り替えます。

`statuslineCategory.format` では `{category}` が現在の category 名に置換されます。解決後の category が無名なら、category セグメント自体を表示しません。

current category 内だけで session を巡回する:

```tmux
bind-key -n M-n run-shell 'vtm session-cycle next'
bind-key -n M-p run-shell 'vtm session-cycle prev'
```

statusline で利用する:

```tmux
set -g status-left '#(vtm statusline-category) '
set -g status-right '#(vtm statusline-sessions) #[fg=colour250]| %Y-%m-%d %H:%M'
```

必要なときだけ 1 始まりの index を出す:

```tmux
set -g status-right '#(vtm statusline-sessions --show-index) #[fg=colour250]| %Y-%m-%d %H:%M'
```

表示された 1 始まりの index で session を切り替える:

```bash
vtm statusline-sessions switch 2
```

project path から session を作成または再利用する:

```bash
vtm project switch ~/ghq/github.com/xxx-company/foo
vtm project switch /tmp/playground-repo
```

session category を明示 override し、あとでまとめて再計算する:

```bash
vtm session set-category dotfiles private
vtm sessions refresh-category
```

内部 state:

- `@current_category`: tmux client ごとの current category
- `@category_last_sessions`: tmux client ごとの `category -> last active session` JSON

kill 操作に絞ったシンプルな右クリックメニュー:

```tmux
bind-key -n MouseDown3Pane display-menu -T "Pane #{pane_index}" -t = -x M -y M \
  "Kill Pane" X { run-shell "vtm session-manager kill-pane #{q:pane_id}" } \
  "Kill Window" W { run-shell "vtm session-manager kill-window #{q:window_id}" }
```

この設定は既存の右クリックメニューを、kill 用の最小メニューに置き換えます。

## トラブルシュート

- `session-manager` が開かない場合は、`tmux` と `fzf` が `PATH` にあるか確認してください。
- clean kill が期待通りに動かない場合は、`ps` と `kill` コマンドの有無を確認してください。
- プレビューのリポジトリ情報が空の場合は、pane の現在パスが Git リポジトリ配下か確認してください。
- category 判定が意図とずれる場合は、`GHQ_ROOT` / `ghq root` を確認し、`vtm sessions refresh-category` を実行してください。
