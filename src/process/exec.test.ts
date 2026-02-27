import { CommandExecutionError, commandExists, runCommand } from "./exec"

describe("runCommand", () => {
  it("returns command output on success", async () => {
    const result = await runCommand("sh", ["-lc", "printf ok"])

    expect(result).toEqual({
      stdout: "ok",
      stderr: "",
      exitCode: 0,
    })
  })

  it("throws CommandExecutionError on non-zero exit without allowFail", async () => {
    await expect(
      runCommand("sh", ["-lc", "echo failed 1>&2; exit 1"]),
    ).rejects.toBeInstanceOf(CommandExecutionError)
  })

  it("returns failure output when allowFail is true", async () => {
    const result = await runCommand("sh", ["-lc", "echo failed 1>&2; exit 1"], {
      allowFail: true,
    })

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain("failed")
  })

  it("returns 127 for missing command when allowFail is true", async () => {
    const result = await runCommand("__definitely_missing_command__", [], {
      allowFail: true,
    })

    expect(result.exitCode).toBe(127)
  })
})

describe("commandExists", () => {
  it("returns true when command lookup succeeds", async () => {
    await expect(commandExists("sh")).resolves.toBe(true)
  })

  it("returns false when command lookup fails", async () => {
    await expect(commandExists("__definitely_missing_command__")).resolves.toBe(
      false,
    )
  })
})
