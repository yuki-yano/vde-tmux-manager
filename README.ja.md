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
- 実行名は Rust バイナリ `vtm` のみ
- statusline の前後フォント（prefix/suffix グリフ）を設定可能

## 動作要件

- Rust toolchain と Cargo
- tmux
- fzf
- `ps` / `kill` コマンド

`fzf-tmux` は任意です。tmux 内で利用可能な場合は自動で使用します。

## インストール

ソースからビルド:

```bash
cargo build --release
```

ローカルインストール:

```bash
cargo install vde-tmux-manager
```

ローカルリポジトリから入れる場合:

```bash
cargo install --path crates/vtm-cli --bin vtm
```

## プロジェクト構成

- `crates/vtm-core`: config 読込、tmux wrapper、parse、format、preview、session/category state 解決などの再利用ロジック
- `crates/vtm-cli`: `vtm` 実行バイナリ、daemon lifecycle、cache 管理、CLI command orchestration

## コマンド

- `vtm session-manager`
- `vtm session-manager --popup`
- `vtm session-manager kill-window <target>`
- `vtm session-manager kill-pane <target>`
- `vtm daemon start`
- `vtm daemon stop`
- `vtm daemon status`
- `vtm daemon reload`
- `vtm project switch <path>`
- `vtm category use <name>`
- `vtm category next`
- `vtm category prev`
- `vtm export state --json`
- `vtm export subscribe --json`
- `vtm hooks on-client-session-changed [<client-name> <session-name>]`
- `vtm session-cycle next`
- `vtm session-cycle prev`
- `vtm session set-category <session> <category>`
- `vtm sessions refresh-category`
- `vtm statusline-category`
- `vtm statusline-category switch 2`
- `vtm statusline-sessions`
- `vtm statusline-sessions switch 2`
- `vtm --help`
- `vtm --version`

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
ghqRoot: "/Users/you/ghq"
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
  mode: current
  format: "{category}"
  prefix: ""
  suffix: ""
  bold: true
  colors:
    fg: "#1C1C1C"
    bg: "#FAB387"
    outerBg: "#352F63"
  inactiveColors:
    fg: "#C6D0F5"
    bg: "#352F63"
    outerBg: "#352F63"

statuslineSessions:
  showIndex: false
  current:
    format: "{session}"
    prefix: ""
    suffix: ""
    bold: false
    colors:
      fg: "#1E1E2E"
      bg: "#B4BEFE"
      outerBg: "#352F63"
  other:
    format: " {session} "
    prefix: ""
    suffix: ""
    bold: false
    colors:
      fg: "#C6D0F5"
      bg: "#352F63"
      outerBg: "#352F63"

