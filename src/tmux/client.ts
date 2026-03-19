import {
  runCommand,
  type RunCommandOptions,
  type RunCommandResult,
} from "../process/exec"
import {
  parsePaneList,
  parseSessionDetailsList,
  parseSessionIdentityList,
  parseSessionList,
  parseWindowList,
  type PaneInfo,
  type SessionDetails,
  type SessionIdentity,
  type SessionMeta,
  type WindowInfo,
} from "./parse"

type Runner = (
  command: string,
  args?: readonly string[],
  options?: RunCommandOptions,
) => Promise<RunCommandResult>

const TMUX_BINARY = "tmux"

export type TmuxClient = {
  run: (
    args: readonly string[],
    options?: RunCommandOptions,
  ) => Promise<RunCommandResult>
  currentSession: () => Promise<string>
  currentClientName: () => Promise<string>
  listSessions: () => Promise<SessionMeta[]>
  listSessionDetails: () => Promise<SessionDetails[]>
  listSessionIdentities: () => Promise<SessionIdentity[]>
  listWindows: (sessionName: string) => Promise<WindowInfo[]>
  listPanes: (target: string, recursive?: boolean) => Promise<PaneInfo[]>
  getSinglePane: (target: string) => Promise<PaneInfo[]>
  capturePaneTail: (target: string, tailLines: number) => Promise<string[]>
  paneCurrentPath: (target: string) => Promise<string>
  showGlobalOption: (name: string) => Promise<string>
  showSessionOption: (target: string, name: string) => Promise<string>
  setSessionOption: (
    target: string,
    name: string,
    value: string,
  ) => Promise<void>
  unsetSessionOption: (target: string, name: string) => Promise<void>
  showClientOption: (target: string, name: string) => Promise<string>
  setClientOption: (
    target: string,
    name: string,
    value: string,
  ) => Promise<void>
  switchClient: (target: string) => Promise<void>
  attachSession: (target: string, inheritStdio?: boolean) => Promise<void>
  selectWindow: (target: string) => Promise<void>
  newSessionDetached: () => Promise<string>
  newSessionDetachedNamed: (target: string, cwd: string) => Promise<void>
  newSessionInteractive: (inheritStdio?: boolean) => Promise<void>
  newSessionInteractiveNamed: (
    target: string,
    cwd: string,
    inheritStdio?: boolean,
  ) => Promise<void>
  renameSession: (target: string, next: string) => Promise<void>
  sendCtrlC: (paneId: string) => Promise<void>
  killSession: (target: string) => Promise<void>
  killWindow: (target: string) => Promise<void>
  killPane: (target: string) => Promise<void>
  killServer: () => Promise<void>
}

