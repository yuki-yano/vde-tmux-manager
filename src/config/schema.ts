export type SessionManagerPopupConfig = {
  enabled: boolean
  width: string
  height: string
}

export type SessionManagerFzfConfig = {
  prompt: string
  border: string
  previewWidth: string
  previewRefreshMs: number
}

export type SessionManagerPreviewConfig = {
  sessionCaptureLines: number
  paneCaptureLines: number
}

export type SessionManagerKillConfig = {
  sendCtrlC: boolean
  termWaitMs: number
  killWaitMs: number
}

export type SessionManagerConfig = {
  popup: SessionManagerPopupConfig
  fzf: SessionManagerFzfConfig
  preview: SessionManagerPreviewConfig
  kill: SessionManagerKillConfig
}

export type StatuslineSessionsColorsConfig = {
  baseFg: string
  baseBg: string
  currentFg: string
  currentBg: string
  otherFg: string
}

export type StatuslineSessionsFontsConfig = {
  currentPrefix: string
  currentSuffix: string
  otherPrefix: string
  otherSuffix: string
}

export type StatuslineSessionsConfig = {
  showIndex: boolean
  colors: StatuslineSessionsColorsConfig
  fonts: StatuslineSessionsFontsConfig
}

export type StatuslineCategoryColorsConfig = {
  fg: string
  bg: string
}

export type StatuslineCategoryConfig = {
  format: string
  colors: StatuslineCategoryColorsConfig
}

export type CategoryRuleConfig = {
  category: string
  ghqPatterns: readonly string[]
  pathPatterns: readonly string[]
}

export type SessionNameRuleConfig = {
  category: string
  patterns: readonly string[]
}

export type CategoriesConfig = {
  defaultCategory: string
  order?: Readonly<Record<string, number>>
  rules: readonly CategoryRuleConfig[]
  sessionNameRules: readonly SessionNameRuleConfig[]
}

export type ResolvedConfig = {
  sessionManager: SessionManagerConfig
  statuslineCategory: StatuslineCategoryConfig
  statuslineSessions: StatuslineSessionsConfig
  categories: CategoriesConfig
}

export type PartialConfig = {
  sessionManager?: {
    popup?: Partial<SessionManagerPopupConfig>
    fzf?: Partial<SessionManagerFzfConfig>
    preview?: Partial<SessionManagerPreviewConfig>
    kill?: Partial<SessionManagerKillConfig>
  }
  statuslineSessions?: {
    showIndex?: boolean
    colors?: Partial<StatuslineSessionsColorsConfig>
    fonts?: Partial<StatuslineSessionsFontsConfig>
  }
  statuslineCategory?: {
    format?: string
    colors?: Partial<StatuslineCategoryColorsConfig>
  }
  categories?: {
    defaultCategory?: string
    order?: Record<string, number>
    rules?: Array<{
      category?: string
      ghqPatterns?: string[]
      pathPatterns?: string[]
    }>
    sessionNameRules?: Array<{
      category?: string
      patterns?: string[]
    }>
  }
}

export type ValidationIssue = {
  path: ReadonlyArray<PropertyKey>
  message: string
}

type ValidationSuccess<T> = {
  success: true
  data: T
}

type ValidationFailure = {
  success: false
  issues: ReadonlyArray<ValidationIssue>
}

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return (
    value !== null && typeof value === "object" && Array.isArray(value) !== true
  )
}

const pushIssue = (
  issues: ValidationIssue[],
  path: ReadonlyArray<PropertyKey>,
  message: string,
): void => {
  issues.push({
    path: [...path],
    message,
  })
}

const ensureNoUnknownKeys = (
  record: Record<string, unknown>,
  allowedKeys: string[],
  path: ReadonlyArray<PropertyKey>,
  issues: ValidationIssue[],
): void => {
  const allowed = new Set(allowedKeys)
  for (const key of Object.keys(record)) {
    if (allowed.has(key)) {
      continue
    }
    pushIssue(issues, [...path, key], "unknown key")
  }
}

const parseBoolean = (
  value: unknown,
  path: ReadonlyArray<PropertyKey>,
  issues: ValidationIssue[],
  required: boolean,
): boolean | undefined => {
  if (value === undefined) {
    if (required) {
      pushIssue(issues, path, "required")
    }
    return undefined
  }

  if (typeof value !== "boolean") {
    pushIssue(issues, path, "must be boolean")
    return undefined
  }

  return value
}