categories:
  defaultCategory: work
  displayNames:
    work: Work
    private: Private
    oss: OSS
  order:
    work: 10
    private: 20
    oss: 30
  rules:
    - category: work
      ghqPatterns:
        - github.com/${WORK_GHQ_OWNER}/*
        - github.com/${WORK_GHQ_OWNER}/**
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

`ghqPatterns` と `pathPatterns` では、config load 時に `${VAR_NAME}` 形式の環境変数展開を使えます。たとえば `WORK_GHQ_OWNER=acme-inc` なら、`github.com/${WORK_GHQ_OWNER}/*` は `github.com/acme-inc/*` に展開されます。未定義の環境変数を参照した場合は設定エラーになります。固定文字列だけの既存パターンはそのまま動作します。

想定外の設定キーは config load 時に無視されるため、余分なキーがあっても `vtm` は起動エラーになりません。

category 名は文字列のまま使い、整数順は `categories.order` で別に定義します。`vtm category next` / `vtm category prev` と `vtm session-manager` 内の category グルーピングはその順序を使います。

`categories` を設定しない場合は、全 session が 1 つの無名 category に所属します。このとき session-cycle や statusline-sessions switch は全 session を対象に動作し、`vtm statusline-category` は何も表示しません。

Schema ファイル:

- [`schemas/config.schema.json`](./schemas/config.schema.json)

## 機械可読 State Export

解決済みの category/session/client state を JSON として出力します。

```bash
vtm export state --json
```

daemon が利用できる場合は daemon 経由で動作し、繰り返し呼び出す consumer は daemon の snapshot cache を利用できます。daemon を起動または接続できない場合は、tmux から直接 state を解決します。

解決済み state の変更を購読できます。

```bash
vtm export subscribe --json
```

subscribe command は daemon socket 接続を維持し、1 行に 1 つの compact JSON object を出力します。各 object は `vtm export state --json` と同じ schema で、daemon は export 結果が変わったときに全 state を push します。

出力スキーマ:

- [`schemas/state-export.schema.json`](./schemas/state-export.schema.json)

出力例:

```json
{
  "version": 1,
  "categories": [
    { "name": "private", "displayName": "Private", "order": 0 }
  ],
  "sessions": [
    {
      "name": "dotfiles",
      "category": "private",
      "categorySource": "sessionNameRule",
      "projectPath": "/Users/you/dotfiles",
      "attached": true,
      "activity": 1751400000
    }
  ],
  "clients": [
    {
      "client": "/dev/ttys003",
      "currentCategory": "private",
      "lastSessions": { "private": "dotfiles" }
    }
  ]
}
```

`version` は互換性契約を表します。同一 version では field 追加のみを行い、field の削除や rename などの破壊的変更では `version` を上げます。

## tmux 連携例

クリックによる session 移動を使う場合は mouse を有効化:

```tmux
set -g mouse on
```

session manager を開く:

```tmux
bind-key C-f run-shell 'vtm session-manager'
```

statusline 呼び出し前に cache を温めたい場合は daemon を明示起動できます:

```tmux
run-shell 'vtm daemon start'
```

tmux client ごとの current category を切り替える:

```tmux
bind-key C-w run-shell 'vtm category use work'
bind-key C-p run-shell 'vtm category use private'
bind-key ] run-shell 'vtm category next'
bind-key [ run-shell 'vtm category prev'
```

`vtm category use <name>` は、その tmux client の current category を更新したあと、その client でその category 内で最後に見ていた session へ戻ります。記録がなければ category 内の先頭 session に移動し、category に session がなければ category だけ切り替えます。

last active session の記録タイミング:

- `vtm` 経由の session 切替では即座に記録されます
- `vtm category use` 実行時は、切替前に tmux client の実際の current session を補正反映します
- tmux 標準操作の session 切替も追跡したい場合は、以下の hook 設定を入れてください
- client ごとの category state は、client 名を埋め込んだ tmux server-scoped user option に保存されるため、同一 client 上の session 切替では失われません

`statuslineCategory.format` の `{category}` には statusline 用の表示名が入ります。通常は内部 category 名そのままですが、`categories.displayNames` で内部名を変えずに表示名だけ差し替えられます。`mode: current` は現在の category だけを表示し、`mode: list` は `categories.order` 順で category を横並び表示します。`colors` はアクティブ項目、`inactiveColors` は非アクティブ項目に使われます。`prefix` / `suffix` は各 category 本体の前後に描画され、`outerBg` はその外側背景色です。解決後の category が無名なら、`current` では空文字を返し、`list` では無名 category を表示しません。
`statuslineSessions.current.format` / `statuslineSessions.other.format` では `{session}` が session 名に置換されます。`--show-index` または `showIndex: true` のときは `1 foo` のような index 付き文字列が入ります。

```tmux
bind-key -n MouseDown1Status if-shell -F '#{m/r:^[0-9]+$,#{mouse_status_range}}' \
  'run-shell "vtm statusline-category switch #{mouse_status_range}"' \
  'switch-client -t ='
```

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

tmux 標準の session 切替も last active に反映する:

```tmux
set-hook -g client-session-changed 'run-shell "vtm hooks on-client-session-changed #{client_name} #{session_name}"'
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
- `@category_last_session_<hex(category)>`: tmux client ごとの category 別 last active session

kill 操作に絞ったシンプルな右クリックメニュー:

```tmux
bind-key -n MouseDown3Pane display-menu -T "Pane #{pane_index}" -t = -x M -y M \
  "Kill Pane" X { run-shell "vtm session-manager kill-pane #{q:pane_id}" } \
  "Kill Window" W { run-shell "vtm session-manager kill-window #{q:window_id}" }
```

この設定は既存の右クリックメニューを、kill 用の最小メニューに置き換えます。

## トラブルシュート

- `session-manager` が開かない場合は、`tmux` と `fzf` が `PATH` にあるか確認してください。
- daemon 状態が古いように見える場合は `vtm daemon reload` を実行してください。
- clean kill が期待通りに動かない場合は、`ps` と `kill` コマンドの有無を確認してください。
- プレビューのリポジトリ情報が空の場合は、pane の現在パスが Git リポジトリ配下か確認してください。
- GHQ root が固定なら、config に `ghqRoot` を設定すると毎回 `ghq root` を呼ばなくなります。
- category 判定が意図とずれる場合は、`ghqRoot` / `GHQ_ROOT` / `ghq root` を確認し、`vtm sessions refresh-category` を実行してください。
