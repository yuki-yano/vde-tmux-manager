import chalk from "chalk"
import {
  getCurrentCategory,
  resolveEffectiveSessionCategory,
  switchClientAndRememberSession,
} from "../../categories/state"
import { resolveGhqRoot } from "../../categories/runtime"
import { loadConfig } from "../../config/loader"
import type { ResolvedConfig } from "../../config/schema"
import {
  runFzf,
  normalizeRefreshMs,
  type SelectorEntry,
} from "../../fzf/runner"
import { runCommand } from "../../process/exec"
import { createTmuxClient, type TmuxClient } from "../../tmux/client"
import {
  killPaneClean,
  killServerClean,
  killSessionClean,
  killWindowClean,
  resolveSessionNameFromSelection,
} from "../../tmux/actions"
import {
  parseIntSafe,
  splitNonEmptyLines,
  splitWindowTarget,
  type SessionDetails,
  type WindowInfo,
} from "../../tmux/parse"
import { renderPreviewOnce } from "../../ui/preview"
import {
  padVisible,
  stripAnsi,
  truncateVisible,
  visibleWidth,
} from "../../ui/format"

const EXIT_CODE_OK = 0
const EXIT_CODE_ERROR = 1
const EXIT_CODE_USAGE = 2
const ACTIVE_ACTIVITY_THRESHOLD_SECONDS = 60 * 60

const SYMBOLS = {
  sessionCurrent: "●",
  sessionAttached: "○",
  sessionDetached: "·",
  activityActive: "*",
  activityIdle: "·",
  active: "▸",
  inactive: "·",
  server: "✕",
} as const

type SessionWithWindows = SessionDetails & {
  readonly windows: ReadonlyArray<WindowInfo>
  readonly totalWindows: number
  readonly totalPanes: number
  readonly isCurrent: boolean
}

type SessionManagerOptions = {
  readonly popup: boolean
  readonly renderPreview?: string
  readonly previewName?: string
  readonly positional: readonly string[]
}

const parseAllWindowsBySession = (
  output: string,
): Map<string, WindowInfo[]> => {
  const grouped = new Map<string, WindowInfo[]>()

  for (const line of splitNonEmptyLines(output)) {
    const [sessionName, index, panes, active, name, command] = line.split("\t")
    const normalizedSessionName = (sessionName ?? "").trim()
    const normalizedIndex = (index ?? "").trim()

    if (normalizedSessionName.length === 0 || normalizedIndex.length === 0) {
      continue
    }

    const windows = grouped.get(normalizedSessionName) ?? []
    windows.push({
      index: normalizedIndex,
      panes: parseIntSafe(panes, 0),
      active: active === "1",
      name: (name ?? "").trim() || "(unnamed)",
      command: (command ?? "").trim(),
    })
    grouped.set(normalizedSessionName, windows)
  }

  return grouped
}

export type RunSessionManagerDeps = {
  readonly programName: string
  readonly stdout: (line: string) => void
  readonly stderr: (line: string) => void
  readonly tmux?: TmuxClient
  readonly loadConfigFn?: typeof loadConfig
  readonly runCommandFn?: typeof runCommand
  readonly argv?: readonly string[]
  readonly env?: NodeJS.ProcessEnv
}

const usageText = (programName: string): string => {
  return [
    `Usage: ${programName} session-manager [--popup]`,
    `       ${programName} session-manager kill-window <target>`,
    `       ${programName} session-manager kill-pane <target>`,
    "",
    "Interactive controls:",
    "  Enter   switch/attach",
    "  Ctrl-T  create session",
    "  Ctrl-Q  clean kill target",
    "  Ctrl-R  rename session",
  ].join("\n")
}

const isHelpFlag = (value: string): boolean =>
  value === "-h" || value === "--help"