const parseString = (
  value: unknown,
  path: ReadonlyArray<PropertyKey>,
  issues: ValidationIssue[],
  required: boolean,
): string | undefined => {
  if (value === undefined) {
    if (required) {
      pushIssue(issues, path, "required")
    }
    return undefined
  }

  if (typeof value !== "string") {
    pushIssue(issues, path, "must be string")
    return undefined
  }

  return value
}

const parseNonEmptyString = (
  value: unknown,
  path: ReadonlyArray<PropertyKey>,
  issues: ValidationIssue[],
  required: boolean,
): string | undefined => {
  const parsed = parseString(value, path, issues, required)
  if (parsed === undefined) {
    return undefined
  }

  if (parsed.trim().length === 0) {
    pushIssue(issues, path, "must include non-whitespace characters")
    return undefined
  }

  return parsed
}

const parseDimension = (
  value: unknown,
  path: ReadonlyArray<PropertyKey>,
  issues: ValidationIssue[],
  required: boolean,
): string | undefined => {
  const parsed = parseString(value, path, issues, required)
  if (parsed === undefined) {
    return undefined
  }

  const normalized = parsed.trim()
  if (/^\d+%?$/.test(normalized) !== true) {
    pushIssue(issues, path, "must be a number or percentage")
    return undefined
  }

  return normalized
}

const parseNonNegativeInteger = (
  value: unknown,
  path: ReadonlyArray<PropertyKey>,
  issues: ValidationIssue[],
  required: boolean,
): number | undefined => {
  if (value === undefined) {
    if (required) {
      pushIssue(issues, path, "required")
    }
    return undefined
  }

  if (typeof value !== "number") {
    pushIssue(issues, path, "must be number")
    return undefined
  }

  if (Number.isInteger(value) !== true || value < 0) {
    pushIssue(issues, path, "must be a non-negative integer")
    return undefined
  }

  return value
}

const parseStringArray = (
  value: unknown,
  path: ReadonlyArray<PropertyKey>,
  issues: ValidationIssue[],
  required: boolean,
): string[] | undefined => {
  if (value === undefined) {
    if (required) {
      pushIssue(issues, path, "required")
    }
    return undefined
  }

  if (Array.isArray(value) !== true) {
    pushIssue(issues, path, "must be an array")
    return undefined
  }

  const result: string[] = []
  for (const [index, item] of value.entries()) {
    const parsed = parseNonEmptyString(item, [...path, index], issues, true)
    if (parsed !== undefined) {
      result.push(parsed)
    }
  }

  return result
}

const parseIntegerRecord = (
  value: unknown,
  path: ReadonlyArray<PropertyKey>,
  issues: ValidationIssue[],
  required: boolean,
): Record<string, number> | undefined => {
  if (value === undefined) {
    if (required) {
      pushIssue(issues, path, "required")
    }
    return undefined
  }

  if (!isRecord(value)) {
    pushIssue(issues, path, "must be an object")
    return undefined
  }

  const result: Record<string, number> = {}
  for (const [key, rawValue] of Object.entries(value)) {
    if (typeof rawValue !== "number" || Number.isInteger(rawValue) !== true) {
      pushIssue(issues, [...path, key], "must be integer")
      continue
    }
    result[key] = rawValue
  }

  return result
}

const parsePopupConfig = (
  value: unknown,
  path: ReadonlyArray<PropertyKey>,
  issues: ValidationIssue[],
  requiredObject: boolean,
  requiredFields: boolean,
):
  | Partial<SessionManagerPopupConfig>
  | SessionManagerPopupConfig
  | undefined => {
  if (value === undefined) {
    if (requiredObject) {
      pushIssue(issues, path, "required")
    }
    return undefined
  }

  if (!isRecord(value)) {
    pushIssue(issues, path, "must be an object")
    return undefined
  }

  ensureNoUnknownKeys(value, ["enabled", "width", "height"], path, issues)

  const enabled = parseBoolean(
    value.enabled,
    [...path, "enabled"],
    issues,
    requiredFields,
  )
  const width = parseDimension(
    value.width,
    [...path, "width"],
    issues,
    requiredFields,
  )
  const height = parseDimension(
    value.height,
    [...path, "height"],
    issues,
    requiredFields,
  )

  const partial: Partial<SessionManagerPopupConfig> = {}
  if (enabled !== undefined) {
    partial.enabled = enabled
  }
  if (width !== undefined) {
    partial.width = width
  }
  if (height !== undefined) {
    partial.height = height
  }

  if (requiredFields) {
    if (
      partial.enabled === undefined ||
      partial.width === undefined ||
      partial.height === undefined
    ) {
      return undefined
    }
    return partial as SessionManagerPopupConfig
  }

  return partial
}

