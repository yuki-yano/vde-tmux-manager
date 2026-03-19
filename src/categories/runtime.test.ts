import { resolveGhqRoot } from "./runtime"

describe("resolveGhqRoot", () => {
  it("prefers config.ghqRoot over env and ghq command", async () => {
    const runner = vi.fn(async () => ({
      stdout: "/tmp/from-runner\n",
      stderr: "",
      exitCode: 0,
    }))

    const result = await resolveGhqRoot({
      config: {
        ghqRoot: "/tmp/from-config",
      },
      env: {
        GHQ_ROOT: "/tmp/from-env",
      },
      runner,
    })

    expect(result).toBe("/tmp/from-config")
    expect(runner).not.toHaveBeenCalled()
  })

  it("expands ~ in config.ghqRoot using HOME", async () => {
    const runner = vi.fn(async () => ({
      stdout: "/tmp/from-runner\n",
      stderr: "",
      exitCode: 0,
    }))

    const result = await resolveGhqRoot({
      config: {
        ghqRoot: "~/repos",
      },
      env: {
        HOME: "/Users/test",
      },
      runner,
    })

    expect(result).toBe("/Users/test/repos")
    expect(runner).not.toHaveBeenCalled()
  })

  it("uses GHQ_ROOT when config.ghqRoot is unset", async () => {
    const runner = vi.fn(async () => ({
      stdout: "/tmp/from-runner\n",
      stderr: "",
      exitCode: 0,
    }))

    const result = await resolveGhqRoot({
      config: {
        ghqRoot: null,
      },
      env: {
        GHQ_ROOT: "/tmp/from-env",
      },
      runner,
    })

    expect(result).toBe("/tmp/from-env")
    expect(runner).not.toHaveBeenCalled()
  })

  it("expands ~ in GHQ_ROOT using HOME", async () => {
    const runner = vi.fn(async () => ({
      stdout: "/tmp/from-runner\n",
      stderr: "",
      exitCode: 0,
    }))

    const result = await resolveGhqRoot({
      config: {
        ghqRoot: null,
      },
      env: {
        GHQ_ROOT: "~/repos",
        HOME: "/Users/test",
      },
      runner,
    })

    expect(result).toBe("/Users/test/repos")
    expect(runner).not.toHaveBeenCalled()
  })
})
