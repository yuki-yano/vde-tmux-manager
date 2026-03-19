import {
  collectDefinedCategories,
  resolveCategoryForSession,
  sortCategories,
} from "./matcher"
import type { ResolvedConfig } from "../config/schema"
import type { TmuxClient } from "../tmux/client"
import type { SessionDetails } from "../tmux/parse"

const CURRENT_CATEGORY_OPTION = "current_category"
const CATEGORY_OPTION = "category"
const CATEGORY_OVERRIDE_OPTION = "category_override"
const CATEGORY_LAST_SESSION_OPTION_PREFIX = "category_last_session_"
const TMUX_BATCH_SEPARATOR = ";"
const TMUX_VALUE_SEPARATOR = "\t"

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

export const getOrderedCategories = (config: ResolvedConfig): string[] => {
  return sortCategories(
    collectDefinedCategories(config.categories),
    config.categories.order,
  )
}

export const resolveAdjacentCategory = ({
  config,
  currentCategory,
  direction,
}: {
  readonly config: ResolvedConfig
  readonly currentCategory: string
  readonly direction: "next" | "prev"
}): string => {
  const categories = getOrderedCategories(config)
  if (categories.length === 0) {
    throw new Error("no categories defined")
  }

  const currentIndex = categories.findIndex(
    (category) => category === currentCategory,
  )
  const baseIndex = currentIndex === -1 ? 0 : currentIndex
  const nextIndex =
    direction === "next"
      ? (baseIndex + 1) % categories.length
      : (baseIndex - 1 + categories.length) % categories.length
  return categories[nextIndex] ?? categories[0] ?? ""
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

const encodeScopeKey = (value: string): string => {
  return Buffer.from(value, "utf8").toString("hex") || "0"
}

const toClientStateOptionNameForClient = (
  clientName: string,
  name: string,
): string => {
  return `@client_${encodeScopeKey(clientName)}_${name}`
}

const toCategoryLastSessionOptionName = (categoryName: string): string => {
  const encoded = encodeScopeKey(categoryName)
  return `${CATEGORY_LAST_SESSION_OPTION_PREFIX}${encoded.length > 0 ? encoded : "0"}`
}

const readClientContext = async ({
  tmux,
  errorMessage,
}: {
  readonly tmux: Pick<TmuxClient, "currentClientName" | "currentSession"> &
    Partial<Pick<TmuxClient, "run">>
  readonly errorMessage: string
}): Promise<{ clientName: string; sessionName: string }> => {
  const candidate = tmux as Partial<TmuxClient>
  if (typeof candidate.run === "function") {
    const result = await candidate.run(
      [
        "display-message",
        "-p",
        `#{client_name}${TMUX_VALUE_SEPARATOR}#{session_name}`,
      ],
      {
        allowFail: true,
      },
    )
    const [clientName, sessionName] = result.stdout
      .replace(/\r?\n$/, "")
      .split(TMUX_VALUE_SEPARATOR)
      .map((value) => value.trim())
    if ((clientName ?? "").length > 0) {
      return {
        clientName: clientName ?? "",
        sessionName: sessionName ?? "",
      }
    }
  }

  const [clientName, sessionName] = await Promise.all([
    requireCurrentClientName({ tmux, errorMessage }),
    tmux.currentSession(),
  ])
  return { clientName, sessionName }
}

const readClientOptionsForClient = async ({
  tmux,
  clientName,
  names,
}: {
  readonly tmux: Pick<TmuxClient, "showClientOption"> &
    Partial<Pick<TmuxClient, "run">>
  readonly clientName: string
  readonly names: readonly string[]
}): Promise<string[]> => {
  const candidate = tmux as Partial<TmuxClient>
  if (typeof candidate.run === "function" && names.length > 0) {
    const format = names
      .map((name) => `#{${toClientStateOptionNameForClient(clientName, name)}}`)
      .join(TMUX_VALUE_SEPARATOR)
    const result = await candidate.run(["display-message", "-p", format], {
      allowFail: true,
    })
    return result.stdout
      .replace(/\r?\n$/, "")
      .split(TMUX_VALUE_SEPARATOR)
      .map((value) => value.trim())
  }

  return Promise.all(
    names.map((name) => tmux.showClientOption(clientName, name)),
  )
}

const applyClientStateUpdate = async ({
  tmux,
  clientName,
  switchSessionName,
  currentCategory,
  lastSessionUpdates,
}: {
  readonly tmux: Pick<TmuxClient, "setClientOption"> &
    Partial<Pick<TmuxClient, "switchClient" | "run">>
  readonly clientName: string
  readonly switchSessionName?: string
  readonly currentCategory?: string
  readonly lastSessionUpdates?: ReadonlyArray<{
    categoryName: string
    sessionName: string
  }>
}): Promise<void> => {
  const candidate = tmux as Partial<TmuxClient>
  const updates = lastSessionUpdates ?? []

  if (typeof candidate.run === "function") {
    const commands: string[][] = []

    if (
      typeof switchSessionName === "string" &&
      switchSessionName.trim().length > 0
    ) {
      commands.push(["switch-client", "-t", switchSessionName])
    }

    if (typeof currentCategory === "string") {
      commands.push([
        "set-option",
        "-sq",
        toClientStateOptionNameForClient(clientName, CURRENT_CATEGORY_OPTION),
        currentCategory,
      ])
    }

    for (const update of updates) {
      commands.push([
        "set-option",
        "-sq",
        toClientStateOptionNameForClient(
          clientName,
          toCategoryLastSessionOptionName(update.categoryName),
        ),
        update.sessionName,
      ])
    }

    if (commands.length > 0) {
      const args = commands.flatMap((command, index) =>
        index === 0 ? command : [TMUX_BATCH_SEPARATOR, ...command],
      )
      await candidate.run(args, { allowFail: true })
    }
    return
  }

  if (
    typeof switchSessionName === "string" &&
    switchSessionName.trim().length > 0
  ) {
    if (typeof tmux.switchClient !== "function") {
      throw new Error("tmux.switchClient is required for session switching")
    }
    await tmux.switchClient(switchSessionName)
  }

  await Promise.all([
    ...(typeof currentCategory === "string"
      ? [
          tmux.setClientOption(
            clientName,
            CURRENT_CATEGORY_OPTION,
            currentCategory,
          ),
        ]
      : []),
    ...updates.map((update) =>
      tmux.setClientOption(
        clientName,
        toCategoryLastSessionOptionName(update.categoryName),
        update.sessionName,
      ),
    ),
  ])
}

const writeCategoryLastSessionForClient = async ({
  tmux,
  clientName,
  categoryName,
  sessionName,
}: {
  readonly tmux: Pick<TmuxClient, "setClientOption">
  readonly clientName: string
  readonly categoryName: string
  readonly sessionName: string
}): Promise<void> => {
  await applyClientStateUpdate({
    tmux,
    clientName,
    lastSessionUpdates: [
      {
        categoryName,
        sessionName,
      },
    ],
  })
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
  await applyClientStateUpdate({
    tmux,
    clientName,
    currentCategory: categoryName,
  })
}

const readCurrentCategoryForClient = async ({
  tmux,
  config,
  clientName,
}: {
  readonly tmux: Pick<TmuxClient, "showClientOption">
  readonly config: ResolvedConfig
  readonly clientName: string
}): Promise<string> => {
  const [category = ""] = await readClientOptionsForClient({
    tmux,
    clientName,
    names: [CURRENT_CATEGORY_OPTION],
  })
  if (category.length === 0) {
    return config.categories.defaultCategory
  }

  return ensureKnownCategory({
    config,
    categoryName: category,
  })
}

const readCategoryLastActiveSessionForClient = async ({
  tmux,
  clientName,
  categoryName,
}: {
  readonly tmux: Pick<TmuxClient, "showClientOption">
  readonly clientName: string
  readonly categoryName: string
}): Promise<string | null> => {
  const [sessionName = ""] = await readClientOptionsForClient({
    tmux,
    clientName,
    names: [toCategoryLastSessionOptionName(categoryName)],
  })
  return sessionName.length > 0 ? sessionName : null
}

const findSessionByName = ({
  sessions,
  sessionName,
}: {
  readonly sessions: ReadonlyArray<SessionDetails>
  readonly sessionName: string
}): SessionDetails | null => {
  return sessions.find((candidate) => candidate.name === sessionName) ?? null
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

  return readCurrentCategoryForClient({
    tmux,
    config,
    clientName,
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
  return readCategoryLastActiveSessionForClient({
    tmux,
    clientName,
    categoryName,
  })
}

export const rememberCategoryLastActiveSession = async ({
  tmux,
  categoryName,
  sessionName,
}: {
  readonly tmux: Pick<TmuxClient, "currentClientName" | "setClientOption">
  readonly categoryName: string
  readonly sessionName: string
}): Promise<void> => {
  const clientName = await requireCurrentClientName({
    tmux,
    errorMessage: "remember session requires tmux client context",
  })
  await writeCategoryLastSessionForClient({
    tmux,
    clientName,
    categoryName,
    sessionName,
  })
}

export const rememberSessionForClient = async ({
  tmux,
  config,
  clientName,
  sessionName,
  homeDirectory,
  ghqRoot,
  sessions,
  writeCurrentCategory = true,
}: {
  readonly tmux: Pick<TmuxClient, "listSessionDetails" | "setClientOption">
  readonly config: ResolvedConfig
  readonly clientName: string
  readonly sessionName: string
  readonly homeDirectory: string
  readonly ghqRoot?: string | null
  readonly sessions?: ReadonlyArray<SessionDetails>
  readonly writeCurrentCategory?: boolean
}): Promise<string | null> => {
  const resolvedSessions = sessions ?? (await tmux.listSessionDetails())
  const session = findSessionByName({
    sessions: resolvedSessions,
    sessionName,
  })
  if (!session) {
    return null
  }

  const categoryName = resolveEffectiveSessionCategory({
    session,
    config,
    homeDirectory,
    ghqRoot,
  })

  await applyClientStateUpdate({
    tmux,
    clientName,
    currentCategory: writeCurrentCategory ? categoryName : undefined,
    lastSessionUpdates: [
      {
        categoryName,
        sessionName,
      },
    ],
  })
  return categoryName
}

export const rememberCurrentSessionForCurrentClient = async ({
  tmux,
  config,
  homeDirectory,
  ghqRoot,
  clientName,
  sessions,
  writeCurrentCategory = true,
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
  readonly clientName?: string
  readonly sessions?: ReadonlyArray<SessionDetails>
  readonly writeCurrentCategory?: boolean
}): Promise<string | null> => {
  const resolvedClientName =
    clientName ??
    (await requireCurrentClientName({
      tmux,
      errorMessage: "remember current session requires tmux client context",
    }))
  const [sessionName, resolvedSessions] = await Promise.all([
    tmux.currentSession(),
    sessions ? Promise.resolve(sessions) : tmux.listSessionDetails(),
  ])
  if (sessionName.length === 0) {
    return null
  }

  const remembered = await rememberSessionForClient({
    tmux,
    config,
    clientName: resolvedClientName,
    sessionName,
    homeDirectory,
    ghqRoot,
    sessions: resolvedSessions,
    writeCurrentCategory,
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
  sessions,
}: {
  readonly tmux: Pick<TmuxClient, "listSessionDetails">
  readonly config: ResolvedConfig
  readonly sessionName: string
  readonly homeDirectory: string
  readonly ghqRoot?: string | null
  readonly sessions?: ReadonlyArray<SessionDetails>
}): Promise<string> => {
  const resolvedSessions = sessions ?? (await tmux.listSessionDetails())
  const session = findSessionByName({
    sessions: resolvedSessions,
    sessionName,
  })
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
  clientName,
  sessions,
  skipCurrentCategoryUpdate = false,
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
  readonly clientName?: string
  readonly sessions?: ReadonlyArray<SessionDetails>
  readonly skipCurrentCategoryUpdate?: boolean
}): Promise<string> => {
  const [resolvedClientName, resolvedCategory] = await Promise.all([
    typeof clientName === "string" && clientName.length > 0
      ? Promise.resolve(clientName)
      : requireCurrentClientName({
          tmux,
          errorMessage: "switch session requires tmux client context",
        }),
    typeof categoryName === "string" && categoryName.length > 0
      ? Promise.resolve(categoryName)
      : resolveSessionCategoryByName({
          tmux,
          config,
          sessionName,
          homeDirectory,
          ghqRoot,
          sessions,
        }),
  ])

  await applyClientStateUpdate({
    tmux,
    clientName: resolvedClientName,
    switchSessionName: sessionName,
    currentCategory: skipCurrentCategoryUpdate ? undefined : resolvedCategory,
    lastSessionUpdates: [
      {
        categoryName: resolvedCategory,
        sessionName,
      },
    ],
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
  const { clientName, sessionName: currentSession } = await readClientContext({
    tmux,
    errorMessage: "session cycle requires tmux client context",
  })
  const [currentCategory, sessionDetails] = await Promise.all([
    readCurrentCategoryForClient({
      tmux,
      config,
      clientName,
    }),
    tmux.listSessionDetails(),
  ])
  const sessions = getSessionsInCategory({
    sessions: sessionDetails,
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
      await writeCategoryLastSessionForClient({
        tmux,
        clientName,
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
    clientName,
    skipCurrentCategoryUpdate: true,
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
  const { clientName, sessionName: currentSession } = await readClientContext({
    tmux,
    errorMessage: "category use requires tmux client context",
  })
  const sessionDetails = await tmux.listSessionDetails()
  const normalizedCategory = ensureKnownCategory({
    config,
    categoryName,
  })
  const currentSessionDetails =
    currentSession.length > 0
      ? findSessionByName({
          sessions: sessionDetails,
          sessionName: currentSession,
        })
      : null

  if (
    currentSessionDetails !== null &&
    resolveEffectiveSessionCategory({
      session: currentSessionDetails,
      config,
      homeDirectory,
      ghqRoot,
    }) !== normalizedCategory
  ) {
    await rememberSessionForClient({
      tmux,
      config,
      clientName,
      sessionName: currentSession,
      homeDirectory,
      ghqRoot,
      sessions: sessionDetails,
      writeCurrentCategory: false,
    })
  }

  const sessions = getSessionsInCategory({
    sessions: sessionDetails,
    categoryName: normalizedCategory,
    config,
    homeDirectory,
    ghqRoot,
  })

  if (sessions.length === 0) {
    await writeCurrentCategoryForClient({
      tmux,
      clientName,
      categoryName: normalizedCategory,
    })
    return null
  }

  const lastActiveSession = await readCategoryLastActiveSessionForClient({
    tmux,
    clientName,
    categoryName: normalizedCategory,
  })
  const target =
    sessions.find((session) => session.name === lastActiveSession)?.name ??
    sessions[0]?.name ??
    null

  if (target === null) {
    return null
  }

  if (target === currentSession) {
    await applyClientStateUpdate({
      tmux,
      clientName,
      currentCategory: normalizedCategory,
      lastSessionUpdates: [
        {
          categoryName: normalizedCategory,
          sessionName: target,
        },
      ],
    })
    return target
  }

  await switchClientAndRememberSession({
    tmux,
    config,
    sessionName: target,
    categoryName: normalizedCategory,
    homeDirectory,
    ghqRoot,
    clientName,
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