const parseFzfConfig = (
  value: unknown,
  path: ReadonlyArray<PropertyKey>,
  issues: ValidationIssue[],
  requiredObject: boolean,
  requiredFields: boolean,
): Partial<SessionManagerFzfConfig> | SessionManagerFzfConfig | undefined => {
  if (value === undefined) {
    if (requiredObject) {
      pushIssue(issues, path, "required")
    }
    return undefined
  }

  if (!isRecord(value)) {
    pushIssue(issues, path, "must be an object")
    return undefined
  }

  ensureNoUnknownKeys(
    value,
    ["prompt", "border", "previewWidth", "previewRefreshMs"],
    path,
    issues,
  )

  const prompt = parseNonEmptyString(
    value.prompt,
    [...path, "prompt"],
    issues,
    requiredFields,
  )
  const border = parseNonEmptyString(
    value.border,
    [...path, "border"],
    issues,
    requiredFields,
  )
  const previewWidth = parseDimension(
    value.previewWidth,
    [...path, "previewWidth"],
    issues,
    requiredFields,
  )
  const previewRefreshMs = parseNonNegativeInteger(
    value.previewRefreshMs,
    [...path, "previewRefreshMs"],
    issues,
    requiredFields,
  )

  const partial: Partial<SessionManagerFzfConfig> = {}
  if (prompt !== undefined) {
    partial.prompt = prompt
  }
  if (border !== undefined) {
    partial.border = border
  }
  if (previewWidth !== undefined) {
    partial.previewWidth = previewWidth
  }
  if (previewRefreshMs !== undefined) {
    partial.previewRefreshMs = previewRefreshMs
  }

  if (requiredFields) {
    if (
      partial.prompt === undefined ||
      partial.border === undefined ||
      partial.previewWidth === undefined ||
      partial.previewRefreshMs === undefined
    ) {
      return undefined
    }
    return partial as SessionManagerFzfConfig
  }

  return partial
}

const parsePreviewConfig = (
  value: unknown,
  path: ReadonlyArray<PropertyKey>,
  issues: ValidationIssue[],
  requiredObject: boolean,
  requiredFields: boolean,
):
  | Partial<SessionManagerPreviewConfig>
  | SessionManagerPreviewConfig
  | undefined => {
  if (value === undefined) {
    if (requiredObject) {
      pushIssue(issues, path, "required")
    }
    return undefined
  }

  if (!isRecord(value)) {
    pushIssue(issues, path, "must be an object")
    return undefined
  }

  ensureNoUnknownKeys(
    value,
    ["sessionCaptureLines", "paneCaptureLines"],
    path,
    issues,
  )

  const sessionCaptureLines = parseNonNegativeInteger(
    value.sessionCaptureLines,
    [...path, "sessionCaptureLines"],
    issues,
    requiredFields,
  )
  const paneCaptureLines = parseNonNegativeInteger(
    value.paneCaptureLines,
    [...path, "paneCaptureLines"],
    issues,
    requiredFields,
  )

  const partial: Partial<SessionManagerPreviewConfig> = {}
  if (sessionCaptureLines !== undefined) {
    partial.sessionCaptureLines = sessionCaptureLines
  }
  if (paneCaptureLines !== undefined) {
    partial.paneCaptureLines = paneCaptureLines
  }

  if (requiredFields) {
    if (
      partial.sessionCaptureLines === undefined ||
      partial.paneCaptureLines === undefined
    ) {
      return undefined
    }
    return partial as SessionManagerPreviewConfig
  }

  return partial
}

