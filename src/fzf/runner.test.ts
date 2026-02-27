import { buildPreviewWindowOption, normalizeRefreshMs, runFzf } from "./runner"

describe("normalizeRefreshMs", () => {
  it("normalizes number and string values", () => {
    expect(normalizeRefreshMs(10)).toBe(10)
    expect(normalizeRefreshMs("20")).toBe(20)
    expect(normalizeRefreshMs("-1")).toBe(0)
    expect(normalizeRefreshMs(undefined)).toBe(0)
  })
})

describe("buildPreviewWindowOption", () => {
  it("builds preview window options", () => {
    expect(buildPreviewWindowOption("65")).toBe("right:65%:border-left")
    expect(buildPreviewWindowOption("70%")).toBe("right:70%:border-left")
    expect(buildPreviewWindowOption("bad")).toBe("right:65%:border-left")
  })
})

describe("runFzf", () => {
  const entries = [
    {
      action: "session" as const,
      name: "main",
      display: "main",
    },
  ]

  it("uses fzf-tmux in tmux context when available", async () => {
    const run = vi.fn(async () => ({
      stdout: "enter\nsession\tmain\tmain",
      stderr: "",
      exitCode: 0,
    }))
    const commandExistsFn = vi.fn(async () => true)

    const lines = await runFzf({
      entries,
      prompt: "tmux> ",
      border: "rounded",
      previewWidth: "65",
      previewCommand: "echo preview",
      popupWidth: "50%",
      popupHeight: "50%",
      inTmux: true,
      run,
      commandExistsFn,
    })

    expect(lines).toEqual(["enter", "session\tmain\tmain"])
    expect(commandExistsFn).toHaveBeenCalledWith("fzf-tmux")
    expect(run).toHaveBeenCalledWith(
      "fzf-tmux",
      expect.arrayContaining(["-p", "50%,50%"]),
      expect.objectContaining({
        allowFail: true,
      }),
    )
  })

  it("uses plain fzf when not in tmux", async () => {
    const run = vi.fn(async () => ({
      stdout: "",
      stderr: "",
      exitCode: 130,
    }))

    const lines = await runFzf({
      entries,
      prompt: "tmux> ",
      border: "rounded",
      previewWidth: "65",
      previewCommand: "echo preview",
      popupWidth: "50%",
      popupHeight: "50%",
      inTmux: false,
      run,
      commandExistsFn: vi.fn(async () => false),
    })

    expect(lines).toEqual([])
    expect(run).toHaveBeenCalledWith(
      "fzf",
      expect.arrayContaining(["--ansi", "--expect=enter,ctrl-q,ctrl-t,ctrl-r"]),
      expect.objectContaining({
        allowFail: true,
      }),
    )
  })
})