const shellEscape = (value: string): string => {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

const parseOptions = (args: readonly string[]): SessionManagerOptions => {
  let popup = false
  let renderPreview: string | undefined
  let previewName: string | undefined
  const positional: string[] = []

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] as string

    if (arg === "--popup") {
      popup = true
      continue
    }

    if (arg === "--render-preview") {
      const value = args[index + 1]
      if (typeof value !== "string" || value.length === 0) {
        throw new Error("--render-preview requires a value")
      }
      renderPreview = value
      index += 1
      continue
    }

    if (arg === "--preview-name") {
      const value = args[index + 1]
      if (typeof value !== "string" || value.length === 0) {
        throw new Error("--preview-name requires a value")
      }
      previewName = value
      index += 1
      continue
    }

    positional.push(arg)
  }

  return {
    popup,
    renderPreview,
    previewName,
    positional,
  }
}

const collectSessions = async ({
  tmux,
  inTmux,
  config,
  homeDirectory,
  ghqRoot,
}: {
  readonly tmux: TmuxClient
  readonly inTmux: boolean
  readonly config: ResolvedConfig
  readonly homeDirectory: string
  readonly ghqRoot: string | null
}): Promise<SessionWithWindows[]> => {
  const [sessions, currentSession, allWindowsResult] = await Promise.all([
    tmux.listSessionDetails(),
    inTmux ? tmux.currentSession() : Promise.resolve(""),
    tmux.run(
      [
        "list-windows",
        "-a",
        "-F",
        "#{session_name}\t#{window_index}\t#{window_panes}\t#{window_active}\t#{window_name}\t#{pane_current_command}",
      ],
      { allowFail: true },
    ),
  ])
  const windowsBySession = parseAllWindowsBySession(allWindowsResult.stdout)

  const result: SessionWithWindows[] = []
  for (const session of sessions) {
    const windows = windowsBySession.get(session.name) ?? []
    const totalPanes = windows.reduce((sum, window) => sum + window.panes, 0)

    result.push({
      ...session,
      category: resolveEffectiveSessionCategory({
        session,
        config,
        homeDirectory,
        ghqRoot,
      }),
      windows,
      totalWindows: windows.length,
      totalPanes,
      isCurrent: inTmux && session.name === currentSession,
    })
  }

  return result
}

