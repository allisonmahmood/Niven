import { type EChartsOption, type EChartsType, init } from "echarts";
import { type RefObject, useEffect, useMemo, useRef, useState } from "react";
import type {
  VisualizationArtifact,
  VisualizationChartType,
  VisualizationDataRow,
  VisualizationSeries,
  VisualizationValueFormat,
} from "../../../packages/wealth-chat-bridge/src/visualization.ts";

type CartesianChartType = Exclude<VisualizationChartType, "pie">;

interface VisualizationViewport {
  readonly width: number;
  readonly isCompact: boolean;
  readonly isMedium: boolean;
}

interface PieSeriesLayout {
  readonly center: [string, string];
  readonly showSliceLabels: boolean;
  readonly viewport: VisualizationViewport;
}

const CHART_FONT_FAMILY = '"IBM Plex Sans", sans-serif';
const DEFAULT_VISUALIZATION_WIDTH = 720;

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

function getVisualizationViewport(chartWidth: number): VisualizationViewport {
  const width =
    Number.isFinite(chartWidth) && chartWidth > 0
      ? Math.round(chartWidth)
      : DEFAULT_VISUALIZATION_WIDTH;

  return {
    isCompact: width < 520,
    isMedium: width < 760,
    width,
  };
}

function getLongestLabelLength(labels: readonly string[]): number {
  return labels.reduce((maxLength, label) => {
    return Math.max(maxLength, label.trim().length);
  }, 0);
}

function shouldUseHorizontalBarLayout(
  artifact: VisualizationArtifact,
  viewport: VisualizationViewport,
  categoryLabels: readonly string[],
): boolean {
  if (artifact.spec.chartType !== "bar" || artifact.spec.series.length !== 1) {
    return false;
  }

  const longestLabelLength = getLongestLabelLength(categoryLabels);
  return (
    categoryLabels.length >= (viewport.isCompact ? 7 : 10) ||
    (categoryLabels.length >= 5 && longestLabelLength >= (viewport.isCompact ? 16 : 18))
  );
}

function getChartCanvasHeight(artifact: VisualizationArtifact, chartWidth: number): number {
  const viewport = getVisualizationViewport(chartWidth);
  const { spec } = artifact;

  if (spec.chartType === "pie") {
    return viewport.isCompact ? 344 : viewport.isMedium ? 360 : 376;
  }

  if (spec.chartType === "scatter") {
    return viewport.isCompact ? 332 : 344;
  }

  if (spec.chartType === "bar" && spec.xKey) {
    const rows = sortRows(artifact);
    const categoryLabels = rows.map((row) => toDisplayText(row[spec.xKey ?? ""]));

    if (shouldUseHorizontalBarLayout(artifact, viewport, categoryLabels)) {
      const rowHeight = viewport.isCompact ? 38 : 30;
      return Math.min(680, Math.max(392, 124 + categoryLabels.length * rowHeight));
    }
  }

  return viewport.isCompact ? 336 : viewport.isMedium ? 352 : 364;
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

function truncateText(value: string, maxLength: number): string {
  return value.length > maxLength
    ? `${value.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`
    : value;
}

function wrapText(value: string, maxLength: number, maxLines = 2): string {
  if (value.length <= maxLength) {
    return value;
  }

  const words = value.split(/\s+/).filter(Boolean);
  if (words.length < 2) {
    return truncateText(value, maxLength);
  }

  const lines: string[] = [];
  let currentLine = "";

  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;
    if (nextLine.length <= maxLength) {
      currentLine = nextLine;
      continue;
    }

    if (currentLine) {
      lines.push(currentLine);
    } else {
      lines.push(truncateText(word, maxLength));
    }

    currentLine = word.length > maxLength ? truncateText(word, maxLength) : word;

    if (lines.length === maxLines - 1) {
      break;
    }
  }

  if (lines.length < maxLines && currentLine) {
    lines.push(currentLine);
  }

  if (lines.length < words.length) {
    const lastIndex = lines.length - 1;
    lines[lastIndex] = truncateText(lines[lastIndex] ?? value, maxLength);
  }

  return lines.join("\n");
}

function formatCategoryAxisLabel(
  label: string,
  viewport: VisualizationViewport,
  categoryCount: number,
): string {
  const normalized = label.trim();
  if (normalized.length === 0) {
    return normalized;
  }

  if (normalized.length <= (viewport.isCompact ? 12 : 16)) {
    return normalized;
  }

  if (normalized.includes(" ")) {
    return wrapText(normalized, viewport.isCompact ? 11 : 14, 2);
  }

  return truncateText(normalized, categoryCount > 8 ? 10 : viewport.isCompact ? 12 : 14);
}

