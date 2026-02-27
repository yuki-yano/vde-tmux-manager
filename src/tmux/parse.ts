export type SessionMeta = {
  readonly name: string
  readonly attachedClients: number
  readonly lastActivity: number
}

export type SessionIdentity = {
  readonly id: string
  readonly name: string
}

export type WindowInfo = {
  readonly index: string
  readonly panes: number
  readonly active: boolean
  readonly name: string
  readonly command: string
}

export type PaneInfo = {
  readonly id: string
  readonly pid: string
  readonly tty: string
}

export const parseIntSafe = (
  value: string | undefined,
  fallback = 0,
): number => {
  const parsed = Number.parseInt(value ?? "", 10)
  if (Number.isFinite(parsed)) {
    return parsed
  }
  return fallback
}

export const splitNonEmptyLines = (output: string): string[] => {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

export const splitWindowTarget = (
  target: string,
): { sessionName: string; windowIndex: string } | null => {
  const separatorIndex = target.lastIndexOf(":")
  if (separatorIndex <= 0 || separatorIndex >= target.length - 1) {
    return null
  }

  return {
    sessionName: target.slice(0, separatorIndex),
    windowIndex: target.slice(separatorIndex + 1),
  }
}

export const parseSessionList = (output: string): SessionMeta[] => {
  return splitNonEmptyLines(output)
    .map((line) => {
      const [name, attached, activity] = line.split("\t")
      return {
        name: (name ?? "").trim(),
        attachedClients: parseIntSafe(attached, 0),
        lastActivity: parseIntSafe(activity, 0),
      }
    })
    .filter((row) => row.name.length > 0)
}

export const parseSessionIdentityList = (output: string): SessionIdentity[] => {
  return splitNonEmptyLines(output)
    .map((line) => {
      const [id, name] = line.split("\t")
      return {
        id: (id ?? "").trim(),
        name: (name ?? "").trim(),
      }
    })
    .filter((row) => row.id.length > 0 && row.name.length > 0)
}

export const parseWindowList = (output: string): WindowInfo[] => {
  return splitNonEmptyLines(output)
    .map((line) => {
      const [index, panes, active, name, command] = line.split("\t")
      return {
        index: (index ?? "").trim(),
        panes: parseIntSafe(panes, 0),
        active: active === "1",
        name: (name ?? "").trim() || "(unnamed)",
        command: (command ?? "").trim(),
      }
    })
    .filter((window) => window.index.length > 0)
}

export const parsePaneList = (output: string): PaneInfo[] => {
  return splitNonEmptyLines(output)
    .map((line) => {
      const [id, pid, tty] = line.split("\t")
      return {
        id: (id ?? "").trim(),
        pid: (pid ?? "").trim(),
        tty: (tty ?? "").trim(),
      }
    })
    .filter((pane) => pane.id.length > 0)
}
