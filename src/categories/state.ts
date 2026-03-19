import { collectDefinedCategories, resolveCategoryForSession } from "./matcher"
import type { ResolvedConfig } from "../config/schema"
import type { TmuxClient } from "../tmux/client"
import type { SessionDetails } from "../tmux/parse"

const CURRENT_CATEGORY_OPTION = "current_category"
const CATEGORY_OPTION = "category"
const CATEGORY_OVERRIDE_OPTION = "category_override"
const CATEGORY_LAST_SESSIONS_OPTION = "category_last_sessions"

type CategoryLastSessionsState = Record<string, string>

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return (
    value !== null && typeof value === "object" && Array.isArray(value) !== true
  )
}

const ensureKnownCategory = ({
  config,
  categoryName,
}: {
  readonly config: ResolvedConfig
  readonly categoryName: string
}): string => {
  const normalized = categoryName.trim()
  const definedCategories = collectDefinedCategories(config.categories)
  if (!definedCategories.includes(normalized)) {
    throw new Error(`unknown category: ${normalized}`)
  }

  return normalized
}

const requireCurrentClientName = async ({
  tmux,
  errorMessage,
}: {
  readonly tmux: Pick<TmuxClient, "currentClientName">
  readonly errorMessage: string
}): Promise<string> => {
  const clientName = await tmux.currentClientName()
  if (clientName.length === 0) {
    throw new Error(errorMessage)
  }
  return clientName
}

const parseCategoryLastSessionsState = (
  rawState: string,
): CategoryLastSessionsState => {
  const normalized = rawState.trim()
  if (normalized.length === 0) {
    return {}
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(normalized)
  } catch {
    throw new Error("invalid category last-session state")
  }

  if (!isRecord(parsed)) {
    throw new Error("invalid category last-session state")
  }

  const result: CategoryLastSessionsState = {}
  for (const [categoryName, sessionName] of Object.entries(parsed)) {
    if (typeof sessionName !== "string" || sessionName.trim().length === 0) {
      throw new Error("invalid category last-session state")
    }
    result[categoryName] = sessionName
  }

  return result
}

const readCategoryLastSessionsState = async ({
  tmux,
  clientName,
}: {
  readonly tmux: Pick<TmuxClient, "showClientOption">
  readonly clientName: string
}): Promise<CategoryLastSessionsState> => {
  return parseCategoryLastSessionsState(
    await tmux.showClientOption(clientName, CATEGORY_LAST_SESSIONS_OPTION),
  )
}

const writeCategoryLastSessionsState = async ({
  tmux,
  clientName,
  state,
}: {
  readonly tmux: Pick<TmuxClient, "setClientOption">
  readonly clientName: string
  readonly state: CategoryLastSessionsState
}): Promise<void> => {
  await tmux.setClientOption(
    clientName,
    CATEGORY_LAST_SESSIONS_OPTION,
    JSON.stringify(state),
  )
}

const writeCurrentCategoryForClient = async ({
  tmux,
  clientName,
  categoryName,
}: {
  readonly tmux: Pick<TmuxClient, "setClientOption">
  readonly clientName: string
  readonly categoryName: string
}): Promise<void> => {
  await tmux.setClientOption(clientName, CURRENT_CATEGORY_OPTION, categoryName)
}

export const getCurrentCategory = async ({
  tmux,
  config,
}: {
  readonly tmux: Pick<TmuxClient, "currentClientName" | "showClientOption">
  readonly config: ResolvedConfig
}): Promise<string> => {
  let clientName: string
  try {
    clientName = await requireCurrentClientName({
      tmux,
      errorMessage: "current category requires tmux client context",
    })
  } catch {
    return config.categories.defaultCategory
  }

  const category = await tmux.showClientOption(
    clientName,
    CURRENT_CATEGORY_OPTION,
  )
  if (category.length === 0) {
    return config.categories.defaultCategory
  }

  return ensureKnownCategory({
    config,
    categoryName: category,
  })
}

export const setCurrentCategory = async ({
  tmux,
  config,
  categoryName,
}: {
  readonly tmux: Pick<TmuxClient, "currentClientName" | "setClientOption">
  readonly config: ResolvedConfig
  readonly categoryName: string
}): Promise<string> => {
  const clientName = await requireCurrentClientName({
    tmux,
    errorMessage: "category use requires tmux client context",
  })

  const normalized = ensureKnownCategory({ config, categoryName })
  await tmux.setClientOption(clientName, CURRENT_CATEGORY_OPTION, normalized)
  return normalized
}

export const getCategoryLastActiveSession = async ({
  tmux,
  categoryName,
}: {
  readonly tmux: Pick<TmuxClient, "currentClientName" | "showClientOption">
  readonly categoryName: string
}): Promise<string | null> => {
  const clientName = await requireCurrentClientName({
    tmux,
    errorMessage: "last active session requires tmux client context",
  })
  const state = await readCategoryLastSessionsState({
    tmux,
    clientName,
  })
  return state[categoryName] ?? null
}

