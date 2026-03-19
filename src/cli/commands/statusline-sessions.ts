import { homedir } from "node:os"
import {
  getSessionsInCategory,
  getCurrentCategory,
} from "../../categories/state"
import { loadConfig } from "../../config/loader"
import type { ResolvedConfig } from "../../config/schema"
import { resolveGhqRoot } from "../../categories/runtime"
import { createTmuxClient, type TmuxClient } from "../../tmux/client"
import type { SessionDetails, SessionIdentity } from "../../tmux/parse"

const EXIT_CODE_OK = 0
const EXIT_CODE_ERROR = 1
const EXIT_CODE_USAGE = 2

const isHelpFlag = (value: string): boolean =>
  value === "-h" || value === "--help"

const usageText = (programName: string): string => {
  return [
    `Usage: ${programName} statusline-sessions [--show-index]`,
    `       ${programName} statusline-sessions switch <index>`,
    "",
    "Print tmux statusline session segments or switch sessions by index.",
    "",
    "Options:",
    "  --show-index  Prefix session names with 1-based indexes (1-9 only)",
    "",
    "Commands:",
    "  switch <index>  Switch to the session at the given 1-based index",
  ].join("\n")
}

const buildSessionLabel = ({
  index,
  name,
  showIndex,
  prefix,
  suffix,
}: {
  readonly index: number
  readonly name: string
  readonly showIndex: boolean
  readonly prefix: string
  readonly suffix: string
}): string => {
  const label = showIndex && index <= 9 ? `${String(index)} ${name}` : `${name}`
  return `${prefix} ${label} ${suffix}`
}

export const renderStatuslineSessions = ({
  sessions,
  currentSession,
  config,
}: {
  readonly sessions: ReadonlyArray<SessionIdentity>
  readonly currentSession: string
  readonly config: ResolvedConfig["statuslineSessions"]
}): string => {
  const base = config.colors
  let output = `#[fg=${base.baseFg},bg=${base.baseBg},nobold]`

  for (const [index, session] of sessions.entries()) {
    output += " "
    output += `#[range=session|${session.id}]`

    if (session.name === currentSession) {
      output += `#[fg=${base.currentBg},bg=${base.baseBg},nobold]`
      output += `${config.fonts.currentPrefix}`
      output += `#[fg=${base.currentFg},bg=${base.currentBg},bold]`
      output += buildSessionLabel({
        index: index + 1,
        name: session.name,
        showIndex: config.showIndex,
        prefix: "",
        suffix: "",
      })
      output += `#[fg=${base.currentBg},bg=${base.baseBg},nobold]`
      output += `${config.fonts.currentSuffix}`
      output += `#[fg=${base.baseFg},bg=${base.baseBg},nobold]`
    } else {
      output += `#[fg=${base.otherFg},bg=${base.baseBg},nobold]`
      output += buildSessionLabel({
        index: index + 1,
        name: session.name,
        showIndex: config.showIndex,
        prefix: config.fonts.otherPrefix,
        suffix: config.fonts.otherSuffix,
      })
      output += `#[fg=${base.baseFg},bg=${base.baseBg},nobold]`
    }

    output += "#[norange]"
  }

  return output
}

export type RunStatuslineSessionsDeps = {
  readonly programName: string
  readonly stdout: (line: string) => void
  readonly stderr: (line: string) => void
  readonly tmux?: Pick<
    TmuxClient,
    | "listSessionDetails"
    | "currentSession"
    | "currentClientName"
    | "showClientOption"
  > &
    Partial<Pick<TmuxClient, "switchClient">>
  readonly loadConfigFn?: typeof loadConfig
  readonly env?: NodeJS.ProcessEnv
}

const parseSwitchIndex = (value: string): number | null => {
  if (/^[1-9]\d*$/.test(value) !== true) {
    return null
  }

  return Number.parseInt(value, 10)
}

const resolveSessionNameByIndex = ({
  sessions,
  targetIndex,
}: {
  readonly sessions: ReadonlyArray<SessionIdentity>
  readonly targetIndex: number
}): string | null => {
  for (const [index, session] of sessions.entries()) {
    if (index + 1 === targetIndex) {
      return session.name
    }
  }

  return null
}

const toSessionIdentities = (
  sessions: ReadonlyArray<SessionDetails>,
): SessionIdentity[] => {
  return sessions.map((session) => ({
    id: session.id,
    name: session.name,
  }))
}

export const runStatuslineSessions = async (
  args: readonly string[],
  {
    programName,
    stdout,
    stderr,
    tmux = createTmuxClient(),
    loadConfigFn = loadConfig,
    env = process.env,
  }: RunStatuslineSessionsDeps,
): Promise<number> => {
  if (args.length > 0 && isHelpFlag(args[0] as string)) {
    stdout(usageText(programName))
    return EXIT_CODE_OK
  }

  if (args[0] === "switch") {
    if (args.length !== 2) {
      stderr(`[USAGE] ${usageText(programName)}`)
      return EXIT_CODE_USAGE
    }

    const targetIndex = parseSwitchIndex(args[1] as string)
    if (targetIndex === null) {
      stderr(
        `${programName} statusline-sessions: index must be a positive integer: ${args[1]}`,
      )
      return EXIT_CODE_USAGE
    }

    const { config } = await loadConfigFn()
    const currentCategory = await getCurrentCategory({ tmux, config })
    const sessions = toSessionIdentities(
      getSessionsInCategory({
        sessions: await tmux.listSessionDetails(),
        categoryName: currentCategory,
        config,
        homeDirectory: env.HOME ?? homedir(),
        ghqRoot: await resolveGhqRoot({ env }),
      }),
    )
    const targetSessionName = resolveSessionNameByIndex({
      sessions,
      targetIndex,
    })

    if (targetSessionName === null) {
      stderr(
        `${programName} statusline-sessions: session not found at index ${targetIndex}`,
      )
      return EXIT_CODE_ERROR
    }

    if (typeof tmux.switchClient !== "function") {
      throw new Error("tmux.switchClient is required for switch command")
    }

    await tmux.switchClient(targetSessionName)
    return EXIT_CODE_OK
  }

  let showIndexOverride: boolean | undefined

  for (const arg of args) {
    if (arg === "--show-index") {
      showIndexOverride = true
      continue
    }

    stderr(`[USAGE] ${usageText(programName)}`)
    return EXIT_CODE_USAGE
  }

  const { config } = await loadConfigFn()
  const currentCategory = await getCurrentCategory({ tmux, config })
  const ghqRoot = await resolveGhqRoot({ env })
  const [sessionDetails, currentSession] = await Promise.all([
    tmux.listSessionDetails(),
    tmux.currentSession(),
  ])
  const sessions = toSessionIdentities(
    getSessionsInCategory({
      sessions: sessionDetails,
      categoryName: currentCategory,
      config,
      homeDirectory: env.HOME ?? homedir(),
      ghqRoot,
    }),
  )
  stdout(
    renderStatuslineSessions({
      sessions,
      currentSession,
      config: {
        ...config.statuslineSessions,
        showIndex: showIndexOverride ?? config.statuslineSessions.showIndex,
      },
    }),
  )

  return EXIT_CODE_OK
}