const buildRows = (
  sessions: ReadonlyArray<SessionWithWindows>,
  currentCategory: string,
): Array<{
  action: "session" | "window" | "server"
  name: string
  columns: string[]
}> => {
  const rows: Array<{
    action: "session" | "window" | "server"
    name: string
    columns: string[]
  }> = []

  const nowSeconds = Math.floor(Date.now() / 1000)
  const getSessionStateSymbol = (session: SessionWithWindows): string => {
    if (session.isCurrent) {
      return chalk.green(SYMBOLS.sessionCurrent)
    }
    if (session.attachedClients > 0) {
      return chalk.yellow(SYMBOLS.sessionAttached)
    }
    return chalk.gray(SYMBOLS.sessionDetached)
  }

  const getActivityBadge = (lastActivity: number): string => {
    if (!Number.isFinite(lastActivity) || lastActivity <= 0) {
      return chalk.gray(SYMBOLS.activityIdle)
    }

    const delta = Math.max(0, nowSeconds - lastActivity)
    if (delta <= ACTIVE_ACTIVITY_THRESHOLD_SECONDS) {
      return chalk.yellow(SYMBOLS.activityActive)
    }

    return chalk.gray(SYMBOLS.activityIdle)
  }

  const orderedSessions = [...sessions].sort((left, right) => {
    const leftCurrent = left.category === currentCategory ? 0 : 1
    const rightCurrent = right.category === currentCategory ? 0 : 1
    if (leftCurrent !== rightCurrent) {
      return leftCurrent - rightCurrent
    }
    const categoryCompare = left.category.localeCompare(right.category)
    if (categoryCompare !== 0) {
      return categoryCompare
    }
    return left.name.localeCompare(right.name)
  })

  for (const session of orderedSessions) {
    const stateSymbol = getSessionStateSymbol(session)
    const activity = getActivityBadge(session.lastActivity)
    const attachedState =
      session.attachedClients > 0
        ? chalk.yellow(`attached:${session.attachedClients}`)
        : chalk.gray("detached")
    const categoryLabel =
      session.category === currentCategory
        ? chalk.green(`[${session.category}]`)
        : chalk.cyan(`[${session.category}]`)

    rows.push({
      action: "session",
      name: session.name,
      columns: [
        `${stateSymbol} ${activity} ${chalk.bold(session.name)}`,
        categoryLabel,
        `${chalk.gray("win")} ${chalk.cyan(String(session.totalWindows))}`,
        `${chalk.gray("pane")} ${chalk.cyan(String(session.totalPanes))}`,
        attachedState,
      ],
    })

    for (const [index, window] of session.windows.entries()) {
      const branch = index === session.windows.length - 1 ? "  └─" : "  ├─"
      const active = window.active
        ? chalk.green(SYMBOLS.active)
        : chalk.gray(SYMBOLS.inactive)
      const command =
        window.command.length > 0
          ? chalk.magenta(truncateVisible(window.command, 28))
          : chalk.gray("-")

      rows.push({
        action: "window",
        name: `${session.name}:${window.index}`,
        columns: [
          `${branch} ${active} ${chalk.bold(session.name)}:${chalk.cyan(window.index)} ${truncateVisible(window.name, 24)}`,
          categoryLabel,
          `${chalk.gray("pane")} ${chalk.cyan(String(window.panes))}`,
          `${chalk.gray("cmd")} ${command}`,
          "",
        ],
      })
    }
  }

  if (sessions.length > 1) {
    rows.push({
      action: "server",
      name: "",
      columns: [
        `  ${chalk.red(SYMBOLS.server)} ${chalk.bold("tmux server")}`,
        chalk.gray(`[${currentCategory}]`),
        chalk.cyan("tmux kill-server"),
        "",
        "",
      ],
    })
  }

  return rows
}

const isBlankColumn = (value: string | undefined): boolean => {
  if (typeof value !== "string") {
    return true
  }

  return stripAnsi(value).trim().length === 0
}

const lastUsedColumnIndex = (columns: readonly string[]): number => {
  for (let index = columns.length - 1; index >= 0; index -= 1) {
    if (!isBlankColumn(columns[index])) {
      return index
    }
  }

  return 0
}

const computeColumnWidths = (
  rows: ReadonlyArray<{ columns: readonly string[] }>,
): number[] => {
  const maxColumns = rows.reduce(
    (max, row) => Math.max(max, row.columns.length),
    0,
  )
  const widths = Array.from({ length: maxColumns }, () => 0)

  for (const row of rows) {
    const limit = lastUsedColumnIndex(row.columns)
    for (let index = 0; index < limit; index += 1) {
      const column = row.columns[index] ?? ""
      widths[index] = Math.max(widths[index] ?? 0, visibleWidth(column))
    }
  }

  return widths
}

const renderRows = (
  rows: ReadonlyArray<{
    action: "session" | "window" | "server"
    name: string
    columns: string[]
  }>,
): SelectorEntry[] => {
  const widths = computeColumnWidths(rows)

  return rows.map((row) => {
    const limit = lastUsedColumnIndex(row.columns)
    const segments: string[] = []

    for (let index = 0; index <= limit; index += 1) {
      const column = row.columns[index] ?? ""
      if (index < limit) {
        segments.push(padVisible(column, widths[index] ?? 0))
      } else {
        segments.push(column)
      }
    }

    return {
      action: row.action,
      name: row.name,
      display: segments.join(` ${chalk.gray("|")} `),
    }
  })
}

const buildEntries = (
  sessions: ReadonlyArray<SessionWithWindows>,
  currentCategory: string,
): SelectorEntry[] => {
  return renderRows(buildRows(sessions, currentCategory))
}

