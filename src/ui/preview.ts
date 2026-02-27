import { access } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import chalk from "chalk"
import type { ResolvedConfig } from "../config/schema"
import type { TmuxClient } from "../tmux/client"
import {
  parseIntSafe,
  splitNonEmptyLines,
  splitWindowTarget,
} from "../tmux/parse"
import { padVisible, truncateVisible } from "./format"

const HEADER_BOX_FALLBACK_WIDTH = 60
const SERVER_HEADER_FALLBACK_WIDTH = 46
const PREVIEW_BOX_FALLBACK_WIDTH = 76
const PREVIEW_BOX_MIN_WIDTH = 24
const ACTIVE_ACTIVITY_THRESHOLD_SECONDS = 60 * 60

const SYMBOLS = {
  activityActive: "*",
  activityIdle: "·",
  active: "▸",
  inactive: "·",
} as const

type RepoInfo = {
  readonly name: string
  readonly rootPath: string
}

type PreviewPane = {
  readonly index: string
  readonly command: string
  readonly width: number
  readonly height: number
  readonly active: boolean
}

export const computeSessionCaptureLines = (
  previewLines: number | null | undefined,
  windowCount: number,
  fallback: number,
): number => {
  const safeWindowCount = Math.max(0, Math.floor(windowCount))
  const safePreviewLines =
    typeof previewLines === "number" && Number.isFinite(previewLines)
      ? Math.floor(previewLines)
      : 0
  const staticLines = 11
  const dynamicLines = 1 + safeWindowCount + 1
  const margin = staticLines + dynamicLines
  if (safePreviewLines > margin + 3) {
    return safePreviewLines - margin
  }
  return fallback
}

export const computePerPaneCaptureLines = (
  previewLines: number | null | undefined,
  paneCount: number,
  fallback: number,
): number => {
  const safePaneCount = Math.max(1, Math.floor(paneCount))
  const safePreviewLines =
    typeof previewLines === "number" && Number.isFinite(previewLines)
      ? Math.floor(previewLines)
      : 0
  const headerLines = 4
  const listLines = 1 + safePaneCount + 1
  const staticLines = headerLines + listLines

  if (safePreviewLines > 0) {
    const available = safePreviewLines - staticLines
    if (available > 2 * safePaneCount + 1) {
      const computed = Math.floor(available / safePaneCount) - 2
      return Math.max(fallback, computed, 3)
    }
  }

  return fallback
}

const readPreviewLines = (env: NodeJS.ProcessEnv): number | null => {
  const raw = env.FZF_PREVIEW_LINES
  if (typeof raw !== "string" || raw.length === 0) {
    return null
  }

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }

  return parsed
}

const readPreviewColumns = (env: NodeJS.ProcessEnv): number | null => {
  const raw = env.FZF_PREVIEW_COLUMNS
  if (typeof raw !== "string" || raw.length === 0) {
    return null
  }

  const parsed = Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null
  }

  return parsed
}

const fitPreviewLine = (
  line: string,
  env: NodeJS.ProcessEnv,
  padding = 3,
): string => {
  const columns = readPreviewColumns(env)
  if (columns === null) {
    return line
  }
  const max = Math.max(20, columns - padding)
  return truncateVisible(line, max)
}

const resolveBoxWidth = ({
  env,
  fallback,
}: {
  readonly env: NodeJS.ProcessEnv
  readonly fallback: number
}): number => {
  const columns = readPreviewColumns(env)
  if (columns === null) {
    return fallback
  }
  return Math.max(PREVIEW_BOX_MIN_WIDTH, columns - 2)
}

const renderHeaderBox = ({
  title,
  env,
  fallbackWidth = HEADER_BOX_FALLBACK_WIDTH,
}: {
  readonly title: string
  readonly env: NodeJS.ProcessEnv
  readonly fallbackWidth?: number
}): string[] => {
  const width = resolveBoxWidth({ env, fallback: fallbackWidth })
  const normalized = padVisible(` ${truncateVisible(title, width - 2)} `, width)

  return [
    chalk.magenta(`╔${"═".repeat(width)}╗`),
    `${chalk.magenta("║")}${chalk.bold(chalk.cyan(normalized))}${chalk.magenta("║")}`,
    chalk.magenta(`╚${"═".repeat(width)}╝`),
  ]
}

const renderInfoBlock = (
  rows: Array<{ label: string; value: string }>,
  title: string,
): string[] => {
  const lines = [chalk.bold(chalk.blue(`┌─ ${title}`))]

  if (rows.length === 0) {
    lines.push(`${chalk.blue("└─")} ${chalk.dim("(none)")}`)
    return lines
  }

  for (const [index, row] of rows.entries()) {
    const branch = index === rows.length - 1 ? "└─" : "├─"
    lines.push(
      `${chalk.blue(branch)} ${chalk.dim(row.label.padEnd(14))} ${row.value}`,
    )
  }

  return lines
}

