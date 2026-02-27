import { padVisible, stripAnsi, truncateVisible, visibleWidth } from "./format"

describe("format helpers", () => {
  it("strips ANSI escape sequences", () => {
    expect(stripAnsi("\u001b[31mred\u001b[0m")).toBe("red")
  })

  it("calculates visible width", () => {
    expect(visibleWidth("abc")).toBe(3)
  })

  it("truncates text with ellipsis", () => {
    expect(truncateVisible("abcdef", 4)).toBe("abc…")
  })

  it("pads text to requested width", () => {
    expect(padVisible("abc", 5)).toBe("abc  ")
  })
})