const parseSelectionLines = (
  lines: readonly string[],
): { key: "enter" | "ctrl-q" | "ctrl-t" | "ctrl-r"; selections: string[] } => {
  if (lines.length === 0) {
    return {
      key: "enter",
      selections: [],
    }
  }

  const first = (lines[0] ?? "").trim()
  if (
    first === "enter" ||
    first === "ctrl-q" ||
    first === "ctrl-t" ||
    first === "ctrl-r"
  ) {
    return {
      key: first,
      selections: lines.slice(1) as string[],
    }
  }

  return {
    key: "enter",
    selections: [...lines],
  }
}

const parseEntryLine = (
  line: string,
): { action: "session" | "window" | "server"; name: string } | null => {
  const [action, name] = line.split("\t")
  if (action !== "session" && action !== "window" && action !== "server") {
    return null
  }

  return {
    action,
    name: (name ?? "").trim(),
  }
}

const runPreviewRenderer = async ({
  tmux,
  config,
  action,
  name,
  env,
}: {
  readonly tmux: TmuxClient
  readonly config: ResolvedConfig
  readonly action: string
  readonly name: string
  readonly env: NodeJS.ProcessEnv
}): Promise<void> => {
  const refreshMs = normalizeRefreshMs(env.PREVIEW_REFRESH_MS)

  if (refreshMs <= 0) {
    const preview = await renderPreviewOnce({
      tmux,
      config,
      action,
      name,
      env,
    })
    process.stdout.write(`${preview}\n`)
    return
  }

  while (true) {
    try {
      const preview = await renderPreviewOnce({
        tmux,
        config,
        action,
        name,
        env,
      })
      process.stdout.write("\u001b[H\u001b[2J")
      process.stdout.write(`${preview}\n`)
      await new Promise<void>((resolve) => setTimeout(resolve, refreshMs))
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException
      if (nodeError.code === "EPIPE") {
        return
      }
      throw error
    }
  }
}

const runDirectCommand = async ({
  positional,
  tmux,
  config,
  runner,
  stderr,
  programName,
}: {
  readonly positional: readonly string[]
  readonly tmux: TmuxClient
  readonly config: ResolvedConfig
  readonly runner: typeof runCommand
  readonly stderr: (line: string) => void
  readonly programName: string
}): Promise<number | null> => {
  const [name, target] = positional
  if (name !== "kill-window" && name !== "kill-pane") {
    return null
  }

  if (isHelpFlag(target ?? "")) {
    stderr(`Usage: ${programName} session-manager ${name} <target>`)
    return EXIT_CODE_OK
  }

  if (typeof target !== "string" || target.length === 0) {
    stderr(`Usage: ${programName} session-manager ${name} <target>`)
    return EXIT_CODE_USAGE
  }

  if (name === "kill-window") {
    await killWindowClean({ tmux, config, target, runner })
  } else {
    await killPaneClean({ tmux, config, target, runner })
  }

  return EXIT_CODE_OK
}

const openPopupIfNeeded = async ({
  tmux,
  config,
  popup,
  env,
  argv,
}: {
  readonly tmux: TmuxClient
  readonly config: ResolvedConfig
  readonly popup: boolean
  readonly env: NodeJS.ProcessEnv
  readonly argv: readonly string[]
}): Promise<boolean> => {
  if (popup || config.sessionManager.popup.enabled !== true) {
    return false
  }

  if (typeof env.TMUX !== "string" || env.TMUX.length === 0) {
    return false
  }

  const panePathResult = await tmux.run(
    ["display-message", "-p", "#{pane_current_path}"],
    { allowFail: true },
  )
  const panePathFromTmux = panePathResult.stdout.trim()
  const home = env.HOME
  const panePath =
    panePathFromTmux.length > 0
      ? panePathFromTmux
      : typeof home === "string" && home.length > 0
        ? home
        : process.cwd()

  const executable = argv[1] ?? "vtm"
  await tmux.run(
    [
      "display-popup",
      "-E",
      "-w",
      config.sessionManager.popup.width,
      "-h",
      config.sessionManager.popup.height,
      "-d",
      panePath,
      executable,
      "session-manager",
      "--popup",
    ],
    { allowFail: false },
  )

  return true
}

