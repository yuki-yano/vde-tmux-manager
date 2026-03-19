import { homedir } from "node:os"
import { resolveGhqRoot } from "../../categories/runtime"
import { refreshSessionCategories } from "../../categories/state"
import { loadConfig } from "../../config/loader"
import { createTmuxClient, type TmuxClient } from "../../tmux/client"

const EXIT_CODE_OK = 0
const EXIT_CODE_USAGE = 2

const usageText = (programName: string): string => {
  return [
    `Usage: ${programName} sessions refresh-category`,
    "",
    "Recompute session categories from tmux project metadata.",
  ].join("\n")
}

export const runSessions = async (
  args: readonly string[],
  {
    programName,
    stdout: _stdout,
    stderr,
    tmux = createTmuxClient(),
    loadConfigFn = loadConfig,
    refreshSessionCategoriesFn = refreshSessionCategories,
    env = process.env,
  }: {
    readonly programName: string
    readonly stdout: (line: string) => void
    readonly stderr: (line: string) => void
    readonly tmux?: Pick<TmuxClient, "listSessionDetails" | "setSessionOption">
    readonly loadConfigFn?: typeof loadConfig
    readonly refreshSessionCategoriesFn?: typeof refreshSessionCategories
    readonly env?: NodeJS.ProcessEnv
  },
): Promise<number> => {
  if (args[0] !== "refresh-category" || args.length !== 1) {
    stderr(`[USAGE] ${usageText(programName)}`)
    return EXIT_CODE_USAGE
  }

  const { config } = await loadConfigFn()
  await refreshSessionCategoriesFn({
    tmux,
    config,
    homeDirectory: env.HOME ?? homedir(),
    ghqRoot: await resolveGhqRoot({ env }),
  })
  return EXIT_CODE_OK
}
