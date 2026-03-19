import { DEFAULT_CONFIG } from "../../config/defaults"
import { runSession } from "./session"

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

describe("runSession", () => {
  it("sets a category override on a session", async () => {
    const stdout = createCollector()
    const stderr = createCollector()
    const tmux = {
      setSessionOption: vi.fn(async () => undefined),
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

    const exitCode = await runSession(["set-category", "repo-a", "work"], {
      programName: "vtm",
      stdout: stdout.write,
      stderr: stderr.write,
      tmux: tmux as never,
      loadConfigFn,
    })

    expect(exitCode).toBe(0)
    expect(tmux.setSessionOption).toHaveBeenNthCalledWith(
      1,
      "repo-a",
      "category_override",
      "work",
    )
  })
})
