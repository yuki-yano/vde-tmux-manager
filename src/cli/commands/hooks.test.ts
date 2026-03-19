import { DEFAULT_CONFIG } from "../../config/defaults"
import { runHooks } from "./hooks"

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

describe("runHooks", () => {
  it("updates last active state from explicit tmux hook arguments", async () => {
    const stdout = createCollector()
    const stderr = createCollector()
    const tmux = {
      listSessionDetails: vi.fn(async () => [
        {
          id: "$1",
          name: "private-repo",
          attachedClients: 0,
          lastActivity: 0,
          category: "private",
          projectPath: "/tmp/private-repo",
          categoryOverride: "",
        },
      ]),
      showClientOption: vi.fn(async () => ""),
      setClientOption: vi.fn(async () => undefined),
      currentClientName: vi.fn(async () => "/dev/ttys001"),
      currentSession: vi.fn(async () => "private-repo"),
    }

    const loadConfigFn = vi.fn(async () => ({
      config: {
        ...DEFAULT_CONFIG,
        categories: {
          defaultCategory: "",
          rules: [
            {
              category: "private",
              ghqPatterns: [],
              pathPatterns: ["/tmp/**"],
            },
          ],
          sessionNameRules: [],
        },
      },
      path: "/tmp/config.yml",
      loaded: false,
    }))

    const exitCode = await runHooks(
      ["on-client-session-changed", "/dev/ttys999", "private-repo"],
      {
        programName: "vtm",
        stdout: stdout.write,
        stderr: stderr.write,
        tmux: tmux as never,
        loadConfigFn,
        env: { HOME: "/Users/test", GHQ_ROOT: "/Users/test/ghq" },
      },
    )

    expect(exitCode).toBe(0)
    expect(tmux.setClientOption).toHaveBeenCalledWith(
      "/dev/ttys999",
      "current_category",
      "private",
    )
    expect(tmux.setClientOption).toHaveBeenCalledWith(
      "/dev/ttys999",
      "category_last_sessions",
      JSON.stringify({
        private: "private-repo",
      }),
    )
    expect(stderr.lines).toHaveLength(0)
  })
})
