import { describe, expect, it } from "vitest";
import {
  childFolders,
  folderName,
  matchingFolders,
  parentScope,
  scopeTyped,
} from "./picker.ts";

const note = (name: string, modified: number) => ({ name, modified });
const NOTES = [
  note("inbox.md", 100),
  note("cos/README.md", 50),
  note("cos/charter.md", 80),
  note("cos/desks/README.md", 30),
  note("desks/parker.md", 90),
  note("desks/itau.md", 20),
  note("archive/changelog/2026-09.md", 10),
];
// The walk knows a folder no note is in yet.
const FOLDERS = ["archive", "archive/changelog", "cos", "cos/desks", "desks", "empty"];

describe("scopes", () => {
  it("name a folder and step out of it", () => {
    expect(folderName("cos/desks/")).toBe("desks");
    expect(folderName("desks/")).toBe("desks");
    expect(parentScope("cos/desks/")).toBe("cos/");
    expect(parentScope("cos/")).toBe("");
    expect(parentScope("")).toBe("");
  });
});

describe("childFolders", () => {
  it("lists the folders directly under the root, alphabetically, with what they hold", () => {
    const rows = childFolders(FOLDERS, NOTES, "");
    expect(rows.map((r) => r.path)).toEqual(["archive/", "cos/", "desks/", "empty/"]);
    const cos = rows.find((r) => r.path === "cos/")!;
    expect(cos.count).toBe(3); // any depth: cos/desks/README.md counts
    expect(cos.modified).toBe(80);
    const empty = rows.find((r) => r.path === "empty/")!;
    expect(empty.count).toBe(0);
    expect(empty.modified).toBe(0);
  });

  it("lists only the next level inside a folder", () => {
    expect(childFolders(FOLDERS, NOTES, "cos/").map((r) => r.path)).toEqual(["cos/desks/"]);
    expect(childFolders(FOLDERS, NOTES, "cos/desks/")).toEqual([]);
    expect(childFolders(FOLDERS, NOTES, "archive/").map((r) => r.path)).toEqual([
      "archive/changelog/",
    ]);
  });

  it("knows a folder from a note's name alone, before the walk has said so", () => {
    expect(childFolders([], NOTES, "").map((r) => r.path)).toEqual(["archive/", "cos/", "desks/"]);
  });
});

describe("matchingFolders", () => {
  it("finds folders at any depth by their own name, not their parents'", () => {
    expect(matchingFolders(FOLDERS, NOTES, "", "des").map((r) => r.path)).toEqual([
      "cos/desks/",
      "desks/",
    ]);
    // "cos" is in cos/desks/'s path but not its name.
    expect(matchingFolders(FOLDERS, NOTES, "", "cos").map((r) => r.path)).toEqual(["cos/"]);
    expect(matchingFolders(FOLDERS, NOTES, "", "")).toEqual([]);
  });

  it("stays inside the scope and never offers the scope itself", () => {
    expect(matchingFolders(FOLDERS, NOTES, "cos/", "des").map((r) => r.path)).toEqual([
      "cos/desks/",
    ]);
    expect(matchingFolders(FOLDERS, NOTES, "cos/", "cos")).toEqual([]);
  });
});

describe("scopeTyped", () => {
  it("walks into a folder when its whole name and a slash are typed", () => {
    expect(scopeTyped("desks/", "", FOLDERS, NOTES)).toBe("desks/");
    expect(scopeTyped("DESKS/", "", FOLDERS, NOTES)).toBe("desks/");
    expect(scopeTyped("desks/", "cos/", FOLDERS, NOTES)).toBe("cos/desks/");
  });

  it("is not fooled by a prefix, a lone slash, or a folder elsewhere", () => {
    expect(scopeTyped("des/", "", FOLDERS, NOTES)).toBeNull();
    expect(scopeTyped("/", "", FOLDERS, NOTES)).toBeNull();
    expect(scopeTyped("desks", "", FOLDERS, NOTES)).toBeNull();
    expect(scopeTyped("changelog/", "", FOLDERS, NOTES)).toBeNull();
  });
});
