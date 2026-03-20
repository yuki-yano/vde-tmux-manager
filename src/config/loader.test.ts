import { DEFAULT_CONFIG } from "./defaults"
import { ConfigValidationError, loadConfig, resolveConfigPath } from "./loader"

describe("resolveConfigPath", () => {
  it("uses XDG_CONFIG_HOME when set", () => {
    const path = resolveConfigPath({
      env: { XDG_CONFIG_HOME: "/tmp/xdg" },
      homeDirectory: "/tmp/home",
    })

    expect(path).toBe("/tmp/xdg/vde/tmux-manager/config.yml")
  })

  it("falls back to HOME/.config", () => {
    const path = resolveConfigPath({
      env: {},
      homeDirectory: "/tmp/home",
    })

    expect(path).toBe("/tmp/home/.config/vde/tmux-manager/config.yml")
  })
})

describe("loadConfig", () => {
  it("returns defaults when config file does not exist", async () => {
    const readFileFn = vi.fn(async (): Promise<string> => {
      const error = new Error("missing") as NodeJS.ErrnoException
      error.code = "ENOENT"
      throw error
    })

    const result = await loadConfig({
      env: {},
      homeDirectory: "/tmp/home",
      readFileFn,
    })

    expect(result.loaded).toBe(false)
    expect(result.path).toBe("/tmp/home/.config/vde/tmux-manager/config.yml")
    expect(result.config).toEqual(DEFAULT_CONFIG)
  })

  it("merges partial YAML values with defaults", async () => {
    const yaml = [
      'ghqRoot: "/tmp/ghq"',
      "sessionManager:",
      "  fzf:",
      '    prompt: "custom> "',
      "statuslineSessions:",
      "  showIndex: true",
      "  other:",
      '    format: "[{session}]"',
      '    prefix: "("',
      '    suffix: ")"',
      "    bold: true",
      "    colors:",
      '      fg: "#ffffff"',
      "",
    ].join("\n")

    const readFileFn = vi.fn(async (): Promise<string> => yaml)
    const result = await loadConfig({
      env: {},
      homeDirectory: "/tmp/home",
      readFileFn,
    })

    expect(result.loaded).toBe(true)
    expect(result.config.ghqRoot).toBe("/tmp/ghq")
    expect(result.config.sessionManager.fzf.prompt).toBe("custom> ")
    expect(result.config.sessionManager.fzf.border).toBe(
      DEFAULT_CONFIG.sessionManager.fzf.border,
    )
    expect(result.config.statuslineSessions.other.format).toBe("[{session}]")
    expect(result.config.statuslineSessions.other.prefix).toBe("(")
    expect(result.config.statuslineSessions.other.suffix).toBe(")")
    expect(result.config.statuslineSessions.other.bold).toBe(true)
    expect(result.config.statuslineSessions.other.colors.fg).toBe("#ffffff")
    expect(result.config.statuslineSessions.other.colors.bg).toBe(
      DEFAULT_CONFIG.statuslineSessions.other.colors.bg,
    )
    expect(result.config.statuslineSessions.other.colors.outerBg).toBe(
      DEFAULT_CONFIG.statuslineSessions.other.colors.outerBg,
    )
    expect(result.config.statuslineSessions.showIndex).toBe(true)
    expect(result.config.statuslineCategory).toEqual(
      DEFAULT_CONFIG.statuslineCategory,
    )
  })

  it("merges statuslineCategory config with defaults", async () => {
    const yaml = [
      "statuslineCategory:",
      '  format: "<{category}>"',
      '  prefix: "["',
      '  suffix: "]"',
      "  bold: false",
      "  colors:",
      '    fg: "#ffffff"',
      "",
    ].join("\n")

    const readFileFn = vi.fn(async (): Promise<string> => yaml)
    const result = await loadConfig({
      env: {},
      homeDirectory: "/tmp/home",
      readFileFn,
    })

    expect(result.loaded).toBe(true)
    expect(result.config.statuslineCategory).toEqual({
      format: "<{category}>",
      prefix: "[",
      suffix: "]",
      bold: false,
      colors: {
        fg: "#ffffff",
        bg: DEFAULT_CONFIG.statuslineCategory.colors.bg,
        outerBg: DEFAULT_CONFIG.statuslineCategory.colors.outerBg,
      },
    })
  })

  it("merges categories config with defaults", async () => {
    const yaml = [
      "categories:",
      "  defaultCategory: public",
      "  rules:",
      "    - category: work",
      "      ghqPatterns:",
      "        - github.com/company/**",
      "",
    ].join("\n")

    const readFileFn = vi.fn(async (): Promise<string> => yaml)
    const result = await loadConfig({
      env: {},
      homeDirectory: "/tmp/home",
      readFileFn,
    })

    expect(result.loaded).toBe(true)
    expect(result.config.categories.defaultCategory).toBe("public")
    expect(result.config.categories.rules).toEqual([
      {
        category: "work",
        ghqPatterns: ["github.com/company/**"],
        pathPatterns: [],
      },
    ])
    expect(result.config.categories.sessionNameRules).toEqual([])
  })

  it("expands environment variables in category patterns", async () => {
    const yaml = [
      "categories:",
      "  rules:",
      "    - category: work",
      "      ghqPatterns:",
      "        - github.com/${WORK_GHQ_OWNER}/*",
      "        - github.com/${WORK_GHQ_OWNER}/**",
      "      pathPatterns:",
      "        - /work/${WORK_GHQ_OWNER}/**",
      "",
    ].join("\n")

    const readFileFn = vi.fn(async (): Promise<string> => yaml)
    const result = await loadConfig({
      env: { WORK_GHQ_OWNER: "kaizenplatform" },
      homeDirectory: "/tmp/home",
      readFileFn,
    })

    expect(result.loaded).toBe(true)
    expect(result.config.categories.rules).toEqual([
      {
        category: "work",
        ghqPatterns: [
          "github.com/kaizenplatform/*",
          "github.com/kaizenplatform/**",
        ],
        pathPatterns: ["/work/kaizenplatform/**"],
      },
    ])
  })

  it("throws ConfigValidationError when category pattern references an undefined environment variable", async () => {
    const yaml = [
      "categories:",
      "  rules:",
      "    - category: work",
      "      ghqPatterns:",
      "        - github.com/${WORK_GHQ_OWNER}/**",
      "",
    ].join("\n")

    const readFileFn = vi.fn(async (): Promise<string> => yaml)

    await expect(
      loadConfig({
        env: {},
        homeDirectory: "/tmp/home",
        readFileFn,
      }),
    ).rejects.toThrow(
      "categories.rules.0.ghqPatterns.0: environment variable WORK_GHQ_OWNER is not defined",
    )
  })

  it("defaults to an unnamed category when categories are not configured", async () => {
    const readFileFn = vi.fn(async (): Promise<string> => "")
    const result = await loadConfig({
      env: {},
      homeDirectory: "/tmp/home",
      readFileFn,
    })

    expect(result.loaded).toBe(true)
    expect(result.config.ghqRoot).toBeNull()
    expect(result.config.categories.defaultCategory).toBe("")
    expect(result.config.categories.rules).toEqual([])
    expect(result.config.categories.sessionNameRules).toEqual([])
  })

  it("accepts category order values in config", async () => {
    const yaml = [
      "categories:",
      "  defaultCategory: work",
      "  order:",
      "    work: 10",
      "    private: 20",
      "  rules:",
      "    - category: private",
      "      ghqPatterns:",
      "        - github.com/company/**",
      "",
    ].join("\n")

    const readFileFn = vi.fn(async (): Promise<string> => yaml)
    const result = await loadConfig({
      env: {},
      homeDirectory: "/tmp/home",
      readFileFn,
    })

    expect(result.config.categories.defaultCategory).toBe("work")
    expect(result.config.categories.order).toEqual({
      work: 10,
      private: 20,
    })
    expect(result.config.categories.rules[0]?.category).toBe("private")
  })

  it("ignores unknown config keys", async () => {
    const yaml = [
      "unknownTopLevel: true",
      "categories:",
      "  defaultCategory: work",
      "  unknownNested: ignored",
      "  rules:",
      "    - category: work",
      "      ghqPatterns:",
      "        - github.com/company/**",
      "      unknownRuleKey: ignored",
      "",
    ].join("\n")

    const readFileFn = vi.fn(async (): Promise<string> => yaml)
    const result = await loadConfig({
      env: {},
      homeDirectory: "/tmp/home",
      readFileFn,
    })

    expect(result.loaded).toBe(true)
    expect(result.config.categories.defaultCategory).toBe("work")
    expect(result.config.categories.rules).toEqual([
      {
        category: "work",
        ghqPatterns: ["github.com/company/**"],
        pathPatterns: [],
      },
    ])
  })

  it("throws ConfigValidationError for invalid YAML", async () => {
    const readFileFn = vi.fn(async (): Promise<string> => "sessionManager: [")

    await expect(
      loadConfig({
        env: {},
        homeDirectory: "/tmp/home",
        readFileFn,
      }),
    ).rejects.toBeInstanceOf(ConfigValidationError)
  })
})
