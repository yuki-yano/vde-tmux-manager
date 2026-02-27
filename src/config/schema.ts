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
  colors: StatuslineSessionsColorsConfig
  fonts: StatuslineSessionsFontsConfig
}

export type ResolvedConfig = {
  sessionManager: SessionManagerConfig
  statuslineSessions: StatuslineSessionsConfig
}

export type PartialConfig = {
  sessionManager?: {
    popup?: Partial<SessionManagerPopupConfig>
    fzf?: Partial<SessionManagerFzfConfig>
    preview?: Partial<SessionManagerPreviewConfig>
    kill?: Partial<SessionManagerKillConfig>
  }
  statuslineSessions?: {
    colors?: Partial<StatuslineSessionsColorsConfig>
    fonts?: Partial<StatuslineSessionsFontsConfig>
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

  ensureNoUnknownKeys(value, ["colors", "fonts"], path, issues)

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
    colors?: Partial<StatuslineSessionsColorsConfig>
    fonts?: Partial<StatuslineSessionsFontsConfig>
  } = {}

  if (colors !== undefined) {
    partial.colors = colors as Partial<StatuslineSessionsColorsConfig>
  }
  if (fonts !== undefined) {
    partial.fonts = fonts as Partial<StatuslineSessionsFontsConfig>
  }

  if (requiredFields) {
    if (partial.colors === undefined || partial.fonts === undefined) {
      return undefined
    }
    return partial as StatuslineSessionsConfig
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
    ["sessionManager", "statuslineSessions"],
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
  const statuslineSessions = parseStatuslineSessions(
    input.statuslineSessions,
    ["statuslineSessions"],
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
  if (statuslineSessions !== undefined) {
    partial.statuslineSessions =
      statuslineSessions as PartialConfig["statuslineSessions"]
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
    ["sessionManager", "statuslineSessions"],
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
  const statuslineSessions = parseStatuslineSessions(
    input.statuslineSessions,
    ["statuslineSessions"],
    issues,
    true,
    true,
  )

  if (
    issues.length > 0 ||
    sessionManager === undefined ||
    statuslineSessions === undefined
  ) {
    return { success: false, issues }
  }

  return {
    success: true,
    data: {
      sessionManager: sessionManager as SessionManagerConfig,
      statuslineSessions: statuslineSessions as StatuslineSessionsConfig,
    },
  }
}
