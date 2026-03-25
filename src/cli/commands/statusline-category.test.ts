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
      listSessionDetails: vi.fn(async () => [
        {
          id: "$1",
          name: "repo-a",
          attachedClients: 1,
          lastActivity: 0,
          category: "work",
          projectPath: "/Users/test/ghq/github.com/company/repo-a",
          categoryOverride: "",
        },
      ]),
    }

    const loadConfigFn = vi.fn(async () => ({
      config: {
        ...DEFAULT_CONFIG,
        categories: {
          defaultCategory: "public",
          displayNames: {
            work: "Work",
          },
          order: {},
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
      env: {
        HOME: "/Users/test",
        GHQ_ROOT: "/Users/test/ghq",
      },
    })

    expect(exitCode).toBe(0)
    expect(stdout.lines[0]).toContain("Work")
    expect(stdout.lines[0]).not.toContain("")
    expect(stdout.lines[0]).not.toContain("")
    expect(stdout.lines[0]).toContain(
      `bg=${DEFAULT_CONFIG.statuslineCategory.colors.bg}`,
    )
    expect(stderr.lines).toHaveLength(0)
  })

  it("renders categories horizontally in list mode with inactive colors", () => {
    const output = renderStatuslineCategory({
      currentCategoryName: "work",
      orderedCategories: ["work", "private"],
      statuslineConfig: {
        ...DEFAULT_CONFIG.statuslineCategory,
        mode: "list",
        format: " {category} ",
        colors: {
          fg: "#111111",
          bg: "#aaaaaa",
          outerBg: "#222222",
        },
        inactiveColors: {
          fg: "#333333",
          bg: "#bbbbbb",
          outerBg: "#444444",
        },
      },
      categoriesConfig: {
        ...DEFAULT_CONFIG.categories,
        defaultCategory: "work",
        displayNames: {
          work: "Work",
          private: "Personal",
        },
        order: {
          work: 10,
          private: 20,
        },
      },
    })

    expect(output).toContain("#[range=user|1]")
    expect(output).toContain("#[range=user|2]")
    expect(output).toContain(" Work ")
    expect(output).toContain(" Personal ")
    expect(output).toContain("fg=#111111,bg=#aaaaaa")
    expect(output).toContain("fg=#333333,bg=#bbbbbb")
    expect(output).toContain("#[norange]")
  })

  it("returns empty output for the unnamed default category", async () => {
    expect(
      renderStatuslineCategory({
        currentCategoryName: "",
        orderedCategories: [""],
        statuslineConfig: DEFAULT_CONFIG.statuslineCategory,
        categoriesConfig: DEFAULT_CONFIG.categories,
      }),
    ).toBe("")
  })

  it("returns empty output when the current category has no sessions", () => {
    expect(
      renderStatuslineCategory({
        currentCategoryName: "public",
        orderedCategories: ["work"],
        statuslineConfig: DEFAULT_CONFIG.statuslineCategory,
        categoriesConfig: DEFAULT_CONFIG.categories,
      }),
    ).toBe("")
  })

  it("switches to the category at the given 1-based index", async () => {
    const stdout = createCollector()
    const stderr = createCollector()

    const tmux = {
      currentClientName: vi.fn(async () => "/dev/ttys001"),
      currentSession: vi.fn(async () => "repo-a"),
      showClientOption: vi.fn(async () => ""),
      setClientOption: vi.fn(async () => undefined),
      listSessionDetails: vi.fn(async () => [
        {
          id: "$1",
          name: "repo-a",
          attachedClients: 1,
          lastActivity: 0,
          category: "public",
          projectPath: "/Users/test/ghq/github.com/example/repo-a",
          categoryOverride: "",
        },
        {
          id: "$2",
          name: "repo-b",
          attachedClients: 0,
          lastActivity: 0,
          category: "work",
          projectPath: "/Users/test/ghq/github.com/company/repo-b",
          categoryOverride: "",
        },
      ]),
      switchClient: vi.fn(async () => undefined),
    }

    const loadConfigFn = vi.fn(async () => ({
      config: {
        ...DEFAULT_CONFIG,
        statuslineCategory: {
          ...DEFAULT_CONFIG.statuslineCategory,
          mode: "list" as const,
        },
        categories: {
          defaultCategory: "public",
          displayNames: {},
          order: {
            public: 10,
            work: 20,
          },
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

    const exitCode = await runStatuslineCategory(["switch", "2"], {
      programName: "vtm",
      stdout: stdout.write,
      stderr: stderr.write,
      tmux: tmux as never,
      loadConfigFn,
      env: {
        HOME: "/Users/test",
        GHQ_ROOT: "/Users/test/ghq",
      },
    })

    expect(exitCode).toBe(0)
    expect(tmux.switchClient).toHaveBeenCalledWith("repo-b")
    expect(stdout.lines).toHaveLength(0)
    expect(stderr.lines).toHaveLength(0)
  })
})
