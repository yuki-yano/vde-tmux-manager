import { DEFAULT_CONFIG } from "../../config/defaults"
import { runCategory } from "./category"

const categoryLastSessionOption = (categoryName: string): string => {
  const encoded = Buffer.from(categoryName, "utf8").toString("hex")
  return `category_last_session_${encoded.length > 0 ? encoded : "0"}`
}

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

describe("runCategory", () => {
  it("switches the current client category", async () => {
    const stdout = createCollector()
    const stderr = createCollector()

    const tmux = {
      currentClientName: vi.fn(async () => "/dev/ttys001"),
      currentSession: vi.fn(async () => "repo-a"),
      showClientOption: vi.fn(async (_target: string, option: string) => {
        if (option === categoryLastSessionOption("work")) {
          return "repo-b"
        }
        return ""
      }),
      setClientOption: vi.fn(async () => undefined),
      listSessionDetails: vi.fn(async () => [
        {
          id: "$1",
          name: "repo-a",
          attachedClients: 0,
          lastActivity: 0,
          category: "work",
          projectPath: "/Users/test/ghq/github.com/company/repo-a",
          categoryOverride: "",
        },
        {
          id: "$2",
          name: "repo-b",
          attachedClients: 0,
          lastActivity: 0,
          category: "work",
          projectPath: "/Users/test/ghq/github.com/company/repo-b",
          categoryOverride: "",
        },
      ]),
      switchClient: vi.fn(async () => undefined),
    }

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

    const exitCode = await runCategory(["use", "work"], {
      programName: "vtm",
      stdout: stdout.write,
      stderr: stderr.write,
      tmux: tmux as never,
      loadConfigFn,
      env: {
        HOME: "/Users/test",
        GHQ_ROOT: "/Users/test/ghq",
      },
    })

    expect(exitCode).toBe(0)
    expect(tmux.currentClientName).toHaveBeenCalledTimes(1)
    expect(tmux.listSessionDetails).toHaveBeenCalledTimes(1)
    expect(tmux.setClientOption).toHaveBeenCalledWith(
      "/dev/ttys001",
      "current_category",
      "work",
    )
    expect(tmux.switchClient).toHaveBeenCalledWith("repo-b")
    expect(stderr.lines).toHaveLength(0)
  })

  it("switches to the next ordered category", async () => {
    const stdout = createCollector()
    const stderr = createCollector()

    const tmux = {
      currentClientName: vi.fn(async () => "/dev/ttys001"),
      currentSession: vi.fn(async () => "repo-work"),
      showClientOption: vi.fn(async (_target: string, option: string) => {
        if (option === "current_category") {
          return "work"
        }
        if (option === categoryLastSessionOption("private")) {
          return "repo-private"
        }
        return ""
      }),
      setClientOption: vi.fn(async () => undefined),
      listSessionDetails: vi.fn(async () => [
        {
          id: "$1",
          name: "repo-work",
          attachedClients: 0,
          lastActivity: 0,
          category: "work",
          projectPath: "/tmp/repo-work",
          categoryOverride: "",
        },
        {
          id: "$2",
          name: "repo-private",
          attachedClients: 0,
          lastActivity: 0,
          category: "private",
          projectPath: "/tmp/repo-private",
          categoryOverride: "",
        },
      ]),
      switchClient: vi.fn(async () => undefined),
    }

    const loadConfigFn = vi.fn(async () => ({
      config: {
        ...DEFAULT_CONFIG,
        categories: {
          defaultCategory: "work",
          order: {
            work: 10,
            private: 20,
          },
          rules: [
            {
              category: "work",
              ghqPatterns: [],
              pathPatterns: ["/tmp/repo-work"],
            },
            {
              category: "private",
              ghqPatterns: [],
              pathPatterns: ["/tmp/repo-private"],
            },
          ],
          sessionNameRules: [],
        },
      },
      path: "/tmp/config.yaml",
      loaded: false,
    }))

    const exitCode = await runCategory(["next"], {
      programName: "vtm",
      stdout: stdout.write,
      stderr: stderr.write,
      tmux: tmux as never,
      loadConfigFn,
      env: {
        HOME: "/Users/test",
      },
    })

    expect(exitCode).toBe(0)
    expect(tmux.switchClient).toHaveBeenCalledWith("repo-private")
    expect(stderr.lines).toHaveLength(0)
  })
})
