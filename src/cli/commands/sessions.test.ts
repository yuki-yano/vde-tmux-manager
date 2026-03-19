import { DEFAULT_CONFIG } from "../../config/defaults"
import { runSessions } from "./sessions"

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

describe("runSessions", () => {
  it("refreshes session categories from project metadata", async () => {
    const stdout = createCollector()
    const stderr = createCollector()
    const tmux = {
      listSessionDetails: vi.fn(async () => []),
      setSessionOption: vi.fn(async () => undefined),
    }
    const loadConfigFn = vi.fn(async () => ({
      config: DEFAULT_CONFIG,
      path: "/tmp/config.yaml",
      loaded: false,
    }))
    const refreshSessionCategoriesFn = vi.fn(async () => ({
      updated: [{ sessionName: "repo-a", category: "default" }],
    }))

    const exitCode = await runSessions(["refresh-category"], {
      programName: "vtm",
      stdout: stdout.write,
      stderr: stderr.write,
      tmux: tmux as never,
      loadConfigFn,
      refreshSessionCategoriesFn,
      env: {},
    })

    expect(exitCode).toBe(0)
    expect(refreshSessionCategoriesFn).toHaveBeenCalled()
  })
})
