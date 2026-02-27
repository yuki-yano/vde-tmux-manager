import { DEFAULT_CONFIG } from "../../config/defaults"
import { runSessionManager } from "./session-manager"

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

const createLoadConfigFn = (): ReturnType<typeof vi.fn> => {
  return vi.fn(async () => ({
    config: DEFAULT_CONFIG,
    path: "/tmp/config.yaml",
    loaded: false,
  }))
}

const createRunner = (): ReturnType<typeof vi.fn> => {
  return vi.fn(async () => ({
    stdout: "",
    stderr: "",
    exitCode: 0,
  }))
}

const createTmuxForDirectKill = (): {
  readonly listPanes: ReturnType<typeof vi.fn>
  readonly getSinglePane: ReturnType<typeof vi.fn>
  readonly sendCtrlC: ReturnType<typeof vi.fn>
  readonly killWindow: ReturnType<typeof vi.fn>
  readonly killPane: ReturnType<typeof vi.fn>
} => {
  return {
    listPanes: vi.fn(async () => []),
    getSinglePane: vi.fn(async () => []),
    sendCtrlC: vi.fn(async () => undefined),
    killWindow: vi.fn(async () => undefined),
    killPane: vi.fn(async () => undefined),
  } as const
}

describe("runSessionManager", () => {
  it("prints usage with --help", async () => {
    const stdout = createCollector()
    const stderr = createCollector()

    const exitCode = await runSessionManager(["--help"], {
      programName: "vtm",
      stdout: stdout.write,
      stderr: stderr.write,
      loadConfigFn: createLoadConfigFn(),
      tmux: createTmuxForDirectKill() as never,
      runCommandFn: createRunner(),
      env: {},
      argv: ["node", "vtm"],
    })

    expect(exitCode).toBe(0)
    expect(stdout.lines.join("\n")).toContain("Usage: vtm session-manager")
    expect(stderr.lines).toHaveLength(0)
  })

  it("returns usage error when direct kill command target is missing", async () => {
    const stdout = createCollector()
    const stderr = createCollector()

    const exitCode = await runSessionManager(["kill-window"], {
      programName: "vtm",
      stdout: stdout.write,
      stderr: stderr.write,
      loadConfigFn: createLoadConfigFn(),
      tmux: createTmuxForDirectKill() as never,
      runCommandFn: createRunner(),
      env: {},
      argv: ["node", "vtm"],
    })

    expect(exitCode).toBe(2)
    expect(stderr.lines.join("\n")).toContain(
      "Usage: vtm session-manager kill-window <target>",
    )
  })

  it("runs direct kill-window command", async () => {
    const stdout = createCollector()
    const stderr = createCollector()
    const tmux = createTmuxForDirectKill()

    const exitCode = await runSessionManager(["kill-window", "dev:1"], {
      programName: "vtm",
      stdout: stdout.write,
      stderr: stderr.write,
      loadConfigFn: createLoadConfigFn(),
      tmux: tmux as never,
      runCommandFn: createRunner(),
      env: {},
      argv: ["node", "vtm"],
    })

    expect(exitCode).toBe(0)
    expect(tmux.killWindow).toHaveBeenCalledWith("dev:1")
  })

  it("returns usage error for unexpected positional args", async () => {
    const stdout = createCollector()
    const stderr = createCollector()

    const exitCode = await runSessionManager(["unexpected-command"], {
      programName: "vtm",
      stdout: stdout.write,
      stderr: stderr.write,
      loadConfigFn: createLoadConfigFn(),
      tmux: createTmuxForDirectKill() as never,
      runCommandFn: createRunner(),
      env: {},
      argv: ["node", "vtm"],
    })

    expect(exitCode).toBe(2)
    expect(stderr.lines.join("\n")).toContain("Usage: vtm session-manager")
  })

  it("opens popup in tmux client mode", async () => {
    const stdout = createCollector()
    const stderr = createCollector()

    const tmuxRun = vi
      .fn()
      .mockResolvedValueOnce({
        stdout: "/tmp/project",
        stderr: "",
        exitCode: 0,
      })
      .mockResolvedValueOnce({
        stdout: "",
        stderr: "",
        exitCode: 0,
      })

    const tmux = {
      run: tmuxRun,
    } as const

    const exitCode = await runSessionManager([], {
      programName: "vtm",
      stdout: stdout.write,
      stderr: stderr.write,
      loadConfigFn: createLoadConfigFn(),
      tmux: tmux as never,
      runCommandFn: createRunner(),
      env: {
        TMUX: "1",
      },
      argv: ["node", "vtm"],
    })

    expect(exitCode).toBe(0)
    expect(tmuxRun).toHaveBeenNthCalledWith(
      2,
      expect.arrayContaining([
        "display-popup",
        "-E",
        "-w",
        "50%",
        "-h",
        "50%",
        "-d",
        "/tmp/project",
        "vtm",
      ]),
      {
        allowFail: false,
      },
    )
  })
})
