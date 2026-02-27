import { spawn } from "node:child_process"

export type RunCommandOptions = {
  readonly allowFail?: boolean
  readonly inheritStdio?: boolean
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
  readonly input?: string
}

export type RunCommandResult = {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

export class CommandExecutionError extends Error {
  readonly code = "COMMAND_EXEC_FAILED"
  readonly command: string
  readonly args: readonly string[]
  readonly exitCode: number
  readonly stderr: string

  constructor({
    command,
    args,
    exitCode,
    stderr,
  }: {
    readonly command: string
    readonly args: readonly string[]
    readonly exitCode: number
    readonly stderr: string
  }) {
    super(
      `${command} ${args.join(" ")} exited with ${exitCode}${stderr.length > 0 ? `: ${stderr}` : ""}`,
    )
    this.name = "CommandExecutionError"
    this.command = command
    this.args = args
    this.exitCode = exitCode
    this.stderr = stderr
  }
}

const shellEscape = (value: string): string => {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

const toExitCodeFromError = (error: NodeJS.ErrnoException): number => {
  if (error.code === "ENOENT") {
    return 127
  }
  return 1
}

const runSpawnedCommand = async ({
  command,
  args,
  inheritStdio,
  cwd,
  env,
  input,
}: {
  readonly command: string
  readonly args: readonly string[]
  readonly inheritStdio: boolean
  readonly cwd?: string
  readonly env?: NodeJS.ProcessEnv
  readonly input?: string
}): Promise<RunCommandResult> => {
  return new Promise<RunCommandResult>((resolve, reject) => {
    const stdio = inheritStdio ? "inherit" : "pipe"
    const child = spawn(command, [...args], {
      cwd,
      env,
      stdio,
    })

    let spawnError: NodeJS.ErrnoException | null = null
    const stdoutChunks: Buffer[] = []
    const stderrChunks: Buffer[] = []

    child.on("error", (error: NodeJS.ErrnoException) => {
      spawnError = error
    })

    if (!inheritStdio) {
      child.stdout?.on("data", (chunk: string | Buffer) => {
        stdoutChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      })

      child.stderr?.on("data", (chunk: string | Buffer) => {
        stderrChunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      })

      if (typeof input === "string") {
        child.stdin?.end(input)
      } else {
        child.stdin?.end()
      }
    }

    child.on("close", (code: number | null) => {
      if (spawnError !== null) {
        reject(spawnError)
        return
      }

      const stdout = inheritStdio
        ? ""
        : Buffer.concat(stdoutChunks).toString("utf8")
      const stderr = inheritStdio
        ? ""
        : Buffer.concat(stderrChunks).toString("utf8")

      resolve({
        stdout,
        stderr,
        exitCode: typeof code === "number" ? code : 1,
      })
    })
  })
}

export const runCommand = async (
  command: string,
  args: readonly string[] = [],
  {
    allowFail = false,
    inheritStdio = false,
    cwd,
    env,
    input,
  }: RunCommandOptions = {},
): Promise<RunCommandResult> => {
  try {
    const result = await runSpawnedCommand({
      command,
      args,
      inheritStdio,
      cwd,
      env,
      input,
    })

    if (result.exitCode !== 0 && allowFail !== true) {
      throw new CommandExecutionError({
        command,
        args,
        exitCode: result.exitCode,
        stderr: result.stderr,
      })
    }

    return result
  } catch (error) {
    if (error instanceof CommandExecutionError) {
      throw error
    }

    const spawnError = error as NodeJS.ErrnoException
    const failureResult: RunCommandResult = {
      stdout: "",
      stderr: spawnError.message,
      exitCode: toExitCodeFromError(spawnError),
    }

    if (allowFail) {
      return failureResult
    }

    throw new CommandExecutionError({
      command,
      args,
      exitCode: failureResult.exitCode,
      stderr: failureResult.stderr,
    })
  }
}

export const commandExists = async (command: string): Promise<boolean> => {
  const result = await runCommand(
    "sh",
    ["-lc", `command -v ${shellEscape(command)} >/dev/null 2>&1`],
    {
      allowFail: true,
    },
  )
  return result.exitCode === 0
}
