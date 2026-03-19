import { DEFAULT_CONFIG } from "../../config/defaults"
import { runProject } from "./project"

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

describe("runProject", () => {
  it("switches to the requested project path", async () => {
    const stdout = createCollector()
    const stderr = createCollector()
    const tmux = {
      listSessionDetails: vi.fn(async () => []),
      newSessionInteractiveNamed: vi.fn(async () => undefined),
      newSessionDetachedNamed: vi.fn(async () => undefined),
      setSessionOption: vi.fn(async () => undefined),
      switchClient: vi.fn(async () => undefined),
    }
    const loadConfigFn = vi.fn(async () => ({
      config: DEFAULT_CONFIG,
      path: "/tmp/config.yaml",
      loaded: false,
    }))
    const switchProjectSessionFn = vi.fn(async () => ({
      sessionName: "repo-a",
      projectPath: "/tmp/repo-a",
      category: "default",
    }))

    const exitCode = await runProject(["switch", "/tmp/repo-a"], {
      programName: "vtm",
      stdout: stdout.write,
      stderr: stderr.write,
      tmux: tmux as never,
      loadConfigFn,
      switchProjectSessionFn,
      env: {},
    })

    expect(exitCode).toBe(0)
    expect(switchProjectSessionFn).toHaveBeenCalledWith(
      expect.objectContaining({
        tmux,
        config: DEFAULT_CONFIG,
        inputPath: "/tmp/repo-a",
        env: {},
        homeDirectory: expect.any(String),
        runner: expect.any(Function),
      }),
    )
  })
})
