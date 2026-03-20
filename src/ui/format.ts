import stringWidth from "string-width"
import type { StatuslineSegmentConfig } from "../config/schema"

const ANSI_PATTERN = new RegExp(String.raw`\u001B\[[0-9;]*m`, "g")
const HAS_ANSI_PATTERN = new RegExp(String.raw`\u001B\[[0-9;]*m`)
const graphemeSegmenter =
  typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null

export const stripAnsi = (text: string): string => {
  return text.replace(ANSI_PATTERN, "")
}

export const visibleWidth = (text: string): number => {
  return stringWidth(stripAnsi(text))
}

const splitGraphemes = (text: string): string[] => {
  if (text.length === 0) {
    return []
  }

  if (graphemeSegmenter === null) {
    return Array.from(text)
  }

  return Array.from(graphemeSegmenter.segment(text), ({ segment }) => segment)
}

const ensureAnsiReset = (text: string): string => {
  if (HAS_ANSI_PATTERN.test(text) && !text.endsWith("\u001b[0m")) {
    return `${text}\u001b[0m`
  }

  return text
}

export const truncateVisible = (text: string, maxWidth: number): string => {
  if (maxWidth <= 0) {
    return ""
  }

  if (visibleWidth(text) <= maxWidth) {
    return text
  }

  if (maxWidth === 1) {
    return "…"
  }

  const targetWidth = maxWidth - 1
  let output = ""
  let currentWidth = 0
  let lastIndex = 0

  for (const match of text.matchAll(ANSI_PATTERN)) {
    const index = match.index ?? 0
    const plainChunk = text.slice(lastIndex, index)

    for (const grapheme of splitGraphemes(plainChunk)) {
      const width = stringWidth(grapheme)
      if (currentWidth + width > targetWidth) {
        return ensureAnsiReset(`${output}…`)
      }
      output += grapheme
      currentWidth += width
    }

    output += match[0]
    lastIndex = index + match[0].length
  }

  const remainder = text.slice(lastIndex)
  for (const grapheme of splitGraphemes(remainder)) {
    const width = stringWidth(grapheme)
    if (currentWidth + width > targetWidth) {
      return ensureAnsiReset(`${output}…`)
    }
    output += grapheme
    currentWidth += width
  }

  return ensureAnsiReset(`${output}…`)
}

export const padVisible = (text: string, width: number): string => {
  const current = visibleWidth(text)
  if (current >= width) {
    return truncateVisible(text, width)
  }
  return text + " ".repeat(width - current)
}

export const renderTmuxStatuslineSegment = ({
  content,
  config,
}: {
  readonly content: string
  readonly config: StatuslineSegmentConfig
}): string => {
  if (content.length === 0) {
    return ""
  }

  const weight = config.bold ? "bold" : "nobold"
  let output = ""

  if (config.prefix.length > 0) {
    output += `#[fg=${config.colors.bg},bg=${config.colors.outerBg},nobold]${config.prefix}`
  }
  output += `#[fg=${config.colors.fg},bg=${config.colors.bg},${weight}]${content}`
  if (config.suffix.length > 0) {
    output += `#[fg=${config.colors.bg},bg=${config.colors.outerBg},nobold]${config.suffix}`
  }
  output += "#[default]"

  return output
}
