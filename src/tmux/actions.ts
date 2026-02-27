import type { ResolvedConfig } from "../config/schema"
import { runCommand } from "../process/exec"
import type { TmuxClient } from "./client"
import { splitWindowTarget, type PaneInfo } from "./parse"

const sleep = async (ms: number): Promise<void> => {
  if (ms <= 0) {
    return
  }
  await new Promise<void>((resolve) => {
    setTimeout(() => resolve(), ms)
  })
}

const addPgidsFromOutput = (output: string, pgids: Set<string>): void => {
  for (const token of output.split(/\s+/)) {
    if (/^\d+$/.test(token)) {
      pgids.add(token)
    }
  }
}

const normalizePaneTty = (tty: string): string => {
  const normalized = tty.trim()
  if (normalized.length === 0 || normalized === "?" || normalized === "-") {
    return ""
  }

  if (normalized.startsWith("/dev/")) {
    return normalized.slice("/dev/".length)
  }

  return normalized
}

const collectPanePgids = async ({
  pane,
  runner,
}: {
  readonly pane: PaneInfo
  readonly runner: typeof runCommand
}): Promise<Set<string>> => {
  const pgids = new Set<string>()
  const tty = normalizePaneTty(pane.tty)

  if (tty.length > 0) {
    const ttyResult = await runner("ps", ["-t", tty, "-o", "pgid="], {
      allowFail: true,
    })
    addPgidsFromOutput(ttyResult.stdout, pgids)
  }

  if (/^\d+$/.test(pane.pid)) {
    const pidResult = await runner("ps", ["-o", "pgid=", "-p", pane.pid], {
      allowFail: true,
    })
    addPgidsFromOutput(pidResult.stdout, pgids)
  }

  return pgids
}

type CleanKillOptions = {
  readonly tmux: TmuxClient
  readonly target: string
  readonly recursive: boolean
  readonly killConfig: ResolvedConfig["sessionManager"]["kill"]
  readonly runner?: typeof runCommand
  readonly singlePane?: boolean
  readonly includeCurrentPane?: boolean
  readonly finalize: () => Promise<void>
}

const cleanKillTarget = async ({
  tmux,
  target,
  recursive,
  killConfig,
  runner = runCommand,
  singlePane = false,
  includeCurrentPane = false,
  finalize,
}: CleanKillOptions): Promise<void> => {
  const panes = singlePane
    ? await tmux.getSinglePane(target)
    : await tmux.listPanes(target, recursive)
  if (panes.length === 0) {
    await finalize()
    return
  }

  const currentPane = process.env.TMUX_PANE ?? ""
  const panesToSignal = includeCurrentPane
    ? panes
    : panes.filter((pane) => pane.id !== currentPane)

  if (killConfig.sendCtrlC && panesToSignal.length > 0) {
    await Promise.all(
      panesToSignal.map(async (pane) => tmux.sendCtrlC(pane.id)),
    )
  }

  if (panesToSignal.length > 0) {
    await sleep(killConfig.termWaitMs)
  }

  const pgids = new Set<string>()
  for (const pane of panesToSignal) {
    const panePgids = await collectPanePgids({ pane, runner })
    for (const pgid of panePgids) {
      pgids.add(pgid)
    }
  }

  if (pgids.size > 0) {
    await Promise.all(
      Array.from(pgids).map(async (pgid) => {
        await runner("kill", ["-TERM", `-${pgid}`], { allowFail: true })
      }),
    )
    await sleep(killConfig.termWaitMs)
  }

  if (pgids.size > 0) {
    await Promise.all(
      Array.from(pgids).map(async (pgid) => {
        const check = await runner("ps", ["-o", "pid=", "-g", pgid], {
          allowFail: true,
        })
        if (check.stdout.trim().length > 0) {
          await runner("kill", ["-KILL", `-${pgid}`], { allowFail: true })
        }
      }),
    )

    await sleep(killConfig.killWaitMs)
  }

  await finalize()
}

export const switchAwayFromSession = async ({
  tmux,
  target,
}: {
  readonly tmux: TmuxClient
  readonly target: string
}): Promise<void> => {
  if (typeof process.env.TMUX !== "string" || process.env.TMUX.length === 0) {
    return
  }

  const current = await tmux.currentSession()
  if (current !== target) {
    return
  }

  const sessions = await tmux.listSessions()
  if (sessions.length <= 1) {
    return
  }

  const names = sessions.map((session) => session.name)
  const currentIndex = names.findIndex((name) => name === target)
  const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % names.length
  const next = names[nextIndex]
  if (typeof next === "string" && next !== target) {
    await tmux.switchClient(next)
  }
}

export const killSessionClean = async ({
  tmux,
  config,
  sessionName,
  runner,
}: {
  readonly tmux: TmuxClient
  readonly config: ResolvedConfig
  readonly sessionName: string
  readonly runner?: typeof runCommand
}): Promise<void> => {
  await switchAwayFromSession({ tmux, target: sessionName })

  await cleanKillTarget({
    tmux,
    target: `${sessionName}:`,
    recursive: true,
    killConfig: config.sessionManager.kill,
    runner,
    finalize: async (): Promise<void> => {
      await tmux.killSession(sessionName)
    },
  })
}

export const killWindowClean = async ({
  tmux,
  config,
  target,
  runner,
}: {
  readonly tmux: TmuxClient
  readonly config: ResolvedConfig
  readonly target: string
  readonly runner?: typeof runCommand
}): Promise<void> => {
  await cleanKillTarget({
    tmux,
    target,
    recursive: false,
    killConfig: config.sessionManager.kill,
    runner,
    finalize: async (): Promise<void> => {
      await tmux.killWindow(target)
    },
  })
}

export const killPaneClean = async ({
  tmux,
  config,
  target,
  runner,
}: {
  readonly tmux: TmuxClient
  readonly config: ResolvedConfig
  readonly target: string
  readonly runner?: typeof runCommand
}): Promise<void> => {
  await cleanKillTarget({
    tmux,
    target,
    recursive: false,
    singlePane: true,
    includeCurrentPane: true,
    killConfig: config.sessionManager.kill,
    runner,
    finalize: async (): Promise<void> => {
      await tmux.killPane(target)
    },
  })
}

export const killServerClean = async ({
  tmux,
  config,
  runner,
}: {
  readonly tmux: TmuxClient
  readonly config: ResolvedConfig
  readonly runner?: typeof runCommand
}): Promise<void> => {
  const sessions = await tmux.listSessions()
  const current = await tmux.currentSession()

  for (const session of sessions) {
    if (session.name !== current) {
      await killSessionClean({
        tmux,
        config,
        sessionName: session.name,
        runner,
      })
    }
  }

  if (current.length > 0) {
    await killSessionClean({ tmux, config, sessionName: current, runner })
  }

  await tmux.killServer()
}

export const resolveSessionNameFromSelection = ({
  action,
  name,
}: {
  readonly action: "session" | "window" | "server"
  readonly name: string
}): string => {
  if (action === "session") {
    return name
  }

  if (action === "window") {
    return splitWindowTarget(name)?.sessionName ?? ""
  }

  return ""
}
