import {
  collectDefinedCategories,
  matchGlob,
  resolveCategoryForSession,
  resolveProjectPathCategory,
} from "./matcher"

const config = {
  defaultCategory: "public",
  rules: [
    {
      category: "work",
      ghqPatterns: ["github.com/xxx-company/*", "github.com/xxx-company/**"],
      pathPatterns: [],
    },
    {
      category: "private",
      ghqPatterns: [],
      pathPatterns: ["~/dotfiles", "~/private/**", "/tmp/**"],
    },
    {
      category: "oss",
      ghqPatterns: ["github.com/yuki-yano/**"],
      pathPatterns: [],
    },
  ],
  sessionNameRules: [
    {
      category: "private",
      patterns: ["dotfiles", "local-*"],
    },
  ],
}

describe("matchGlob", () => {
  it("matches * within a single segment", () => {
    expect(
      matchGlob("github.com/xxx-company/foo", "github.com/xxx-company/*"),
    ).toBe(true)
    expect(
      matchGlob("github.com/xxx-company/foo/bar", "github.com/xxx-company/*"),
    ).toBe(false)
  })

  it("matches ** across multiple segments", () => {
    expect(
      matchGlob(
        "github.com/yuki-yano/vde-tmux-manager",
        "github.com/yuki-yano/**",
      ),
    ).toBe(true)
    expect(
      matchGlob("/Users/test/private/work/repo", "/Users/test/private/**"),
    ).toBe(true)
  })
})

describe("resolveProjectPathCategory", () => {
  it("matches ghq relative path rules", () => {
    expect(
      resolveProjectPathCategory({
        config,
        homeDirectory: "/Users/test",
        projectPath: "/Users/test/ghq/github.com/xxx-company/foo",
        ghqRoot: "/Users/test/ghq",
      }),
    ).toBe("work")
  })

  it("matches absolute path rules outside ghq", () => {
    expect(
      resolveProjectPathCategory({
        config,
        homeDirectory: "/Users/test",
        projectPath: "/tmp/scratch/repo",
        ghqRoot: "/Users/test/ghq",
      }),
    ).toBe("private")
  })

  it("expands ~ in path patterns before matching", () => {
    expect(
      resolveProjectPathCategory({
        config,
        homeDirectory: "/Users/test",
        projectPath: "/Users/test/private/worktree",
        ghqRoot: "/Users/test/ghq",
      }),
    ).toBe("private")
  })

  it("applies first-match-wins for path rules", () => {
    expect(
      resolveProjectPathCategory({
        config: {
          defaultCategory: "fallback",
          rules: [
            {
              category: "first",
              ghqPatterns: [],
              pathPatterns: ["/tmp/**"],
            },
            {
              category: "second",
              ghqPatterns: [],
              pathPatterns: ["/tmp/project/**"],
            },
          ],
          sessionNameRules: [],
        },
        homeDirectory: "/Users/test",
        projectPath: "/tmp/project/demo",
        ghqRoot: "/Users/test/ghq",
      }),
    ).toBe("first")
  })

  it("falls back to defaultCategory when no rule matches", () => {
    expect(
      resolveProjectPathCategory({
        config,
        homeDirectory: "/Users/test",
        projectPath: "/Users/test/misc/repo",
        ghqRoot: "/Users/test/ghq",
      }),
    ).toBe("public")
  })
})

describe("resolveCategoryForSession", () => {
  it("prefers override over path and session name rules", () => {
    expect(
      resolveCategoryForSession({
        config,
        homeDirectory: "/Users/test",
        ghqRoot: "/Users/test/ghq",
        sessionName: "dotfiles",
        projectPath: "/Users/test/dotfiles",
        categoryOverride: "oss",
      }),
    ).toBe("oss")
  })

  it("uses session name rules as exception fallback", () => {
    expect(
      resolveCategoryForSession({
        config,
        homeDirectory: "/Users/test",
        ghqRoot: "/Users/test/ghq",
        sessionName: "local-playground",
        projectPath: "",
      }),
    ).toBe("private")
  })

  it("applies first-match-wins for session name rules", () => {
    expect(
      resolveCategoryForSession({
        config: {
          defaultCategory: "fallback",
          rules: [],
          sessionNameRules: [
            { category: "first", patterns: ["local-*"] },
            { category: "second", patterns: ["local-dev"] },
          ],
        },
        homeDirectory: "/Users/test",
        ghqRoot: "/Users/test/ghq",
        sessionName: "local-dev",
        projectPath: "",
      }),
    ).toBe("first")
  })
})

describe("collectDefinedCategories", () => {
  it("collects categories from default, path rules, and session name rules", () => {
    expect(collectDefinedCategories(config)).toEqual([
      "oss",
      "private",
      "public",
      "work",
    ])
  })
})