function buildPieSeries(
  rows: readonly VisualizationDataRow[],
  labelKey: string,
  series: VisualizationSeries,
  artifact: VisualizationArtifact,
  layout: PieSeriesLayout,
) {
  return {
    avoidLabelOverlap: layout.showSliceLabels,
    center: layout.center,
    emphasis: layout.showSliceLabels
      ? {
          scale: true,
        }
      : {
          label: {
            fontFamily: CHART_FONT_FAMILY,
            fontSize: layout.viewport.isCompact ? 13 : 15,
            fontWeight: 600,
            formatter: ({ data }: { data: { name?: string; value?: number } }) => {
              const datum = data;
              return `${datum.name ?? ""}\n${formatValue(datum.value ?? null, artifact.spec.valueFormat)}`;
            },
            lineHeight: layout.viewport.isCompact ? 16 : 18,
            position: "center",
            show: true,
          },
          scale: true,
        },
    itemStyle: {
      borderColor: "#f8f3ea",
      borderWidth: 2,
    },
    label: layout.showSliceLabels
      ? {
          fontFamily: CHART_FONT_FAMILY,
          fontSize: 11,
          formatter: ({ data }: { data: { name?: string } }) =>
            formatCategoryAxisLabel(data.name ?? "", layout.viewport, rows.length),
          lineHeight: 14,
          show: true,
        }
      : {
          position: "center",
          show: false,
        },
    labelLine: layout.showSliceLabels
      ? {
          length: layout.viewport.isCompact ? 10 : 14,
          length2: layout.viewport.isCompact ? 8 : 12,
          show: true,
          smooth: true,
        }
      : {
          show: false,
        },
    minShowLabelAngle: rows.length > 6 ? 6 : 0,
    name: series.name,
    radius: artifact.spec.donut
      ? [layout.viewport.isCompact ? "42%" : "50%", layout.viewport.isCompact ? "68%" : "76%"]
      : layout.viewport.isCompact
        ? "72%"
        : "80%",
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
  viewport: VisualizationViewport,
  horizontalBar: boolean,
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
    areaStyle:
      seriesType === "area"
        ? {
            opacity: 0.16,
          }
        : undefined,
    barMaxWidth: baseType === "bar" ? (viewport.isCompact ? 28 : 36) : undefined,
    data: rows.map((row) => toNumericValue(row[series.dataKey])),
    emphasis: {
      focus: "series" as const,
    },
    itemStyle:
      baseType === "bar"
        ? horizontalBar
          ? {
              color: series.color,
            }
          : {
              borderRadius: [8, 8, 0, 0],
              color: series.color,
            }
        : series.color
          ? { color: series.color }
          : undefined,
    lineStyle:
      baseType === "line"
        ? {
            color: series.color,
            width: 3,
          }
        : series.color
          ? { color: series.color }
          : undefined,
    name: series.name,
    showSymbol: baseType === "line" ? rows.length <= 10 : undefined,
    smooth: seriesType === "line" || seriesType === "area" ? (series.smooth ?? true) : undefined,
    stack: series.stack,
    symbolSize: baseType === "line" ? 7 : undefined,
    type: baseType as "bar" | "line" | "scatter",
    yAxisIndex: series.yAxis === "right" ? 1 : 0,
  };
}

function buildLegendOption(
  showLegend: boolean,
  viewport: VisualizationViewport,
  itemCount: number,
  position: "top" | "bottom",
): EChartsOption["legend"] {
  if (!showLegend) {
    return undefined;
  }

  const isScrollable = itemCount > (viewport.isCompact ? 3 : 5);

  return {
    itemGap: viewport.isCompact ? 10 : 14,
    itemHeight: 10,
    itemWidth: 14,
    left: 0,
    pageButtonGap: 12,
    pageButtonItemGap: 8,
    pageFormatter: "",
    pageIconColor: "#121310",
    pageIconInactiveColor: "#b8af9e",
    pageTextStyle: {
      color: "#666459",
      fontFamily: CHART_FONT_FAMILY,
      fontSize: 11,
    },
    right: isScrollable ? (viewport.isCompact ? 84 : 48) : 0,
    textStyle: {
      color: "#403d33",
      fontFamily: CHART_FONT_FAMILY,
      fontSize: viewport.isCompact ? 11 : 12,
    },
    top: position === "top" ? 0 : undefined,
    bottom: position === "bottom" ? 0 : undefined,
    type: isScrollable ? "scroll" : "plain",
  };
}

