import { DEFAULT_CONFIG } from "../../config/defaults"
import { runCategory } from "./category"

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
        if (option === "category_last_sessions") {
          return JSON.stringify({
            work: "repo-b",
          })
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
    expect(tmux.setClientOption).toHaveBeenCalledWith(
      "/dev/ttys001",
      "current_category",
      "work",
    )
    expect(tmux.switchClient).toHaveBeenCalledWith("repo-b")
    expect(stderr.lines).toHaveLength(0)
  })
})
