import { DEFAULT_CONFIG } from "../../config/defaults"
import { __internal } from "./session-manager"

const categoryLastSessionOption = (categoryName: string): string => {
  const encoded = Buffer.from(categoryName, "utf8").toString("hex")
  return `category_last_session_${encoded.length > 0 ? encoded : "0"}`
}

const configWithCategories = {
  ...DEFAULT_CONFIG,
  categories: {
    defaultCategory: "default",
    rules: [
      {
        category: "work",
        ghqPatterns: ["github.com/company/**"],
        pathPatterns: [],
      },
      {
        category: "private",
        ghqPatterns: [],
        pathPatterns: ["/tmp/**"],
      },
    ],
    sessionNameRules: [],
  },
}

const createTmuxMock = (): {
  readonly listSessions: ReturnType<typeof vi.fn>
  readonly listSessionDetails: ReturnType<typeof vi.fn>
  readonly currentSession: ReturnType<typeof vi.fn>
  readonly currentClientName: ReturnType<typeof vi.fn>
  readonly showClientOption: ReturnType<typeof vi.fn>
  readonly setClientOption: ReturnType<typeof vi.fn>
  readonly listWindows: ReturnType<typeof vi.fn>
  readonly run: ReturnType<typeof vi.fn>
  readonly switchClient: ReturnType<typeof vi.fn>
  readonly attachSession: ReturnType<typeof vi.fn>
  readonly selectWindow: ReturnType<typeof vi.fn>
  readonly newSessionDetached: ReturnType<typeof vi.fn>
  readonly newSessionInteractive: ReturnType<typeof vi.fn>
  readonly renameSession: ReturnType<typeof vi.fn>
  readonly listPanes: ReturnType<typeof vi.fn>
  readonly getSinglePane: ReturnType<typeof vi.fn>
  readonly sendCtrlC: ReturnType<typeof vi.fn>
  readonly killSession: ReturnType<typeof vi.fn>
  readonly killWindow: ReturnType<typeof vi.fn>
  readonly killPane: ReturnType<typeof vi.fn>
  readonly killServer: ReturnType<typeof vi.fn>
} => {
  return {
    listSessions: vi.fn(async () => [
      { name: "dev", attachedClients: 1, lastActivity: 100 },
      { name: "work", attachedClients: 0, lastActivity: 50 },
    ]),
    listSessionDetails: vi.fn(async () => [
      {
        id: "$1",
        name: "dev",
        attachedClients: 1,
        lastActivity: 100,
        category: "work",
        projectPath: "/Users/test/ghq/github.com/company/dev",
        categoryOverride: "",
      },
      {
        id: "$2",
        name: "work",
        attachedClients: 0,
        lastActivity: 50,
        category: "private",
        projectPath: "/tmp/work",
        categoryOverride: "",
      },
    ]),
    currentSession: vi.fn(async () => "dev"),
    currentClientName: vi.fn(async () => "/dev/ttys001"),
    showClientOption: vi.fn(async (_target: string, option: string) => {
      if (option === categoryLastSessionOption("work")) {
        return ""
      }
      return "work"
    }),
    setClientOption: vi.fn(async () => undefined),
    listWindows: vi.fn(async (_name: string) => [
      {
        index: "0",
        panes: 2,
        active: true,
        name: "editor",
        command: "zsh",
      },
    ]),
    run: vi.fn(async (args: readonly string[]) => {
      if (args[0] === "list-windows" && args[1] === "-a") {
        return {
          stdout: "dev\t0\t2\t1\teditor\tzsh\nwork\t0\t1\t0\tlogs\tbash\n",
          stderr: "",
          exitCode: 0,
        }
      }
      if (
        args[0] === "display-message" &&
        args.includes("#{pane_current_path}")
      ) {
        return { stdout: "/tmp/project\n", stderr: "", exitCode: 0 }
      }
      return { stdout: "", stderr: "", exitCode: 0 }
    }),
    switchClient: vi.fn(async () => undefined),
    attachSession: vi.fn(async () => undefined),
    selectWindow: vi.fn(async () => undefined),
    newSessionDetached: vi.fn(async () => "new-session"),
    newSessionInteractive: vi.fn(async () => undefined),
    renameSession: vi.fn(async () => undefined),
    listPanes: vi.fn(async () => []),
    getSinglePane: vi.fn(async () => []),
    sendCtrlC: vi.fn(async () => undefined),
    killSession: vi.fn(async () => undefined),
    killWindow: vi.fn(async () => undefined),
    killPane: vi.fn(async () => undefined),
    killServer: vi.fn(async () => undefined),
  } as const
}

