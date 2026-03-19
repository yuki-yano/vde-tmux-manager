import { DEFAULT_CONFIG } from "../../config/defaults"
import { runSessionCycle } from "./session-cycle"

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

describe("runSessionCycle", () => {
  it("cycles to the next session inside the current category", async () => {
    const stdout = createCollector()
    const stderr = createCollector()

    const tmux = {
      currentClientName: vi.fn(async () => "/dev/ttys001"),
      showClientOption: vi.fn(async (_target: string, option: string) => {
        if (option === "category_last_sessions") {
          return ""
        }
        return "work"
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
      currentSession: vi.fn(async () => "repo-a"),
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

    const exitCode = await runSessionCycle(["next"], {
      programName: "vtm",
      stdout: stdout.write,
      stderr: stderr.write,
      tmux: tmux as never,
      loadConfigFn,
      env: { TMUX: "1", HOME: "/Users/test", GHQ_ROOT: "/Users/test/ghq" },
    })

    expect(exitCode).toBe(0)
    expect(tmux.switchClient).toHaveBeenCalledWith("repo-b")
    expect(tmux.setClientOption).toHaveBeenCalledWith(
      "/dev/ttys001",
      "category_last_sessions",
      JSON.stringify({
        work: "repo-b",
      }),
    )
  })
})
