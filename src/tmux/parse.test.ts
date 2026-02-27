import {
  parsePaneList,
  parseSessionIdentityList,
  parseSessionList,
  parseWindowList,
  splitWindowTarget,
} from "./parse"

describe("splitWindowTarget", () => {
  it("parses session and window index", () => {
    expect(splitWindowTarget("dev:2")).toEqual({
      sessionName: "dev",
      windowIndex: "2",
    })
  })

  it("returns null for invalid target", () => {
    expect(splitWindowTarget("dev")).toBeNull()
  })
})

describe("parseSessionList", () => {
  it("parses session rows", () => {
    const output = "dev\t1\t100\nwork\t0\t200\n"
    expect(parseSessionList(output)).toEqual([
      {
        name: "dev",
        attachedClients: 1,
        lastActivity: 100,
      },
      {
        name: "work",
        attachedClients: 0,
        lastActivity: 200,
      },
    ])
  })
})

describe("parseSessionIdentityList", () => {
  it("parses session identities", () => {
    const output = "$1\tdev\n$2\twork\n"
    expect(parseSessionIdentityList(output)).toEqual([
      { id: "$1", name: "dev" },
      { id: "$2", name: "work" },
    ])
  })
})

describe("parseWindowList", () => {
  it("parses windows", () => {
    const output = "0\t2\t1\teditor\tzsh\n1\t1\t0\tlogs\tbash\n"
    expect(parseWindowList(output)).toEqual([
      {
        index: "0",
        panes: 2,
        active: true,
        name: "editor",
        command: "zsh",
      },
      {
        index: "1",
        panes: 1,
        active: false,
        name: "logs",
        command: "bash",
      },
    ])
  })
})

describe("parsePaneList", () => {
  it("parses pane metadata", () => {
    const output = "%1\t100\tttys001\n%2\t200\tttys002\n"
    expect(parsePaneList(output)).toEqual([
      { id: "%1", pid: "100", tty: "ttys001" },
      { id: "%2", pid: "200", tty: "ttys002" },
    ])
  })
})
