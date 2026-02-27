# vde-tmux-manager

[日本語版 README](./README.ja.md)

`vde-tmux-manager` is a tmux utility CLI for session operations and statusline rendering.

## Features

- Interactive tmux session manager with fzf
- Clean kill flows for sessions/windows/panes/server targets
- tmux statusline session segment renderer
- Clickable statusline session segments for session switching
- YAML-based configuration
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
- `vtm statusline-sessions`
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

- `$XDG_CONFIG_HOME/vde-tmux-manager/config.yaml`
- fallback path when `XDG_CONFIG_HOME` is unset: `~/.config/vde-tmux-manager/config.yaml`

Example:

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

## tmux Integration

Enable mouse support (required for clickable statusline session switching):

```tmux
set -g mouse on
```

Open session manager:

```tmux
bind-key C-f run-shell 'vtm session-manager'
```

Use in statusline:

```tmux
set -g status-right '#(vtm statusline-sessions) #[fg=colour250]| %Y-%m-%d %H:%M'
```

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
