import { stat } from "node:fs/promises"
import { basename, dirname, resolve } from "node:path"
import { homedir } from "node:os"
import type { ResolvedConfig } from "../config/schema"
import { resolveGhqRoot } from "./runtime"
import {
  runCommand,
  type RunCommandOptions,
  type RunCommandResult,
} from "../process/exec"
import type { TmuxClient } from "../tmux/client"
import { resolveProjectPathCategory } from "./matcher"
import { switchClientAndRememberSession } from "./state"

type Runner = (
  command: string,
  args?: readonly string[],
  options?: RunCommandOptions,
) => Promise<RunCommandResult>

const normalizeInputPath = async (inputPath: string): Promise<string> => {
  const absolutePath = resolve(inputPath)
  const stats = await stat(absolutePath)
  if (stats.isDirectory()) {
    return absolutePath
  }
  return dirname(absolutePath)
}

const resolveGitRoot = async ({
  path,
  runner,
}: {
  readonly path: string
  readonly runner: Runner
}): Promise<string | null> => {
  const result = await runner("git", [
    "-C",
    path,
    "rev-parse",
    "--show-toplevel",
  ])
  if (result.exitCode !== 0) {
    return null
  }
  const root = result.stdout.trim()
  return root.length > 0 ? root : null
}

const toSessionName = (projectPath: string): string => {
  const sessionName = basename(projectPath).trim()
  if (sessionName.length === 0) {
    throw new Error(`failed to derive session name from path: ${projectPath}`)
  }
  return sessionName.replaceAll(":", "-")
}

const updateSessionMetadata = async ({
  tmux,
  sessionName,
  projectPath,
  category,
}: {
  readonly tmux: Pick<TmuxClient, "setSessionOption">
  readonly sessionName: string
  readonly projectPath: string
  readonly category: string
}): Promise<void> => {
  await tmux.setSessionOption(sessionName, "project_path", projectPath)
  await tmux.setSessionOption(sessionName, "category", category)
}

export const switchProjectSession = async ({
  tmux,
  config,
  inputPath,
  env = process.env,
  homeDirectory = homedir(),
  runner = runCommand,
}: {
  readonly tmux: Pick<
    TmuxClient,
    | "listSessionDetails"
    | "newSessionDetachedNamed"
    | "newSessionInteractiveNamed"
    | "currentClientName"
    | "showClientOption"
    | "setClientOption"
    | "setSessionOption"
    | "switchClient"
  >
  readonly config: ResolvedConfig
  readonly inputPath: string
  readonly env?: NodeJS.ProcessEnv
  readonly homeDirectory?: string
  readonly runner?: Runner
}): Promise<{ sessionName: string; projectPath: string; category: string }> => {
  const normalizedInputPath = await normalizeInputPath(inputPath)
  const gitRoot = await resolveGitRoot({
    path: normalizedInputPath,
    runner: async (command, args) =>
      runner(command, args, {
        allowFail: true,
      }),
  })
  const projectPath = gitRoot ?? normalizedInputPath
  const ghqRoot = await resolveGhqRoot({
    config,
    env,
    runner: async (command, args) =>
      runner(command, args, {
        allowFail: true,
      }),
  })
  const sessionName = toSessionName(projectPath)
  const category = resolveProjectPathCategory({
    config: config.categories,
    projectPath,
    ghqRoot,
    homeDirectory,
  })

  const existing = (await tmux.listSessionDetails()).find(
    (session) => session.name === sessionName,
  )
  if (
    existing &&
    existing.projectPath.length > 0 &&
    existing.projectPath !== projectPath
  ) {
    throw new Error(
      `session name collision: ${sessionName} is already bound to ${existing.projectPath}`,
    )
  }

  const inTmux = typeof env.TMUX === "string" && env.TMUX.length > 0
  if (!existing) {
    if (inTmux) {
      await tmux.newSessionDetachedNamed(sessionName, projectPath)
    } else {
      await tmux.newSessionInteractiveNamed(sessionName, projectPath, true)
    }
  }

  await updateSessionMetadata({
    tmux,
    sessionName,
    projectPath,
    category,
  })

  if (inTmux) {
    await switchClientAndRememberSession({
      tmux,
      config,
      sessionName,
      categoryName: category,
      homeDirectory,
      ghqRoot,
    })
  }

  return {
    sessionName,
    projectPath,
    category,
  }
}
