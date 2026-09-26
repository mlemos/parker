import { describe, expect, it } from "vitest";
import { imageAllowed, imageHost, imageKind, imageModeOf, localImagePath } from "./images";

describe("imageKind", () => {
  it("tells remote, local, inline and anything else apart", () => {
    expect(imageKind("https://example.com/a.png")).toBe("remote");
    expect(imageKind("http://192.168.0.1/x")).toBe("remote");
    expect(imageKind("//cdn.example.com/a.png")).toBe("remote");
    expect(imageKind("HTTPS://EXAMPLE.COM/A.PNG")).toBe("remote");
    expect(imageKind("img/photo.png")).toBe("local");
    expect(imageKind("../shared/photo.png")).toBe("local");
    expect(imageKind("/Users/me/photo.png")).toBe("local");
    expect(imageKind("data:image/png;base64,AAAA")).toBe("inline");
    expect(imageKind("file:///etc/passwd")).toBe("other");
    expect(imageKind("asset://localhost/x")).toBe("other");
    expect(imageKind("")).toBe("other");
  });
});

describe("imageAllowed", () => {
  it("loads remote images only when everything is allowed", () => {
    expect(imageAllowed("remote", "all")).toBe(true);
    expect(imageAllowed("remote", "local")).toBe(false);
    expect(imageAllowed("remote", "none")).toBe(false);
  });
  it("loads local and inline images unless images are off", () => {
    for (const k of ["local", "inline"] as const) {
      expect(imageAllowed(k, "all")).toBe(true);
      expect(imageAllowed(k, "local")).toBe(true);
      expect(imageAllowed(k, "none")).toBe(false);
    }
  });
  it("never loads any other scheme", () => {
    for (const m of ["none", "local", "all"] as const) expect(imageAllowed("other", m)).toBe(false);
  });
});

describe("imageModeOf", () => {
  it("keeps the three modes and falls back to local", () => {
    expect(imageModeOf("none")).toBe("none");
    expect(imageModeOf("all")).toBe("all");
    expect(imageModeOf("local")).toBe("local");
    expect(imageModeOf("everything")).toBe("local");
    expect(imageModeOf(undefined)).toBe("local");
  });
});

describe("imageHost", () => {
  it("names the server a remote image would come from", () => {
    expect(imageHost("https://example.com/a.png")).toBe("example.com");
    expect(imageHost("//cdn.example.com:8080/a.png?x=1")).toBe("cdn.example.com:8080");
    expect(imageHost("https://user:pw@evil.example/p.gif")).toBe("evil.example");
    expect(imageHost("img/a.png")).toBe("");
  });
});

describe("localImagePath", () => {
  const dir = "/home/me/Documents/Parker";
  it("resolves against the note's own folder", () => {
    expect(localImagePath(dir, "trips/lisbon.md", "img/tram.jpg")).toBe(
      "/home/me/Documents/Parker/trips/img/tram.jpg"
    );
    expect(localImagePath(dir, "inbox.md", "./a.png")).toBe("/home/me/Documents/Parker/a.png");
    expect(localImagePath(dir + "/", "inbox.md", "a.png")).toBe("/home/me/Documents/Parker/a.png");
  });
  it("follows .. out of a subfolder", () => {
    expect(localImagePath(dir, "trips/lisbon.md", "../shared/map.png")).toBe(
      "/home/me/Documents/Parker/shared/map.png"
    );
  });
  it("decodes what markdown-it encoded, and drops a query or fragment", () => {
    expect(localImagePath(dir, "a.md", "my%20photo.png?v=2#x")).toBe("/home/me/Documents/Parker/my photo.png");
  });
  it("resolves an external file's images next to it", () => {
    expect(localImagePath(dir, "/home/me/Desktop/notes.md", "shot.png")).toBe("/home/me/Desktop/shot.png");
  });
  it("keeps an absolute path, and refuses one that climbs past the root", () => {
    expect(localImagePath(dir, "a.md", "/home/me/pic.png")).toBe("/home/me/pic.png");
    expect(localImagePath(dir, "a.md", "../../../../../../x.png")).toBeNull();
    expect(localImagePath(dir, "a.md", "%E0%A4%A")).toBeNull();
    expect(localImagePath(dir, "a.md", "   ")).toBeNull();
  });
});
