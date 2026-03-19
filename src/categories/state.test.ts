import { DEFAULT_CONFIG } from "../config/defaults"
import type { SessionDetails } from "../tmux/parse"
import {
  cycleSessionInCurrentCategory,
  getCurrentCategory,
  getSessionsInCategory,
  refreshSessionCategories,
  resolveEffectiveSessionCategory,
  setCurrentCategory,
  setSessionCategoryOverride,
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
})

describe("cycleSessionInCurrentCategory", () => {
  it("cycles only within the current category", async () => {
    const tmux = {
      currentClientName: vi.fn(async () => "/dev/ttys001"),
      showClientOption: vi.fn(async () => "work"),
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
