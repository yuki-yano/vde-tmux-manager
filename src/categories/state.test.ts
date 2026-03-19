import { DEFAULT_CONFIG } from "../config/defaults"
import type { SessionDetails } from "../tmux/parse"
import {
  cycleSessionInCurrentCategory,
  getCategoryLastActiveSession,
  getCurrentCategory,
  getSessionsInCategory,
  rememberCategoryLastActiveSession,
  rememberCurrentSessionForCurrentClient,
  rememberSessionForClient,
  refreshSessionCategories,
  resolveEffectiveSessionCategory,
  switchClientAndRememberSession,
  setCurrentCategory,
  setSessionCategoryOverride,
  useCategoryAndSwitchToLastSession,
} from "./state"

const createSession = (
  overrides: Partial<SessionDetails> & Pick<SessionDetails, "id" | "name">,
): SessionDetails => ({
  id: overrides.id,
  name: overrides.name,
  attachedClients: overrides.attachedClients ?? 0,
  lastActivity: overrides.lastActivity ?? 0,
  category: overrides.category ?? "",
  projectPath: overrides.projectPath ?? "",
  categoryOverride: overrides.categoryOverride ?? "",
})

const categoryLastSessionOption = (categoryName: string): string => {
  const encoded = Buffer.from(categoryName, "utf8").toString("hex")
  return `category_last_session_${encoded.length > 0 ? encoded : "0"}`
}

const config = {
  ...DEFAULT_CONFIG,
  categories: {
    defaultCategory: "public",
    rules: [
      {
        category: "work",
        ghqPatterns: ["github.com/company/**"],
        pathPatterns: [],
      },
      {
        category: "private",
        ghqPatterns: [],
        pathPatterns: ["~/private/**", "/tmp/**"],
      },
    ],
    sessionNameRules: [
      {
        category: "private",
        patterns: ["local-*"],
      },
    ],
  },
}

describe("current category", () => {
  it("uses defaultCategory when the client has no explicit category", async () => {
    const tmux = {
      currentClientName: vi.fn(async () => "/dev/ttys001"),
      showClientOption: vi.fn(async () => ""),
    }

    await expect(
      getCurrentCategory({
        tmux: tmux as never,
        config,
      }),
    ).resolves.toBe("public")
  })

  it("stores current category per client", async () => {
    const tmux = {
      currentClientName: vi.fn(async () => "/dev/ttys001"),
      setClientOption: vi.fn(async () => undefined),
    }

    await setCurrentCategory({
      tmux: tmux as never,
      config,
      categoryName: "work",
    })

    expect(tmux.setClientOption).toHaveBeenCalledWith(
      "/dev/ttys001",
      "current_category",
      "work",
    )
  })

  it("switches to the remembered last active session when using a category", async () => {
    const tmux = {
      currentClientName: vi.fn(async () => "/dev/ttys001"),
      currentSession: vi.fn(async () => "repo-a"),
      setClientOption: vi.fn(async () => undefined),
      showClientOption: vi.fn(async (_target: string, option: string) => {
        if (option === categoryLastSessionOption("work")) {
          return "repo-b"
        }
        return ""
      }),
      listSessionDetails: vi.fn(async () => [
        createSession({
          id: "$1",
          name: "repo-a",
          projectPath: "/Users/test/ghq/github.com/company/repo-a",
        }),
        createSession({
          id: "$2",
          name: "repo-b",
          projectPath: "/Users/test/ghq/github.com/company/repo-b",
        }),
      ]),
      switchClient: vi.fn(async () => undefined),
    }

    const target = await useCategoryAndSwitchToLastSession({
      tmux: tmux as never,
      config,
      categoryName: "work",
      homeDirectory: "/Users/test",
      ghqRoot: "/Users/test/ghq",
    })

    expect(target).toBe("repo-b")
    expect(tmux.switchClient).toHaveBeenCalledWith("repo-b")
  })

  it("falls back to the first session when no remembered session exists", async () => {
    const tmux = {
      currentClientName: vi.fn(async () => "/dev/ttys001"),
      currentSession: vi.fn(async () => "repo-a"),
      setClientOption: vi.fn(async () => undefined),
      showClientOption: vi.fn(async () => ""),
      listSessionDetails: vi.fn(async () => [
        createSession({
          id: "$1",
          name: "repo-a",
          projectPath: "/Users/test/ghq/github.com/company/repo-a",
        }),
        createSession({
          id: "$2",
          name: "repo-b",
          projectPath: "/Users/test/ghq/github.com/company/repo-b",
        }),
      ]),
      switchClient: vi.fn(async () => undefined),
    }

    const target = await useCategoryAndSwitchToLastSession({
      tmux: tmux as never,
      config,
      categoryName: "work",
      homeDirectory: "/Users/test",
      ghqRoot: "/Users/test/ghq",
    })

    expect(target).toBe("repo-a")
    expect(tmux.switchClient).toHaveBeenCalledWith("repo-a")
  })

  it("switches only the category when the category has no sessions", async () => {
    const tmux = {
      currentClientName: vi.fn(async () => "/dev/ttys001"),
      currentSession: vi.fn(async () => ""),
      setClientOption: vi.fn(async () => undefined),
      showClientOption: vi.fn(async () => ""),
      listSessionDetails: vi.fn(async () => []),
      switchClient: vi.fn(async () => undefined),
    }

    const target = await useCategoryAndSwitchToLastSession({
      tmux: tmux as never,
      config,
      categoryName: "work",
      homeDirectory: "/Users/test",
      ghqRoot: "/Users/test/ghq",
    })

    expect(target).toBeNull()
    expect(tmux.setClientOption).toHaveBeenCalledWith(
      "/dev/ttys001",
      "current_category",
      "work",
    )
    expect(tmux.switchClient).not.toHaveBeenCalled()
  })
})