export const rememberCategoryLastActiveSession = async ({
  tmux,
  categoryName,
  sessionName,
}: {
  readonly tmux: Pick<
    TmuxClient,
    "currentClientName" | "showClientOption" | "setClientOption"
  >
  readonly categoryName: string
  readonly sessionName: string
}): Promise<void> => {
  const clientName = await requireCurrentClientName({
    tmux,
    errorMessage: "remember session requires tmux client context",
  })
  const state = await readCategoryLastSessionsState({
    tmux,
    clientName,
  })
  await writeCategoryLastSessionsState({
    tmux,
    clientName,
    state: {
      ...state,
      [categoryName]: sessionName,
    },
  })
}

export const rememberSessionForClient = async ({
  tmux,
  config,
  clientName,
  sessionName,
  homeDirectory,
  ghqRoot,
}: {
  readonly tmux: Pick<
    TmuxClient,
    "listSessionDetails" | "showClientOption" | "setClientOption"
  >
  readonly config: ResolvedConfig
  readonly clientName: string
  readonly sessionName: string
  readonly homeDirectory: string
  readonly ghqRoot?: string | null
}): Promise<string | null> => {
  const session = (await tmux.listSessionDetails()).find(
    (candidate) => candidate.name === sessionName,
  )
  if (!session) {
    return null
  }

  const categoryName = resolveEffectiveSessionCategory({
    session,
    config,
    homeDirectory,
    ghqRoot,
  })
  const state = await readCategoryLastSessionsState({
    tmux,
    clientName,
  })

  await writeCurrentCategoryForClient({
    tmux,
    clientName,
    categoryName,
  })
  await writeCategoryLastSessionsState({
    tmux,
    clientName,
    state: {
      ...state,
      [categoryName]: sessionName,
    },
  })
  return categoryName
}

export const rememberCurrentSessionForCurrentClient = async ({
  tmux,
  config,
  homeDirectory,
  ghqRoot,
}: {
  readonly tmux: Pick<
    TmuxClient,
    | "currentClientName"
    | "currentSession"
    | "listSessionDetails"
    | "showClientOption"
    | "setClientOption"
  >
  readonly config: ResolvedConfig
  readonly homeDirectory: string
  readonly ghqRoot?: string | null
}): Promise<string | null> => {
  const clientName = await requireCurrentClientName({
    tmux,
    errorMessage: "remember current session requires tmux client context",
  })
  const sessionName = await tmux.currentSession()
  if (sessionName.length === 0) {
    return null
  }

  const remembered = await rememberSessionForClient({
    tmux,
    config,
    clientName,
    sessionName,
    homeDirectory,
    ghqRoot,
  })
  return remembered === null ? null : sessionName
}

export const resolveEffectiveSessionCategory = ({
  session,
  config,
  homeDirectory,
  ghqRoot,
}: {
  readonly session: SessionDetails
  readonly config: ResolvedConfig
  readonly homeDirectory: string
  readonly ghqRoot?: string | null
}): string => {
  if (session.projectPath.length > 0 || session.categoryOverride.length > 0) {
    return resolveCategoryForSession({
      config: config.categories,
      sessionName: session.name,
      projectPath: session.projectPath,
      categoryOverride: session.categoryOverride,
      ghqRoot,
      homeDirectory,
    })
  }

  if (session.category.trim().length > 0) {
    return session.category.trim()
  }

  return resolveCategoryForSession({
    config: config.categories,
    sessionName: session.name,
    projectPath: "",
    ghqRoot,
    homeDirectory,
  })
}

export const getSessionsInCategory = ({
  sessions,
  categoryName,
  config,
  homeDirectory,
  ghqRoot,
}: {
  readonly sessions: ReadonlyArray<SessionDetails>
  readonly categoryName: string
  readonly config: ResolvedConfig
  readonly homeDirectory: string
  readonly ghqRoot?: string | null
}): SessionDetails[] => {
  return sessions.filter(
    (session) =>
      resolveEffectiveSessionCategory({
        session,
        config,
        homeDirectory,
        ghqRoot,
      }) === categoryName,
  )
}

export const resolveSessionCategoryByName = async ({
  tmux,
  config,
  sessionName,
  homeDirectory,
  ghqRoot,
}: {
  readonly tmux: Pick<TmuxClient, "listSessionDetails">
  readonly config: ResolvedConfig
  readonly sessionName: string
  readonly homeDirectory: string
  readonly ghqRoot?: string | null
}): Promise<string> => {
  const session = (await tmux.listSessionDetails()).find(
    (candidate) => candidate.name === sessionName,
  )
  if (!session) {
    throw new Error(`session not found: ${sessionName}`)
  }

  return resolveEffectiveSessionCategory({
    session,
    config,
    homeDirectory,
    ghqRoot,
  })
}

