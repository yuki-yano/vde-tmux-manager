import { homedir } from "node:os"
import { resolveGhqRoot } from "../../categories/runtime"
import { rememberCurrentSessionForCurrentClient, rememberSessionForClient } from "../../categories/state"
import { loadConfig } from "../../config/loader"
import { createTmuxClient, type TmuxClient } from "../../tmux/client"

const EXIT_CODE_OK = 0
const EXIT_CODE_USAGE = 2

const usageText = (programName: string): string => {
  return [
    `Usage: ${programName} hooks on-client-session-changed [<client-name> <session-name>]`,
    "",
    "Update category last-active state from tmux hook events.",
  ].join("\n")
}

export const runHooks = async (
  args: readonly string[],
  {
    programName,
    stdout: _stdout,
    stderr,
    tmux = createTmuxClient(),
    loadConfigFn = loadConfig,
    env = process.env,
  }: {
    readonly programName: string
    readonly stdout: (line: string) => void
    readonly stderr: (line: string) => void
    readonly tmux?: Pick<
      TmuxClient,
      | "currentClientName"
      | "currentSession"
      | "listSessionDetails"
      | "showClientOption"
      | "setClientOption"
    >
    readonly loadConfigFn?: typeof loadConfig
    readonly env?: NodeJS.ProcessEnv
  },
): Promise<number> => {
  if (args[0] !== "on-client-session-changed") {
    stderr(`[USAGE] ${usageText(programName)}`)
    return EXIT_CODE_USAGE
  }

  const { config } = await loadConfigFn()
  const homeDirectory = env.HOME ?? homedir()
  const ghqRoot = await resolveGhqRoot({ env })

  if (args.length === 1) {
    await rememberCurrentSessionForCurrentClient({
      tmux,
      config,
      homeDirectory,
      ghqRoot,
    })
    return EXIT_CODE_OK
  }

  if (
    args.length === 3 &&
    typeof args[1] === "string" &&
    typeof args[2] === "string"
  ) {
    await rememberSessionForClient({
      tmux,
      config,
      clientName: args[1],
      sessionName: args[2],
      homeDirectory,
      ghqRoot,
    })
    return EXIT_CODE_OK
  }

  stderr(`[USAGE] ${usageText(programName)}`)
  return EXIT_CODE_USAGE
}
