#!/usr/bin/env node
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import packageJson from "../package.json"
import { createCli, resolveProgramNameFromArgv } from "./cli/index"

type RunMainOptions = {
  readonly argv?: readonly string[]
  readonly stdout?: (line: string) => void
  readonly stderr?: (line: string) => void
}

const EXIT_CODE_UNEXPECTED_ERROR = 1

const PACKAGE_VERSION = packageJson.version

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

  const cli = createCli({
    programName: resolveProgramNameFromArgv(argv),
    version: PACKAGE_VERSION,
    stdout,
    stderr,
  })

  try {
    return await cli.run(argv.slice(2))
  } catch (error) {
    if (error instanceof Error) {
      stderr(`[UNEXPECTED_ERROR] ${error.message}`)
    } else {
      stderr(`[UNEXPECTED_ERROR] ${String(error)}`)
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