describe("external session changes", () => {
  it("records last active state for an explicit client and session", async () => {
    const tmux = {
      listSessionDetails: vi.fn(async () => [
        createSession({
          id: "$1",
          name: "private-repo",
          projectPath: "/tmp/private-repo",
        }),
      ]),
      showClientOption: vi.fn(async () => ""),
      setClientOption: vi.fn(async () => undefined),
    }

    const remembered = await rememberSessionForClient({
      tmux: tmux as never,
      config,
      clientName: "/dev/ttys999",
      sessionName: "private-repo",
      homeDirectory: "/Users/test",
      ghqRoot: "/Users/test/ghq",
    })

    expect(remembered).toBe("private")
    expect(tmux.setClientOption).toHaveBeenCalledWith(
      "/dev/ttys999",
      "current_category",
      "private",
    )
    expect(tmux.setClientOption).toHaveBeenCalledWith(
      "/dev/ttys999",
      categoryLastSessionOption("private"),
      "private-repo",
    )
  })

  it("reconciles the real current session before category use", async () => {
    const tmux = {
      currentClientName: vi.fn(async () => "/dev/ttys001"),
      currentSession: vi.fn(async () => "private-repo"),
      listSessionDetails: vi.fn(async () => [
        createSession({
          id: "$1",
          name: "private-repo",
          projectPath: "/tmp/private-repo",
        }),
      ]),
      showClientOption: vi.fn(async () => ""),
      setClientOption: vi.fn(async () => undefined),
    }

    const remembered = await rememberCurrentSessionForCurrentClient({
      tmux: tmux as never,
      config,
      homeDirectory: "/Users/test",
      ghqRoot: "/Users/test/ghq",
    })

    expect(remembered).toBe("private-repo")
    expect(tmux.setClientOption).toHaveBeenCalledWith(
      "/dev/ttys001",
      categoryLastSessionOption("private"),
      "private-repo",
    )
  })
})

describe("resolveEffectiveSessionCategory", () => {
  it("prefers override over path and stored category", () => {
    expect(
      resolveEffectiveSessionCategory({
        session: createSession({
          id: "$1",
          name: "dev",
          category: "public",
          projectPath: "/tmp/dev",
          categoryOverride: "work",
        }),
        config,
        homeDirectory: "/Users/test",
        ghqRoot: "/Users/test/ghq",
      }),
    ).toBe("work")
  })

  it("recomputes from projectPath when metadata exists", () => {
    expect(
      resolveEffectiveSessionCategory({
        session: createSession({
          id: "$1",
          name: "repo",
          category: "legacy",
          projectPath: "/Users/test/ghq/github.com/company/repo",
        }),
        config,
        homeDirectory: "/Users/test",
        ghqRoot: "/Users/test/ghq",
      }),
    ).toBe("work")
  })
})

