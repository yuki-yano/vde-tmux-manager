import { homedir } from "node:os"
import { loadConfig } from "../../config/loader"
import { runCommand } from "../../process/exec"
import { createTmuxClient, type TmuxClient } from "../../tmux/client"
import { switchProjectSession } from "../../categories/project-switch"

const EXIT_CODE_OK = 0
const EXIT_CODE_USAGE = 2

const usageText = (programName: string): string => {
  return [
    `Usage: ${programName} project switch <path>`,
    "",
    "Create or reuse a tmux session for the given project path.",
  ].join("\n")
}

export const runProject = async (
  args: readonly string[],
  {
    programName,
    stdout: _stdout,
    stderr,
    tmux = createTmuxClient(),
    loadConfigFn = loadConfig,
    switchProjectSessionFn = switchProjectSession,
    env = process.env,
  }: {
    readonly programName: string
    readonly stdout: (line: string) => void
    readonly stderr: (line: string) => void
    readonly tmux?: Pick<
      TmuxClient,
      | "listSessionDetails"
      | "newSessionDetachedNamed"
      | "newSessionInteractiveNamed"
      | "currentClientName"
      | "showClientOption"
      | "setClientOption"
      | "setSessionOption"
      | "switchClient"
    >
    readonly loadConfigFn?: typeof loadConfig
    readonly switchProjectSessionFn?: typeof switchProjectSession
    readonly env?: NodeJS.ProcessEnv
  },
): Promise<number> => {
  if (
    args[0] !== "switch" ||
    typeof args[1] !== "string" ||
    args.length !== 2
  ) {
    stderr(`[USAGE] ${usageText(programName)}`)
    return EXIT_CODE_USAGE
  }

  const { config } = await loadConfigFn()
  await switchProjectSessionFn({
    tmux,
    config,
    inputPath: args[1],
    env,
    homeDirectory: env.HOME ?? homedir(),
    runner: runCommand,
  })
  return EXIT_CODE_OK
}