const parseKillConfig = (
  value: unknown,
  path: ReadonlyArray<PropertyKey>,
  issues: ValidationIssue[],
  requiredObject: boolean,
  requiredFields: boolean,
): Partial<SessionManagerKillConfig> | SessionManagerKillConfig | undefined => {
  if (value === undefined) {
    if (requiredObject) {
      pushIssue(issues, path, "required")
    }
    return undefined
  }

  if (!isRecord(value)) {
    pushIssue(issues, path, "must be an object")
    return undefined
  }

  ensureNoUnknownKeys(
    value,
    ["sendCtrlC", "termWaitMs", "killWaitMs"],
    path,
    issues,
  )

  const sendCtrlC = parseBoolean(
    value.sendCtrlC,
    [...path, "sendCtrlC"],
    issues,
    requiredFields,
  )
  const termWaitMs = parseNonNegativeInteger(
    value.termWaitMs,
    [...path, "termWaitMs"],
    issues,
    requiredFields,
  )
  const killWaitMs = parseNonNegativeInteger(
    value.killWaitMs,
    [...path, "killWaitMs"],
    issues,
    requiredFields,
  )

  const partial: Partial<SessionManagerKillConfig> = {}
  if (sendCtrlC !== undefined) {
    partial.sendCtrlC = sendCtrlC
  }
  if (termWaitMs !== undefined) {
    partial.termWaitMs = termWaitMs
  }
  if (killWaitMs !== undefined) {
    partial.killWaitMs = killWaitMs
  }

  if (requiredFields) {
    if (
      partial.sendCtrlC === undefined ||
      partial.termWaitMs === undefined ||
      partial.killWaitMs === undefined
    ) {
      return undefined
    }
    return partial as SessionManagerKillConfig
  }

  return partial
}

const parseColorsConfig = (
  value: unknown,
  path: ReadonlyArray<PropertyKey>,
  issues: ValidationIssue[],
  requiredObject: boolean,
  requiredFields: boolean,
):
  | Partial<StatuslineSessionsColorsConfig>
  | StatuslineSessionsColorsConfig
  | undefined => {
  if (value === undefined) {
    if (requiredObject) {
      pushIssue(issues, path, "required")
    }
    return undefined
  }

  if (!isRecord(value)) {
    pushIssue(issues, path, "must be an object")
    return undefined
  }

  ensureNoUnknownKeys(
    value,
    ["baseFg", "baseBg", "currentFg", "currentBg", "otherFg"],
    path,
    issues,
  )

  const baseFg = parseNonEmptyString(
    value.baseFg,
    [...path, "baseFg"],
    issues,
    requiredFields,
  )
  const baseBg = parseNonEmptyString(
    value.baseBg,
    [...path, "baseBg"],
    issues,
    requiredFields,
  )
  const currentFg = parseNonEmptyString(
    value.currentFg,
    [...path, "currentFg"],
    issues,
    requiredFields,
  )
  const currentBg = parseNonEmptyString(
    value.currentBg,
    [...path, "currentBg"],
    issues,
    requiredFields,
  )
  const otherFg = parseNonEmptyString(
    value.otherFg,
    [...path, "otherFg"],
    issues,
    requiredFields,
  )

  const partial: Partial<StatuslineSessionsColorsConfig> = {}
  if (baseFg !== undefined) {
    partial.baseFg = baseFg
  }
  if (baseBg !== undefined) {
    partial.baseBg = baseBg
  }
  if (currentFg !== undefined) {
    partial.currentFg = currentFg
  }
  if (currentBg !== undefined) {
    partial.currentBg = currentBg
  }
  if (otherFg !== undefined) {
    partial.otherFg = otherFg
  }

  if (requiredFields) {
    if (
      partial.baseFg === undefined ||
      partial.baseBg === undefined ||
      partial.currentFg === undefined ||
      partial.currentBg === undefined ||
      partial.otherFg === undefined
    ) {
      return undefined
    }
    return partial as StatuslineSessionsColorsConfig
  }

  return partial
}

const parseFontsConfig = (
  value: unknown,
  path: ReadonlyArray<PropertyKey>,
  issues: ValidationIssue[],
  requiredObject: boolean,
  requiredFields: boolean,
):
  | Partial<StatuslineSessionsFontsConfig>
  | StatuslineSessionsFontsConfig
  | undefined => {
  if (value === undefined) {
    if (requiredObject) {
      pushIssue(issues, path, "required")
    }
    return undefined
  }

  if (!isRecord(value)) {
    pushIssue(issues, path, "must be an object")
    return undefined
  }

  ensureNoUnknownKeys(
    value,
    ["currentPrefix", "currentSuffix", "otherPrefix", "otherSuffix"],
    path,
    issues,
  )

  const currentPrefix = parseString(
    value.currentPrefix,
    [...path, "currentPrefix"],
    issues,
    requiredFields,
  )
  const currentSuffix = parseString(
    value.currentSuffix,
    [...path, "currentSuffix"],
    issues,
    requiredFields,
  )
  const otherPrefix = parseString(
    value.otherPrefix,
    [...path, "otherPrefix"],
    issues,
    requiredFields,
  )
  const otherSuffix = parseString(
    value.otherSuffix,
    [...path, "otherSuffix"],
    issues,
    requiredFields,
  )

  const partial: Partial<StatuslineSessionsFontsConfig> = {}
  if (currentPrefix !== undefined) {
    partial.currentPrefix = currentPrefix
  }
  if (currentSuffix !== undefined) {
    partial.currentSuffix = currentSuffix
  }
  if (otherPrefix !== undefined) {
    partial.otherPrefix = otherPrefix
  }
  if (otherSuffix !== undefined) {
    partial.otherSuffix = otherSuffix
  }

  if (requiredFields) {
    if (
      partial.currentPrefix === undefined ||
      partial.currentSuffix === undefined ||
      partial.otherPrefix === undefined ||
      partial.otherSuffix === undefined
    ) {
      return undefined
    }
    return partial as StatuslineSessionsFontsConfig
  }

  return partial
}

