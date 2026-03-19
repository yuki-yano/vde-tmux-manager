import { DEFAULT_CONFIG } from "../../config/defaults"
import {
  renderStatuslineCategory,
  runStatuslineCategory,
} from "./statusline-category"

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

describe("runStatuslineCategory", () => {
  it("renders the current category as a tmux segment", async () => {
    const stdout = createCollector()
    const stderr = createCollector()

    const tmux = {
      currentClientName: vi.fn(async () => "/dev/ttys001"),
      showClientOption: vi.fn(async () => "work"),
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

    const exitCode = await runStatuslineCategory([], {
      programName: "vtm",
      stdout: stdout.write,
      stderr: stderr.write,
      tmux: tmux as never,
      loadConfigFn,
    })

    expect(exitCode).toBe(0)
    expect(stdout.lines[0]).toContain("[work]")
    expect(stdout.lines[0]).toContain(
      `bg=${DEFAULT_CONFIG.statuslineSessions.colors.baseBg}`,
    )
    expect(stderr.lines).toHaveLength(0)
  })

  it("returns empty output for the unnamed default category", async () => {
    expect(
      renderStatuslineCategory({
        categoryName: "",
        config: DEFAULT_CONFIG.statuslineCategory,
      }),
    ).toBe("")
  })
})
