import { DEFAULT_CONFIG } from "../../config/defaults"
import {
  renderStatuslineSessions,
  runStatuslineSessions,
} from "./statusline-sessions"

const categoryLastSessionOption = (categoryName: string): string => {
  const encoded = Buffer.from(categoryName, "utf8").toString("hex")
  return `category_last_session_${encoded.length > 0 ? encoded : "0"}`
}

describe("renderStatuslineSessions", () => {
  it("renders clickable segments with current session styling", () => {
    const output = renderStatuslineSessions({
      sessions: [
        { id: "$1", name: "dev" },
        { id: "$2", name: "work" },
      ],
      currentSession: "work",
      config: DEFAULT_CONFIG.statuslineSessions,
    })

    expect(output).toMatchInlineSnapshot(
      '" #[range=session|$1]#[fg=#C6D0F5,bg=#352F63,nobold]dev#[default]#[norange] #[range=session|$2]#[fg=#B4BEFE,bg=#352F63,nobold]#[fg=#1E1E2E,bg=#B4BEFE,nobold]work#[fg=#B4BEFE,bg=#352F63,nobold]#[default]#[norange]"',
    )
  })

  it("renders 1-based indexes before session names when enabled", () => {
    const output = renderStatuslineSessions({
      sessions: [
        { id: "$1", name: "dev" },
        { id: "$2", name: "work" },
      ],
      currentSession: "work",
      config: {
        ...DEFAULT_CONFIG.statuslineSessions,
        showIndex: true,
      },
    })

    expect(output).toContain("]1 dev#[")
    expect(output).toContain("#[fg=#1E1E2E,bg=#B4BEFE,nobold]2 work")
    expect(output).toContain("work#[fg=#B4BEFE,bg=#352F63,nobold]")
  })

  it("omits indexes greater than 9 to match tmux-list-sessions", () => {
    const output = renderStatuslineSessions({
      sessions: Array.from({ length: 10 }, (_, index) => ({
        id: `$${index + 1}`,
        name: `session-${index + 1}`,
      })),
      currentSession: "session-10",
      config: {
        ...DEFAULT_CONFIG.statuslineSessions,
        showIndex: true,
      },
    })

    expect(output).toContain("]9 session-9#[")
    expect(output).not.toContain("10 session-10")
    expect(output).toContain("#[fg=#1E1E2E,bg=#B4BEFE,nobold]session-10")
    expect(output).toContain("session-10#[fg=#B4BEFE,bg=#352F63,nobold]")
  })
})

