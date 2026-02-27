import { createCli, resolveProgramNameFromArgv } from "./index"

type LineCollector = {
  lines: string[]
  write: (line: string) => void
}

const createLineCollector = (): LineCollector => {
  const lines: string[] = []
  return {
    lines,
    write: (line: string): void => {
      lines.push(line)
    },
  }
}

describe("resolveProgramNameFromArgv", () => {
  it("resolves the executable name from argv[1]", () => {
    expect(resolveProgramNameFromArgv(["node", "/tmp/bin/vtm"])).toBe("vtm")
    expect(
      resolveProgramNameFromArgv(["node", "/tmp/bin/vde-tmux-manager"]),
    ).toBe("vde-tmux-manager")
  })

  it("returns default executable name when argv is missing", () => {
    expect(resolveProgramNameFromArgv([])).toBe("vde-tmux-manager")
    expect(resolveProgramNameFromArgv(["node"])).toBe("vde-tmux-manager")
  })
})

describe("createCli", () => {
  it("prints help when no args are provided", async () => {
    const stdout = createLineCollector()
    const stderr = createLineCollector()

    const cli = createCli({
      programName: "vtm",
      version: "0.1.0",
      stdout: stdout.write,
      stderr: stderr.write,
    })

    const exitCode = await cli.run([])

    expect(exitCode).toBe(0)
    expect(stdout.lines.join("\n")).toContain("Usage: vtm <command>")
    expect(stdout.lines.join("\n")).toContain("session-manager")
    expect(stdout.lines.join("\n")).toContain("statusline-sessions")
    expect(stderr.lines).toHaveLength(0)
  })

  it("prints version with --version", async () => {
    const stdout = createLineCollector()

    const cli = createCli({
      version: "0.1.0",
      stdout: stdout.write,
    })

    const exitCode = await cli.run(["--version"])

    expect(exitCode).toBe(0)
    expect(stdout.lines).toEqual(["0.1.0"])
  })

  it("prints help with --help", async () => {
    const stdout = createLineCollector()

    const cli = createCli({
      programName: "vde-tmux-manager",
      version: "0.1.0",
      stdout: stdout.write,
    })

    const exitCode = await cli.run(["--help"])

    expect(exitCode).toBe(0)
    expect(stdout.lines.join("\n")).toContain(
      "Usage: vde-tmux-manager <command>",
    )
  })

  it("shows session-manager help", async () => {
    const stdout = createLineCollector()

    const cli = createCli({
      programName: "vtm",
      stdout: stdout.write,
    })

    const exitCode = await cli.run(["session-manager", "--help"])

    expect(exitCode).toBe(0)
    expect(stdout.lines.join("\n")).toContain("Usage: vtm session-manager")
  })

  it("shows statusline-sessions help", async () => {
    const stdout = createLineCollector()

    const cli = createCli({
      programName: "vtm",
      stdout: stdout.write,
    })

    const exitCode = await cli.run(["statusline-sessions", "--help"])

    expect(exitCode).toBe(0)
    expect(stdout.lines.join("\n")).toContain("Usage: vtm statusline-sessions")
  })

  it("returns an error for an unknown subcommand", async () => {
    const stderr = createLineCollector()

    const cli = createCli({
      stderr: stderr.write,
    })

    const exitCode = await cli.run(["unknown"])

    expect(exitCode).toBe(1)
    expect(stderr.lines.join("\n")).toContain("Unknown command: unknown")
  })

  it("returns usage error for unknown global option", async () => {
    const stderr = createLineCollector()

    const cli = createCli({
      stderr: stderr.write,
    })

    const exitCode = await cli.run(["--bad-option"])

    expect(exitCode).toBe(2)
    expect(stderr.lines.join("\n")).toContain("Unknown option: --bad-option")
  })
})