const renderPanePreviewBlock = ({
  title,
  paneLines,
  emptyLabel,
  env,
}: {
  readonly title: string
  readonly paneLines: readonly string[]
  readonly emptyLabel: string
  readonly env: NodeJS.ProcessEnv
}): string[] => {
  const innerWidth = resolveBoxWidth({
    env,
    fallback: PREVIEW_BOX_FALLBACK_WIDTH,
  })
  const normalizedTitle = padVisible(
    ` ${truncateVisible(title, innerWidth - 2)} `,
    innerWidth,
  )
  const body = paneLines.length > 0 ? paneLines : [emptyLabel]

  const lines: string[] = []
  lines.push(chalk.blue(`┌${"─".repeat(innerWidth)}┐`))
  lines.push(
    `${chalk.blue("│")}${chalk.bold(chalk.cyan(normalizedTitle))}${chalk.blue("│")}`,
  )
  lines.push(chalk.blue(`├${"─".repeat(innerWidth)}┤`))

  for (const line of body) {
    const content = padVisible(truncateVisible(line, innerWidth), innerWidth)
    lines.push(`${chalk.blue("│")}${content}${chalk.blue("│")}`)
  }

  lines.push(chalk.blue(`└${"─".repeat(innerWidth)}┘`))
  return lines
}

const formatAgoFromEpoch = (epochSeconds: number): string => {
  if (!Number.isFinite(epochSeconds) || epochSeconds <= 0) {
    return "unknown"
  }

  const nowSeconds = Math.floor(Date.now() / 1000)
  const delta = Math.max(0, nowSeconds - epochSeconds)

  if (delta < 60) {
    return `${delta}s ago`
  }
  if (delta < 3600) {
    return `${Math.floor(delta / 60)}m ago`
  }
  if (delta < 86_400) {
    return `${Math.floor(delta / 3600)}h ago`
  }
  return `${Math.floor(delta / 86_400)}d ago`
}

const activityBadge = (lastActivity: number): string => {
  if (!Number.isFinite(lastActivity) || lastActivity <= 0) {
    return chalk.dim(SYMBOLS.activityIdle)
  }

  const nowSeconds = Math.floor(Date.now() / 1000)
  const delta = Math.max(0, nowSeconds - lastActivity)
  if (delta <= ACTIVE_ACTIVITY_THRESHOLD_SECONDS) {
    return chalk.yellow(SYMBOLS.activityActive)
  }

  return chalk.dim(SYMBOLS.activityIdle)
}

const shortenPath = (path: string, env: NodeJS.ProcessEnv): string => {
  if (path.length === 0) {
    return ""
  }

  const home = env.HOME
  if (typeof home !== "string" || home.length === 0) {
    return path
  }

  if (path === home) {
    return "~"
  }

  if (path.startsWith(`${home}/`)) {
    return `~/${path.slice(home.length + 1)}`
  }

  return path
}

