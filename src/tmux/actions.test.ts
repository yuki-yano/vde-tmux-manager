import { DEFAULT_CONFIG } from "../config/defaults"
import {
  killPaneClean,
  killServerClean,
  killSessionClean,
  killWindowClean,
  resolveSessionNameFromSelection,
  switchAwayFromSession,
} from "./actions"

const zeroWaitConfig = {
  ...DEFAULT_CONFIG,
  sessionManager: {
    ...DEFAULT_CONFIG.sessionManager,
    kill: {
      ...DEFAULT_CONFIG.sessionManager.kill,
      termWaitMs: 0,
      killWaitMs: 0,
    },
  },
}

const createRunner = (): ReturnType<typeof vi.fn> => {
  return vi.fn(async (command: string, args: readonly string[]) => {
    if (command === "ps" && args[0] === "-t") {
      return { stdout: "300\n", stderr: "", exitCode: 0 }
    }

    if (command === "ps" && args[0] === "-o" && args[1] === "pgid=") {
      return { stdout: "301\n", stderr: "", exitCode: 0 }
    }

    if (command === "ps" && args[0] === "-o" && args[1] === "pid=") {
      return { stdout: "100\n", stderr: "", exitCode: 0 }
    }

    if (command === "kill") {
      return { stdout: "", stderr: "", exitCode: 0 }
    }

    return { stdout: "", stderr: "", exitCode: 0 }
  })
}

describe("resolveSessionNameFromSelection", () => {
  it("extracts session names from selection rows", () => {
    expect(
      resolveSessionNameFromSelection({ action: "session", name: "dev" }),
    ).toBe("dev")
    expect(
      resolveSessionNameFromSelection({ action: "window", name: "dev:2" }),
    ).toBe("dev")
    expect(
      resolveSessionNameFromSelection({ action: "server", name: "" }),
    ).toBe("")
  })
})

