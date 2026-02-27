import { createTmuxClient } from "./client"

describe("createTmuxClient", () => {
  it("parses list outputs", async () => {
    const runner = vi.fn(async (_command: string, args: readonly string[]) => {
      if (args[0] === "display-message" && args[2] === "#{session_name}") {
        return { stdout: "dev\n", stderr: "", exitCode: 0 }
      }

      if (
        args[0] === "list-sessions" &&
        args[2] === "#{session_name}\t#{session_attached}\t#{session_activity}"
      ) {
        return { stdout: "dev\t1\t100\nwork\t0\t50\n", stderr: "", exitCode: 0 }
      }

      if (
        args[0] === "list-sessions" &&
        args[2] === "#{session_id}\t#{session_name}"
      ) {
        return { stdout: "$1\tdev\n$2\twork\n", stderr: "", exitCode: 0 }
      }

      if (args[0] === "list-windows") {
        return {
          stdout: "0\t2\t1\teditor\tzsh\n1\t1\t0\tlogs\tbash\n",
          stderr: "",
          exitCode: 0,
        }
      }

      if (args[0] === "list-panes" && args[1] === "-s") {
        return {
          stdout: "%1\t100\tttys001\n%2\t200\tttys002\n",
          stderr: "",
          exitCode: 0,
        }
      }

      if (args[0] === "list-panes") {
        return {
          stdout: "%3\t300\tttys003\n",
          stderr: "",
          exitCode: 0,
        }
      }

      if (args[0] === "capture-pane") {
        return {
          stdout: "line1\nline2\nline3\n",
          stderr: "",
          exitCode: 0,
        }
      }

      if (args[0] === "show-option") {
        return {
          stdout: "value\n",
          stderr: "",
          exitCode: 0,
        }
      }

      if (
        args[0] === "display-message" &&
        args.includes("#{pane_current_path}")
      ) {
        return {
          stdout: "/tmp/project\n",
          stderr: "",
          exitCode: 0,
        }
      }

      if (args[0] === "new-session" && args.includes("-P")) {
        return {
          stdout: "created\n",
          stderr: "",
          exitCode: 0,
        }
      }

      if (
        args[0] === "display-message" &&
        args.includes("#{pane_id}\t#{pane_pid}\t#{pane_tty}")
      ) {
        return {
          stdout: "%9\t900\tttys009\n",
          stderr: "",
          exitCode: 0,
        }
      }

      return {
        stdout: "",
        stderr: "",
        exitCode: 0,
      }
    })

    const tmux = createTmuxClient({ runner: runner as never })

    await expect(tmux.currentSession()).resolves.toBe("dev")
    await expect(tmux.listSessions()).resolves.toHaveLength(2)
    await expect(tmux.listSessionIdentities()).resolves.toEqual([
      { id: "$1", name: "dev" },
      { id: "$2", name: "work" },
    ])
    await expect(tmux.listWindows("dev")).resolves.toHaveLength(2)
    await expect(tmux.listPanes("dev:", true)).resolves.toHaveLength(2)
    await expect(tmux.listPanes("dev:0", false)).resolves.toHaveLength(1)
    await expect(tmux.getSinglePane("%9")).resolves.toEqual([
      { id: "%9", pid: "900", tty: "ttys009" },
    ])
    await expect(tmux.capturePaneTail("dev:0.0", 2)).resolves.toEqual([
      "line2",
      "line3",
    ])
    await expect(tmux.capturePaneTail("dev:0.0", 0)).resolves.toEqual([])
    await expect(tmux.paneCurrentPath("dev:0.0")).resolves.toBe("/tmp/project")
    await expect(tmux.showGlobalOption("test")).resolves.toBe("value")
    await expect(tmux.newSessionDetached()).resolves.toBe("created")
  })

  it("executes operational commands", async () => {
    const runner = vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 }))
    const tmux = createTmuxClient({ runner: runner as never })

    await tmux.switchClient("dev")
    await tmux.attachSession("dev")
    await tmux.attachSession("dev", true)
    await tmux.selectWindow("dev:0")
    await tmux.newSessionInteractive()
    await tmux.newSessionInteractive(true)
    await tmux.renameSession("dev", "next")
    await tmux.sendCtrlC("%1")
    await tmux.killSession("dev")
    await tmux.killWindow("dev:1")
    await tmux.killPane("%1")
    await tmux.killServer()

    expect(runner).toHaveBeenCalledWith(
      "tmux",
      ["switch-client", "-t", "dev"],
      { allowFail: true },
    )
    expect(runner).toHaveBeenCalledWith("tmux", ["attach", "-t", "dev"], {
      allowFail: true,
      inheritStdio: true,
    })
    expect(runner).toHaveBeenCalledWith("tmux", ["kill-server"], {
      allowFail: true,
    })
  })
})
