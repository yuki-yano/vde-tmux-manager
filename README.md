# vde-tmux-manager

[日本語版 README](./README.ja.md)

`vde-tmux-manager` is a tmux utility CLI for session operations and statusline rendering.

## Features

- Interactive tmux session manager with fzf
- Category-aware tmux session grouping based on project paths
- Clean kill flows for sessions/windows/panes/server targets
- Category-scoped session cycling and statusline switching
- tmux statusline session segment renderer
- tmux statusline current-category segment renderer
- Clickable statusline session segments for session switching
- YAML-based configuration
- JSON Schema for YAML completion and validation
- Two executable names: `vde-tmux-manager` and `vtm`
- Configurable statusline fonts (prefix/suffix glyphs)

## Requirements

- Node.js `>=22`
- tmux
- fzf
- `ps` / `kill` commands

`fzf-tmux` is optional. If present, it is used automatically inside tmux.

## Installation

Global install:

```bash
npm install -g vde-tmux-manager
```

or

```bash
pnpm add -g vde-tmux-manager
```

## Commands

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

`vde-tmux-manager` is a full alias of `vtm`.

## Session Manager Controls

Inside the selector:

- `Enter`: switch/attach to selected target
- `Ctrl-T`: create new session
- `Ctrl-Q`: clean kill selected target(s)
- `Ctrl-R`: rename selected session
- `Ctrl-D` / `Ctrl-U`: preview page down/up

## Configuration

Configuration file path:

- `$XDG_CONFIG_HOME/vde/tmux-manager/config.yml`
- fallback path when `XDG_CONFIG_HOME` is unset: `~/.config/vde/tmux-manager/config.yml`

Example:

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

Category resolution order:

1. Session override metadata (`@category_override`)
2. Path rules
3. Session name rules
4. `defaultCategory`

Path rules use first-match-wins. For GHQ projects, matching is done against the GHQ-root-relative path such as `github.com/org/repo`. For non-GHQ projects, matching is done against the normalized absolute path, with `~` expanded to `HOME`.

Schema file:

- [`schemas/config.schema.json`](./schemas/config.schema.json)

## tmux Integration

Enable mouse support (required for clickable statusline session switching):

```tmux
set -g mouse on
```

Open session manager:

```tmux
bind-key C-f run-shell 'vtm session-manager'
```

Switch the current tmux client category:

```tmux
bind-key C-w run-shell 'vtm category use work'
bind-key C-p run-shell 'vtm category use private'
```

`vtm category use <name>` changes the current category for that tmux client, then restores the last active session remembered for that client and category. If no remembered session exists, it switches to the first session in the category. If the category has no sessions, only the category is updated.

Cycle sessions only inside the current category:

```tmux
bind-key -n M-n run-shell 'vtm session-cycle next'
bind-key -n M-p run-shell 'vtm session-cycle prev'
```

Use in statusline:

```tmux
set -g status-left '#(vtm statusline-category) '
set -g status-right '#(vtm statusline-sessions) #[fg=colour250]| %Y-%m-%d %H:%M'
```

Show 1-based indexes before session names when needed:

```tmux
set -g status-right '#(vtm statusline-sessions --show-index) #[fg=colour250]| %Y-%m-%d %H:%M'
```

Switch to a session by the displayed 1-based index:

```bash
vtm statusline-sessions switch 2
```

Create or reuse a session from a project path and attach/switch to it:

```bash
vtm project switch ~/ghq/github.com/xxx-company/foo
vtm project switch /tmp/playground-repo
```

Explicitly override a session category and refresh stored categories later:

```bash
vtm session set-category dotfiles private
vtm sessions refresh-category
```

Internal client state:

- `@current_category`: current category for the tmux client
- `@category_last_sessions`: JSON map of `category -> last active session` scoped to the tmux client

Simple right-click menu for kill actions:

```tmux
bind-key -n MouseDown3Pane display-menu -T "Pane #{pane_index}" -t = -x M -y M \
  "Kill Pane" X { run-shell "vtm session-manager kill-pane #{q:pane_id}" } \
  "Kill Window" W { run-shell "vtm session-manager kill-window #{q:window_id}" }
```

This replaces your existing right-click menu with a minimal kill-focused menu.

## Troubleshooting

- If `session-manager` does not open, verify `tmux` and `fzf` are available in `PATH`.
- If clean kill behavior is incomplete, verify `ps` and `kill` are available.
- If repo metadata is empty in preview, verify the pane path is inside a Git repository.
- If category matching looks wrong, verify `GHQ_ROOT` / `ghq root`, then run `vtm sessions refresh-category`.