const parseStatuslineCategoryColorsConfig = (
  value: unknown,
  path: ReadonlyArray<PropertyKey>,
  issues: ValidationIssue[],
  requiredObject: boolean,
  requiredFields: boolean,
):
  | Partial<StatuslineCategoryColorsConfig>
  | StatuslineCategoryColorsConfig
  | undefined => {
  if (value === undefined) {
    if (requiredObject) {
      pushIssue(issues, path, "required")
    }
    return undefined
  }

  if (!isRecord(value)) {
    pushIssue(issues, path, "must be an object")
    return undefined
  }

  ensureNoUnknownKeys(value, ["fg", "bg"], path, issues)

  const fg = parseNonEmptyString(
    value.fg,
    [...path, "fg"],
    issues,
    requiredFields,
  )
  const bg = parseNonEmptyString(
    value.bg,
    [...path, "bg"],
    issues,
    requiredFields,
  )

  const partial: Partial<StatuslineCategoryColorsConfig> = {}
  if (fg !== undefined) {
    partial.fg = fg
  }
  if (bg !== undefined) {
    partial.bg = bg
  }

  if (requiredFields) {
    if (partial.fg === undefined || partial.bg === undefined) {
      return undefined
    }
    return partial as StatuslineCategoryColorsConfig
  }

  return partial
}

const parseCategoryRule = (
  value: unknown,
  path: ReadonlyArray<PropertyKey>,
  issues: ValidationIssue[],
  requiredFields: boolean,
): Partial<CategoryRuleConfig> | CategoryRuleConfig | undefined => {
  if (!isRecord(value)) {
    pushIssue(issues, path, "must be an object")
    return undefined
  }

  ensureNoUnknownKeys(
    value,
    ["category", "ghqPatterns", "pathPatterns"],
    path,
    issues,
  )

  const category = parseNonEmptyString(
    value.category,
    [...path, "category"],
    issues,
    requiredFields,
  )
  const ghqPatterns = parseStringArray(
    value.ghqPatterns,
    [...path, "ghqPatterns"],
    issues,
    false,
  )
  const pathPatterns = parseStringArray(
    value.pathPatterns,
    [...path, "pathPatterns"],
    issues,
    false,
  )

  if (
    ghqPatterns === undefined &&
    pathPatterns === undefined &&
    requiredFields === true
  ) {
    pushIssue(issues, path, "must define ghqPatterns or pathPatterns")
  }

  const partial: Partial<CategoryRuleConfig> = {}
  if (category !== undefined) {
    partial.category = category
  }
  if (ghqPatterns !== undefined) {
    partial.ghqPatterns = ghqPatterns
  }
  if (pathPatterns !== undefined) {
    partial.pathPatterns = pathPatterns
  }

  if (requiredFields) {
    if (partial.category === undefined) {
      return undefined
    }
    return {
      category: partial.category,
      ghqPatterns: partial.ghqPatterns ?? [],
      pathPatterns: partial.pathPatterns ?? [],
    }
  }

  return partial
}

const parseCategoryRules = (
  value: unknown,
  path: ReadonlyArray<PropertyKey>,
  issues: ValidationIssue[],
  required: boolean,
  requiredFields: boolean,
): Partial<CategoryRuleConfig>[] | CategoryRuleConfig[] | undefined => {
  if (value === undefined) {
    if (required) {
      pushIssue(issues, path, "required")
    }
    return undefined
  }

  if (Array.isArray(value) !== true) {
    pushIssue(issues, path, "must be an array")
    return undefined
  }

  const result: Array<Partial<CategoryRuleConfig> | CategoryRuleConfig> = []
  for (const [index, item] of value.entries()) {
    const parsed = parseCategoryRule(
      item,
      [...path, index],
      issues,
      requiredFields,
    )
    if (parsed !== undefined) {
      result.push(parsed)
    }
  }
  return result
}

