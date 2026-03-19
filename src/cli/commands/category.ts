import { setCurrentCategory } from "../../categories/state"
import { loadConfig } from "../../config/loader"
import { createTmuxClient, type TmuxClient } from "../../tmux/client"

const EXIT_CODE_OK = 0
const EXIT_CODE_USAGE = 2

const usageText = (programName: string): string => {
  return [
    `Usage: ${programName} category use <name>`,
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
  }: {
    readonly programName: string
    readonly stdout: (line: string) => void
    readonly stderr: (line: string) => void
    readonly tmux?: Pick<TmuxClient, "currentClientName" | "setClientOption">
    readonly loadConfigFn?: typeof loadConfig
  },
): Promise<number> => {
  if (args[0] !== "use" || typeof args[1] !== "string" || args.length !== 2) {
    stderr(`[USAGE] ${usageText(programName)}`)
    return EXIT_CODE_USAGE
  }

  const { config } = await loadConfigFn()
  await setCurrentCategory({
    tmux,
    config,
    categoryName: args[1],
  })
  return EXIT_CODE_OK
}
