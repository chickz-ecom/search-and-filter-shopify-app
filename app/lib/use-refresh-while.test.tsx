// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const revalidator = { state: "idle", revalidate: vi.fn() };
vi.mock("react-router", () => ({ useRevalidator: () => revalidator }));

const { useRefreshWhile } = await import("./use-refresh-while");

function Probe({ active }: { active: boolean }) {
  useRefreshWhile(active, 1000);
  return null;
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useRefreshWhile", () => {
  let root: ReturnType<typeof createRoot>;
  beforeEach(() => {
    vi.useFakeTimers();
    revalidator.state = "idle";
    revalidator.revalidate.mockClear();
    root = createRoot(document.createElement("div"));
  });
  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it("reloads loader data on an interval while active, and stops when it settles", () => {
    act(() => root.render(<Probe active />));
    vi.advanceTimersByTime(3000);
    expect(revalidator.revalidate).toHaveBeenCalledTimes(3);

    act(() => root.render(<Probe active={false} />));
    vi.advanceTimersByTime(5000);
    expect(revalidator.revalidate).toHaveBeenCalledTimes(3);
  });

  it("does not stack requests while one is in flight", () => {
    revalidator.state = "loading";
    act(() => root.render(<Probe active />));
    vi.advanceTimersByTime(3000);
    expect(revalidator.revalidate).not.toHaveBeenCalled();
  });
});
