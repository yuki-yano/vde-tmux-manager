#!/usr/bin/env node
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import packageJson from "../package.json"
import { createCli, resolveProgramNameFromArgv } from "./cli/index"
import type { OutputWriter } from "./cli/output"
import { runCommand } from "./process/exec"

type RunMainOptions = {
  readonly argv?: readonly string[]
  readonly stdout?: OutputWriter
  readonly stderr?: OutputWriter
  readonly env?: NodeJS.ProcessEnv
  readonly reportTmuxErrorFn?: (args: {
    message: string
    env: NodeJS.ProcessEnv
  }) => Promise<boolean>
}

const EXIT_CODE_UNEXPECTED_ERROR = 1

const PACKAGE_VERSION = packageJson.version

const normalizeTmuxErrorMessage = (message: string): string => {
  return message.replace(/\s+/g, " ").trim()
}

const reportTmuxError = async ({
  message,
  env,
}: {
  message: string
  env: NodeJS.ProcessEnv
}): Promise<boolean> => {
  if (typeof env.TMUX !== "string" || env.TMUX.length === 0) {
    return false
  }

  const normalizedMessage = normalizeTmuxErrorMessage(message)
  if (normalizedMessage.length === 0) {
    return true
  }

  try {
    await runCommand("tmux", ["display-message", normalizedMessage], {
      allowFail: true,
    })
    return true
  } catch {
    return false
  }
}

export const isExecutedAsEntryPoint = ({
  moduleUrl,
  argv,
}: {
  readonly moduleUrl: string
  readonly argv: readonly string[]
}): boolean => {
  const scriptPath = argv[1]
  if (typeof scriptPath !== "string" || scriptPath.length === 0) {
    return false
  }

  return fileURLToPath(moduleUrl) === resolve(scriptPath)
}

export const runMain = async (
  options: RunMainOptions = {},
): Promise<number> => {
  const argv = options.argv ?? process.argv
  const stdout = options.stdout ?? ((line: string): void => console.log(line))
  const stderr = options.stderr ?? ((line: string): void => console.error(line))
  const env = options.env ?? process.env
  const reportTmuxErrorFn = options.reportTmuxErrorFn ?? reportTmuxError

  const writeError: OutputWriter = async (line: string): Promise<void> => {
    if (await reportTmuxErrorFn({ message: line, env })) {
      return
    }

    await stderr(line)
  }

  const cli = createCli({
    programName: resolveProgramNameFromArgv(argv),
    version: PACKAGE_VERSION,
    stdout,
    stderr: writeError,
  })

  try {
    return await cli.run(argv.slice(2))
  } catch (error) {
    if (error instanceof Error) {
      await writeError(`[UNEXPECTED_ERROR] ${error.message}`)
    } else {
      await writeError(`[UNEXPECTED_ERROR] ${String(error)}`)
    }
    return EXIT_CODE_UNEXPECTED_ERROR
  }
}

/* c8 ignore start */
if (
  isExecutedAsEntryPoint({ moduleUrl: import.meta.url, argv: process.argv })
) {
  const exitCode = await runMain()
  if (exitCode !== 0) {
    process.exit(exitCode)
  }
}
/* c8 ignore stop */