const runSelection = async ({
  lines,
  tmux,
  config,
  popup,
  stderr,
  runner,
  env,
}: {
  readonly lines: readonly string[]
  readonly tmux: TmuxClient
  readonly config: ResolvedConfig
  readonly popup: boolean
  readonly stderr: (line: string) => void
  readonly runner: typeof runCommand
  readonly env: NodeJS.ProcessEnv
}): Promise<void> => {
  const { key, selections } = parseSelectionLines(lines)

  if (key === "ctrl-t") {
    if (typeof env.TMUX === "string" && env.TMUX.length > 0) {
      const created = await tmux.newSessionDetached()
      if (created.length > 0) {
        await tmux.switchClient(created)
      } else {
        await tmux.newSessionInteractive(true)
      }

      if (popup) {
        return
      }
      return
    }

    await tmux.newSessionInteractive(true)
    return
  }

  if (key === "ctrl-q") {
    const targets = new Set<string>()

    for (const line of selections) {
      const parsed = parseEntryLine(line)
      if (!parsed) {
        continue
      }

      const sessionName = resolveSessionNameFromSelection(parsed)
      if (sessionName.length > 0) {
        targets.add(sessionName)
      }
    }

    if (
      typeof env.TMUX === "string" &&
      env.TMUX.length > 0 &&
      targets.size > 0
    ) {
      const sessions = await tmux.listSessions()
      const current = await tmux.currentSession()
      const fallback = sessions.find(
        (session) => targets.has(session.name) !== true,
      )
      if (targets.has(current) && fallback) {
        await tmux.switchClient(fallback.name)
      }
    }

    for (const line of selections) {
      const parsed = parseEntryLine(line)
      if (!parsed) {
        continue
      }

      if (parsed.action === "session") {
        await killSessionClean({
          tmux,
          config,
          sessionName: parsed.name,
          runner,
        })
      } else if (parsed.action === "window") {
        await killWindowClean({ tmux, config, target: parsed.name, runner })
      } else if (parsed.action === "server") {
        await killServerClean({ tmux, config, runner })
      }
    }
    return
  }

  if (key === "ctrl-r") {
    const first = selections[0]
    if (typeof first !== "string") {
      return
    }

    const parsed = parseEntryLine(first)
    if (!parsed) {
      return
    }

    const sessionName = resolveSessionNameFromSelection(parsed)
    if (sessionName.length === 0) {
      return
    }

    if (typeof env.TMUX !== "string" || env.TMUX.length === 0) {
      stderr(
        "[SESSION_RENAME_UNAVAILABLE] session rename requires tmux client context",
      )
      return
    }

    const escaped = sessionName.replaceAll("'", "''")
    await tmux.run(
      [
        "command-prompt",
        "-I",
        sessionName,
        `rename-session -t '${escaped}' '%%'`,
      ],
      { allowFail: true },
    )
    return
  }

  const first = selections[0]
  if (typeof first !== "string") {
    return
  }

  const parsed = parseEntryLine(first)
  if (!parsed) {
    return
  }

  const homeDirectory = env.HOME ?? process.env.HOME ?? ""
  const ghqRoot = await resolveGhqRoot({ env, runner })

  if (parsed.action === "session") {
    if (typeof env.TMUX === "string" && env.TMUX.length > 0) {
      await switchClientAndRememberSession({
        tmux,
        config,
        sessionName: parsed.name,
        homeDirectory,
        ghqRoot,
      })
    } else {
      await tmux.attachSession(parsed.name, true)
    }
    return
  }

  if (parsed.action === "window") {
    const sessionName =
      splitWindowTarget(parsed.name)?.sessionName ?? parsed.name
    if (typeof env.TMUX === "string" && env.TMUX.length > 0) {
      await switchClientAndRememberSession({
        tmux,
        config,
        sessionName,
        homeDirectory,
        ghqRoot,
      })
      await tmux.selectWindow(parsed.name)
      return
    }

    await tmux.selectWindow(parsed.name)
    await tmux.attachSession(sessionName, true)
  }
}

