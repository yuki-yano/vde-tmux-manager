import {
  type RunCommandOptions,
  type RunCommandResult,
  runCommand,
} from "../process/exec"
import type { ResolvedConfig } from "../config/schema"
import { expandHomePath } from "./matcher"

type Runner = (
  command: string,
  args?: readonly string[],
  options?: RunCommandOptions,
) => Promise<RunCommandResult>

export const resolveGhqRoot = async ({
  config,
  env = process.env,
  runner = runCommand,
}: {
  readonly config?: Pick<ResolvedConfig, "ghqRoot">
  readonly env?: NodeJS.ProcessEnv
  readonly runner?: Runner
} = {}): Promise<string | null> => {
  const homeDirectory = env.HOME?.trim()

  const fromConfig = config?.ghqRoot?.trim()
  if (typeof fromConfig === "string" && fromConfig.length > 0) {
    return typeof homeDirectory === "string" && homeDirectory.length > 0
      ? expandHomePath(fromConfig, homeDirectory)
      : fromConfig
  }

  const fromEnv = env.GHQ_ROOT?.trim()
  if (typeof fromEnv === "string" && fromEnv.length > 0) {
    return typeof homeDirectory === "string" && homeDirectory.length > 0
      ? expandHomePath(fromEnv, homeDirectory)
      : fromEnv
  }

  const result = await runner("ghq", ["root"], {
    allowFail: true,
  })
  const root = result.stdout.trim()
  return root.length > 0 ? root : null
}
