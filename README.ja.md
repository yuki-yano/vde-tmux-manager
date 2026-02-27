# vde-tmux-manager

[English README](./README.md)

`vde-tmux-manager` は、tmux のセッション操作と statusline 描画を提供するユーティリティ CLI です。

## 機能

- fzf ベースのインタラクティブ session manager
- session/window/pane/server 対象の clean kill
- tmux statusline 用セッションセグメント生成
- statusline 上の session をクリックして session 移動が可能
- YAML ベース設定
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
- `vtm statusline-sessions`
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

- `$XDG_CONFIG_HOME/vde-tmux-manager/config.yaml`
- `XDG_CONFIG_HOME` 未設定時: `~/.config/vde-tmux-manager/config.yaml`

設定例:

```yaml
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

statuslineSessions:
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
```

## tmux 連携例

クリックによる session 移動を使う場合は mouse を有効化:

```tmux
set -g mouse on
```

session manager を開く:

```tmux
bind-key C-f run-shell 'vtm session-manager'
```

statusline で利用する:

```tmux
set -g status-right '#(vtm statusline-sessions) #[fg=colour250]| %Y-%m-%d %H:%M'
```

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
