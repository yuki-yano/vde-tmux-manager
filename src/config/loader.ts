import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import { parse } from "yaml"
import { DEFAULT_CONFIG } from "./defaults"
import {
  validatePartialConfig,
  validateResolvedConfig,
  type PartialConfig,
  type ResolvedConfig,
} from "./schema"

const CONFIG_DIRECTORY = "vde-tmux-manager"
const CONFIG_BASENAME = "config.yaml"

export class ConfigValidationError extends Error {
  readonly code = "CONFIG_INVALID"

  constructor(message: string) {
    super(message)
    this.name = "ConfigValidationError"
  }
}

export type LoadConfigResult = {
  readonly config: ResolvedConfig
  readonly path: string
  readonly loaded: boolean
}

type LoadConfigInput = {
  readonly env?: NodeJS.ProcessEnv
  readonly homeDirectory?: string
  readonly readFileFn?: (
    path: string,
    encoding: BufferEncoding,
  ) => Promise<string>
}

const formatIssues = (
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): string => {
  return issues
    .map((issue) => {
      const path =
        issue.path.length > 0
          ? issue.path.map((segment) => String(segment)).join(".")
          : "<root>"
      return `${path}: ${issue.message}`
    })
    .join(", ")
}

const mergeConfig = (partial: PartialConfig): ResolvedConfig => {
  return {
    sessionManager: {
      popup: {
        ...DEFAULT_CONFIG.sessionManager.popup,
        ...(partial.sessionManager?.popup ?? {}),
      },
      fzf: {
        ...DEFAULT_CONFIG.sessionManager.fzf,
        ...(partial.sessionManager?.fzf ?? {}),
      },
      preview: {
        ...DEFAULT_CONFIG.sessionManager.preview,
        ...(partial.sessionManager?.preview ?? {}),
      },
      kill: {
        ...DEFAULT_CONFIG.sessionManager.kill,
        ...(partial.sessionManager?.kill ?? {}),
      },
    },
    statuslineSessions: {
      showIndex:
        partial.statuslineSessions?.showIndex ??
        DEFAULT_CONFIG.statuslineSessions.showIndex,
      colors: {
        ...DEFAULT_CONFIG.statuslineSessions.colors,
        ...(partial.statuslineSessions?.colors ?? {}),
      },
      fonts: {
        ...DEFAULT_CONFIG.statuslineSessions.fonts,
        ...(partial.statuslineSessions?.fonts ?? {}),
      },
    },
    categories: {
      defaultCategory:
        partial.categories?.defaultCategory ??
        DEFAULT_CONFIG.categories.defaultCategory,
      rules: (partial.categories?.rules ?? DEFAULT_CONFIG.categories.rules).map(
        (rule) => ({
          category: rule.category ?? "",
          ghqPatterns: [...(rule.ghqPatterns ?? [])],
          pathPatterns: [...(rule.pathPatterns ?? [])],
        }),
      ),
      sessionNameRules: (
        partial.categories?.sessionNameRules ??
        DEFAULT_CONFIG.categories.sessionNameRules
      ).map((rule) => ({
        category: rule.category ?? "",
        patterns: [...(rule.patterns ?? [])],
      })),
    },
  }
}

export const resolveConfigPath = ({
  env = process.env,
  homeDirectory = homedir(),
}: {
  readonly env?: NodeJS.ProcessEnv
  readonly homeDirectory?: string
} = {}): string => {
  const xdgConfigHome = env.XDG_CONFIG_HOME
  const baseDirectory =
    typeof xdgConfigHome === "string" && xdgConfigHome.trim().length > 0
      ? xdgConfigHome
      : join(homeDirectory, ".config")

  return join(baseDirectory, CONFIG_DIRECTORY, CONFIG_BASENAME)
}

const parseYamlConfig = (source: string, path: string): PartialConfig => {
  let parsed: unknown
  try {
    parsed = parse(source)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new ConfigValidationError(
      `Failed to parse YAML config (${path}): ${message}`,
    )
  }

  const normalized = parsed ?? {}
  const partialResult = validatePartialConfig(normalized)
  if (!partialResult.success) {
    throw new ConfigValidationError(
      `Invalid config (${path}): ${formatIssues(partialResult.issues)}`,
    )
  }

  return partialResult.data
}

export const loadConfig = async ({
  env = process.env,
  homeDirectory = homedir(),
  readFileFn = (path: string, encoding: BufferEncoding): Promise<string> =>
    readFile(path, encoding),
}: LoadConfigInput = {}): Promise<LoadConfigResult> => {
  const path = resolveConfigPath({ env, homeDirectory })

  let source: string
  try {
    source = await readFileFn(path, "utf8")
  } catch (error) {
    const code = error as NodeJS.ErrnoException
    if (code.code !== "ENOENT") {
      const message = error instanceof Error ? error.message : String(error)
      throw new ConfigValidationError(
        `Failed to read config (${path}): ${message}`,
      )
    }

    return {
      config: DEFAULT_CONFIG,
      path,
      loaded: false,
    }
  }

  const partial = parseYamlConfig(source, path)
  const merged = mergeConfig(partial)
  const resolvedResult = validateResolvedConfig(merged)
  if (!resolvedResult.success) {
    throw new ConfigValidationError(
      `Invalid merged config (${path}): ${formatIssues(resolvedResult.issues)}`,
    )
  }

  return {
    config: resolvedResult.data,
    path,
    loaded: true,
  }
}
