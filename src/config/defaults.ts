import type { ResolvedConfig } from "./schema"

export const DEFAULT_PREVIEW_WIDTH = "65"
export const DEFAULT_PREVIEW_REFRESH_MS = 0
export const DEFAULT_SESSION_CAPTURE_LINES = 15
export const DEFAULT_PANE_CAPTURE_LINES = 16

export const DEFAULT_CONFIG: ResolvedConfig = {
  ghqRoot: null,
  sessionManager: {
    popup: {
      enabled: true,
      width: "50%",
      height: "50%",
    },
    fzf: {
      prompt: "tmux> ",
      border: "rounded",
      previewWidth: DEFAULT_PREVIEW_WIDTH,
      previewRefreshMs: DEFAULT_PREVIEW_REFRESH_MS,
    },
    preview: {
      sessionCaptureLines: DEFAULT_SESSION_CAPTURE_LINES,
      paneCaptureLines: DEFAULT_PANE_CAPTURE_LINES,
    },
    kill: {
      sendCtrlC: true,
      termWaitMs: 300,
      killWaitMs: 300,
    },
  },
  statuslineCategory: {
    format: "{category}",
    prefix: "",
    suffix: "",
    bold: true,
    colors: {
      fg: "#1C1C1C",
      bg: "#FAB387",
      outerBg: "#352F63",
    },
  },
  statuslineSessions: {
    showIndex: false,
    current: {
      format: "{session}",
      prefix: "",
      suffix: "",
      bold: false,
      colors: {
        fg: "#1E1E2E",
        bg: "#B4BEFE",
        outerBg: "#352F63",
      },
    },
    other: {
      format: " {session} ",
      prefix: "",
      suffix: "",
      bold: false,
      colors: {
        fg: "#C6D0F5",
        bg: "#352F63",
        outerBg: "#352F63",
      },
    },
  },
  categories: {
    defaultCategory: "",
    order: {},
    rules: [],
    sessionNameRules: [],
  },
}