describe("getSessionsInCategory", () => {
  it("filters sessions by the effective category", () => {
    const sessions = getSessionsInCategory({
      sessions: [
        createSession({
          id: "$1",
          name: "repo-a",
          projectPath: "/Users/test/ghq/github.com/company/repo-a",
        }),
        createSession({
          id: "$2",
          name: "repo-b",
          projectPath: "/tmp/repo-b",
        }),
      ],
      categoryName: "work",
      config,
      homeDirectory: "/Users/test",
      ghqRoot: "/Users/test/ghq",
    })

    expect(sessions.map((session) => session.name)).toEqual(["repo-a"])
  })

  it("treats all sessions as belonging to the unnamed category by default", () => {
    const sessions = getSessionsInCategory({
      sessions: [
        createSession({
          id: "$1",
          name: "repo-a",
          projectPath: "/Users/test/ghq/github.com/company/repo-a",
        }),
        createSession({
          id: "$2",
          name: "repo-b",
          projectPath: "/tmp/repo-b",
        }),
      ],
      categoryName: "",
      config: DEFAULT_CONFIG,
      homeDirectory: "/Users/test",
      ghqRoot: "/Users/test/ghq",
    })

    expect(sessions.map((session) => session.name)).toEqual([
      "repo-a",
      "repo-b",
    ])
  })
})

describe("cycleSessionInCurrentCategory", () => {
  it("cycles only within the current category", async () => {
    const tmux = {
      currentClientName: vi.fn(async () => "/dev/ttys001"),
      showClientOption: vi.fn(async (_target: string, option: string) => {
        if (option === categoryLastSessionOption("work")) {
          return ""
        }
        return "work"
      }),
      setClientOption: vi.fn(async () => undefined),
      listSessionDetails: vi.fn(async () => [
        createSession({
          id: "$1",
          name: "repo-a",
          projectPath: "/Users/test/ghq/github.com/company/repo-a",
        }),
        createSession({
          id: "$2",
          name: "private-repo",
          projectPath: "/tmp/private-repo",
        }),
        createSession({
          id: "$3",
          name: "repo-b",
          projectPath: "/Users/test/ghq/github.com/company/repo-b",
        }),
      ]),
      currentSession: vi.fn(async () => "repo-a"),
      switchClient: vi.fn(async () => undefined),
    }

    await cycleSessionInCurrentCategory({
      tmux: tmux as never,
      config,
      direction: "next",
      homeDirectory: "/Users/test",
      ghqRoot: "/Users/test/ghq",
    })

    expect(tmux.switchClient).toHaveBeenCalledWith("repo-b")
    expect(tmux.setClientOption).toHaveBeenCalledWith(
      "/dev/ttys001",
      categoryLastSessionOption("work"),
      "repo-b",
    )
  })
})

describe("client-scoped last active sessions", () => {
  it("keeps last active session state separate per client", async () => {
    const clientState = new Map<string, string>()
    const tmuxClientA = {
      currentClientName: vi.fn(async () => "/dev/ttys001"),
      showClientOption: vi.fn(async (target: string, option: string) => {
        if (option.startsWith("category_last_session_")) {
          return clientState.get(`${target}:${option}`) ?? ""
        }
        return ""
      }),
      setClientOption: vi.fn(
        async (target: string, option: string, value: string) => {
          if (option.startsWith("category_last_session_")) {
            clientState.set(`${target}:${option}`, value)
          }
        },
      ),
    }
    const tmuxClientB = {
      currentClientName: vi.fn(async () => "/dev/ttys002"),
      showClientOption: vi.fn(async (target: string, option: string) => {
        if (option.startsWith("category_last_session_")) {
          return clientState.get(`${target}:${option}`) ?? ""
        }
        return ""
      }),
      setClientOption: vi.fn(
        async (target: string, option: string, value: string) => {
          if (option.startsWith("category_last_session_")) {
            clientState.set(`${target}:${option}`, value)
          }
        },
      ),
    }

    await rememberCategoryLastActiveSession({
      tmux: tmuxClientA as never,
      categoryName: "private",
      sessionName: "dotfiles",
    })
    await rememberCategoryLastActiveSession({
      tmux: tmuxClientB as never,
      categoryName: "private",
      sessionName: "local-dev",
    })

    await expect(
      getCategoryLastActiveSession({
        tmux: tmuxClientA as never,
        categoryName: "private",
      }),
    ).resolves.toBe("dotfiles")
    await expect(
      getCategoryLastActiveSession({
        tmux: tmuxClientB as never,
        categoryName: "private",
      }),
    ).resolves.toBe("local-dev")
  })

  it("falls back when remembered session no longer exists", async () => {
    const tmux = {
      currentClientName: vi.fn(async () => "/dev/ttys001"),
      currentSession: vi.fn(async () => "deleted-repo"),
      setClientOption: vi.fn(async () => undefined),
      showClientOption: vi.fn(async (_target: string, option: string) => {
        if (option === categoryLastSessionOption("work")) {
          return "deleted-repo"
        }
        return ""
      }),
      listSessionDetails: vi.fn(async () => [
        createSession({
          id: "$1",
          name: "repo-a",
          projectPath: "/Users/test/ghq/github.com/company/repo-a",
        }),
      ]),
      switchClient: vi.fn(async () => undefined),
    }

    const target = await useCategoryAndSwitchToLastSession({
      tmux: tmux as never,
      config,
      categoryName: "work",
      homeDirectory: "/Users/test",
      ghqRoot: "/Users/test/ghq",
    })

    expect(target).toBe("repo-a")
    expect(tmux.switchClient).toHaveBeenCalledWith("repo-a")
  })
})

