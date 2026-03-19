import {
  type RunCommandOptions,
  type RunCommandResult,
  runCommand,
} from "../process/exec"

type Runner = (
  command: string,
  args?: readonly string[],
  options?: RunCommandOptions,
) => Promise<RunCommandResult>

export const resolveGhqRoot = async ({
  env = process.env,
  runner = runCommand,
}: {
  readonly env?: NodeJS.ProcessEnv
  readonly runner?: Runner
} = {}): Promise<string | null> => {
  const fromEnv = env.GHQ_ROOT?.trim()
  if (typeof fromEnv === "string" && fromEnv.length > 0) {
    return fromEnv
  }

  const result = await runner("ghq", ["root"], {
    allowFail: true,
  })
  const root = result.stdout.trim()
  return root.length > 0 ? root : null
}
