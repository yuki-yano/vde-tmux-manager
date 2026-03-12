import { loadConfig } from "../../config/loader"
import type { ResolvedConfig } from "../../config/schema"
import { createTmuxClient, type TmuxClient } from "../../tmux/client"
import type { SessionIdentity } from "../../tmux/parse"

const EXIT_CODE_OK = 0
const EXIT_CODE_USAGE = 2

const isHelpFlag = (value: string): boolean =>
  value === "-h" || value === "--help"

const usageText = (programName: string): string => {
  return [
    `Usage: ${programName} statusline-sessions`,
    "",
    "Print tmux statusline session segments.",
    "",
    "Options:",
    "  --show-index  Prefix session names with 1-based indexes (1-9 only)",
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
  readonly tmux?: Pick<TmuxClient, "listSessionIdentities" | "currentSession">
  readonly loadConfigFn?: typeof loadConfig
}

export const runStatuslineSessions = async (
  args: readonly string[],
  {
    programName,
    stdout,
    stderr,
    tmux = createTmuxClient(),
    loadConfigFn = loadConfig,
  }: RunStatuslineSessionsDeps,
): Promise<number> => {
  let showIndexOverride: boolean | undefined

  for (const arg of args) {
    if (isHelpFlag(arg)) {
      stdout(usageText(programName))
      return EXIT_CODE_OK
    }

    if (arg === "--show-index") {
      showIndexOverride = true
      continue
    }

    stderr(`[USAGE] ${usageText(programName)}`)
    return EXIT_CODE_USAGE
  }

  const { config } = await loadConfigFn()
  const [sessions, currentSession] = await Promise.all([
    tmux.listSessionIdentities(),
    tmux.currentSession(),
  ])
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