describe("runStatuslineSessions", () => {
  const createCollector = (): {
    lines: string[]
    write: (line: string) => void
  } => {
    const lines: string[] = []
    return {
      lines,
      write: (line: string): void => {
        lines.push(line)
      },
    }
  }

  it("prints usage with --help", async () => {
    const stdout = createCollector()
    const stderr = createCollector()

    const exitCode = await runStatuslineSessions(["--help"], {
      programName: "vtm",
      stdout: stdout.write,
      stderr: stderr.write,
    })

    expect(exitCode).toBe(0)
    expect(stdout.lines.join("\n")).toContain("Usage: vtm statusline-sessions")
    expect(stdout.lines.join("\n")).toContain(
      "statusline-sessions switch <index>",
    )
    expect(stdout.lines.join("\n")).toContain("--show-index")
    expect(stderr.lines).toHaveLength(0)
  })

  it("returns usage error when positional args are provided", async () => {
    const stdout = createCollector()
    const stderr = createCollector()

    const exitCode = await runStatuslineSessions(["extra"], {
      programName: "vtm",
      stdout: stdout.write,
      stderr: stderr.write,
    })

    expect(exitCode).toBe(2)
    expect(stderr.lines.join("\n")).toContain("Usage: vtm statusline-sessions")
  })

  it("renders statusline output with injected dependencies", async () => {
    const stdout = createCollector()
    const stderr = createCollector()

    const tmux = {
      listSessionDetails: vi.fn(async () => [
        {
          id: "$1",
          name: "dev",
          attachedClients: 0,
          lastActivity: 0,
          category: "work",
          projectPath: "/Users/test/ghq/github.com/company/dev",
          categoryOverride: "",
        },
        {
          id: "$2",
          name: "personal",
          attachedClients: 0,
          lastActivity: 0,
          category: "private",
          projectPath: "/tmp/personal",
          categoryOverride: "",
        },
      ]),
      currentSession: vi.fn(async () => "dev"),
      currentClientName: vi.fn(async () => "/dev/ttys001"),
      showClientOption: vi.fn(async () => "work"),
    } as const

    const loadConfigFn = vi.fn(async () => ({
      config: {
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
              pathPatterns: ["/tmp/**"],
            },
          ],
          sessionNameRules: [],
        },
      },
      path: "/tmp/config.yaml",
      loaded: false,
    }))

    const exitCode = await runStatuslineSessions([], {
      programName: "vtm",
      stdout: stdout.write,
      stderr: stderr.write,
      tmux,
      loadConfigFn,
      env: {
        HOME: "/Users/test",
        GHQ_ROOT: "/Users/test/ghq",
      },
    })

    expect(exitCode).toBe(0)
    expect(stdout.lines[0]).toContain("#[range=session|$1]")
    expect(stdout.lines[0]).not.toContain("personal")
    expect(stdout.lines[0]).toContain("#[norange]")
    expect(stderr.lines).toHaveLength(0)
  })

  it("renders indexes when --show-index is provided", async () => {
    const stdout = createCollector()
    const stderr = createCollector()

    const tmux = {
      listSessionDetails: vi.fn(async () => [
        {
          id: "$1",
          name: "dev",
          attachedClients: 0,
          lastActivity: 0,
          category: "work",
          projectPath: "/Users/test/ghq/github.com/company/dev",
          categoryOverride: "",
        },
        {
          id: "$2",
          name: "work",
          attachedClients: 0,
          lastActivity: 0,
          category: "work",
          projectPath: "/Users/test/ghq/github.com/company/work",
          categoryOverride: "",
        },
      ]),
      currentSession: vi.fn(async () => "dev"),
      currentClientName: vi.fn(async () => "/dev/ttys001"),
      showClientOption: vi.fn(async () => "work"),
    } as const

    const loadConfigFn = vi.fn(async () => ({
      config: {
        ...DEFAULT_CONFIG,
        categories: {
          defaultCategory: "public",
          rules: [
            {
              category: "work",
              ghqPatterns: ["github.com/company/**"],
              pathPatterns: [],
            },
          ],
          sessionNameRules: [],
        },
      },
      path: "/tmp/config.yaml",
      loaded: false,
    }))

    const exitCode = await runStatuslineSessions(["--show-index"], {
      programName: "vtm",
      stdout: stdout.write,
      stderr: stderr.write,
      tmux,
      loadConfigFn,
      env: {
        HOME: "/Users/test",
        GHQ_ROOT: "/Users/test/ghq",
      },
    })

    expect(exitCode).toBe(0)
    expect(stdout.lines[0]).toContain("#[fg=#1E1E2E,bg=#B4BEFE,nobold]1 dev")
    expect(stdout.lines[0]).toContain("]2 work#[")
    expect(stderr.lines).toHaveLength(0)
  })

  it("switches to the session at the given 1-based index", async () => {
    const stdout = createCollector()
    const stderr = createCollector()

    const tmux = {
      listSessionDetails: vi.fn(async () => [
        {
          id: "$1",
          name: "dev",
          attachedClients: 0,
          lastActivity: 0,
          category: "work",
          projectPath: "/Users/test/ghq/github.com/company/dev",
          categoryOverride: "",
        },
        {
          id: "$2",
          name: "other",
          attachedClients: 0,
          lastActivity: 0,
          category: "private",
          projectPath: "/tmp/other",
          categoryOverride: "",
        },
        {
          id: "$3",
          name: "work",
          attachedClients: 0,
          lastActivity: 0,
          category: "work",
          projectPath: "/Users/test/ghq/github.com/company/work",
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
      switchClient: vi.fn(async () => undefined),
    } as const

    const loadConfigFn = vi.fn(async () => ({
      config: {
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
              pathPatterns: ["/tmp/**"],
            },
          ],
          sessionNameRules: [],
        },
      },
      path: "/tmp/config.yaml",
      loaded: false,
    }))

    const exitCode = await runStatuslineSessions(["switch", "2"], {
      programName: "vtm",
      stdout: stdout.write,
      stderr: stderr.write,
      tmux,
      loadConfigFn,
      env: {
        HOME: "/Users/test",
        GHQ_ROOT: "/Users/test/ghq",
      },
    })

    expect(exitCode).toBe(0)
    expect(tmux.switchClient).toHaveBeenCalledWith("work")
    expect(tmux.setClientOption).toHaveBeenCalledTimes(1)
    expect(tmux.setClientOption).toHaveBeenCalledWith(
      "/dev/ttys001",
      categoryLastSessionOption("work"),
      "work",
    )
    expect(tmux.setClientOption).not.toHaveBeenCalledWith(
      "/dev/ttys001",
      "current_category",
      "work",
    )
    expect(stdout.lines).toHaveLength(0)
    expect(stderr.lines).toHaveLength(0)
  })

  it("returns usage error when switch index is not a positive integer", async () => {
    const stdout = createCollector()
    const stderr = createCollector()

    const tmux = {
      listSessionDetails: vi.fn(async () => []),
      currentSession: vi.fn(async () => "dev"),
      currentClientName: vi.fn(async () => "/dev/ttys001"),
      showClientOption: vi.fn(async () => "work"),
      switchClient: vi.fn(async () => undefined),
    } as const

    const exitCode = await runStatuslineSessions(["switch", "0"], {
      programName: "vtm",
      stdout: stdout.write,
      stderr: stderr.write,
      tmux,
    })

    expect(exitCode).toBe(2)
    expect(stderr.lines.join("\n")).toContain(
      "index must be a positive integer: 0",
    )
    expect(tmux.switchClient).not.toHaveBeenCalled()
  })

  it("returns error when switch target index does not exist", async () => {
    const stdout = createCollector()
    const stderr = createCollector()

    const tmux = {
      listSessionDetails: vi.fn(async () => [
        {
          id: "$1",
          name: "dev",
          attachedClients: 0,
          lastActivity: 0,
          category: "work",
          projectPath: "/Users/test/ghq/github.com/company/dev",
          categoryOverride: "",
        },
      ]),
      currentSession: vi.fn(async () => "dev"),
      currentClientName: vi.fn(async () => "/dev/ttys001"),
      showClientOption: vi.fn(async () => "work"),
      switchClient: vi.fn(async () => undefined),
    } as const

    const loadConfigFn = vi.fn(async () => ({
      config: {
        ...DEFAULT_CONFIG,
        categories: {
          defaultCategory: "public",
          rules: [
            {
              category: "work",
              ghqPatterns: ["github.com/company/**"],
              pathPatterns: [],
            },
          ],
          sessionNameRules: [],
        },
      },
      path: "/tmp/config.yaml",
      loaded: false,
    }))

    const exitCode = await runStatuslineSessions(["switch", "2"], {
      programName: "vtm",
      stdout: stdout.write,
      stderr: stderr.write,
      tmux,
      loadConfigFn,
      env: {
        HOME: "/Users/test",
        GHQ_ROOT: "/Users/test/ghq",
      },
    })

    expect(exitCode).toBe(1)
    expect(stderr.lines.join("\n")).toContain("session not found at index 2")
    expect(tmux.switchClient).not.toHaveBeenCalled()
  })
})
