import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

class MockResizeObserver implements ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = MockResizeObserver;

HTMLElement.prototype.scrollTo = vi.fn();