export const createTmuxClient = ({
  runner = runCommand,
}: {
  readonly runner?: Runner
} = {}): TmuxClient => {
  const run = async (
    args: readonly string[],
    options: RunCommandOptions = {},
  ): Promise<RunCommandResult> => {
    return runner(TMUX_BINARY, args, options)
  }

  const currentSession = async (): Promise<string> => {
    const result = await run(["display-message", "-p", "#{session_name}"], {
      allowFail: true,
    })
    return result.stdout.trim()
  }

  const currentClientName = async (): Promise<string> => {
    const result = await run(["display-message", "-p", "#{client_name}"], {
      allowFail: true,
    })
    return result.stdout.trim()
  }

  const listSessions = async (): Promise<SessionMeta[]> => {
    const result = await run(
      [
        "list-sessions",
        "-F",
        "#{session_name}\t#{session_attached}\t#{session_activity}",
      ],
      {
        allowFail: true,
      },
    )
    return parseSessionList(result.stdout)
  }

  const listSessionDetails = async (): Promise<SessionDetails[]> => {
    const result = await run(
      [
        "list-sessions",
        "-F",
        "#{session_id}\t#{session_name}\t#{session_attached}\t#{session_activity}\t#{@category}\t#{@project_path}\t#{@category_override}",
      ],
      {
        allowFail: true,
      },
    )
    return parseSessionDetailsList(result.stdout)
  }

  const listSessionIdentities = async (): Promise<SessionIdentity[]> => {
    const result = await run(
      ["list-sessions", "-F", "#{session_id}\t#{session_name}"],
      { allowFail: true },
    )
    return parseSessionIdentityList(result.stdout)
  }

  const listWindows = async (sessionName: string): Promise<WindowInfo[]> => {
    const result = await run(
      [
        "list-windows",
        "-t",
        `${sessionName}:`,
        "-F",
        "#{window_index}\t#{window_panes}\t#{window_active}\t#{window_name}\t#{pane_current_command}",
      ],
      { allowFail: true },
    )
    return parseWindowList(result.stdout)
  }

  const listPanes = async (
    target: string,
    recursive = false,
  ): Promise<PaneInfo[]> => {
    const args = recursive
      ? [
          "list-panes",
          "-s",
          "-t",
          target,
          "-F",
          "#{pane_id}\t#{pane_pid}\t#{pane_tty}",
        ]
      : [
          "list-panes",
          "-t",
          target,
          "-F",
          "#{pane_id}\t#{pane_pid}\t#{pane_tty}",
        ]
    const result = await run(args, { allowFail: true })
    return parsePaneList(result.stdout)
  }

  const getSinglePane = async (target: string): Promise<PaneInfo[]> => {
    const result = await run(
      [
        "display-message",
        "-p",
        "-t",
        target,
        "#{pane_id}\t#{pane_pid}\t#{pane_tty}",
      ],
      {
        allowFail: true,
      },
    )
    return parsePaneList(result.stdout)
  }

  const capturePaneTail = async (
    target: string,
    tailLines: number,
  ): Promise<string[]> => {
    if (tailLines <= 0) {
      return []
    }

    const result = await run(
      ["capture-pane", "-t", target, "-J", "-N", "-e", "-p"],
      {
        allowFail: true,
      },
    )

    const lines = result.stdout.replace(/\r/g, "").split("\n")
    while (lines.length > 0 && (lines.at(-1) ?? "") === "") {
      lines.pop()
    }

    return lines.slice(-tailLines)
  }

  const paneCurrentPath = async (target: string): Promise<string> => {
    const result = await run(
      ["display-message", "-p", "-t", target, "#{pane_current_path}"],
      { allowFail: true },
    )
    return result.stdout.trim()
  }

  const showGlobalOption = async (name: string): Promise<string> => {
    const result = await run(["show-option", "-gqv", `@${name}`], {
      allowFail: true,
    })
    return result.stdout.trim()
  }

  const showSessionOption = async (
    target: string,
    name: string,
  ): Promise<string> => {
    const result = await run(["show-option", "-qv", "-t", target, `@${name}`], {
      allowFail: true,
    })
    return result.stdout.trim()
  }

  const setSessionOption = async (
    target: string,
    name: string,
    value: string,
  ): Promise<void> => {
    await run(["set-option", "-q", "-t", target, `@${name}`, value], {
      allowFail: true,
    })
  }

  const unsetSessionOption = async (
    target: string,
    name: string,
  ): Promise<void> => {
    await run(["set-option", "-qu", "-t", target, `@${name}`], {
      allowFail: true,
    })
  }

  const showClientOption = async (
    target: string,
    name: string,
  ): Promise<string> => {
    const result = await run(["show-option", "-qv", "-t", target, `@${name}`], {
      allowFail: true,
    })
    return result.stdout.trim()
  }

  const setClientOption = async (
    target: string,
    name: string,
    value: string,
  ): Promise<void> => {
    await run(["set-option", "-q", "-t", target, `@${name}`, value], {
      allowFail: true,
    })
  }

  const switchClient = async (target: string): Promise<void> => {
    await run(["switch-client", "-t", target], { allowFail: true })
  }

  const attachSession = async (
    target: string,
    inheritStdio = false,
  ): Promise<void> => {
    await run(["attach", "-t", target], { allowFail: true, inheritStdio })
  }

  const selectWindow = async (target: string): Promise<void> => {
    await run(["select-window", "-t", target], { allowFail: true })
  }

  const newSessionDetached = async (): Promise<string> => {
    const result = await run(
      ["new-session", "-d", "-P", "-F", "#{session_name}"],
      { allowFail: true },
    )
    return result.stdout.trim()
  }

  const newSessionDetachedNamed = async (
    target: string,
    cwd: string,
  ): Promise<void> => {
    await run(["new-session", "-d", "-s", target, "-c", cwd], {
      allowFail: true,
    })
  }

  const newSessionInteractive = async (inheritStdio = false): Promise<void> => {
    await run(["new-session"], { allowFail: true, inheritStdio })
  }

  const newSessionInteractiveNamed = async (
    target: string,
    cwd: string,
    inheritStdio = false,
  ): Promise<void> => {
    await run(["new-session", "-s", target, "-c", cwd], {
      allowFail: true,
      inheritStdio,
    })
  }

  const renameSession = async (target: string, next: string): Promise<void> => {
    await run(["rename-session", "-t", target, next], { allowFail: true })
  }

  const sendCtrlC = async (paneId: string): Promise<void> => {
    await run(["send-keys", "-t", paneId, "C-c"], { allowFail: true })
  }

  const killSession = async (target: string): Promise<void> => {
    await run(["kill-session", "-t", target], { allowFail: true })
  }

  const killWindow = async (target: string): Promise<void> => {
    await run(["kill-window", "-t", target], { allowFail: true })
  }

  const killPane = async (target: string): Promise<void> => {
    await run(["kill-pane", "-t", target], { allowFail: true })
  }

  const killServer = async (): Promise<void> => {
    await run(["kill-server"], { allowFail: true })
  }

  return {
    run,
    currentSession,
    currentClientName,
    listSessions,
    listSessionDetails,
    listSessionIdentities,
    listWindows,
    listPanes,
    getSinglePane,
    capturePaneTail,
    paneCurrentPath,
    showGlobalOption,
    showSessionOption,
    setSessionOption,
    unsetSessionOption,
    showClientOption,
    setClientOption,
    switchClient,
    attachSession,
    selectWindow,
    newSessionDetached,
    newSessionDetachedNamed,
    newSessionInteractive,
    newSessionInteractiveNamed,
    renameSession,
    sendCtrlC,
    killSession,
    killWindow,
    killPane,
    killServer,
  }
}
