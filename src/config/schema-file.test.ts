import { readFile } from "node:fs/promises"
import { parse } from "yaml"
import { loadConfig } from "./loader"

describe("config schema file", () => {
  it("stays aligned with the loader for categories config", async () => {
    const schemaSource = await readFile("schemas/config.schema.json", "utf8")
    const schema = JSON.parse(schemaSource) as {
      properties?: Record<string, unknown>
    }

    expect(schema.properties).toHaveProperty("sessionManager")
    expect(schema.properties).toHaveProperty("statuslineCategory")
    expect(schema.properties).toHaveProperty("statuslineSessions")
    expect(schema.properties).toHaveProperty("categories")
    expect(schema.properties).toHaveProperty("ghqRoot")

    const yaml = [
      'ghqRoot: "/tmp/ghq"',
      "sessionManager:",
      "  popup:",
      "    enabled: true",
      '    width: "50%"',
      '    height: "50%"',
      "  fzf:",
      '    prompt: "tmux> "',
      '    border: "rounded"',
      '    previewWidth: "65"',
      "    previewRefreshMs: 0",
      "  preview:",
      "    sessionCaptureLines: 15",
      "    paneCaptureLines: 16",
      "  kill:",
      "    sendCtrlC: true",
      "    termWaitMs: 300",
      "    killWaitMs: 300",
      "statuslineCategory:",
      '  format: " {category} "',
      '  prefix: ""',
      '  suffix: ""',
      "  bold: true",
      "  colors:",
      '    fg: "#1C1C1C"',
      '    bg: "#FAB387"',
      '    outerBg: "#352F63"',
      "statuslineSessions:",
      "  showIndex: false",
      "  current:",
      '    format: " {session} "',
      '    prefix: ""',
      '    suffix: ""',
      "    bold: false",
      "    colors:",
      '      fg: "#1E1E2E"',
      '      bg: "#B4BEFE"',
      '      outerBg: "#352F63"',
      "  other:",
      '    format: " {session} "',
      '    prefix: ""',
      '    suffix: ""',
      "    bold: false",
      "    colors:",
      '      fg: "#C6D0F5"',
      '      bg: "#352F63"',
      '      outerBg: "#352F63"',
      "categories:",
      "  defaultCategory: work",
      "  order:",
      "    work: 10",
      "    private: 20",
      "  rules:",
      "    - category: private",
      "      ghqPatterns:",
      "        - github.com/example/*",
      "  sessionNameRules:",
      "    - category: work",
      "      patterns:",
      "        - local-*",
      "",
    ].join("\n")

    const parsedYaml = parse(yaml)
    expect(parsedYaml).toHaveProperty("categories.defaultCategory", "work")

    const result = await loadConfig({
      env: {},
      homeDirectory: "/tmp/home",
      readFileFn: vi.fn(async () => yaml),
    })

    expect(result.config.categories.defaultCategory).toBe("work")
    expect(result.config.ghqRoot).toBe("/tmp/ghq")
    expect(result.config.categories.order).toEqual({
      work: 10,
      private: 20,
    })
    expect(result.config.statuslineCategory.format).toBe(" {category} ")
    expect(result.config.statuslineCategory.prefix).toBe("")
    expect(result.config.statuslineCategory.suffix).toBe("")
    expect(result.config.statuslineCategory.bold).toBe(true)
    expect(result.config.categories.rules[0]?.category).toBe("private")
    expect(result.config.categories.sessionNameRules[0]?.patterns).toEqual([
      "local-*",
    ])
  })
})
