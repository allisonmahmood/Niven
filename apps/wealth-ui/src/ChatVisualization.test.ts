import { describe, expect, it } from "vitest";

import { createVisualizationArtifact } from "../../../packages/wealth-chat-bridge/src/visualization.ts";

import { buildVisualizationOption } from "./ChatVisualization";

describe("buildVisualizationOption", () => {
  it("wraps dense category labels on compact bar charts instead of dropping them", () => {
    const artifact = createVisualizationArtifact({
      altText: "Bar chart showing market value by sector.",
      spec: {
        chartType: "bar",
        data: [
          { sector: "Information Technology", value: 124500 },
          { sector: "Consumer Discretionary", value: 98300 },
          { sector: "Communication Services", value: 65400 },
          { sector: "Utilities", value: 18300 },
        ],
        series: [{ dataKey: "value", name: "Market value" }],
        xAxisLabel: "Sector",
        xKey: "sector",
      },
      summary: "Reviewing sector market value.",
      title: "Sector allocation",
    });

    const option = buildVisualizationOption(artifact, 420);
    const xAxis = option.xAxis as {
      axisLabel: {
        formatter: (value: string) => string;
        hideOverlap: boolean;
        interval: number | "auto";
        rotate: number;
      };
    };
    const grid = option.grid as { bottom: number; containLabel: boolean };

    expect(grid.containLabel).toBe(true);
    expect(grid.bottom).toBeGreaterThan(70);
    expect(xAxis.axisLabel.hideOverlap).toBe(false);
    expect(xAxis.axisLabel.interval).toBe(0);
    expect(xAxis.axisLabel.rotate).toBe(0);
    expect(xAxis.axisLabel.formatter("Information Technology")).toContain("\n");
  });

  it("moves dual-axis line chart titles away from the legend", () => {
    const artifact = createVisualizationArtifact({
      altText: "Line chart comparing return and contributions.",
      spec: {
        chartType: "line",
        data: [
          { month: "Jan", contribution: 1200, returnPct: 0.012 },
          { month: "Feb", contribution: 1200, returnPct: 0.018 },
          { month: "Mar", contribution: 1400, returnPct: 0.021 },
        ],
        series: [
          { dataKey: "returnPct", name: "Portfolio return" },
          { dataKey: "contribution", name: "Monthly contributions", yAxis: "right" },
        ],
        xAxisLabel: "Month",
        xKey: "month",
        yAxisLabel: "Return %",
        yAxisLabelRight: "Contribution",
      },
      summary: "Reviewing return against contributions.",
      title: "Performance vs contributions",
    });

    const option = buildVisualizationOption(artifact, 420);
    const legend = option.legend as { top: number; type: string };
    const grid = option.grid as { top: number };
    const yAxes = option.yAxis as Array<{
      nameLocation: string;
      nameRotate: number;
    }>;

    expect(legend.top).toBe(0);
    expect(legend.type).toBe("plain");
    expect(grid.top).toBeGreaterThanOrEqual(52);
    expect(yAxes[0]?.nameLocation).toBe("middle");
    expect(yAxes[0]?.nameRotate).toBe(90);
    expect(yAxes[1]?.nameLocation).toBe("middle");
    expect(yAxes[1]?.nameRotate).toBe(-90);
  });

  it("keeps single-axis y labels parallel to the tick labels", () => {
    const artifact = createVisualizationArtifact({
      altText: "Line chart showing remaining balance over time.",
      spec: {
        chartType: "line",
        data: [
          { year: 0, amount: 900000 },
          { year: 5, amount: 820000 },
          { year: 10, amount: 720000 },
          { year: 15, amount: 600000 },
          { year: 20, amount: 450000 },
          { year: 25, amount: 250000 },
          { year: 30, amount: 0 },
        ],
        series: [{ dataKey: "amount", name: "Remaining balance" }],
        xAxisLabel: "Year",
        xKey: "year",
        yAxisLabel: "Amount",
      },
      summary: "Reviewing amortization over time.",
      title: "Remaining balance",
    });

    const option = buildVisualizationOption(artifact, 980);
    const grid = option.grid as { left: number; top: number };
    const yAxis = option.yAxis as {
      nameGap: number;
      nameLocation: string;
      nameRotate: number;
      nameTextStyle: { align?: string };
    };

    expect(grid.left).toBeGreaterThanOrEqual(100);
    expect(grid.top).toBe(20);
    expect(yAxis.nameLocation).toBe("middle");
    expect(yAxis.nameRotate).toBe(0);
    expect(yAxis.nameGap).toBeGreaterThanOrEqual(70);
    expect(yAxis.nameTextStyle.align).toBe("right");
  });

  it("switches dense single-series account bars to a horizontal layout", () => {
    const artifact = createVisualizationArtifact({
      altText: "Bar chart showing balances by account.",
      spec: {
        chartType: "bar",
        data: [
          { account: "Plaid Money Market", balance: 42000 },
          { account: "Plaid 401k", balance: 23000 },
          { account: "Plaid Cash Management", balance: 11000 },
          { account: "Plaid HSA", balance: 6000 },
          { account: "Plaid Savings", balance: 800 },
          { account: "Plaid IRA", balance: 300 },
          { account: "Plaid Credit Card", balance: -500 },
          { account: "Plaid Business Credit", balance: -5200 },
          { account: "Plaid Mortgage", balance: -56000 },
          { account: "Plaid Student Loan", balance: -65000 },
        ],
        series: [{ dataKey: "balance", name: "Balance" }],
        xAxisLabel: "Account",
        xKey: "account",
        yAxisLabel: "Balance",
      },
      summary: "Reviewing balances by account.",
      title: "Account balances",
    });

    const option = buildVisualizationOption(artifact, 980);
    const grid = option.grid as { left: number; containLabel: boolean };
    const xAxis = option.xAxis as { name: string; type: string };
    const yAxis = option.yAxis as {
      axisLabel: { formatter: (value: string) => string };
      data: string[];
      type: string;
    };

    expect(grid.containLabel).toBe(false);
    expect(grid.left).toBeGreaterThanOrEqual(150);
    expect(xAxis.type).toBe("value");
    expect(xAxis.name).toBe("Balance");
    expect(yAxis.type).toBe("category");
    expect(yAxis.data).toHaveLength(10);
    expect(yAxis.axisLabel.formatter("Plaid Cash Management")).toContain("\n");
  });

  it("switches dense donut charts into legend mode with center emphasis labels", () => {
    const artifact = createVisualizationArtifact({
      altText: "Donut chart showing holdings mix.",
      spec: {
        chartType: "pie",
        data: [
          { ticker: "AAPL", value: 54000 },
          { ticker: "MSFT", value: 49800 },
          { ticker: "NVDA", value: 44500 },
          { ticker: "AMZN", value: 30200 },
          { ticker: "GOOGL", value: 28100 },
          { ticker: "META", value: 19100 },
          { ticker: "VTI", value: 15700 },
        ],
        donut: true,
        labelKey: "ticker",
        series: [{ dataKey: "value", name: "Weight" }],
      },
      summary: "Reviewing holdings mix.",
      title: "Holdings mix",
    });

    const option = buildVisualizationOption(artifact, 420);
    const legend = option.legend as { bottom: number; type: string };
    const pieSeries = (
      option.series as Array<{
        center: [string, string];
        emphasis: { label: { position: string; show: boolean } };
        label: { show: boolean };
        labelLine: { show: boolean };
      }>
    )[0];

    expect(legend.bottom).toBe(0);
    expect(legend.type).toBe("scroll");
    expect(pieSeries.center[1]).toBe("40%");
    expect(pieSeries.label.show).toBe(false);
    expect(pieSeries.labelLine.show).toBe(false);
    expect(pieSeries.emphasis.label.show).toBe(true);
    expect(pieSeries.emphasis.label.position).toBe("center");
  });
});
