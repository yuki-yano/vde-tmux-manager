import type { ResolvedConfig } from "./schema"

export const DEFAULT_PREVIEW_WIDTH = "65"
export const DEFAULT_PREVIEW_REFRESH_MS = 0
export const DEFAULT_SESSION_CAPTURE_LINES = 15
export const DEFAULT_PANE_CAPTURE_LINES = 16

export const DEFAULT_CONFIG: ResolvedConfig = {
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
    format: "[{category}]",
    colors: {
      fg: "#A5A1F2",
      bg: "#352F63",
    },
  },
  statuslineSessions: {
    showIndex: false,
    colors: {
      baseFg: "#A5A1F2",
      baseBg: "#352F63",
      currentFg: "#1E1E2E",
      currentBg: "#B4BEFE",
      otherFg: "#C6D0F5",
    },
    fonts: {
      currentPrefix: "\ue0b6",
      currentSuffix: "\ue0b4",
      otherPrefix: "",
      otherSuffix: "",
    },
  },
  categories: {
    defaultCategory: "",
    rules: [],
    sessionNameRules: [],
  },
}
