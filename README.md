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
- `vtm category next`
- `vtm category prev`
- `vtm hooks on-client-session-changed [<client-name> <session-name>]`
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
  format: " {category} "
  prefix: ""
  suffix: ""
  bold: true
  colors:
    fg: "#1C1C1C"
    bg: "#FAB387"
    outerBg: "#352F63"

statuslineSessions:
  showIndex: false
  current:
    format: " {session} "
    prefix: ""
    suffix: ""
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

Category resolution order:

1. Session override metadata (`@category_override`)
2. Path rules
3. Session name rules
4. `defaultCategory`

Path rules use first-match-wins. For GHQ projects, matching is done against the GHQ-root-relative path such as `github.com/org/repo`. For non-GHQ projects, matching is done against the normalized absolute path, with `~` expanded to `HOME`.

`ghqPatterns` and `pathPatterns` support `${VAR_NAME}` environment variable expansion at config load time. For example, with `WORK_GHQ_OWNER=acme-inc`, `github.com/${WORK_GHQ_OWNER}/*` resolves to `github.com/acme-inc/*`. Referencing an undefined environment variable is treated as a config error. Existing fixed-string patterns continue to work unchanged.

Unknown config keys are ignored during config loading so newer or extra keys do not make `vtm` fail at startup.

Category names remain strings. Use `categories.order` to assign integer ordering, and `vtm category next` / `vtm category prev` use that order.

When `categories` is omitted, every session belongs to one unnamed category. In that mode, session cycling and statusline session switching continue to operate across all sessions, similar to the pre-category behavior, and `vtm statusline-category` renders nothing.

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
bind-key ] run-shell 'vtm category next'
bind-key [ run-shell 'vtm category prev'
```

`vtm category use <name>` changes the current category for that tmux client, then restores the last active session remembered for that client and category. If no remembered session exists, it switches to the first session in the category. If the category has no sessions, only the category is updated.

Last-active session timing:

- session switches triggered through `vtm` update the remembered session immediately
- `vtm category use` first reconciles the tmux client's actual current session before switching away
- to track plain tmux session switches as well, install the hook below
- client-scoped category state is stored in tmux server-scoped user options keyed by client name, so it survives session switches on the same client

`statuslineCategory.format` replaces `{category}` with the current category name. `prefix` and `suffix` are rendered around it, and `colors.outerBg` is used as the outside background for those edge glyphs. If the resolved category is unnamed, the category segment is disabled and prints an empty string.
`statuslineSessions.current.format` and `statuslineSessions.other.format` replace `{session}` with the rendered session label. When `--show-index` or `showIndex: true` is enabled, that label includes the 1-based index like `1 foo`.

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

Track standard tmux session changes so category restore follows the real last active session:

```tmux
set-hook -g client-session-changed 'run-shell "vtm hooks on-client-session-changed #{client_name} #{session_name}"'
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
- `@category_last_session_<hex(category)>`: last active session for each category, scoped to the tmux client

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
- If your GHQ root is fixed, set `ghqRoot` in config to avoid calling `ghq root` on every command.
- If category matching looks wrong, verify `ghqRoot` / `GHQ_ROOT` / `ghq root`, then run `vtm sessions refresh-category`.
