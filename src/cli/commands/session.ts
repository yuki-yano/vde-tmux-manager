import { setSessionCategoryOverride } from "../../categories/state"
import type { OutputWriter } from "../output"
import { loadConfig } from "../../config/loader"
import { createTmuxClient, type TmuxClient } from "../../tmux/client"

const EXIT_CODE_OK = 0
const EXIT_CODE_USAGE = 2

const usageText = (programName: string): string => {
  return [
    `Usage: ${programName} session set-category <session> <category>`,
    "",
    "Set an explicit category override on a tmux session.",
  ].join("\n")
}

export const runSession = async (
  args: readonly string[],
  {
    programName,
    stdout: _stdout,
    stderr,
    tmux = createTmuxClient(),
    loadConfigFn = loadConfig,
  }: {
    readonly programName: string
    readonly stdout: OutputWriter
    readonly stderr: OutputWriter
    readonly tmux?: Pick<TmuxClient, "setSessionOption">
    readonly loadConfigFn?: typeof loadConfig
  },
): Promise<number> => {
  if (
    args[0] !== "set-category" ||
    typeof args[1] !== "string" ||
    typeof args[2] !== "string" ||
    args.length !== 3
  ) {
    await stderr(`[USAGE] ${usageText(programName)}`)
    return EXIT_CODE_USAGE
  }

  const { config } = await loadConfigFn()
  await setSessionCategoryOverride({
    tmux,
    config,
    sessionName: args[1],
    categoryName: args[2],
  })
  return EXIT_CODE_OK
}
