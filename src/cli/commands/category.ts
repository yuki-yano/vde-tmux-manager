import { homedir } from "node:os"
import { resolveGhqRoot } from "../../categories/runtime"
import {
  getCurrentCategory,
  resolveAdjacentCategory,
  useCategoryAndSwitchToLastSession,
} from "../../categories/state"
import type { OutputWriter } from "../output"
import { loadConfig } from "../../config/loader"
import { createTmuxClient, type TmuxClient } from "../../tmux/client"

const EXIT_CODE_OK = 0
const EXIT_CODE_USAGE = 2

const usageText = (programName: string): string => {
  return [
    `Usage: ${programName} category use <name>`,
    `       ${programName} category next`,
    `       ${programName} category prev`,
    "",
    "Switch the current tmux client category.",
  ].join("\n")
}

export const runCategory = async (
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
      | "currentSession"
      | "setClientOption"
      | "showClientOption"
      | "listSessionDetails"
      | "switchClient"
    >
    readonly loadConfigFn?: typeof loadConfig
    readonly env?: NodeJS.ProcessEnv
  },
): Promise<number> => {
  if (args[0] === "next" || args[0] === "prev") {
    if (args.length !== 1) {
      await stderr(`[USAGE] ${usageText(programName)}`)
      return EXIT_CODE_USAGE
    }

    const { config } = await loadConfigFn()
    const ghqRoot = await resolveGhqRoot({ config, env })
    const currentCategory = await getCurrentCategory({ tmux, config })
    await useCategoryAndSwitchToLastSession({
      tmux,
      config,
      categoryName: resolveAdjacentCategory({
        config,
        currentCategory,
        direction: args[0],
      }),
      homeDirectory: env.HOME ?? homedir(),
      ghqRoot,
    })
    return EXIT_CODE_OK
  }

  if (args[0] !== "use" || typeof args[1] !== "string" || args.length !== 2) {
    await stderr(`[USAGE] ${usageText(programName)}`)
    return EXIT_CODE_USAGE
  }

  const { config } = await loadConfigFn()
  const ghqRoot = await resolveGhqRoot({ config, env })
  await useCategoryAndSwitchToLastSession({
    tmux,
    config,
    categoryName: args[1],
    homeDirectory: env.HOME ?? homedir(),
    ghqRoot,
  })
  return EXIT_CODE_OK
}
