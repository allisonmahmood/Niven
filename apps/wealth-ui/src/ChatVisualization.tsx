import { type EChartsOption, init } from "echarts";
import { useEffect, useMemo, useRef } from "react";
import type {
  VisualizationArtifact,
  VisualizationChartType,
  VisualizationDataRow,
  VisualizationSeries,
  VisualizationValueFormat,
} from "../../../packages/wealth-chat-bridge/src/visualization.ts";

type CartesianChartType = Exclude<VisualizationChartType, "pie">;

function toDisplayText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value === null || value === undefined) {
    return "";
  }

  return JSON.stringify(value);
}

function toNumericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function getValueFormatter(format?: VisualizationValueFormat): Intl.NumberFormat {
  switch (format) {
    case "currency":
      return new Intl.NumberFormat("en-US", {
        currency: "USD",
        maximumFractionDigits: 2,
        style: "currency",
      });
    case "percent":
      return new Intl.NumberFormat("en-US", {
        maximumFractionDigits: 1,
        style: "percent",
      });
    default:
      return new Intl.NumberFormat("en-US", {
        maximumFractionDigits: 2,
      });
  }
}

function formatValue(value: number | null, format: VisualizationValueFormat | undefined): string {
  if (value === null) {
    return "n/a";
  }

  const formatter = getValueFormatter(format);
  return format === "percent"
    ? formatter.format(Math.abs(value) > 1 ? value / 100 : value)
    : formatter.format(value);
}

function compareValues(
  left: VisualizationDataRow[string],
  right: VisualizationDataRow[string],
  order: "asc" | "desc",
): number {
  const leftNumeric = toNumericValue(left);
  const rightNumeric = toNumericValue(right);

  if (leftNumeric !== null && rightNumeric !== null) {
    return order === "asc" ? leftNumeric - rightNumeric : rightNumeric - leftNumeric;
  }

  const comparison = toDisplayText(left).localeCompare(toDisplayText(right), undefined, {
    numeric: true,
    sensitivity: "base",
  });
  return order === "asc" ? comparison : -comparison;
}

function sortRows(artifact: VisualizationArtifact): VisualizationDataRow[] {
  const rows = artifact.spec.data.map((row) => ({ ...row }));
  const sort = artifact.spec.sort;

  if (!sort) {
    return rows;
  }

  return rows.sort((left, right) => compareValues(left[sort.by], right[sort.by], sort.order));
}

function buildPieSeries(
  rows: readonly VisualizationDataRow[],
  labelKey: string,
  series: VisualizationSeries,
  artifact: VisualizationArtifact,
) {
  return {
    emphasis: {
      scale: true,
    },
    label: {
      formatter: ({ data }: { data: { name?: string; value?: number } }) => {
        const datum = data;
        return `${datum.name ?? ""}\n${formatValue(datum.value ?? null, artifact.spec.valueFormat)}`;
      },
    },
    name: series.name,
    radius: artifact.spec.donut ? ["44%", "72%"] : "72%",
    type: "pie" as const,
    data: rows.map((row) => ({
      itemStyle: series.color ? { color: series.color } : undefined,
      name: toDisplayText(row[labelKey]),
      value: toNumericValue(row[series.dataKey]) ?? 0,
    })),
  };
}

function buildCartesianSeries(
  rows: readonly VisualizationDataRow[],
  series: VisualizationSeries,
  chartType: CartesianChartType,
) {
  const seriesType =
    series.type === "area" ||
    series.type === "bar" ||
    series.type === "line" ||
    series.type === "scatter"
      ? series.type
      : chartType;
  const baseType = seriesType === "area" ? "line" : seriesType;

  return {
    areaStyle: seriesType === "area" ? {} : undefined,
    data: rows.map((row) => toNumericValue(row[series.dataKey])),
    itemStyle: series.color ? { color: series.color } : undefined,
    lineStyle: series.color ? { color: series.color } : undefined,
    name: series.name,
    smooth: seriesType === "line" || seriesType === "area" ? (series.smooth ?? true) : undefined,
    stack: series.stack,
    type: baseType as "bar" | "line" | "scatter",
    yAxisIndex: series.yAxis === "right" ? 1 : 0,
  };
}

