import { basename } from "node:path"
import { runSessionManager } from "./commands/session-manager"
import { runStatuslineSessions } from "./commands/statusline-sessions"

export type CLI = {
  run(args?: readonly string[]): Promise<number>
}

type CliOptions = {
  readonly programName?: string
  readonly version?: string
  readonly stdout?: (line: string) => void
  readonly stderr?: (line: string) => void
}

type CommandHelp = {
  readonly name: string
  readonly summary: string
}

const DEFAULT_PROGRAM_NAME = "vde-tmux-manager"
const DEFAULT_VERSION = "0.1.0"

const EXIT_CODE = {
  OK: 0,
  UNKNOWN_COMMAND: 1,
  USAGE_ERROR: 2,
} as const

const COMMANDS: readonly CommandHelp[] = [
  {
    name: "session-manager",
    summary: "Manage tmux sessions interactively",
  },
  {
    name: "statusline-sessions",
    summary: "Render tmux statusline session segments",
  },
] as const

const isHelpFlag = (value: string): boolean => {
  return value === "-h" || value === "--help"
}

const isVersionFlag = (value: string): boolean => {
  return value === "-v" || value === "--version"
}

const renderHelpText = ({
  programName,
  version,
}: {
  readonly programName: string
  readonly version: string
}): string => {
  const commandLines = COMMANDS.map(
    (command) => `  ${command.name.padEnd(20)} ${command.summary}`,
  )

  return [
    `${programName} v${version}`,
    "",
    `Usage: ${programName} <command>`,
    "",
    "Commands:",
    ...commandLines,
    "",
    "Global options:",
    "  -h, --help              Show help",
    "  -v, --version           Show version",
  ].join("\n")
}

export const resolveProgramNameFromArgv = (argv: readonly string[]): string => {
  const scriptPath = argv[1]
  if (typeof scriptPath !== "string" || scriptPath.length === 0) {
    return DEFAULT_PROGRAM_NAME
  }

  return basename(scriptPath)
}

const toUnexpectedErrorText = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message
  }
  return String(error)
}

export const createCli = (options: CliOptions = {}): CLI => {
  const programName = options.programName ?? DEFAULT_PROGRAM_NAME
  const version = options.version ?? DEFAULT_VERSION
  const stdout = options.stdout ?? ((line: string): void => console.log(line))
  const stderr = options.stderr ?? ((line: string): void => console.error(line))

  const run = async (args: readonly string[] = []): Promise<number> => {
    if (args.length === 0) {
      stdout(renderHelpText({ programName, version }))
      return EXIT_CODE.OK
    }

    const [command, ...rest] = args as readonly [string, ...string[]]

    if (isHelpFlag(command)) {
      stdout(renderHelpText({ programName, version }))
      return EXIT_CODE.OK
    }

    if (isVersionFlag(command)) {
      stdout(version)
      return EXIT_CODE.OK
    }

    try {
      if (command === "session-manager") {
        return await runSessionManager(rest, {
          programName,
          stdout,
          stderr,
        })
      }

      if (command === "statusline-sessions") {
        return await runStatuslineSessions(rest, {
          programName,
          stdout,
          stderr,
        })
      }
    } catch (error) {
      stderr(`[COMMAND_FAILED] ${toUnexpectedErrorText(error)}`)
      return EXIT_CODE.UNKNOWN_COMMAND
    }

    if (command.startsWith("-")) {
      stderr(`[USAGE] Unknown option: ${command}`)
      stderr(renderHelpText({ programName, version }))
      return EXIT_CODE.USAGE_ERROR
    }

    stderr(`[UNKNOWN_COMMAND] Unknown command: ${command}`)
    return EXIT_CODE.UNKNOWN_COMMAND
  }

  return {
    run,
  }
}