function buildValueAxis(
  name: string | undefined,
  viewport: VisualizationViewport,
  position: "left" | "right",
  centerName: boolean,
) {
  const useParallelName = !centerName;
  const parallelNameGap = viewport.isCompact ? 62 : 76;

  return {
    axisLabel: {
      color: "#666459",
      fontFamily: CHART_FONT_FAMILY,
      fontSize: viewport.isCompact ? 10 : 11,
      margin: 10,
    },
    axisLine: {
      lineStyle: {
        color: "rgba(18, 19, 16, 0.22)",
      },
      show: true,
    },
    axisTick: {
      show: false,
    },
    name,
    nameGap: useParallelName ? parallelNameGap : viewport.isCompact ? 34 : 42,
    nameLocation: "middle" as const,
    nameRotate: useParallelName ? 0 : position === "right" ? -90 : 90,
    nameTextStyle: {
      align: useParallelName
        ? position === "right"
          ? ("left" as const)
          : ("right" as const)
        : undefined,
      color: "#666459",
      fontFamily: CHART_FONT_FAMILY,
      fontSize: viewport.isCompact ? 10 : 11,
      fontWeight: 500,
      padding: useParallelName
        ? position === "right"
          ? [0, 0, 0, 8]
          : [0, 8, 0, 0]
        : centerName
          ? position === "right"
            ? [0, 0, 0, 12]
            : [0, 12, 0, 0]
          : [0, 0, 8, 0],
      verticalAlign: useParallelName ? ("middle" as const) : undefined,
    },
    position,
    splitLine: {
      lineStyle: {
        color: "rgba(18, 19, 16, 0.12)",
        type: "dashed" as const,
      },
      show: true,
    },
    type: "value" as const,
  };
}