describe("clean kill actions", () => {
  it("kills window with clean process signaling", async () => {
    const tmux = {
      listPanes: vi.fn(async () => [
        { id: "%2", pid: "222", tty: "/dev/ttys002" },
      ]),
      getSinglePane: vi.fn(async () => []),
      sendCtrlC: vi.fn(async () => undefined),
      killWindow: vi.fn(async () => undefined),
    }
    const runner = createRunner()
    const originalPane = process.env.TMUX_PANE
    process.env.TMUX_PANE = "%1"

    await killWindowClean({
      tmux: tmux as never,
      config: zeroWaitConfig,
      target: "dev:1",
      runner: runner as never,
    })

    expect(tmux.sendCtrlC).toHaveBeenCalledWith("%2")
    expect(runner).toHaveBeenCalledWith("kill", ["-TERM", "-300"], {
      allowFail: true,
    })
    expect(runner).toHaveBeenCalledWith("kill", ["-TERM", "-301"], {
      allowFail: true,
    })
    expect(runner).toHaveBeenCalledWith("kill", ["-KILL", "-300"], {
      allowFail: true,
    })
    expect(runner).toHaveBeenCalledWith("kill", ["-KILL", "-301"], {
      allowFail: true,
    })
    expect(tmux.killWindow).toHaveBeenCalledWith("dev:1")

    process.env.TMUX_PANE = originalPane
  })

  it("skips current pane for window clean kill", async () => {
    const tmux = {
      listPanes: vi.fn(async () => [{ id: "%1", pid: "111", tty: "ttys001" }]),
      getSinglePane: vi.fn(async () => []),
      sendCtrlC: vi.fn(async () => undefined),
      killWindow: vi.fn(async () => undefined),
    }
    const runner = createRunner()
    const originalPane = process.env.TMUX_PANE
    process.env.TMUX_PANE = "%1"

    await killWindowClean({
      tmux: tmux as never,
      config: zeroWaitConfig,
      target: "dev:1",
      runner: runner as never,
    })

    expect(tmux.sendCtrlC).not.toHaveBeenCalled()
    expect(tmux.killWindow).toHaveBeenCalledWith("dev:1")

    process.env.TMUX_PANE = originalPane
  })

  it("includes current pane when killing a pane", async () => {
    const tmux = {
      listPanes: vi.fn(async () => []),
      getSinglePane: vi.fn(async () => [
        { id: "%1", pid: "111", tty: "ttys001" },
      ]),
      sendCtrlC: vi.fn(async () => undefined),
      killPane: vi.fn(async () => undefined),
    }
    const runner = createRunner()
    const originalPane = process.env.TMUX_PANE
    process.env.TMUX_PANE = "%1"

    await killPaneClean({
      tmux: tmux as never,
      config: zeroWaitConfig,
      target: "%1",
      runner: runner as never,
    })

    expect(tmux.sendCtrlC).toHaveBeenCalledWith("%1")
    expect(tmux.killPane).toHaveBeenCalledWith("%1")

    process.env.TMUX_PANE = originalPane
  })

  it("kills session and switches away from current", async () => {
    const originalTmux = process.env.TMUX
    process.env.TMUX = "1"

    const tmux = {
      listPanes: vi.fn(async () => []),
      getSinglePane: vi.fn(async () => []),
      sendCtrlC: vi.fn(async () => undefined),
      killSession: vi.fn(async () => undefined),
      currentSession: vi.fn(async () => "dev"),
      listSessions: vi.fn(async () => [
        { name: "dev", attachedClients: 1, lastActivity: 1 },
        { name: "work", attachedClients: 0, lastActivity: 0 },
      ]),
      switchClient: vi.fn(async () => undefined),
    }

    await killSessionClean({
      tmux: tmux as never,
      config: zeroWaitConfig,
      sessionName: "dev",
      runner: createRunner() as never,
    })

    expect(tmux.switchClient).toHaveBeenCalledWith("work")
    expect(tmux.killSession).toHaveBeenCalledWith("dev")

    process.env.TMUX = originalTmux
  })

  it("kills server after killing sessions", async () => {
    const tmux = {
      listPanes: vi.fn(async () => []),
      getSinglePane: vi.fn(async () => []),
      sendCtrlC: vi.fn(async () => undefined),
      killSession: vi.fn(async () => undefined),
      killServer: vi.fn(async () => undefined),
      currentSession: vi.fn(async () => "dev"),
      listSessions: vi.fn(async () => [
        { name: "dev", attachedClients: 1, lastActivity: 1 },
        { name: "work", attachedClients: 0, lastActivity: 0 },
      ]),
      switchClient: vi.fn(async () => undefined),
    }

    await killServerClean({
      tmux: tmux as never,
      config: zeroWaitConfig,
      runner: createRunner() as never,
    })

    expect(tmux.killSession).toHaveBeenCalledWith("work")
    expect(tmux.killSession).toHaveBeenCalledWith("dev")
    expect(tmux.killServer).toHaveBeenCalled()
  })
})

describe("switchAwayFromSession", () => {
  it("does nothing outside tmux", async () => {
    const originalTmux = process.env.TMUX
    delete process.env.TMUX

    const tmux = {
      currentSession: vi.fn(async () => "dev"),
      listSessions: vi.fn(async () => [
        { name: "dev", attachedClients: 1, lastActivity: 1 },
      ]),
      switchClient: vi.fn(async () => undefined),
    }

    await switchAwayFromSession({
      tmux: tmux as never,
      target: "dev",
    })

    expect(tmux.switchClient).not.toHaveBeenCalled()

    process.env.TMUX = originalTmux
  })

  it("does not switch when current session differs", async () => {
    const originalTmux = process.env.TMUX
    process.env.TMUX = "1"

    const tmux = {
      currentSession: vi.fn(async () => "work"),
      listSessions: vi.fn(async () => [
        { name: "dev", attachedClients: 1, lastActivity: 1 },
      ]),
      switchClient: vi.fn(async () => undefined),
    }

    await switchAwayFromSession({
      tmux: tmux as never,
      target: "dev",
    })

    expect(tmux.switchClient).not.toHaveBeenCalled()

    process.env.TMUX = originalTmux
  })
})