const parseSessionNameRule = (
  value: unknown,
  path: ReadonlyArray<PropertyKey>,
  issues: ValidationIssue[],
  requiredFields: boolean,
): Partial<SessionNameRuleConfig> | SessionNameRuleConfig | undefined => {
  if (!isRecord(value)) {
    pushIssue(issues, path, "must be an object")
    return undefined
  }

  ensureNoUnknownKeys(value, ["category", "patterns"], path, issues)

  const category = parseNonEmptyString(
    value.category,
    [...path, "category"],
    issues,
    requiredFields,
  )
  const patterns = parseStringArray(
    value.patterns,
    [...path, "patterns"],
    issues,
    requiredFields,
  )

  const partial: Partial<SessionNameRuleConfig> = {}
  if (category !== undefined) {
    partial.category = category
  }
  if (patterns !== undefined) {
    partial.patterns = patterns
  }

  if (requiredFields) {
    if (partial.category === undefined || partial.patterns === undefined) {
      return undefined
    }
    return partial as SessionNameRuleConfig
  }

  return partial
}

const parseSessionNameRules = (
  value: unknown,
  path: ReadonlyArray<PropertyKey>,
  issues: ValidationIssue[],
  required: boolean,
  requiredFields: boolean,
): Partial<SessionNameRuleConfig>[] | SessionNameRuleConfig[] | undefined => {
  if (value === undefined) {
    if (required) {
      pushIssue(issues, path, "required")
    }
    return undefined
  }

  if (Array.isArray(value) !== true) {
    pushIssue(issues, path, "must be an array")
    return undefined
  }

  const result: Array<Partial<SessionNameRuleConfig> | SessionNameRuleConfig> =
    []
  for (const [index, item] of value.entries()) {
    const parsed = parseSessionNameRule(
      item,
      [...path, index],
      issues,
      requiredFields,
    )
    if (parsed !== undefined) {
      result.push(parsed)
    }
  }
  return result
}

const parseCategories = (
  value: unknown,
  path: ReadonlyArray<PropertyKey>,
  issues: ValidationIssue[],
  requiredObject: boolean,
  requiredFields: boolean,
): PartialConfig["categories"] | CategoriesConfig | undefined => {
  if (value === undefined) {
    if (requiredObject) {
      pushIssue(issues, path, "required")
    }
    return undefined
  }

  if (!isRecord(value)) {
    pushIssue(issues, path, "must be an object")
    return undefined
  }

  ensureNoUnknownKeys(
    value,
    ["defaultCategory", "order", "rules", "sessionNameRules"],
    path,
    issues,
  )

  const defaultCategory = parseString(
    value.defaultCategory,
    [...path, "defaultCategory"],
    issues,
    requiredFields,
  )
  const order = parseIntegerRecord(
    value.order,
    [...path, "order"],
    issues,
    false,
  )
  const rules = parseCategoryRules(
    value.rules,
    [...path, "rules"],
    issues,
    false,
    requiredFields,
  )
  const sessionNameRules = parseSessionNameRules(
    value.sessionNameRules,
    [...path, "sessionNameRules"],
    issues,
    false,
    requiredFields,
  )

  const partial: NonNullable<PartialConfig["categories"]> = {}
  if (defaultCategory !== undefined) {
    partial.defaultCategory = defaultCategory
  }
  if (order !== undefined) {
    partial.order = order
  }
  if (rules !== undefined) {
    partial.rules = rules as NonNullable<PartialConfig["categories"]>["rules"]
  }
  if (sessionNameRules !== undefined) {
    partial.sessionNameRules = sessionNameRules as NonNullable<
      PartialConfig["categories"]
    >["sessionNameRules"]
  }

  if (requiredFields) {
    if (partial.defaultCategory === undefined) {
      return undefined
    }
    return {
      defaultCategory: partial.defaultCategory,
      order: partial.order ?? {},
      rules: (partial.rules ?? []).map((rule) => ({
        category: rule?.category ?? "",
        ghqPatterns: rule?.ghqPatterns ?? [],
        pathPatterns: rule?.pathPatterns ?? [],
      })),
      sessionNameRules: (partial.sessionNameRules ?? []).map((rule) => ({
        category: rule?.category ?? "",
        patterns: rule?.patterns ?? [],
      })),
    }
  }

  return partial
}

