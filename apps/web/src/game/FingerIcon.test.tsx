import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FingerIcon } from "./FingerIcon";

describe("finger icon", () => {
  it("renders platform emoji hands again", () => {
    render(<>{[0, 1, 2, 3, 4, 5].map((value) => <FingerIcon key={value} value={value} />)}</>);
    expect(screen.getByText("✊")).toBeTruthy();
    expect(screen.getByText("☝️")).toBeTruthy();
    expect(screen.getByText("✌️")).toBeTruthy();
    expect(screen.getByText("🤟")).toBeTruthy();
    expect(screen.getByText("🖖")).toBeTruthy();
    expect(screen.getByText("🖐️")).toBeTruthy();
  });

  it("does not render custom svg hand models", () => {
    const { container } = render(<FingerIcon value={3} />);
    expect(container.querySelector("svg")).toBeNull();
    expect(container.querySelector(".finger-icon-emoji")).toBeTruthy();
  });
});
