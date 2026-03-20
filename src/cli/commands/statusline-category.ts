import { getCurrentCategory } from "../../categories/state"
import { loadConfig } from "../../config/loader"
import type { ResolvedConfig } from "../../config/schema"
import { createTmuxClient, type TmuxClient } from "../../tmux/client"
import { renderTmuxStatuslineSegment } from "../../ui/format"

const EXIT_CODE_OK = 0
const EXIT_CODE_USAGE = 2

const isHelpFlag = (value: string): boolean =>
  value === "-h" || value === "--help"

const usageText = (programName: string): string => {
  return [
    `Usage: ${programName} statusline-category`,
    "",
    "Print the current tmux client category as a statusline segment.",
  ].join("\n")
}

export const renderStatuslineCategory = ({
  categoryName,
  config,
}: {
  readonly categoryName: string
  readonly config: ResolvedConfig["statuslineCategory"]
}): string => {
  const content = config.format.replaceAll("{category}", categoryName)
  if (categoryName.length === 0 || content.length === 0) {
    return ""
  }
  return renderTmuxStatuslineSegment({ content, config })
}

export const runStatuslineCategory = async (
  args: readonly string[],
  {
    programName,
    stdout,
    stderr,
    tmux = createTmuxClient(),
    loadConfigFn = loadConfig,
  }: {
    readonly programName: string
    readonly stdout: (line: string) => void
    readonly stderr: (line: string) => void
    readonly tmux?: Pick<TmuxClient, "currentClientName" | "showClientOption">
    readonly loadConfigFn?: typeof loadConfig
  },
): Promise<number> => {
  if (args.length > 0 && isHelpFlag(args[0] as string)) {
    stdout(usageText(programName))
    return EXIT_CODE_OK
  }

  if (args.length > 0) {
    stderr(`[USAGE] ${usageText(programName)}`)
    return EXIT_CODE_USAGE
  }

  const { config } = await loadConfigFn()
  const categoryName = await getCurrentCategory({ tmux, config })
  stdout(
    renderStatuslineCategory({
      categoryName,
      config: config.statuslineCategory,
    }),
  )
  return EXIT_CODE_OK
}
