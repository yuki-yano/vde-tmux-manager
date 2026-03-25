import {
  getCurrentCategory,
  getOrderedCategoriesWithSessions,
  useCategoryAndSwitchToLastSession,
} from "../../categories/state"
import { loadConfig } from "../../config/loader"
import type { ResolvedConfig } from "../../config/schema"
import { createTmuxClient, type TmuxClient } from "../../tmux/client"
import { renderTmuxStatuslineSegment } from "../../ui/format"
import type { OutputWriter } from "../output"
import { homedir } from "node:os"
import { resolveGhqRoot } from "../../categories/runtime"

const EXIT_CODE_OK = 0
const EXIT_CODE_ERROR = 1
const EXIT_CODE_USAGE = 2

const isHelpFlag = (value: string): boolean =>
  value === "-h" || value === "--help"

const usageText = (programName: string): string => {
  return [
    `Usage: ${programName} statusline-category`,
    `       ${programName} statusline-category switch <index>`,
    "",
    "Print the current tmux client category as a statusline segment or switch categories by index.",
  ].join("\n")
}

const parseSwitchIndex = (value: string): number | null => {
  if (/^[1-9]\d*$/.test(value) !== true) {
    return null
  }

  return Number.parseInt(value, 10)
}

const resolveCategoryNameByIndex = ({
  categories,
  targetIndex,
}: {
  readonly categories: readonly string[]
  readonly targetIndex: number
}): string | null => {
  const visibleCategories = categories.filter(
    (categoryName) => categoryName.length > 0,
  )

  for (const [index, categoryName] of visibleCategories.entries()) {
    if (index + 1 === targetIndex) {
      return categoryName
    }
  }

  return null
}

export const renderStatuslineCategory = ({
  currentCategoryName,
  orderedCategories,
  statuslineConfig,
  categoriesConfig,
}: {
  readonly currentCategoryName: string
  readonly orderedCategories: readonly string[]
  readonly statuslineConfig: ResolvedConfig["statuslineCategory"]
  readonly categoriesConfig: ResolvedConfig["categories"]
}): string => {
  const resolveDisplayName = (categoryName: string): string => {
    if (categoryName.length === 0) {
      return ""
    }
    return categoriesConfig.displayNames?.[categoryName] ?? categoryName
  }

  const toContent = (categoryName: string): string => {
    return statuslineConfig.format.replaceAll(
      "{category}",
      resolveDisplayName(categoryName),
    )
  }

  if (statuslineConfig.mode === "list") {
    return orderedCategories
      .filter((categoryName) => categoryName.length > 0)
      .map((categoryName, index) => {
        const segment = renderTmuxStatuslineSegment({
          content: toContent(categoryName),
          config: {
            format: statuslineConfig.format,
            prefix: statuslineConfig.prefix,
            suffix: statuslineConfig.suffix,
            bold: statuslineConfig.bold,
            colors:
              categoryName === currentCategoryName
                ? statuslineConfig.colors
                : statuslineConfig.inactiveColors,
          },
        })

        if (segment.length === 0) {
          return ""
        }

        return `#[range=user|${String(index + 1)}]${segment}#[norange]`
      })
      .filter((segment) => segment.length > 0)
      .join(" ")
  }

  if (orderedCategories.includes(currentCategoryName) !== true) {
    return ""
  }

  const content = toContent(currentCategoryName)
  if (currentCategoryName.length === 0 || content.length === 0) {
    return ""
  }

  return renderTmuxStatuslineSegment({
    content,
    config: {
      format: statuslineConfig.format,
      prefix: statuslineConfig.prefix,
      suffix: statuslineConfig.suffix,
      bold: statuslineConfig.bold,
      colors: statuslineConfig.colors,
    },
  })
}

export const runStatuslineCategory = async (
  args: readonly string[],
  {
    programName,
    stdout,
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
      | "showClientOption"
      | "setClientOption"
      | "listSessionDetails"
      | "switchClient"
    >
    readonly loadConfigFn?: typeof loadConfig
    readonly env?: NodeJS.ProcessEnv
  },
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
        `${programName} statusline-category: index must be a positive integer: ${args[1]}`,
      )
      return EXIT_CODE_USAGE
    }

    const { config } = await loadConfigFn()
    const sessionDetails = await tmux.listSessionDetails()
    const visibleCategories = getOrderedCategoriesWithSessions({
      sessions: sessionDetails,
      config,
      homeDirectory: env.HOME ?? homedir(),
      ghqRoot: await resolveGhqRoot({ config, env }),
    })
    const targetCategoryName = resolveCategoryNameByIndex({
      categories: visibleCategories,
      targetIndex,
    })

    if (targetCategoryName === null) {
      await stderr(
        `${programName} statusline-category: category not found at index ${targetIndex}`,
      )
      return EXIT_CODE_ERROR
    }

    const ghqRoot = await resolveGhqRoot({ config, env })
    await useCategoryAndSwitchToLastSession({
      tmux,
      config,
      categoryName: targetCategoryName,
      homeDirectory: env.HOME ?? homedir(),
      ghqRoot,
    })
    return EXIT_CODE_OK
  }

  if (args.length > 0) {
    await stderr(`[USAGE] ${usageText(programName)}`)
    return EXIT_CODE_USAGE
  }

  const { config } = await loadConfigFn()
  const ghqRoot = await resolveGhqRoot({ config, env })
  const currentCategoryName = await getCurrentCategory({ tmux, config })
  const sessionDetails = await tmux.listSessionDetails()
  await stdout(
    renderStatuslineCategory({
      currentCategoryName,
      orderedCategories: getOrderedCategoriesWithSessions({
        sessions: sessionDetails,
        config,
        homeDirectory: env.HOME ?? homedir(),
        ghqRoot,
      }),
      statuslineConfig: config.statuslineCategory,
      categoriesConfig: config.categories,
    }),
  )
  return EXIT_CODE_OK
}
