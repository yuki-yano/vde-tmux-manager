import { DEFAULT_CONFIG } from "../config/defaults"
import { renderPreviewOnce } from "./preview"

describe("renderPreviewOnce", () => {
  it("renders server preview", async () => {
    const output = await renderPreviewOnce({
      tmux: {} as never,
      config: DEFAULT_CONFIG,
      action: "server",
      name: "",
      env: {},
    })

    expect(output).toContain("tmux server")
    expect(output).toContain("tmux kill-server")
  })

  it("renders session not found message", async () => {
    const tmux = {
      listSessions: vi.fn(async () => []),
      listWindows: vi.fn(async () => []),
      capturePaneTail: vi.fn(async () => []),
    }

    const output = await renderPreviewOnce({
      tmux: tmux as never,
      config: DEFAULT_CONFIG,
      action: "session",
      name: "missing",
      env: {},
    })

    expect(output).toContain("Session not found")
  })

  it("renders session preview with windows and pane tail", async () => {
    const tmux = {
      listSessions: vi.fn(async () => [
        { name: "dev", attachedClients: 1, lastActivity: 100 },
      ]),
      listWindows: vi.fn(async () => [
        {
          index: "0",
          panes: 2,
          active: true,
          name: "editor",
          command: "zsh",
        },
      ]),
      capturePaneTail: vi.fn(async () => ["line1", "line2"]),
    }

    const output = await renderPreviewOnce({
      tmux: tmux as never,
      config: DEFAULT_CONFIG,
      action: "session",
      name: "dev",
      env: {
        FZF_PREVIEW_LINES: "70",
        FZF_PREVIEW_COLUMNS: "80",
      },
    })

    expect(output).toContain("Session dev")
    expect(output).toContain("Windows")
    expect(output).toContain("line1")
  })

  it("renders invalid window target message", async () => {
    const output = await renderPreviewOnce({
      tmux: {} as never,
      config: DEFAULT_CONFIG,
      action: "window",
      name: "invalid",
      env: {},
    })

    expect(output).toContain("Invalid window target")
  })

  it("renders window not found message", async () => {
    const tmux = {
      listWindows: vi.fn(async () => []),
      run: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
      capturePaneTail: vi.fn(async () => []),
    }

    const output = await renderPreviewOnce({
      tmux: tmux as never,
      config: DEFAULT_CONFIG,
      action: "window",
      name: "dev:1",
      env: {},
    })

    expect(output).toContain("Window not found")
  })

  it("renders window preview with pane previews", async () => {
    const tmux = {
      listWindows: vi.fn(async () => [
        {
          index: "1",
          panes: 2,
          active: true,
          name: "logs",
          command: "bash",
        },
      ]),
      run: vi.fn(async () => ({
        stdout: "0\tbash\t100\t40\t1\n1\tvim\t100\t40\t0\n",
        stderr: "",
        exitCode: 0,
      })),
      capturePaneTail: vi.fn(async () => ["tail"]),
    }

    const output = await renderPreviewOnce({
      tmux: tmux as never,
      config: DEFAULT_CONFIG,
      action: "window",
      name: "dev:1",
      env: {
        FZF_PREVIEW_LINES: "120",
      },
    })

    expect(output).toContain("Window dev:1")
    expect(output).toContain("Pane Preview")
    expect(output).toContain("Pane 0")
    expect(output).toContain("tail")
  })

  it("returns fallback text for unknown actions", async () => {
    const output = await renderPreviewOnce({
      tmux: {} as never,
      config: DEFAULT_CONFIG,
      action: "other",
      name: "",
      env: {},
    })

    expect(output).toContain("Preview not available")
  })
})