export function buildVisualizationOption(
  artifact: VisualizationArtifact,
  chartWidth = DEFAULT_VISUALIZATION_WIDTH,
): EChartsOption {
  const rows = sortRows(artifact);
  const { spec } = artifact;
  const viewport = getVisualizationViewport(chartWidth);
  const showLegend =
    spec.chartType === "pie"
      ? (spec.legend ?? rows.length > (viewport.isCompact ? 4 : 6))
      : (spec.legend ?? spec.series.length > 1);

  if (spec.chartType === "pie") {
    const labelKey = spec.labelKey;
    const series = spec.series[0];

    if (!labelKey || !series) {
      throw new Error("Pie visualizations require labelKey and at least one series.");
    }

    const showSliceLabels = !showLegend && rows.length <= (viewport.isCompact ? 4 : 5);
    const legend = buildLegendOption(showLegend, viewport, rows.length, "bottom");

    return {
      animationDuration: 300,
      animationDurationUpdate: 220,
      legend,
      series: [
        buildPieSeries(rows, labelKey, series, artifact, {
          center: showLegend ? ["50%", viewport.isCompact ? "40%" : "43%"] : ["50%", "50%"],
          showSliceLabels,
          viewport,
        }),
      ] as unknown as EChartsOption["series"],
      textStyle: {
        fontFamily: CHART_FONT_FAMILY,
      },
      tooltip: {
        confine: true,
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
  const useHorizontalBarLayout = shouldUseHorizontalBarLayout(artifact, viewport, xAxisValues);
  const hasRightAxis = spec.series.some((series) => series.yAxis === "right");
  const longestLabelLength = getLongestLabelLength(xAxisValues);
  const xAxisName = viewport.isCompact
    ? undefined
    : useHorizontalBarLayout
      ? spec.yAxisLabel
      : spec.xAxisLabel;
  const yAxisLabelLeft = viewport.isCompact || useHorizontalBarLayout ? undefined : spec.yAxisLabel;
  const yAxisLabelRight =
    viewport.isCompact || useHorizontalBarLayout ? undefined : spec.yAxisLabelRight;
  const preferRotatedLabels = viewport.isCompact && xAxisValues.length > 6;
  const useWrappedLabels =
    !useHorizontalBarLayout &&
    chartType !== "scatter" &&
    !preferRotatedLabels &&
    xAxisValues.some((value) => value.includes(" ")) &&
    longestLabelLength > (viewport.isCompact ? 12 : 18);
  const useRotatedLabels =
    !useHorizontalBarLayout &&
    chartType !== "scatter" &&
    (preferRotatedLabels ||
      (!useWrappedLabels &&
        (xAxisValues.length > (viewport.isCompact ? 5 : 8) ||
          longestLabelLength > (viewport.isCompact ? 10 : 14))));
  const axisLabelInterval =
    viewport.isCompact && xAxisValues.length > 7
      ? 1
      : useRotatedLabels || useWrappedLabels
        ? 0
        : "auto";
  const legend = buildLegendOption(showLegend, viewport, spec.series.length, "top");
  const horizontalLabelWidth = viewport.isCompact
    ? 120
    : Math.min(272, Math.max(156, longestLabelLength * 8));
  const singleAxisLeftInset =
    !useHorizontalBarLayout && !hasRightAxis && yAxisLabelLeft
      ? viewport.isCompact
        ? 88
        : 104
      : undefined;
  const gridBottom = useHorizontalBarLayout
    ? (spec.showDataZoom ? 30 : 0) + (xAxisName ? 34 : 0) + 20
    : (spec.showDataZoom ? 30 : 0) +
      (xAxisName ? 24 : 0) +
      (useRotatedLabels ? (viewport.isCompact ? 88 : 74) : useWrappedLabels ? 76 : 42);
  const gridTop = showLegend ? (viewport.isCompact ? 52 : 46) : 20;

  return {
    animationDuration: 300,
    animationDurationUpdate: 220,
    dataZoom: spec.showDataZoom
      ? [
          {
            bottom: 0,
            height: 16,
            type: "slider",
          },
        ]
      : undefined,
    grid: {
      bottom: gridBottom,
      containLabel: !useHorizontalBarLayout,
      left: useHorizontalBarLayout
        ? horizontalLabelWidth
        : (singleAxisLeftInset ?? (viewport.isCompact ? 14 : 20)),
      right: hasRightAxis ? (viewport.isCompact ? 18 : 22) : viewport.isCompact ? 12 : 16,
      top: gridTop,
    },
    legend,
    series: spec.series.map((series) =>
      chartType === "scatter"
        ? {
            data: rows.map((row) => [
              toNumericValue(row[xKey]) ?? 0,
              toNumericValue(row[series.dataKey]),
            ]),
            emphasis: {
              focus: "series" as const,
            },
            itemStyle: series.color ? { color: series.color } : undefined,
            name: series.name,
            symbolSize: viewport.isCompact ? 10 : 12,
            type: "scatter" as const,
            yAxisIndex: series.yAxis === "right" ? 1 : 0,
          }
        : buildCartesianSeries(rows, series, chartType, viewport, useHorizontalBarLayout),
    ) as unknown as EChartsOption["series"],
    textStyle: {
      fontFamily: CHART_FONT_FAMILY,
    },
    tooltip: {
      axisPointer:
        chartType === "scatter"
          ? undefined
          : {
              type: chartType === "bar" ? "shadow" : "line",
            },
      confine: true,
      trigger: chartType === "scatter" ? "item" : "axis",
      valueFormatter(value) {
        return formatValue(typeof value === "number" ? value : null, spec.valueFormat);
      },
    },
    xAxis: useHorizontalBarLayout
      ? {
          axisLabel: {
            color: "#666459",
            fontFamily: CHART_FONT_FAMILY,
            fontSize: viewport.isCompact ? 10 : 11,
            margin: 12,
          },
          axisLine: {
            lineStyle: {
              color: "rgba(18, 19, 16, 0.22)",
            },
            show: true,
          },
          axisTick: {
            show: false,
          },
          name: xAxisName,
          nameGap: 28,
          nameLocation: "middle",
          nameTextStyle: {
            color: "#666459",
            fontFamily: CHART_FONT_FAMILY,
            fontSize: viewport.isCompact ? 10 : 11,
            fontWeight: 500,
          },
          splitLine: {
            lineStyle: {
              color: "rgba(18, 19, 16, 0.12)",
              type: "dashed",
            },
            show: true,
          },
          type: "value",
        }
      : chartType === "scatter"
        ? {
            axisLabel: {
              color: "#666459",
              fontFamily: CHART_FONT_FAMILY,
              fontSize: viewport.isCompact ? 10 : 11,
              margin: 10,
            },
            axisLine: {
              lineStyle: {
                color: "rgba(18, 19, 16, 0.22)",
              },
              show: true,
            },
            axisTick: {
              show: false,
            },
            name: xAxisName,
            nameGap: 26,
            nameLocation: "middle",
            nameTextStyle: {
              color: "#666459",
              fontFamily: CHART_FONT_FAMILY,
              fontSize: viewport.isCompact ? 10 : 11,
              fontWeight: 500,
            },
            splitLine: {
              lineStyle: {
                color: "rgba(18, 19, 16, 0.12)",
                type: "dashed",
              },
              show: true,
            },
            type: "value",
          }
        : {
            axisLabel: {
              color: "#666459",
              fontFamily: CHART_FONT_FAMILY,
              fontSize: viewport.isCompact ? 10 : 11,
              formatter(value: string) {
                const label = String(value);

                if (useRotatedLabels) {
                  return truncateText(label, viewport.isCompact ? 12 : 14);
                }

                return formatCategoryAxisLabel(label, viewport, xAxisValues.length);
              },
              hideOverlap: !useRotatedLabels && !useWrappedLabels,
              interval: axisLabelInterval,
              lineHeight: 14,
              margin: useRotatedLabels ? 12 : 10,
              rotate: useWrappedLabels ? 0 : useRotatedLabels ? (viewport.isCompact ? 42 : 28) : 0,
            },
            axisLine: {
              lineStyle: {
                color: "rgba(18, 19, 16, 0.22)",
              },
              show: true,
            },
            axisTick: {
              alignWithLabel: true,
              lineStyle: {
                color: "rgba(18, 19, 16, 0.16)",
              },
              show: true,
            },
            data: xAxisValues,
            name: xAxisName,
            nameGap: viewport.isCompact ? 24 : 28,
            nameLocation: "middle",
            nameTextStyle: {
              color: "#666459",
              fontFamily: CHART_FONT_FAMILY,
              fontSize: viewport.isCompact ? 10 : 11,
              fontWeight: 500,
            },
            type: "category",
          },
    yAxis: useHorizontalBarLayout
      ? {
          axisLabel: {
            color: "#666459",
            fontFamily: CHART_FONT_FAMILY,
            fontSize: viewport.isCompact ? 10 : 11,
            formatter(value: string) {
              const label = String(value);
              return viewport.isCompact ? truncateText(label, 16) : wrapText(label, 18, 2);
            },
            interval: 0,
            lineHeight: 14,
            margin: 14,
          },
          axisLine: {
            show: false,
          },
          axisTick: {
            show: false,
          },
          data: xAxisValues,
          name: undefined,
          type: "category",
        }
      : hasRightAxis
        ? [
            buildValueAxis(yAxisLabelLeft, viewport, "left", true),
            buildValueAxis(yAxisLabelRight, viewport, "right", true),
          ]
        : buildValueAxis(yAxisLabelLeft, viewport, "left", false),
  };
}

function useChartWidth(targetRef: RefObject<HTMLDivElement | null>): number {
  const [width, setWidth] = useState(DEFAULT_VISUALIZATION_WIDTH);

  useEffect(() => {
    const node = targetRef.current;
    if (!node) {
      return;
    }

    const updateWidth = () => {
      const nextWidth = Math.round(node.getBoundingClientRect().width);
      if (nextWidth > 0) {
        setWidth((currentWidth) => (currentWidth === nextWidth ? currentWidth : nextWidth));
      }
    };

    updateWidth();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateWidth);
      return () => {
        window.removeEventListener("resize", updateWidth);
      };
    }

    const observer = new ResizeObserver(() => {
      updateWidth();
    });
    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [targetRef]);

  return width;
}

export function ChatVisualization(props: { artifact: VisualizationArtifact; pending?: boolean }) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const chartInstanceRef = useRef<EChartsType | null>(null);
  const chartWidth = useChartWidth(canvasRef);
  const canvasHeight = useMemo(() => {
    return getChartCanvasHeight(props.artifact, chartWidth);
  }, [chartWidth, props.artifact]);
  const option = useMemo(() => {
    return buildVisualizationOption(props.artifact, chartWidth);
  }, [chartWidth, props.artifact]);

  useEffect(() => {
    const node = canvasRef.current;
    if (!node || props.pending) {
      return;
    }

    const chart = chartInstanceRef.current ?? init(node, undefined, { renderer: "svg" });
    chartInstanceRef.current = chart;
    chart.setOption(option, true);
    chart.resize();
  }, [option, props.pending]);

  useEffect(() => {
    return () => {
      chartInstanceRef.current?.dispose();
      chartInstanceRef.current = null;
    };
  }, []);

  return (
    <section
      className={`visualization-card${props.pending ? " is-pending" : ""}`}
      data-chart-type={props.artifact.spec.chartType}
    >
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
        ref={canvasRef}
        role="img"
        style={{ height: `${canvasHeight}px` }}
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