export function buildVisualizationOption(artifact: VisualizationArtifact): EChartsOption {
  const rows = sortRows(artifact);
  const { spec } = artifact;
  const showLegend = spec.legend ?? spec.series.length > 1;

  if (spec.chartType === "pie") {
    const labelKey = spec.labelKey;
    const series = spec.series[0];

    if (!labelKey || !series) {
      throw new Error("Pie visualizations require labelKey and at least one series.");
    }

    return {
      animationDuration: 300,
      grid: {
        bottom: 16,
        left: 16,
        right: 16,
        top: 16,
      },
      legend: showLegend
        ? {
            left: "left",
            top: 0,
          }
        : undefined,
      series: [
        buildPieSeries(rows, labelKey, series, artifact),
      ] as unknown as EChartsOption["series"],
      tooltip: {
        trigger: "item",
        valueFormatter(value) {
          return formatValue(typeof value === "number" ? value : null, spec.valueFormat);
        },
      },
    };
  }

  const xKey = spec.xKey;

  if (!xKey) {
    throw new Error("Cartesian visualizations require xKey.");
  }

  const chartType = spec.chartType as CartesianChartType;
  const xAxisValues = rows.map((row) => toDisplayText(row[xKey]));
  const hasRightAxis = spec.series.some((series) => series.yAxis === "right");

  return {
    animationDuration: 300,
    dataZoom: spec.showDataZoom
      ? [
          {
            bottom: 0,
            height: 14,
            type: "slider",
          },
        ]
      : undefined,
    grid: {
      bottom: spec.showDataZoom ? 38 : 16,
      left: 18,
      right: hasRightAxis ? 18 : 12,
      top: 24,
    },
    legend: showLegend
      ? {
          left: "left",
          top: 0,
        }
      : undefined,
    series: spec.series.map((series) =>
      chartType === "scatter"
        ? {
            data: rows.map((row) => [
              toNumericValue(row[xKey]) ?? 0,
              toNumericValue(row[series.dataKey]),
            ]),
            itemStyle: series.color ? { color: series.color } : undefined,
            name: series.name,
            type: "scatter" as const,
            yAxisIndex: series.yAxis === "right" ? 1 : 0,
          }
        : buildCartesianSeries(rows, series, chartType),
    ) as unknown as EChartsOption["series"],
    tooltip: {
      trigger: chartType === "scatter" ? "item" : "axis",
      valueFormatter(value) {
        return formatValue(typeof value === "number" ? value : null, spec.valueFormat);
      },
    },
    xAxis:
      chartType === "scatter"
        ? {
            name: spec.xAxisLabel,
            nameLocation: "middle",
            nameGap: 28,
            type: "value",
          }
        : {
            axisLabel: {
              hideOverlap: true,
            },
            data: xAxisValues,
            name: spec.xAxisLabel,
            nameLocation: "middle",
            nameGap: 32,
            type: "category",
          },
    yAxis: hasRightAxis
      ? [
          {
            name: spec.yAxisLabel,
            type: "value",
          },
          {
            name: spec.yAxisLabelRight,
            type: "value",
          },
        ]
      : {
          name: spec.yAxisLabel,
          type: "value",
        },
  };
}

export function ChatVisualization(props: { artifact: VisualizationArtifact; pending?: boolean }) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const option = useMemo(() => buildVisualizationOption(props.artifact), [props.artifact]);

  useEffect(() => {
    const node = chartRef.current;
    if (!node || props.pending) {
      return;
    }

    const chart = init(node, undefined, { renderer: "svg" });
    chart.setOption(option, true);

    const resize = () => chart.resize();
    window.addEventListener("resize", resize);

    return () => {
      window.removeEventListener("resize", resize);
      chart.dispose();
    };
  }, [option, props.pending]);

  return (
    <section className={`visualization-card${props.pending ? " is-pending" : ""}`}>
      <header className="visualization-header">
        <div>
          <span className="panel-kicker">Chart</span>
          <h4>{props.artifact.title ?? "Visualization"}</h4>
        </div>
        {props.pending ? <span className="tool-status tool-status-running">running</span> : null}
      </header>
      <p className="visualization-summary">{props.artifact.summary}</p>
      <div
        aria-label={props.artifact.altText}
        className="visualization-canvas"
        ref={chartRef}
        role="img"
      />
      {props.artifact.warnings && props.artifact.warnings.length > 0 ? (
        <ul className="visualization-warnings">
          {props.artifact.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
