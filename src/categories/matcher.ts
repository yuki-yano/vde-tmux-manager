import { posix } from "node:path"
import type { CategoriesConfig } from "../config/schema"

const normalizeSlashes = (value: string): string => {
  return value.replaceAll("\\", "/")
}

const normalizePathValue = (value: string): string => {
  const normalized = posix.normalize(normalizeSlashes(value))
  if (normalized === ".") {
    return ""
  }
  if (normalized.length > 1 && normalized.endsWith("/")) {
    return normalized.slice(0, -1)
  }
  return normalized
}

export const expandHomePath = (
  value: string,
  homeDirectory: string,
): string => {
  if (value === "~") {
    return homeDirectory
  }
  if (value.startsWith("~/")) {
    return `${homeDirectory}/${value.slice(2)}`
  }
  return value
}

const splitSegments = (value: string): string[] => {
  return normalizePathValue(value).split("/")
}

const matchSegment = (value: string, pattern: string): boolean => {
  const escaped = pattern
    .replace(/[|\\{}()[\]^$+?.]/g, "\\$&")
    .replaceAll("*", ".*")
  return new RegExp(`^${escaped}$`).test(value)
}

const matchSegments = (
  valueSegments: readonly string[],
  patternSegments: readonly string[],
  valueIndex: number,
  patternIndex: number,
): boolean => {
  const pattern = patternSegments[patternIndex]
  if (pattern === undefined) {
    return valueIndex === valueSegments.length
  }

  if (pattern === "**") {
    if (
      matchSegments(
        valueSegments,
        patternSegments,
        valueIndex,
        patternIndex + 1,
      )
    ) {
      return true
    }
    if (valueIndex < valueSegments.length) {
      return matchSegments(
        valueSegments,
        patternSegments,
        valueIndex + 1,
        patternIndex,
      )
    }
    return false
  }

  const value = valueSegments[valueIndex]
  if (value === undefined || !matchSegment(value, pattern)) {
    return false
  }

  return matchSegments(
    valueSegments,
    patternSegments,
    valueIndex + 1,
    patternIndex + 1,
  )
}

export const matchGlob = (value: string, pattern: string): boolean => {
  return matchSegments(splitSegments(value), splitSegments(pattern), 0, 0)
}

const normalizeGhqRelativePath = (
  projectPath: string,
  ghqRoot: string | null | undefined,
): string | null => {
  if (typeof ghqRoot !== "string" || ghqRoot.trim().length === 0) {
    return null
  }

  const normalizedProjectPath = normalizePathValue(projectPath)
  const normalizedGhqRoot = normalizePathValue(ghqRoot)
  if (
    normalizedProjectPath !== normalizedGhqRoot &&
    !normalizedProjectPath.startsWith(`${normalizedGhqRoot}/`)
  ) {
    return null
  }

  const relative = normalizedProjectPath.slice(normalizedGhqRoot.length)
  return relative.replace(/^\/+/, "")
}

export const resolveProjectPathCategory = ({
  config,
  projectPath,
  ghqRoot,
  homeDirectory,
}: {
  readonly config: CategoriesConfig
  readonly projectPath: string
  readonly ghqRoot?: string | null
  readonly homeDirectory: string
}): string => {
  const normalizedProjectPath = normalizePathValue(projectPath)
  const ghqRelativePath = normalizeGhqRelativePath(
    normalizedProjectPath,
    ghqRoot,
  )

  for (const rule of config.rules) {
    if (ghqRelativePath !== null) {
      for (const pattern of rule.ghqPatterns ?? []) {
        if (matchGlob(ghqRelativePath, pattern)) {
          return rule.category
        }
      }
      continue
    }

    for (const pattern of rule.pathPatterns ?? []) {
      const expanded = normalizePathValue(
        expandHomePath(pattern, homeDirectory),
      )
      if (matchGlob(normalizedProjectPath, expanded)) {
        return rule.category
      }
    }
  }

  return config.defaultCategory
}

export const resolveCategoryForSession = ({
  config,
  sessionName,
  projectPath,
  categoryOverride,
  ghqRoot,
  homeDirectory,
}: {
  readonly config: CategoriesConfig
  readonly sessionName: string
  readonly projectPath: string
  readonly categoryOverride?: string | null
  readonly ghqRoot?: string | null
  readonly homeDirectory: string
}): string => {
  if (
    typeof categoryOverride === "string" &&
    categoryOverride.trim().length > 0
  ) {
    return categoryOverride.trim()
  }

  if (projectPath.trim().length > 0) {
    return resolveProjectPathCategory({
      config,
      projectPath,
      ghqRoot,
      homeDirectory,
    })
  }

  for (const rule of config.sessionNameRules) {
    for (const pattern of rule.patterns ?? []) {
      if (matchGlob(sessionName, pattern)) {
        return rule.category
      }
    }
  }

  return config.defaultCategory
}

export const collectDefinedCategories = (
  config: CategoriesConfig,
): string[] => {
  const categories = new Set<string>([config.defaultCategory])
  for (const rule of config.rules) {
    categories.add(rule.category)
  }
  for (const rule of config.sessionNameRules) {
    categories.add(rule.category)
  }
  return Array.from(categories)
}

const toNumericCategory = (value: string): number | null => {
  if (/^-?\d+$/.test(value.trim()) !== true) {
    return null
  }

  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

export const sortCategories = (
  categories: ReadonlyArray<string>,
  order: Readonly<Record<string, number>> = {},
): string[] => {
  return [...categories].sort((left, right) => {
    const leftOrder = order[left]
    const rightOrder = order[right]

    if (
      typeof leftOrder === "number" &&
      typeof rightOrder === "number" &&
      leftOrder !== rightOrder
    ) {
      return leftOrder - rightOrder
    }

    if (typeof leftOrder === "number") {
      return -1
    }

    if (typeof rightOrder === "number") {
      return 1
    }

    const leftNumeric = toNumericCategory(left)
    const rightNumeric = toNumericCategory(right)
    if (leftNumeric !== null && rightNumeric !== null) {
      return leftNumeric - rightNumeric
    }

    return left.localeCompare(right)
  })
}