describe("switchClientAndRememberSession", () => {
  it("updates current category and remembered session after a direct switch", async () => {
    const tmux = {
      currentClientName: vi.fn(async () => "/dev/ttys001"),
      setClientOption: vi.fn(async () => undefined),
      showClientOption: vi.fn(async () => ""),
      switchClient: vi.fn(async () => undefined),
      listSessionDetails: vi.fn(async () => [
        createSession({
          id: "$1",
          name: "private-repo",
          projectPath: "/tmp/private-repo",
        }),
      ]),
    }

    await switchClientAndRememberSession({
      tmux: tmux as never,
      config,
      sessionName: "private-repo",
      homeDirectory: "/Users/test",
      ghqRoot: "/Users/test/ghq",
    })

    expect(tmux.switchClient).toHaveBeenCalledWith("private-repo")
    expect(tmux.setClientOption).toHaveBeenCalledWith(
      "/dev/ttys001",
      "current_category",
      "private",
    )
    expect(tmux.setClientOption).toHaveBeenCalledWith(
      "/dev/ttys001",
      categoryLastSessionOption("private"),
      "private-repo",
    )
  })
})

describe("refreshSessionCategories", () => {
  it("recomputes categories from project_path and updates metadata", async () => {
    const tmux = {
      listSessionDetails: vi.fn(async () => [
        createSession({
          id: "$1",
          name: "repo-a",
          projectPath: "/Users/test/ghq/github.com/company/repo-a",
        }),
        createSession({
          id: "$2",
          name: "private-repo",
          projectPath: "/tmp/private-repo",
        }),
      ]),
      setSessionOption: vi.fn(async () => undefined),
    }

    const result = await refreshSessionCategories({
      tmux: tmux as never,
      config,
      homeDirectory: "/Users/test",
      ghqRoot: "/Users/test/ghq",
    })

    expect(result.updated).toEqual([
      { sessionName: "repo-a", category: "work" },
      { sessionName: "private-repo", category: "private" },
    ])
    expect(tmux.setSessionOption).toHaveBeenCalledWith(
      "repo-a",
      "category",
      "work",
    )
    expect(tmux.setSessionOption).toHaveBeenCalledWith(
      "private-repo",
      "category",
      "private",
    )
  })
})

describe("setSessionCategoryOverride", () => {
  it("writes override metadata and the effective category", async () => {
    const tmux = {
      setSessionOption: vi.fn(async () => undefined),
    }

    await setSessionCategoryOverride({
      tmux: tmux as never,
      config,
      sessionName: "repo-a",
      categoryName: "private",
    })

    expect(tmux.setSessionOption).toHaveBeenNthCalledWith(
      1,
      "repo-a",
      "category_override",
      "private",
    )
    expect(tmux.setSessionOption).toHaveBeenNthCalledWith(
      2,
      "repo-a",
      "category",
      "private",
    )
  })
})