const runner = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }))

describe("session-manager internals", () => {
  beforeEach(() => {
    runner.mockClear()
  })

  it("parses CLI options", () => {
    expect(
      __internal.parseOptions([
        "--popup",
        "--render-preview",
        "session",
        "--preview-name",
        "dev",
        "kill-window",
      ]),
    ).toEqual({
      popup: true,
      renderPreview: "session",
      previewName: "dev",
      positional: ["kill-window"],
    })
  })

  it("throws when preview options are incomplete", () => {
    expect(() => __internal.parseOptions(["--render-preview"])).toThrow(
      "--render-preview requires a value",
    )
    expect(() => __internal.parseOptions(["--preview-name"])).toThrow(
      "--preview-name requires a value",
    )
  })

  it("parses selection lines", () => {
    expect(__internal.parseSelectionLines(["ctrl-q", "session\tdev"])).toEqual({
      key: "ctrl-q",
      selections: ["session\tdev"],
    })
    expect(__internal.parseSelectionLines(["session\tdev"])).toEqual({
      key: "enter",
      selections: ["session\tdev"],
    })
    expect(__internal.parseSelectionLines([])).toEqual({
      key: "enter",
      selections: [],
    })
  })

  it("parses entry lines", () => {
    expect(__internal.parseEntryLine("session\tdev")).toEqual({
      action: "session",
      name: "dev",
    })
    expect(__internal.parseEntryLine("window\tdev:1")).toEqual({
      action: "window",
      name: "dev:1",
    })
    expect(__internal.parseEntryLine("bad\tdev")).toBeNull()
  })

  it("collects sessions with windows and current flag", async () => {
    const tmux = createTmuxMock()
    const result = await __internal.collectSessions({
      tmux: tmux as never,
      inTmux: true,
      config: {
        ...DEFAULT_CONFIG,
        categories: {
          defaultCategory: "default",
          rules: [
            {
              category: "work",
              ghqPatterns: ["github.com/company/**"],
              pathPatterns: [],
            },
            {
              category: "private",
              ghqPatterns: [],
              pathPatterns: ["/tmp/**"],
            },
          ],
          sessionNameRules: [],
        },
      },
      homeDirectory: "/Users/test",
      ghqRoot: "/Users/test/ghq",
    })

    expect(result[0]?.isCurrent).toBe(true)
    expect(result[0]?.category).toBe("work")
    expect(result[0]?.totalWindows).toBe(1)
    expect(result[0]?.totalPanes).toBe(2)
  })

  it("builds selector entries", () => {
    const entries = __internal.buildEntries(
      [
        {
          id: "$1",
          name: "dev",
          attachedClients: 1,
          lastActivity: 100,
          category: "work",
          projectPath: "/Users/test/ghq/github.com/company/dev",
          categoryOverride: "",
          windows: [
            {
              index: "0",
              panes: 2,
              active: true,
              name: "editor",
              command: "zsh",
            },
          ],
          totalWindows: 1,
          totalPanes: 2,
          isCurrent: true,
        },
        {
          id: "$2",
          name: "work",
          attachedClients: 0,
          lastActivity: 50,
          category: "private",
          projectPath: "/tmp/work",
          categoryOverride: "",
          windows: [],
          totalWindows: 0,
          totalPanes: 0,
          isCurrent: false,
        },
      ],
      "work",
    )

    expect(
      entries.some(
        (entry) => entry.action === "session" && entry.name === "dev",
      ),
    ).toBe(true)
    expect(entries[0]?.display).toContain("work")
    const serverEntry = entries.find((entry) => entry.action === "server")
    expect(serverEntry).toBeDefined()
    expect(serverEntry?.display).not.toContain("[work]")
  })

  it("opens popup when running in tmux", async () => {
    const tmux = createTmuxMock()
    tmux.run
      .mockResolvedValueOnce({
        stdout: "/tmp/project",
        stderr: "",
        exitCode: 0,
      })
      .mockResolvedValueOnce({ stdout: "", stderr: "", exitCode: 0 })

    const opened = await __internal.openPopupIfNeeded({
      tmux: tmux as never,
      config: DEFAULT_CONFIG,
      popup: false,
      env: { TMUX: "1" },
      argv: ["node", "vtm"],
    })

    expect(opened).toBe(true)
    expect(tmux.run).toHaveBeenNthCalledWith(
      2,
      expect.arrayContaining(["display-popup", "-E", "-w", "50%", "-h", "50%"]),
      {
        allowFail: false,
      },
    )
  })

  it("skips popup when disabled by context", async () => {
    const tmux = createTmuxMock()

    await expect(
      __internal.openPopupIfNeeded({
        tmux: tmux as never,
        config: DEFAULT_CONFIG,
        popup: true,
        env: { TMUX: "1" },
        argv: ["node", "vtm"],
      }),
    ).resolves.toBe(false)

    await expect(
      __internal.openPopupIfNeeded({
        tmux: tmux as never,
        config: DEFAULT_CONFIG,
        popup: false,
        env: {},
        argv: ["node", "vtm"],
      }),
    ).resolves.toBe(false)
  })

  it("handles ctrl-t selection", async () => {
    const tmux = createTmuxMock()

    await __internal.runSelection({
      lines: ["ctrl-t"],
      tmux: tmux as never,
      config: DEFAULT_CONFIG,
      popup: false,
      stderr: vi.fn(),
      runner: runner as never,
      env: { TMUX: "1" },
    })

    expect(tmux.newSessionDetached).toHaveBeenCalled()
    expect(tmux.switchClient).toHaveBeenCalledWith("new-session")
  })

  it("handles ctrl-q selection", async () => {
    const originalTmux = process.env.TMUX
    process.env.TMUX = "1"

    const tmux = createTmuxMock()

    await __internal.runSelection({
      lines: ["ctrl-q", "session\tdev", "window\twork:1"],
      tmux: tmux as never,
      config: DEFAULT_CONFIG,
      popup: false,
      stderr: vi.fn(),
      runner: runner as never,
      env: { TMUX: "1" },
    })

    expect(tmux.switchClient).toHaveBeenCalled()
    expect(tmux.killSession).toHaveBeenCalledWith("dev")
    expect(tmux.killWindow).toHaveBeenCalledWith("work:1")

    process.env.TMUX = originalTmux
  })

  it("handles ctrl-r selection in and out of tmux", async () => {
    const tmux = createTmuxMock()
    const stderr = vi.fn()

    await __internal.runSelection({
      lines: ["ctrl-r", "session\tdev"],
      tmux: tmux as never,
      config: DEFAULT_CONFIG,
      popup: false,
      stderr,
      runner: runner as never,
      env: {},
    })

    expect(stderr).toHaveBeenCalledWith(
      "[SESSION_RENAME_UNAVAILABLE] session rename requires tmux client context",
    )

    await __internal.runSelection({
      lines: ["ctrl-r", "session\tdev"],
      tmux: tmux as never,
      config: DEFAULT_CONFIG,
      popup: false,
      stderr,
      runner: runner as never,
      env: { TMUX: "1" },
    })

    expect(tmux.run).toHaveBeenCalledWith(
      ["command-prompt", "-I", "dev", "rename-session -t 'dev' '%%'"],
      { allowFail: true },
    )
  })

  it("handles enter selection for session and window", async () => {
    const tmux = createTmuxMock()

    await __internal.runSelection({
      lines: ["session\tdev"],
      tmux: tmux as never,
      config: configWithCategories,
      popup: false,
      stderr: vi.fn(),
      runner: runner as never,
      env: { TMUX: "1", HOME: "/Users/test", GHQ_ROOT: "/Users/test/ghq" },
    })

    expect(tmux.switchClient).toHaveBeenCalledWith("dev")
    expect(tmux.setClientOption).toHaveBeenCalledWith(
      "/dev/ttys001",
      categoryLastSessionOption("work"),
      "dev",
    )

    await __internal.runSelection({
      lines: ["window\tdev:0"],
      tmux: tmux as never,
      config: configWithCategories,
      popup: false,
      stderr: vi.fn(),
      runner: runner as never,
      env: {},
    })

    expect(tmux.selectWindow).toHaveBeenCalledWith("dev:0")
    expect(tmux.attachSession).toHaveBeenCalledWith("dev", true)
  })

  it("renders preview once when refresh is disabled", async () => {
    const tmux = createTmuxMock()
    const writeSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true)

    await __internal.runPreviewRenderer({
      tmux: tmux as never,
      config: DEFAULT_CONFIG,
      action: "other",
      name: "",
      env: {
        PREVIEW_REFRESH_MS: "0",
      },
    })

    expect(writeSpy).toHaveBeenCalled()
    writeSpy.mockRestore()
  })
})
