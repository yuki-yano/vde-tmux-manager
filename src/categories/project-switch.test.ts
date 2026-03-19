import { mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { mkdtemp } from "node:fs/promises"
import { DEFAULT_CONFIG } from "../config/defaults"
import { switchProjectSession } from "./project-switch"

const createRunner = ({
  ghqRoot,
  gitRoot,
}: {
  readonly ghqRoot: string
  readonly gitRoot: string
}): ReturnType<typeof vi.fn> => {
  return vi.fn(async (command: string, args: readonly string[]) => {
    if (command === "ghq" && args[0] === "root") {
      return {
        stdout: `${ghqRoot}\n`,
        stderr: "",
        exitCode: 0,
      }
    }

    if (
      command === "git" &&
      args[0] === "-C" &&
      args[2] === "rev-parse" &&
      args[3] === "--show-toplevel"
    ) {
      return {
        stdout: `${gitRoot}\n`,
        stderr: "",
        exitCode: 0,
      }
    }

    return {
      stdout: "",
      stderr: "",
      exitCode: 1,
    }
  })
}

describe("switchProjectSession", () => {
  it("creates or reuses a session and writes project/category metadata", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "vtm-project-switch-"))
    const ghqRoot = join(tempRoot, "ghq")
    const repoPath = join(ghqRoot, "github.com", "company", "repo-a")
    await mkdir(repoPath, { recursive: true })
    await writeFile(join(repoPath, ".git"), "", "utf8")

    const tmux = {
      listSessionDetails: vi.fn(async () => []),
      currentClientName: vi.fn(async () => "/dev/ttys001"),
      showClientOption: vi.fn(async (_target: string, option: string) => {
        if (option === "category_last_sessions") {
          return ""
        }
        return "public"
      }),
      setClientOption: vi.fn(async () => undefined),
      newSessionDetachedNamed: vi.fn(async () => undefined),
      setSessionOption: vi.fn(async () => undefined),
      switchClient: vi.fn(async () => undefined),
      newSessionInteractiveNamed: vi.fn(async () => undefined),
    }

    const result = await switchProjectSession({
      tmux: tmux as never,
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
      inputPath: repoPath,
      env: { TMUX: "1", HOME: tempRoot, GHQ_ROOT: ghqRoot },
      homeDirectory: tempRoot,
      runner: createRunner({ ghqRoot, gitRoot: repoPath }) as never,
    })

    expect(result.sessionName).toBe("repo-a")
    expect(result.projectPath).toBe(repoPath)
    expect(result.category).toBe("work")
    expect(tmux.newSessionDetachedNamed).toHaveBeenCalledWith(
      "repo-a",
      repoPath,
    )
    expect(tmux.setSessionOption).toHaveBeenCalledWith(
      "repo-a",
      "project_path",
      repoPath,
    )
    expect(tmux.setSessionOption).toHaveBeenCalledWith(
      "repo-a",
      "category",
      "work",
    )
    expect(tmux.switchClient).toHaveBeenCalledWith("repo-a")
    expect(tmux.setClientOption).toHaveBeenCalledWith(
      "/dev/ttys001",
      "current_category",
      "work",
    )
    expect(tmux.setClientOption).toHaveBeenCalledWith(
      "/dev/ttys001",
      "category_last_sessions",
      JSON.stringify({
        work: "repo-a",
      }),
    )
  })

  it("supports non-ghq paths such as /tmp", async () => {
    const repoPath = await mkdtemp("/tmp/vtm-private-repo-")

    const tmux = {
      listSessionDetails: vi.fn(async () => []),
      newSessionInteractiveNamed: vi.fn(async () => undefined),
      setSessionOption: vi.fn(async () => undefined),
    }

    const result = await switchProjectSession({
      tmux: tmux as never,
      config: {
        ...DEFAULT_CONFIG,
        categories: {
          defaultCategory: "public",
          rules: [
            {
              category: "private",
              ghqPatterns: [],
              pathPatterns: ["/tmp/**"],
            },
          ],
          sessionNameRules: [],
        },
      },
      inputPath: repoPath,
      env: { HOME: repoPath },
      homeDirectory: repoPath,
      runner: vi.fn(async () => ({
        stdout: "",
        stderr: "",
        exitCode: 1,
      })) as never,
    })

    expect(result.category).toBe("private")
    expect(tmux.newSessionInteractiveNamed).toHaveBeenCalledWith(
      result.sessionName,
      repoPath,
      true,
    )
    expect(tmux.setSessionOption).toHaveBeenCalledWith(
      result.sessionName,
      "project_path",
      repoPath,
    )
  })
})
