import {
  computePerPaneCaptureLines,
  computeSessionCaptureLines,
} from "./preview"

describe("computeSessionCaptureLines", () => {
  it("derives capture lines from the available preview area", () => {
    expect(computeSessionCaptureLines(20, 3, 15)).toBe(4)
  })

  it("computes capture lines from available preview lines", () => {
    expect(computeSessionCaptureLines(80, 3, 15)).toBe(64)
  })
})

describe("computePerPaneCaptureLines", () => {
  it("returns fallback when preview area is small", () => {
    expect(computePerPaneCaptureLines(20, 4, 16)).toBe(16)
  })

  it("computes per-pane capture lines from available space", () => {
    expect(computePerPaneCaptureLines(120, 3, 16)).toBe(35)
  })
})