const parseSessionManager = (
  value: unknown,
  path: ReadonlyArray<PropertyKey>,
  issues: ValidationIssue[],
  requiredObject: boolean,
  requiredFields: boolean,
): PartialConfig["sessionManager"] | SessionManagerConfig | undefined => {
  if (value === undefined) {
    if (requiredObject) {
      pushIssue(issues, path, "required")
    }
    return undefined
  }

  if (!isRecord(value)) {
    pushIssue(issues, path, "must be an object")
    return undefined
  }

  ensureNoUnknownKeys(value, ["popup", "fzf", "preview", "kill"], path, issues)

  const popup = parsePopupConfig(
    value.popup,
    [...path, "popup"],
    issues,
    requiredFields,
    requiredFields,
  )
  const fzf = parseFzfConfig(
    value.fzf,
    [...path, "fzf"],
    issues,
    requiredFields,
    requiredFields,
  )
  const preview = parsePreviewConfig(
    value.preview,
    [...path, "preview"],
    issues,
    requiredFields,
    requiredFields,
  )
  const kill = parseKillConfig(
    value.kill,
    [...path, "kill"],
    issues,
    requiredFields,
    requiredFields,
  )

  const partial: {
    popup?: Partial<SessionManagerPopupConfig>
    fzf?: Partial<SessionManagerFzfConfig>
    preview?: Partial<SessionManagerPreviewConfig>
    kill?: Partial<SessionManagerKillConfig>
  } = {}

  if (popup !== undefined) {
    partial.popup = popup as Partial<SessionManagerPopupConfig>
  }
  if (fzf !== undefined) {
    partial.fzf = fzf as Partial<SessionManagerFzfConfig>
  }
  if (preview !== undefined) {
    partial.preview = preview as Partial<SessionManagerPreviewConfig>
  }
  if (kill !== undefined) {
    partial.kill = kill as Partial<SessionManagerKillConfig>
  }

  if (requiredFields) {
    if (
      partial.popup === undefined ||
      partial.fzf === undefined ||
      partial.preview === undefined ||
      partial.kill === undefined
    ) {
      return undefined
    }
    return partial as SessionManagerConfig
  }

  return partial
}

const parseStatuslineSessions = (
  value: unknown,
  path: ReadonlyArray<PropertyKey>,
  issues: ValidationIssue[],
  requiredObject: boolean,
  requiredFields: boolean,
):
  | PartialConfig["statuslineSessions"]
  | StatuslineSessionsConfig
  | undefined => {
  if (value === undefined) {
    if (requiredObject) {
      pushIssue(issues, path, "required")
    }
    return undefined
  }

  if (!isRecord(value)) {
    pushIssue(issues, path, "must be an object")
    return undefined
  }

  ensureNoUnknownKeys(value, ["showIndex", "colors", "fonts"], path, issues)

  const showIndex = parseBoolean(
    value.showIndex,
    [...path, "showIndex"],
    issues,
    requiredFields,
  )

  const colors = parseColorsConfig(
    value.colors,
    [...path, "colors"],
    issues,
    requiredFields,
    requiredFields,
  )
  const fonts = parseFontsConfig(
    value.fonts,
    [...path, "fonts"],
    issues,
    requiredFields,
    requiredFields,
  )

  const partial: {
    showIndex?: boolean
    colors?: Partial<StatuslineSessionsColorsConfig>
    fonts?: Partial<StatuslineSessionsFontsConfig>
  } = {}

  if (showIndex !== undefined) {
    partial.showIndex = showIndex
  }
  if (colors !== undefined) {
    partial.colors = colors as Partial<StatuslineSessionsColorsConfig>
  }
  if (fonts !== undefined) {
    partial.fonts = fonts as Partial<StatuslineSessionsFontsConfig>
  }

  if (requiredFields) {
    if (
      partial.showIndex === undefined ||
      partial.colors === undefined ||
      partial.fonts === undefined
    ) {
      return undefined
    }
    return partial as StatuslineSessionsConfig
  }

  return partial
}

