import { describe, expect, it } from "vitest";

import {
  createVisualizationArtifact,
  VisualizationValidationError,
  validateVisualizationArtifact,
} from "../src/visualization.js";

describe("visualization artifact", () => {
  it("creates a normalized artifact for cartesian charts", () => {
    const artifact = createVisualizationArtifact({
      altText: "Bar chart of holdings market value by symbol.",
      spec: {
        chartType: "bar",
        data: [
          { marketValue: 1400, symbol: "AAPL" },
          { marketValue: 920, symbol: "MSFT" },
        ],
        series: [{ dataKey: "marketValue", name: "Market value" }],
        sort: { by: "marketValue", order: "desc" },
        valueFormat: "currency",
        xKey: "symbol",
        yAxisLabel: "Market value",
      },
      summary: "Comparing the two largest holdings by current market value.",
      title: "Top holdings",
    });

    expect(artifact).toEqual({
      altText: "Bar chart of holdings market value by symbol.",
      kind: "visualization",
      renderer: "echarts",
      spec: {
        chartType: "bar",
        data: [
          { marketValue: 1400, symbol: "AAPL" },
          { marketValue: 920, symbol: "MSFT" },
        ],
        series: [{ dataKey: "marketValue", name: "Market value" }],
        sort: { by: "marketValue", order: "desc" },
        valueFormat: "currency",
        xKey: "symbol",
        yAxisLabel: "Market value",
      },
      summary: "Comparing the two largest holdings by current market value.",
      title: "Top holdings",
      version: 1,
    });
  });

  it("rejects invalid pie chart payloads with a validation error", () => {
    expect(() =>
      validateVisualizationArtifact({
        altText: "Pie chart of holdings.",
        kind: "visualization",
        renderer: "echarts",
        spec: {
          chartType: "pie",
          data: [{ marketValue: 1400, symbol: "AAPL" }],
          series: [{ dataKey: "marketValue", name: "Market value" }],
        },
        summary: "Missing label key.",
        version: 1,
      }),
    ).toThrow(VisualizationValidationError);

    expect(() =>
      validateVisualizationArtifact({
        altText: "Pie chart of holdings.",
        kind: "visualization",
        renderer: "echarts",
        spec: {
          chartType: "pie",
          data: [{ marketValue: 1400, symbol: "AAPL" }],
          series: [
            { dataKey: "marketValue", name: "Market value" },
            { dataKey: "marketValue", name: "Duplicate" },
          ],
          labelKey: "symbol",
        },
        summary: "Too many series.",
        version: 1,
      }),
    ).toThrow(/exactly one series/i);
  });

  it("rejects scatter charts with non-numeric x values", () => {
    expect(() =>
      validateVisualizationArtifact({
        altText: "Scatter chart of contributions over time.",
        kind: "visualization",
        renderer: "echarts",
        spec: {
          chartType: "scatter",
          data: [
            { contribution: 1200, month: "2026-01-01" },
            { contribution: 1400, month: "2026-02-01" },
          ],
          series: [{ dataKey: "contribution", name: "Contribution" }],
          xKey: "month",
        },
        summary: "Date labels should not be silently coerced onto the y-axis.",
        version: 1,
      }),
    ).toThrow(/numeric values for spec\.xKey "month"/i);
  });
});
