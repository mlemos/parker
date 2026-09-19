// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PathLabel } from "./PathLabel.tsx";

afterEach(cleanup);

describe("PathLabel", () => {
  it("shows the ~ form, with folder and file in the part that never shrinks", () => {
    const { container } = render(
      <PathLabel path="/Volumes/work/Projects/parker/README.md" home="/Volumes/work" />
    );
    expect(container.querySelector(".pathlabel-head")!.textContent).toBe("~/Projects");
    expect(container.querySelector(".pathlabel-tail")!.textContent).toBe("/parker/README.md");
  });

  it("keeps the full path on the tooltip", () => {
    const { container } = render(<PathLabel path="/Volumes/work/a/b.md" home="" />);
    expect(container.querySelector(".pathlabel")!.getAttribute("title")).toBe(
      "/Volumes/work/a/b.md"
    );
  });

  it("has no head to elide for a short path", () => {
    const { container } = render(<PathLabel path="/Volumes/x.md" home="" />);
    expect(container.querySelector(".pathlabel-head")).toBeNull();
    expect(container.querySelector(".pathlabel-tail")!.textContent).toBe("/Volumes/x.md");
  });
});