const parseStatuslineCategory = (
  value: unknown,
  path: ReadonlyArray<PropertyKey>,
  issues: ValidationIssue[],
  requiredObject: boolean,
  requiredFields: boolean,
):
  | PartialConfig["statuslineCategory"]
  | StatuslineCategoryConfig
  | undefined => {
  if (value === undefined) {
    if (requiredObject) {
      pushIssue(issues, path, "required")
    }
    return undefined
  }

  if (!isRecord(value)) {
    pushIssue(issues, path, "must be an object")
    return undefined
  }

  ensureNoUnknownKeys(value, ["format", "colors"], path, issues)

  const format = parseString(
    value.format,
    [...path, "format"],
    issues,
    requiredFields,
  )
  const colors = parseStatuslineCategoryColorsConfig(
    value.colors,
    [...path, "colors"],
    issues,
    requiredFields,
    requiredFields,
  )

  const partial: NonNullable<PartialConfig["statuslineCategory"]> = {}
  if (format !== undefined) {
    partial.format = format
  }
  if (colors !== undefined) {
    partial.colors = colors as Partial<StatuslineCategoryColorsConfig>
  }

  if (requiredFields) {
    if (partial.format === undefined || partial.colors === undefined) {
      return undefined
    }
    return partial as StatuslineCategoryConfig
  }

  return partial
}

export const validatePartialConfig = (
  input: unknown,
): ValidationResult<PartialConfig> => {
  const issues: ValidationIssue[] = []
  if (!isRecord(input)) {
    pushIssue(issues, [], "must be an object")
    return { success: false, issues }
  }

  ensureNoUnknownKeys(
    input,
    [
      "sessionManager",
      "statuslineCategory",
      "statuslineSessions",
      "categories",
    ],
    [],
    issues,
  )

  const sessionManager = parseSessionManager(
    input.sessionManager,
    ["sessionManager"],
    issues,
    false,
    false,
  )
  const statuslineCategory = parseStatuslineCategory(
    input.statuslineCategory,
    ["statuslineCategory"],
    issues,
    false,
    false,
  )
  const statuslineSessions = parseStatuslineSessions(
    input.statuslineSessions,
    ["statuslineSessions"],
    issues,
    false,
    false,
  )
  const categories = parseCategories(
    input.categories,
    ["categories"],
    issues,
    false,
    false,
  )

  if (issues.length > 0) {
    return { success: false, issues }
  }

  const partial: PartialConfig = {}
  if (sessionManager !== undefined) {
    partial.sessionManager = sessionManager as PartialConfig["sessionManager"]
  }
  if (statuslineCategory !== undefined) {
    partial.statuslineCategory =
      statuslineCategory as PartialConfig["statuslineCategory"]
  }
  if (statuslineSessions !== undefined) {
    partial.statuslineSessions =
      statuslineSessions as PartialConfig["statuslineSessions"]
  }
  if (categories !== undefined) {
    partial.categories = categories as PartialConfig["categories"]
  }

  return {
    success: true,
    data: partial,
  }
}

export const validateResolvedConfig = (
  input: unknown,
): ValidationResult<ResolvedConfig> => {
  const issues: ValidationIssue[] = []
  if (!isRecord(input)) {
    pushIssue(issues, [], "must be an object")
    return { success: false, issues }
  }

  ensureNoUnknownKeys(
    input,
    [
      "sessionManager",
      "statuslineCategory",
      "statuslineSessions",
      "categories",
    ],
    [],
    issues,
  )

  const sessionManager = parseSessionManager(
    input.sessionManager,
    ["sessionManager"],
    issues,
    true,
    true,
  )
  const statuslineCategory = parseStatuslineCategory(
    input.statuslineCategory,
    ["statuslineCategory"],
    issues,
    true,
    true,
  )
  const statuslineSessions = parseStatuslineSessions(
    input.statuslineSessions,
    ["statuslineSessions"],
    issues,
    true,
    true,
  )
  const categories = parseCategories(
    input.categories,
    ["categories"],
    issues,
    true,
    true,
  )

  if (
    issues.length > 0 ||
    sessionManager === undefined ||
    statuslineCategory === undefined ||
    statuslineSessions === undefined ||
    categories === undefined
  ) {
    return { success: false, issues }
  }

  return {
    success: true,
    data: {
      sessionManager: sessionManager as SessionManagerConfig,
      statuslineCategory: statuslineCategory as StatuslineCategoryConfig,
      statuslineSessions: statuslineSessions as StatuslineSessionsConfig,
      categories: categories as CategoriesConfig,
    },
  }
}
