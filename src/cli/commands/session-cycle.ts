import { homedir } from "node:os"
import { resolveGhqRoot } from "../../categories/runtime"
import { cycleSessionInCurrentCategory } from "../../categories/state"
import type { OutputWriter } from "../output"
import { loadConfig } from "../../config/loader"
import { createTmuxClient, type TmuxClient } from "../../tmux/client"

const EXIT_CODE_OK = 0
const EXIT_CODE_USAGE = 2

const usageText = (programName: string): string => {
  return [
    `Usage: ${programName} session-cycle <next|prev>`,
    "",
    "Cycle tmux sessions only within the current category.",
  ].join("\n")
}

export const runSessionCycle = async (
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
    readonly stdout: OutputWriter
    readonly stderr: OutputWriter
    readonly tmux?: Pick<
      TmuxClient,
      | "currentClientName"
      | "showClientOption"
      | "setClientOption"
      | "listSessionDetails"
      | "currentSession"
      | "switchClient"
    >
    readonly loadConfigFn?: typeof loadConfig
    readonly env?: NodeJS.ProcessEnv
  },
): Promise<number> => {
  const direction = args[0]
  if (direction !== "next" && direction !== "prev") {
    await stderr(`[USAGE] ${usageText(programName)}`)
    return EXIT_CODE_USAGE
  }

  const { config } = await loadConfigFn()
  const ghqRoot = await resolveGhqRoot({ config, env })
  await cycleSessionInCurrentCategory({
    tmux,
    config,
    direction,
    homeDirectory: env.HOME ?? homedir(),
    ghqRoot,
  })
  return EXIT_CODE_OK
}
