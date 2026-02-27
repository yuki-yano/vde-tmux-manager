import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { isExecutedAsEntryPoint, runMain } from "./index"

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

describe("runMain", () => {
  it("runs with alias executable names", async () => {
    const stdout = createLineCollector()
    const stderr = createLineCollector()

    const exitCode = await runMain({
      argv: ["node", "/tmp/bin/vtm", "--help"],
      stdout: stdout.write,
      stderr: stderr.write,
    })

    expect(exitCode).toBe(0)
    expect(stdout.lines.join("\n")).toContain("Usage: vtm <command>")
    expect(stderr.lines).toHaveLength(0)
  })

  it("returns exit code 1 for unknown subcommands", async () => {
    const stderr = createLineCollector()

    const exitCode = await runMain({
      argv: ["node", "/tmp/bin/vde-tmux-manager", "unknown"],
      stderr: stderr.write,
    })

    expect(exitCode).toBe(1)
    expect(stderr.lines.join("\n")).toContain("Unknown command: unknown")
  })

  it("returns exit code 1 when an Error is thrown", async () => {
    const stderr = createLineCollector()
    const argv = {
      1: "/tmp/bin/vde-tmux-manager",
      slice: (): never => {
        throw new Error("slice failed")
      },
    } as unknown as readonly string[]

    const exitCode = await runMain({
      argv,
      stderr: stderr.write,
    })

    expect(exitCode).toBe(1)
    expect(stderr.lines.join("\n")).toContain("[UNEXPECTED_ERROR] slice failed")
  })

  it("returns exit code 1 when a non-Error value is thrown", async () => {
    const stderr = createLineCollector()
    const argv = {
      1: "/tmp/bin/vde-tmux-manager",
      slice: (): never => {
        throw "string-error"
      },
    } as unknown as readonly string[]

    const exitCode = await runMain({
      argv,
      stderr: stderr.write,
    })

    expect(exitCode).toBe(1)
    expect(stderr.lines.join("\n")).toContain("[UNEXPECTED_ERROR] string-error")
  })
})

describe("isExecutedAsEntryPoint", () => {
  it("returns false when argv has no script path", () => {
    const modulePath = resolve(process.cwd(), "src/index.ts")
    const moduleUrl = pathToFileURL(modulePath).href

    const result = isExecutedAsEntryPoint({
      moduleUrl,
      argv: ["node"],
    })

    expect(result).toBe(false)
  })

  it("returns true when moduleUrl and argv[1] point to the same file", () => {
    const modulePath = resolve(process.cwd(), "src/index.ts")
    const moduleUrl = pathToFileURL(modulePath).href

    const result = isExecutedAsEntryPoint({
      moduleUrl,
      argv: ["node", modulePath],
    })

    expect(result).toBe(true)
  })
})
