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

const CONFIG_DIRECTORY = join("vde", "tmux-manager")
const CONFIG_BASENAME = "config.yml"

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

type ConfigIssue = {
  path: ReadonlyArray<PropertyKey>
  message: string
}

const formatIssues = (issues: ReadonlyArray<ConfigIssue>): string => {
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

const ENV_VARIABLE_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g

const expandConfigPattern = ({
  value,
  env,
  path,
}: {
  readonly value: string
  readonly env: NodeJS.ProcessEnv
  readonly path: ReadonlyArray<PropertyKey>
}):
  | { success: true; value: string }
  | { success: false; issue: ConfigIssue } => {
  let missingVariable: string | null = null
  const expanded = value.replaceAll(ENV_VARIABLE_PATTERN, (_, variable) => {
    const resolved = env[variable]
    if (resolved === undefined) {
      missingVariable = variable
      return ""
    }
    return resolved
  })

  if (missingVariable !== null) {
    return {
      success: false,
      issue: {
        path,
        message: `environment variable ${missingVariable} is not defined`,
      },
    }
  }

  return {
    success: true,
    value: expanded,
  }
}

const expandCategoryRulePatterns = ({
  partial,
  env,
  path,
}: {
  readonly partial: PartialConfig
  readonly env: NodeJS.ProcessEnv
  readonly path: string
}): PartialConfig => {
  const issues: ConfigIssue[] = []

  const rules = partial.categories?.rules?.map((rule, ruleIndex) => {
    const ghqPatterns = rule.ghqPatterns?.map((pattern, patternIndex) => {
      const result = expandConfigPattern({
        value: pattern,
        env,
        path: ["categories", "rules", ruleIndex, "ghqPatterns", patternIndex],
      })
      if (result.success !== true) {
        issues.push(result.issue)
        return pattern
      }
      return result.value
    })

    const pathPatterns = rule.pathPatterns?.map((pattern, patternIndex) => {
      const result = expandConfigPattern({
        value: pattern,
        env,
        path: ["categories", "rules", ruleIndex, "pathPatterns", patternIndex],
      })
      if (result.success !== true) {
        issues.push(result.issue)
        return pattern
      }
      return result.value
    })

    return {
      ...rule,
      ...(ghqPatterns !== undefined ? { ghqPatterns } : {}),
      ...(pathPatterns !== undefined ? { pathPatterns } : {}),
    }
  })

  if (issues.length > 0) {
    throw new ConfigValidationError(
      `Invalid config (${path}): ${formatIssues(issues)}`,
    )
  }

  return {
    ...partial,
    categories:
      partial.categories === undefined
        ? undefined
        : {
            ...partial.categories,
            ...(rules !== undefined ? { rules } : {}),
          },
  }
}

const mergeConfig = (partial: PartialConfig): ResolvedConfig => {
  return {
    ghqRoot: partial.ghqRoot ?? DEFAULT_CONFIG.ghqRoot,
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
    statuslineCategory: {
      format:
        partial.statuslineCategory?.format ??
        DEFAULT_CONFIG.statuslineCategory.format,
      prefix:
        partial.statuslineCategory?.prefix ??
        DEFAULT_CONFIG.statuslineCategory.prefix,
      suffix:
        partial.statuslineCategory?.suffix ??
        DEFAULT_CONFIG.statuslineCategory.suffix,
      bold:
        partial.statuslineCategory?.bold ??
        DEFAULT_CONFIG.statuslineCategory.bold,
      colors: {
        ...DEFAULT_CONFIG.statuslineCategory.colors,
        ...(partial.statuslineCategory?.colors ?? {}),
      },
    },
    statuslineSessions: {
      showIndex:
        partial.statuslineSessions?.showIndex ??
        DEFAULT_CONFIG.statuslineSessions.showIndex,
      current: {
        format:
          partial.statuslineSessions?.current?.format ??
          DEFAULT_CONFIG.statuslineSessions.current.format,
        prefix:
          partial.statuslineSessions?.current?.prefix ??
          DEFAULT_CONFIG.statuslineSessions.current.prefix,
        suffix:
          partial.statuslineSessions?.current?.suffix ??
          DEFAULT_CONFIG.statuslineSessions.current.suffix,
        bold:
          partial.statuslineSessions?.current?.bold ??
          DEFAULT_CONFIG.statuslineSessions.current.bold,
        colors: {
          ...DEFAULT_CONFIG.statuslineSessions.current.colors,
          ...(partial.statuslineSessions?.current?.colors ?? {}),
        },
      },
      other: {
        format:
          partial.statuslineSessions?.other?.format ??
          DEFAULT_CONFIG.statuslineSessions.other.format,
        prefix:
          partial.statuslineSessions?.other?.prefix ??
          DEFAULT_CONFIG.statuslineSessions.other.prefix,
        suffix:
          partial.statuslineSessions?.other?.suffix ??
          DEFAULT_CONFIG.statuslineSessions.other.suffix,
        bold:
          partial.statuslineSessions?.other?.bold ??
          DEFAULT_CONFIG.statuslineSessions.other.bold,
        colors: {
          ...DEFAULT_CONFIG.statuslineSessions.other.colors,
          ...(partial.statuslineSessions?.other?.colors ?? {}),
        },
      },
    },
    categories: {
      defaultCategory:
        partial.categories?.defaultCategory ??
        DEFAULT_CONFIG.categories.defaultCategory,
      order: {
        ...DEFAULT_CONFIG.categories.order,
        ...(partial.categories?.order ?? {}),
      },
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

const parseYamlConfig = ({
  source,
  path,
  env,
}: {
  readonly source: string
  readonly path: string
  readonly env: NodeJS.ProcessEnv
}): PartialConfig => {
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

  return expandCategoryRulePatterns({
    partial: partialResult.data,
    env,
    path,
  })
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

  const partial = parseYamlConfig({ source, path, env })
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