const pathExists = async (path: string): Promise<boolean> => {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

const findGitRoot = async (startPath: string): Promise<string | null> => {
  if (startPath.length === 0) {
    return null
  }

  let cursor = resolve(startPath)
  while (true) {
    if (await pathExists(join(cursor, ".git"))) {
      return cursor
    }

    const parent = dirname(cursor)
    if (parent === cursor) {
      return null
    }
    cursor = parent
  }
}

const collectRepoInfo = async (path: string): Promise<RepoInfo | null> => {
  if (path.length === 0) {
    return null
  }

  const rootPath = await findGitRoot(path)
  if (rootPath === null) {
    return null
  }

  const name = basename(rootPath)
  if (name.length === 0) {
    return null
  }

  return {
    name,
    rootPath,
  }
}

const getPaneIcon = (command: string): string => {
  switch (command) {
    case "vim":
    case "nvim":
      return "V"
    case "bash":
    case "zsh":
    case "fish":
      return "S"
    case "ssh":
      return "K"
    default:
      return "C"
  }
}

const parsePreviewPanes = (output: string): PreviewPane[] => {
  return splitNonEmptyLines(output)
    .map((line) => {
      const [index, command, width, height, active] = line.split("\t")
      return {
        index: (index ?? "").trim(),
        command: (command ?? "").trim(),
        width: parseIntSafe(width, 0),
        height: parseIntSafe(height, 0),
        active: active === "1",
      }
    })
    .filter((pane) => pane.index.length > 0)
}

const collectPaneCurrentPath = async (
  tmux: TmuxClient,
  target: string,
): Promise<string> => {
  const candidate = tmux as Partial<TmuxClient>
  if (typeof candidate.paneCurrentPath === "function") {
    const value = await candidate.paneCurrentPath(target)
    return value.trim()
  }

  return ""
}

const renderSessionPreview = async ({
  tmux,
  config,
  sessionName,
  env,
}: {
  readonly tmux: TmuxClient
  readonly config: ResolvedConfig
  readonly sessionName: string
  readonly env: NodeJS.ProcessEnv
}): Promise<string> => {
  const sessions = await tmux.listSessions()
  const session = sessions.find((candidate) => candidate.name === sessionName)
  if (!session) {
    return chalk.red(`Session not found: ${sessionName}`)
  }

  const windows = await tmux.listWindows(sessionName)
  const activeWindow = windows.find((window) => window.active) ?? windows[0]
  const activePaneTarget = activeWindow
    ? `${sessionName}:${activeWindow.index}.0`
    : ""

  const captureLines = computeSessionCaptureLines(
    readPreviewLines(env),
    windows.length,
    config.sessionManager.preview.sessionCaptureLines,
  )

  const [paneTail, activePanePath] = await Promise.all([
    activePaneTarget.length > 0
      ? tmux.capturePaneTail(activePaneTarget, captureLines)
      : Promise.resolve([]),
    activePaneTarget.length > 0
      ? collectPaneCurrentPath(tmux, activePaneTarget)
      : Promise.resolve(""),
  ])

  const repoInfo = await collectRepoInfo(activePanePath)

  const lines: string[] = []
  lines.push(...renderHeaderBox({ title: `Session ${sessionName}`, env }))
  lines.push("")
  lines.push(
    ...renderInfoBlock(
      [
        {
          label: "Status",
          value:
            session.attachedClients > 0
              ? chalk.yellow(`attached (${session.attachedClients})`)
              : chalk.dim("detached"),
        },
        {
          label: "Windows",
          value: chalk.cyan(String(windows.length)),
        },
        {
          label: "Last Activity",
          value: `${activityBadge(session.lastActivity)} ${chalk.dim(formatAgoFromEpoch(session.lastActivity))}`,
        },
        {
          label: "Repo",
          value:
            repoInfo === null
              ? chalk.dim("(not git repo)")
              : `${chalk.cyan(repoInfo.name)} ${chalk.dim(`(${truncateVisible(shortenPath(repoInfo.rootPath, env), 44)})`)}`,
        },
        {
          label: "Path",
          value:
            activePanePath.length > 0
              ? chalk.dim(truncateVisible(shortenPath(activePanePath, env), 52))
              : chalk.dim("(unknown)"),
        },
      ],
      "Session Info",
    ),
  )

  lines.push("")
  lines.push(chalk.bold(chalk.blue("┌─ Windows")))
  if (windows.length === 0) {
    lines.push(`${chalk.blue("└─")} ${chalk.dim("(no windows)")}`)
  } else {
    for (const [index, window] of windows.entries()) {
      const marker = window.active
        ? chalk.green(SYMBOLS.active)
        : chalk.dim(SYMBOLS.inactive)
      const branch = index === windows.length - 1 ? "└─" : "├─"
      const commandLabel =
        window.command.length > 0
          ? ` ${chalk.dim(`cmd:${truncateVisible(window.command, 28)}`)}`
          : ""

      lines.push(
        `${chalk.blue(branch)} ${marker} ${chalk.cyan(window.index)} ${truncateVisible(window.name, 26)} ${chalk.dim(`[${window.panes}P]`)}${commandLabel}`,
      )
    }
  }

  lines.push("")
  const previewTitle = activeWindow
    ? `Active Pane ${sessionName}:${activeWindow.index}.0 (last ${captureLines} lines)`
    : `Active Pane (last ${captureLines} lines)`
  lines.push(
    ...renderPanePreviewBlock({
      title: previewTitle,
      paneLines: paneTail.map((line) => fitPreviewLine(line, env)),
      emptyLabel: activeWindow
        ? "(preview not available)"
        : "(active window not found)",
      env,
    }),
  )

  return lines.join("\n")
}

const renderWindowPreview = async ({
  tmux,
  config,
  target,
  env,
}: {
  readonly tmux: TmuxClient
  readonly config: ResolvedConfig
  readonly target: string
  readonly env: NodeJS.ProcessEnv
}): Promise<string> => {
  const resolved = splitWindowTarget(target)
  if (!resolved) {
    return chalk.red(`Invalid window target: ${target}`)
  }

  const windows = await tmux.listWindows(resolved.sessionName)
  const window = windows.find(
    (candidate) => candidate.index === resolved.windowIndex,
  )
  if (!window) {
    return chalk.red(`Window not found: ${target}`)
  }

  const paneListResult = await tmux.run(
    [
      "list-panes",
      "-t",
      `${resolved.sessionName}:${resolved.windowIndex}`,
      "-F",
      "#{pane_index}\t#{pane_current_command}\t#{pane_width}\t#{pane_height}\t#{pane_active}",
    ],
    { allowFail: true },
  )
  const panes = parsePreviewPanes(paneListResult.stdout)
  const perPaneLines = computePerPaneCaptureLines(
    readPreviewLines(env),
    panes.length,
    config.sessionManager.preview.paneCaptureLines,
  )

  const activePane = panes.find((pane) => pane.active) ?? panes[0]
  const activePaneTarget = activePane
    ? `${resolved.sessionName}:${resolved.windowIndex}.${activePane.index}`
    : ""
  const activePanePath =
    activePaneTarget.length > 0
      ? await collectPaneCurrentPath(tmux, activePaneTarget)
      : ""
  const repoInfo = await collectRepoInfo(activePanePath)

  const lines: string[] = []
  lines.push(
    ...renderHeaderBox({ title: `Window ${target}`, env }),
    "",
    ...renderInfoBlock(
      [
        { label: "Name", value: truncateVisible(window.name, 40) },
        { label: "Panes", value: chalk.cyan(String(window.panes)) },
        {
          label: "Command",
          value:
            window.command.length > 0
              ? chalk.magenta(window.command)
              : chalk.dim("(unknown)"),
        },
        {
          label: "Repo",
          value:
            repoInfo === null
              ? chalk.dim("(not git repo)")
              : `${chalk.cyan(repoInfo.name)} ${chalk.dim(`(${truncateVisible(shortenPath(repoInfo.rootPath, env), 44)})`)}`,
        },
        {
          label: "Path",
          value:
            activePanePath.length > 0
              ? chalk.dim(truncateVisible(shortenPath(activePanePath, env), 52))
              : chalk.dim("(unknown)"),
        },
      ],
      "Window Info",
    ),
  )
  lines.push("")
  lines.push(chalk.bold(chalk.blue("┌─ Pane List")))

  if (panes.length === 0) {
    lines.push(`${chalk.blue("└─")} ${chalk.dim("(no panes)")}`)
    return lines.join("\n")
  }

  for (const [index, pane] of panes.entries()) {
    const marker = pane.active
      ? chalk.green(SYMBOLS.active)
      : chalk.dim(SYMBOLS.inactive)
    const branch = index === panes.length - 1 ? "└─" : "├─"
    lines.push(
      `${chalk.blue(branch)} ${marker} ${pane.index}: ${getPaneIcon(pane.command)} ${truncateVisible(pane.command || "(unknown)", 20)} ${chalk.dim(`(${pane.width}x${pane.height})`)}`,
    )
  }

  lines.push("")
  lines.push(
    chalk.bold(chalk.blue(`┌─ Pane Preview (last ${perPaneLines} lines each)`)),
  )

  const paneTails = await Promise.all(
    panes.map((pane) =>
      tmux.capturePaneTail(
        `${resolved.sessionName}:${resolved.windowIndex}.${pane.index}`,
        perPaneLines,
      ),
    ),
  )

  for (const [index, pane] of panes.entries()) {
    const paneLines = paneTails[index] ?? []
    const titlePrefix = pane.active ? SYMBOLS.active : SYMBOLS.inactive
    const title = `${titlePrefix} Pane ${pane.index} (${truncateVisible(pane.command || "unknown", 24)})`

    lines.push(
      ...renderPanePreviewBlock({
        title,
        paneLines: paneLines.map((line) => fitPreviewLine(line, env)),
        emptyLabel: "(preview not available)",
        env,
      }),
    )

    if (index < panes.length - 1) {
      lines.push("")
    }
  }

  return lines.join("\n")
}

const renderServerPreview = (env: NodeJS.ProcessEnv): string => {
  return [
    ...renderHeaderBox({
      title: "tmux server",
      env,
      fallbackWidth: SERVER_HEADER_FALLBACK_WIDTH,
    }),
    "",
    "Selecting this row with Ctrl-Q runs:",
    chalk.cyan("tmux kill-server"),
    "",
    chalk.dim("All sessions are terminated."),
  ].join("\n")
}

export const renderPreviewOnce = async ({
  tmux,
  config,
  action,
  name,
  env = process.env,
}: {
  readonly tmux: TmuxClient
  readonly config: ResolvedConfig
  readonly action: string
  readonly name: string
  readonly env?: NodeJS.ProcessEnv
}): Promise<string> => {
  if (action === "session") {
    return renderSessionPreview({ tmux, config, sessionName: name, env })
  }

  if (action === "window") {
    return renderWindowPreview({ tmux, config, target: name, env })
  }

  if (action === "server") {
    return renderServerPreview(env)
  }

  return chalk.dim("Preview not available")
}