export const runSessionManager = async (
  args: readonly string[],
  {
    programName,
    stdout,
    stderr,
    tmux = createTmuxClient(),
    loadConfigFn = loadConfig,
    runCommandFn = runCommand,
    argv = process.argv,
    env = process.env,
  }: RunSessionManagerDeps,
): Promise<number> => {
  if (args.length > 0 && isHelpFlag(args[0] as string)) {
    stdout(usageText(programName))
    return EXIT_CODE_OK
  }

  let options: SessionManagerOptions
  try {
    options = parseOptions(args)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    stderr(`[USAGE] ${message}`)
    stderr(usageText(programName))
    return EXIT_CODE_USAGE
  }

  const { config } = await loadConfigFn()

  if (
    typeof options.renderPreview === "string" &&
    typeof options.previewName === "string"
  ) {
    await runPreviewRenderer({
      tmux,
      config,
      action: options.renderPreview,
      name: options.previewName,
      env,
    })
    return EXIT_CODE_OK
  }

  const directResult = await runDirectCommand({
    positional: options.positional,
    tmux,
    config,
    runner: runCommandFn,
    stderr,
    programName,
  })
  if (directResult !== null) {
    return directResult
  }

  if (options.positional.length > 0) {
    stderr(`[USAGE] ${usageText(programName)}`)
    return EXIT_CODE_USAGE
  }

  const openedPopup = await openPopupIfNeeded({
    tmux,
    config,
    popup: options.popup,
    env,
    argv,
  })
  if (openedPopup) {
    return EXIT_CODE_OK
  }

  const inTmux = typeof env.TMUX === "string" && env.TMUX.length > 0
  const currentCategory = await getCurrentCategory({ tmux, config })
  const ghqRoot = await resolveGhqRoot({ env })
  const sessions = await collectSessions({
    tmux,
    inTmux,
    config,
    homeDirectory: env.HOME ?? process.env.HOME ?? "",
    ghqRoot,
  })

  if (!inTmux && sessions.length === 0) {
    await tmux.newSessionInteractive(true)
    return EXIT_CODE_OK
  }

  const entries = buildEntries(sessions, currentCategory)
  const executable = argv[1] ?? "vtm"
  const previewCommand = `FORCE_COLOR=1 PREVIEW_REFRESH_MS=${config.sessionManager.fzf.previewRefreshMs} ${shellEscape(executable)} session-manager --popup --render-preview {1} --preview-name {2}`
  const headerText = `Current [${currentCategory}] | Enter switch | C-q kill | C-t new | C-r rename | C-d/C-u scroll`

  const lines = await runFzf({
    entries,
    prompt: config.sessionManager.fzf.prompt,
    headerText,
    border: config.sessionManager.fzf.border,
    previewWidth: config.sessionManager.fzf.previewWidth,
    previewCommand,
    popupWidth: config.sessionManager.popup.width,
    popupHeight: config.sessionManager.popup.height,
    forcePlain: options.popup,
    inTmux,
  })

  await runSelection({
    lines,
    tmux,
    config,
    popup: options.popup,
    stderr,
    runner: runCommandFn,
    env,
  })

  return EXIT_CODE_OK
}

export const SESSION_MANAGER_EXIT_CODE = {
  OK: EXIT_CODE_OK,
  ERROR: EXIT_CODE_ERROR,
  USAGE: EXIT_CODE_USAGE,
} as const

export const __internal = {
  parseOptions,
  collectSessions,
  buildEntries,
  parseSelectionLines,
  parseEntryLine,
  runPreviewRenderer,
  openPopupIfNeeded,
  runSelection,
}
