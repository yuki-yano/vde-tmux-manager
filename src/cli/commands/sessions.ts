import { homedir } from "node:os"
import { resolveGhqRoot } from "../../categories/runtime"
import { refreshSessionCategories } from "../../categories/state"
import type { OutputWriter } from "../output"
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
    readonly stdout: OutputWriter
    readonly stderr: OutputWriter
    readonly tmux?: Pick<TmuxClient, "listSessionDetails" | "setSessionOption">
    readonly loadConfigFn?: typeof loadConfig
    readonly refreshSessionCategoriesFn?: typeof refreshSessionCategories
    readonly env?: NodeJS.ProcessEnv
  },
): Promise<number> => {
  if (args[0] !== "refresh-category" || args.length !== 1) {
    await stderr(`[USAGE] ${usageText(programName)}`)
    return EXIT_CODE_USAGE
  }

  const { config } = await loadConfigFn()
  await refreshSessionCategoriesFn({
    tmux,
    config,
    homeDirectory: env.HOME ?? homedir(),
    ghqRoot: await resolveGhqRoot({ config, env }),
  })
  return EXIT_CODE_OK
}
