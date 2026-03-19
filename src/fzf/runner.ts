import { commandExists, runCommand } from "../process/exec"

const DEFAULT_PREVIEW_WIDTH = "65"
let cachedFzfTmuxExists: boolean | undefined

export type SelectorEntryAction = "session" | "window" | "server"

export type SelectorEntry = {
  readonly action: SelectorEntryAction
  readonly name: string
  readonly display: string
}

type CommandRunner = typeof runCommand

type CommandExists = typeof commandExists

export type RunFzfInput = {
  readonly entries: ReadonlyArray<SelectorEntry>
  readonly prompt: string
  readonly headerText?: string
  readonly border: string
  readonly previewWidth: string
  readonly previewCommand: string
  readonly popupWidth: string
  readonly popupHeight: string
  readonly forcePlain?: boolean
  readonly inTmux?: boolean
  readonly run?: CommandRunner
  readonly commandExistsFn?: CommandExists
}

export const normalizeRefreshMs = (
  value: string | number | null | undefined,
): number => {
  if (typeof value === "number") {
    if (Number.isFinite(value) && value >= 0) {
      return Math.floor(value)
    }
    return 0
  }

  if (typeof value !== "string" || value.length === 0) {
    return 0
  }

  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0
  }

  return parsed
}

export const buildPreviewWindowOption = (widthValue: string): string => {
  const normalized = widthValue.trim()
  if (/^\d+$/.test(normalized)) {
    return `right:${normalized}%:border-left`
  }
  if (/^\d+%$/.test(normalized)) {
    return `right:${normalized}:border-left`
  }
  return `right:${DEFAULT_PREVIEW_WIDTH}%:border-left`
}

const buildBorderOption = ({
  border,
  inTmux,
}: {
  readonly border: string
  readonly inTmux: boolean
}): string => {
  if (inTmux) {
    return "--border=none"
  }

  const normalized = border.trim().toLowerCase()
  if (["", "none", "0", "false", "off"].includes(normalized)) {
    return "--border=none"
  }

  return `--border=${border.trim()}`
}

export const runFzf = async ({
  entries,
  prompt,
  headerText = "Enter switch | C-q kill | C-t new | C-r rename | C-d/C-u scroll",
  border,
  previewWidth,
  previewCommand,
  popupWidth,
  popupHeight,
  forcePlain = false,
  inTmux = typeof process.env.TMUX === "string" && process.env.TMUX.length > 0,
  run = runCommand,
  commandExistsFn = commandExists,
}: RunFzfInput): Promise<string[]> => {
  if (entries.length === 0) {
    return []
  }

  const resolveFzfTmuxAvailability = async (): Promise<boolean> => {
    if (commandExistsFn !== commandExists) {
      return commandExistsFn("fzf-tmux")
    }

    if (typeof cachedFzfTmuxExists === "boolean") {
      return cachedFzfTmuxExists
    }

    cachedFzfTmuxExists = await commandExistsFn("fzf-tmux")
    return cachedFzfTmuxExists
  }

  const useFzfTmux =
    forcePlain !== true && inTmux && (await resolveFzfTmuxAvailability())
  const binary = useFzfTmux ? "fzf-tmux" : "fzf"

  const args = [
    "--ansi",
    `--prompt=${prompt}`,
    `--header=${headerText}`,
    buildBorderOption({ border, inTmux }),
    "--delimiter=\t",
    "--with-nth=3",
    "--cycle",
    "--reverse",
    "--height=100%",
    "--no-info",
    "--no-sort",
    "--exact",
    "--expect=enter,ctrl-q,ctrl-t,ctrl-r",
    "--multi",
    `--preview=${previewCommand}`,
    `--preview-window=${buildPreviewWindowOption(previewWidth)}`,
    "--bind=ctrl-d:preview-page-down",
    "--bind=ctrl-u:preview-page-up",
  ]

  const commandArgs = useFzfTmux
    ? ["-p", `${popupWidth},${popupHeight}`, ...args]
    : args

  const payload = `${entries.map((entry) => `${entry.action}\t${entry.name}\t${entry.display}`).join("\n")}\n`
  const result = await run(binary, commandArgs, {
    allowFail: true,
    input: payload,
  })

  if (result.exitCode !== 0) {
    return []
  }

  const stdout = result.stdout.trim()
  if (stdout.length === 0) {
    return []
  }

  return stdout.split(/\r?\n/)
}
