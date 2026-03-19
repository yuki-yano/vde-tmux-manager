import { collectDefinedCategories, resolveCategoryForSession } from "./matcher"
import type { ResolvedConfig } from "../config/schema"
import type { TmuxClient } from "../tmux/client"
import type { SessionDetails } from "../tmux/parse"

const CURRENT_CATEGORY_OPTION = "current_category"
const CATEGORY_OPTION = "category"
const CATEGORY_OVERRIDE_OPTION = "category_override"

const ensureKnownCategory = ({
  config,
  categoryName,
}: {
  readonly config: ResolvedConfig
  readonly categoryName: string
}): string => {
  const normalized = categoryName.trim()
  if (normalized.length === 0) {
    throw new Error("category name is required")
  }

  if (!collectDefinedCategories(config.categories).includes(normalized)) {
    throw new Error(`unknown category: ${normalized}`)
  }

  return normalized
}

export const getCurrentCategory = async ({
  tmux,
  config,
}: {
  readonly tmux: Pick<TmuxClient, "currentClientName" | "showClientOption">
  readonly config: ResolvedConfig
}): Promise<string> => {
  const clientName = await tmux.currentClientName()
  if (clientName.length === 0) {
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
  const clientName = await tmux.currentClientName()
  if (clientName.length === 0) {
    throw new Error("category use requires tmux client context")
  }

  const normalized = ensureKnownCategory({ config, categoryName })
  await tmux.setClientOption(clientName, CURRENT_CATEGORY_OPTION, normalized)
  return normalized
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
    return target
  }

  await tmux.switchClient(target)
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