export const switchClientAndRememberSession = async ({
  tmux,
  config,
  sessionName,
  categoryName,
  homeDirectory,
  ghqRoot,
}: {
  readonly tmux: Pick<
    TmuxClient,
    | "currentClientName"
    | "showClientOption"
    | "setClientOption"
    | "switchClient"
    | "listSessionDetails"
  >
  readonly config: ResolvedConfig
  readonly sessionName: string
  readonly categoryName?: string
  readonly homeDirectory: string
  readonly ghqRoot?: string | null
}): Promise<string> => {
  const resolvedCategory =
    categoryName ??
    (await resolveSessionCategoryByName({
      tmux,
      config,
      sessionName,
      homeDirectory,
      ghqRoot,
    }))

  await tmux.switchClient(sessionName)
  await setCurrentCategory({
    tmux,
    config,
    categoryName: resolvedCategory,
  })
  await rememberCategoryLastActiveSession({
    tmux,
    categoryName: resolvedCategory,
    sessionName,
  })
  return sessionName
}

export const cycleSessionInCurrentCategory = async ({
  tmux,
  config,
  direction,
  homeDirectory,
  ghqRoot,
}: {
  readonly tmux: Pick<
    TmuxClient,
    | "currentClientName"
    | "showClientOption"
    | "setClientOption"
    | "listSessionDetails"
    | "currentSession"
    | "switchClient"
  >
  readonly config: ResolvedConfig
  readonly direction: "next" | "prev"
  readonly homeDirectory: string
  readonly ghqRoot?: string | null
}): Promise<string | null> => {
  const currentCategory = await getCurrentCategory({ tmux, config })
  const currentSession = await tmux.currentSession()
  const sessions = getSessionsInCategory({
    sessions: await tmux.listSessionDetails(),
    categoryName: currentCategory,
    config,
    homeDirectory,
    ghqRoot,
  })

  if (sessions.length === 0) {
    return null
  }

  const names = sessions.map((session) => session.name)
  const currentIndex = names.findIndex((name) => name === currentSession)
  const baseIndex = currentIndex === -1 ? 0 : currentIndex
  const nextIndex =
    direction === "next"
      ? (baseIndex + 1) % names.length
      : (baseIndex - 1 + names.length) % names.length
  const target = names[nextIndex] ?? null
  if (target === null || target === currentSession) {
    if (typeof target === "string") {
      await rememberCategoryLastActiveSession({
        tmux,
        categoryName: currentCategory,
        sessionName: target,
      })
    }
    return target
  }

  await switchClientAndRememberSession({
    tmux,
    config,
    sessionName: target,
    categoryName: currentCategory,
    homeDirectory,
    ghqRoot,
  })
  return target
}

export const useCategoryAndSwitchToLastSession = async ({
  tmux,
  config,
  categoryName,
  homeDirectory,
  ghqRoot,
}: {
  readonly tmux: Pick<
    TmuxClient,
    | "currentClientName"
    | "currentSession"
    | "showClientOption"
    | "setClientOption"
    | "listSessionDetails"
    | "switchClient"
  >
  readonly config: ResolvedConfig
  readonly categoryName: string
  readonly homeDirectory: string
  readonly ghqRoot?: string | null
}): Promise<string | null> => {
  await rememberCurrentSessionForCurrentClient({
    tmux,
    config,
    homeDirectory,
    ghqRoot,
  })

  const normalizedCategory = await setCurrentCategory({
    tmux,
    config,
    categoryName,
  })
  const sessions = getSessionsInCategory({
    sessions: await tmux.listSessionDetails(),
    categoryName: normalizedCategory,
    config,
    homeDirectory,
    ghqRoot,
  })

  if (sessions.length === 0) {
    return null
  }

  const lastActiveSession = await getCategoryLastActiveSession({
    tmux,
    categoryName: normalizedCategory,
  })
  const target =
    sessions.find((session) => session.name === lastActiveSession)?.name ??
    sessions[0]?.name ??
    null

  if (target === null) {
    return null
  }

  await switchClientAndRememberSession({
    tmux,
    config,
    sessionName: target,
    categoryName: normalizedCategory,
    homeDirectory,
    ghqRoot,
  })
  return target
}

export const refreshSessionCategories = async ({
  tmux,
  config,
  homeDirectory,
  ghqRoot,
}: {
  readonly tmux: Pick<TmuxClient, "listSessionDetails" | "setSessionOption">
  readonly config: ResolvedConfig
  readonly homeDirectory: string
  readonly ghqRoot?: string | null
}): Promise<{ updated: Array<{ sessionName: string; category: string }> }> => {
  const updated: Array<{ sessionName: string; category: string }> = []
  const sessions = await tmux.listSessionDetails()

  for (const session of sessions) {
    const category = resolveEffectiveSessionCategory({
      session,
      config,
      homeDirectory,
      ghqRoot,
    })
    await tmux.setSessionOption(session.name, CATEGORY_OPTION, category)
    updated.push({
      sessionName: session.name,
      category,
    })
  }

  return { updated }
}

export const setSessionCategoryOverride = async ({
  tmux,
  config,
  sessionName,
  categoryName,
}: {
  readonly tmux: Pick<TmuxClient, "setSessionOption">
  readonly config: ResolvedConfig
  readonly sessionName: string
  readonly categoryName: string
}): Promise<string> => {
  const normalized = ensureKnownCategory({ config, categoryName })
  await tmux.setSessionOption(sessionName, CATEGORY_OVERRIDE_OPTION, normalized)
  await tmux.setSessionOption(sessionName, CATEGORY_OPTION, normalized)
  return normalized
}
