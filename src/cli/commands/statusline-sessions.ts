import { homedir } from "node:os"
import {
  switchClientAndRememberSession,
  getSessionsInCategory,
  getCurrentCategory,
} from "../../categories/state"
import { loadConfig } from "../../config/loader"
import type { ResolvedConfig } from "../../config/schema"
import { resolveGhqRoot } from "../../categories/runtime"
import { createTmuxClient, type TmuxClient } from "../../tmux/client"
import { parseSessionDetailsList } from "../../tmux/parse"
import type { SessionDetails, SessionIdentity } from "../../tmux/parse"
import { renderTmuxStatuslineSegment } from "../../ui/format"
import type { OutputWriter } from "../output"

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
}: {
  readonly index: number
  readonly name: string
  readonly showIndex: boolean
}): string => {
  return showIndex && index <= 9 ? `${String(index)} ${name}` : `${name}`
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
  let output = ""

  for (const [index, session] of sessions.entries()) {
    const segment =
      session.name === currentSession ? config.current : config.other
    const label = buildSessionLabel({
      index: index + 1,
      name: session.name,
      showIndex: config.showIndex,
    })

    output += " "
    output += `#[range=session|${session.id}]`
    output += renderTmuxStatuslineSegment({
      content: segment.format.replaceAll("{session}", label),
      config: segment,
    })
    output += "#[norange]"
  }

  return output
}

export type RunStatuslineSessionsDeps = {
  readonly programName: string
  readonly stdout: OutputWriter
  readonly stderr: OutputWriter
  readonly tmux?: Pick<
    TmuxClient,
    | "listSessionDetails"
    | "currentSession"
    | "currentClientName"
    | "showClientOption"
  > &
    Partial<Pick<TmuxClient, "switchClient" | "setClientOption">>
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

const TMUX_BATCH_SEPARATOR = ";"
const CATEGORY_PREFIX = "__VTM_CATEGORY__"
const SESSION_PREFIX = "__VTM_SESSION__"

const encodeScopeKey = (value: string): string => {
  return Buffer.from(value, "utf8").toString("hex") || "0"
}

const readCurrentCategoryAndSessionDetails = async ({
  tmux,
  clientName,
  config,
}: {
  readonly tmux: Pick<TmuxClient, "listSessionDetails" | "showClientOption"> &
    Partial<Pick<TmuxClient, "run">>
  readonly clientName: string
  readonly config: ResolvedConfig
}): Promise<{ currentCategory: string; sessionDetails: SessionDetails[] }> => {
  if (typeof tmux.run === "function") {
    const optionName = `@client_${encodeScopeKey(clientName)}_current_category`
    const sessionFormat = `${SESSION_PREFIX}#{session_id}\t#{session_name}\t#{session_attached}\t#{session_activity}\t#{@category}\t#{@project_path}\t#{@category_override}`
    const result = await tmux.run(
      [
        "display-message",
        "-p",
        `${CATEGORY_PREFIX}#{${optionName}}`,
        TMUX_BATCH_SEPARATOR,
        "list-sessions",
        "-F",
        sessionFormat,
      ],
      {
        allowFail: true,
      },
    )
    const lines = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0)
    const categoryLine = lines.find((line) => line.startsWith(CATEGORY_PREFIX))
    const sessionLines = lines
      .filter((line) => line.startsWith(SESSION_PREFIX))
      .map((line) => line.slice(SESSION_PREFIX.length))

    const categoryValue = categoryLine?.slice(CATEGORY_PREFIX.length) ?? ""
    return {
      currentCategory:
        categoryValue.length > 0
          ? categoryValue
          : config.categories.defaultCategory,
      sessionDetails: parseSessionDetailsList(sessionLines.join("\n")),
    }
  }

  const [categoryValue, sessionDetails] = await Promise.all([
    tmux.showClientOption(clientName, "current_category"),
    tmux.listSessionDetails(),
  ])
  return {
    currentCategory:
      categoryValue.length > 0
        ? categoryValue
        : config.categories.defaultCategory,
    sessionDetails,
  }
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
    await stdout(usageText(programName))
    return EXIT_CODE_OK
  }

  if (args[0] === "switch") {
    if (args.length !== 2) {
      await stderr(`[USAGE] ${usageText(programName)}`)
      return EXIT_CODE_USAGE
    }

    const targetIndex = parseSwitchIndex(args[1] as string)
    if (targetIndex === null) {
      await stderr(
        `${programName} statusline-sessions: index must be a positive integer: ${args[1]}`,
      )
      return EXIT_CODE_USAGE
    }

    const [{ config }, clientName] = await Promise.all([
      loadConfigFn(),
      tmux.currentClientName(),
    ])
    const ghqRoot = await resolveGhqRoot({ config, env })
    const { currentCategory, sessionDetails } =
      await readCurrentCategoryAndSessionDetails({
        tmux,
        clientName,
        config,
      })
    const sessions = toSessionIdentities(
      getSessionsInCategory({
        sessions: sessionDetails,
        categoryName: currentCategory,
        config,
        homeDirectory: env.HOME ?? homedir(),
        ghqRoot,
      }),
    )
    const targetSessionName = resolveSessionNameByIndex({
      sessions,
      targetIndex,
    })

    if (targetSessionName === null) {
      await stderr(
        `${programName} statusline-sessions: session not found at index ${targetIndex}`,
      )
      return EXIT_CODE_ERROR
    }

    if (typeof tmux.switchClient !== "function") {
      throw new Error("tmux.switchClient is required for switch command")
    }
    if (typeof tmux.setClientOption !== "function") {
      throw new Error("tmux.setClientOption is required for switch command")
    }

    await switchClientAndRememberSession({
      tmux: tmux as Pick<
        TmuxClient,
        | "currentClientName"
        | "showClientOption"
        | "setClientOption"
        | "switchClient"
        | "listSessionDetails"
      >,
      config,
      sessionName: targetSessionName,
      categoryName: currentCategory,
      homeDirectory: env.HOME ?? homedir(),
      ghqRoot,
      clientName,
      skipCurrentCategoryUpdate: true,
    })
    return EXIT_CODE_OK
  }

  let showIndexOverride: boolean | undefined

  for (const arg of args) {
    if (arg === "--show-index") {
      showIndexOverride = true
      continue
    }

    await stderr(`[USAGE] ${usageText(programName)}`)
    return EXIT_CODE_USAGE
  }

  const { config } = await loadConfigFn()
  const ghqRoot = await resolveGhqRoot({ config, env })
  const currentCategory = await getCurrentCategory({ tmux, config })
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
  await stdout(
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
