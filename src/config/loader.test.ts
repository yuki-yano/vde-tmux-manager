import { DEFAULT_CONFIG } from "./defaults"
import { ConfigValidationError, loadConfig, resolveConfigPath } from "./loader"

describe("resolveConfigPath", () => {
  it("uses XDG_CONFIG_HOME when set", () => {
    const path = resolveConfigPath({
      env: { XDG_CONFIG_HOME: "/tmp/xdg" },
      homeDirectory: "/tmp/home",
    })

    expect(path).toBe("/tmp/xdg/vde-tmux-manager/config.yaml")
  })

  it("falls back to HOME/.config", () => {
    const path = resolveConfigPath({
      env: {},
      homeDirectory: "/tmp/home",
    })

    expect(path).toBe("/tmp/home/.config/vde-tmux-manager/config.yaml")
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
    expect(result.path).toBe("/tmp/home/.config/vde-tmux-manager/config.yaml")
    expect(result.config).toEqual(DEFAULT_CONFIG)
  })

  it("merges partial YAML values with defaults", async () => {
    const yaml = [
      "sessionManager:",
      "  fzf:",
      '    prompt: "custom> "',
      "statuslineSessions:",
      "  showIndex: true",
      "  fonts:",
      '    otherPrefix: "["',
      '    otherSuffix: "]"',
      "",
    ].join("\n")

    const readFileFn = vi.fn(async (): Promise<string> => yaml)
    const result = await loadConfig({
      env: {},
      homeDirectory: "/tmp/home",
      readFileFn,
    })

    expect(result.loaded).toBe(true)
    expect(result.config.sessionManager.fzf.prompt).toBe("custom> ")
    expect(result.config.sessionManager.fzf.border).toBe(
      DEFAULT_CONFIG.sessionManager.fzf.border,
    )
    expect(result.config.statuslineSessions.fonts.otherPrefix).toBe("[")
    expect(result.config.statuslineSessions.fonts.otherSuffix).toBe("]")
    expect(result.config.statuslineSessions.showIndex).toBe(true)
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

  it("throws ConfigValidationError for unknown keys", async () => {
    const readFileFn = vi.fn(async (): Promise<string> => "unknownKey: true")

    await expect(
      loadConfig({
        env: {},
        homeDirectory: "/tmp/home",
        readFileFn,
      }),
    ).rejects.toBeInstanceOf(ConfigValidationError)
  })
})
