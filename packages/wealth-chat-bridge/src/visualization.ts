export type VisualizationPrimitive = string | number | boolean | null;

export type VisualizationChartType = "area" | "bar" | "line" | "pie" | "scatter";
export type VisualizationSeriesType = VisualizationChartType;
export type VisualizationAxis = "left" | "right";
export type VisualizationValueFormat = "currency" | "number" | "percent";

export interface VisualizationDataRow {
  readonly [key: string]: VisualizationPrimitive;
}

export interface VisualizationSort {
  readonly by: string;
  readonly order: "asc" | "desc";
}

export interface VisualizationSeries {
  readonly name: string;
  readonly dataKey: string;
  readonly type?: VisualizationSeriesType;
  readonly stack?: string;
  readonly smooth?: boolean;
  readonly yAxis?: VisualizationAxis;
  readonly color?: string;
}

export interface VisualizationSpec {
  readonly chartType: VisualizationChartType;
  readonly data: readonly VisualizationDataRow[];
  readonly series: readonly VisualizationSeries[];
  readonly xKey?: string;
  readonly labelKey?: string;
  readonly legend?: boolean;
  readonly xAxisLabel?: string;
  readonly yAxisLabel?: string;
  readonly yAxisLabelRight?: string;
  readonly valueFormat?: VisualizationValueFormat;
  readonly sort?: VisualizationSort;
  readonly showDataZoom?: boolean;
  readonly donut?: boolean;
}

export interface VisualizationArtifact {
  readonly kind: "visualization";
  readonly version: 1;
  readonly renderer: "echarts";
  readonly title?: string;
  readonly summary: string;
  readonly altText: string;
  readonly spec: VisualizationSpec;
  readonly warnings?: readonly string[];
}

export interface CreateVisualizationArtifactInput {
  readonly title?: string;
  readonly summary: string;
  readonly altText: string;
  readonly spec: VisualizationSpec;
  readonly warnings?: readonly string[];
}

export class VisualizationValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(issues.join(" "));
    this.name = "VisualizationValidationError";
    this.issues = issues;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isVisualizationPrimitive(value: unknown): value is VisualizationPrimitive {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isChartType(value: unknown): value is VisualizationChartType {
  return (
    value === "area" ||
    value === "bar" ||
    value === "line" ||
    value === "pie" ||
    value === "scatter"
  );
}

function isAxis(value: unknown): value is VisualizationAxis {
  return value === "left" || value === "right";
}

function isValueFormat(value: unknown): value is VisualizationValueFormat {
  return value === "currency" || value === "number" || value === "percent";
}

function cloneRows(rows: readonly VisualizationDataRow[]): VisualizationDataRow[] {
  return rows.map((row) => ({ ...row }));
}

export function validateVisualizationArtifact(value: unknown): VisualizationArtifact {
  const issues: string[] = [];

  if (!isRecord(value)) {
    throw new VisualizationValidationError(["Visualization payload must be an object."]);
  }

  if (value.kind !== "visualization") {
    issues.push('Visualization payload must include kind "visualization".');
  }

  if (value.version !== 1) {
    issues.push("Visualization payload version must be 1.");
  }

  if (value.renderer !== "echarts") {
    issues.push('Visualization payload renderer must be "echarts".');
  }

  if (!isNonEmptyString(value.summary)) {
    issues.push("Visualization summary must be a non-empty string.");
  }

  if (!isNonEmptyString(value.altText)) {
    issues.push("Visualization altText must be a non-empty string.");
  }

  if ("title" in value && value.title !== undefined && !isNonEmptyString(value.title)) {
    issues.push("Visualization title must be a non-empty string when provided.");
  }

  if ("warnings" in value && value.warnings !== undefined) {
    if (
      !Array.isArray(value.warnings) ||
      value.warnings.some((warning) => !isNonEmptyString(warning))
    ) {
      issues.push("Visualization warnings must be an array of non-empty strings when provided.");
    }
  }

  const rawSpec = value.spec;
  if (!isRecord(rawSpec)) {
    issues.push("Visualization spec must be an object.");
  } else {
    if (!isChartType(rawSpec.chartType)) {
      issues.push("Visualization spec chartType must be one of area, bar, line, pie, or scatter.");
    }

    if (!Array.isArray(rawSpec.data) || rawSpec.data.length === 0) {
      issues.push("Visualization spec data must include at least one row.");
    } else {
      const invalidRowIndex = rawSpec.data.findIndex((row) => {
        return !isRecord(row) || Object.values(row).some((cell) => !isVisualizationPrimitive(cell));
      });

      if (invalidRowIndex >= 0) {
        issues.push(
          `Visualization data row ${invalidRowIndex + 1} must be an object of JSON primitives.`,
        );
      }
    }

    if (!Array.isArray(rawSpec.series) || rawSpec.series.length === 0) {
      issues.push("Visualization spec series must include at least one series.");
    } else {
      rawSpec.series.forEach((series, index) => {
        if (!isRecord(series)) {
          issues.push(`Series ${index + 1} must be an object.`);
          return;
        }

        if (!isNonEmptyString(series.name)) {
          issues.push(`Series ${index + 1} is missing a non-empty name.`);
        }

        if (!isNonEmptyString(series.dataKey)) {
          issues.push(`Series ${index + 1} is missing a non-empty dataKey.`);
        }

        if ("type" in series && series.type !== undefined && !isChartType(series.type)) {
          issues.push(`Series ${index + 1} type must be area, bar, line, pie, or scatter.`);
        }

        if ("stack" in series && series.stack !== undefined && !isNonEmptyString(series.stack)) {
          issues.push(`Series ${index + 1} stack must be a non-empty string when provided.`);
        }

        if (
          "smooth" in series &&
          series.smooth !== undefined &&
          typeof series.smooth !== "boolean"
        ) {
          issues.push(`Series ${index + 1} smooth must be a boolean when provided.`);
        }

        if ("yAxis" in series && series.yAxis !== undefined && !isAxis(series.yAxis)) {
          issues.push(`Series ${index + 1} yAxis must be left or right when provided.`);
        }

        if ("color" in series && series.color !== undefined && !isNonEmptyString(series.color)) {
          issues.push(`Series ${index + 1} color must be a non-empty string when provided.`);
        }
      });
    }

    if ("xKey" in rawSpec && rawSpec.xKey !== undefined && !isNonEmptyString(rawSpec.xKey)) {
      issues.push("Visualization spec xKey must be a non-empty string when provided.");
    }

    if (
      "labelKey" in rawSpec &&
      rawSpec.labelKey !== undefined &&
      !isNonEmptyString(rawSpec.labelKey)
    ) {
      issues.push("Visualization spec labelKey must be a non-empty string when provided.");
    }

    if (
      "legend" in rawSpec &&
      rawSpec.legend !== undefined &&
      typeof rawSpec.legend !== "boolean"
    ) {
      issues.push("Visualization spec legend must be a boolean when provided.");
    }

    if (
      "xAxisLabel" in rawSpec &&
      rawSpec.xAxisLabel !== undefined &&
      !isNonEmptyString(rawSpec.xAxisLabel)
    ) {
      issues.push("Visualization spec xAxisLabel must be a non-empty string when provided.");
    }

    if (
      "yAxisLabel" in rawSpec &&
      rawSpec.yAxisLabel !== undefined &&
      !isNonEmptyString(rawSpec.yAxisLabel)
    ) {
      issues.push("Visualization spec yAxisLabel must be a non-empty string when provided.");
    }

    if (
      "yAxisLabelRight" in rawSpec &&
      rawSpec.yAxisLabelRight !== undefined &&
      !isNonEmptyString(rawSpec.yAxisLabelRight)
    ) {
      issues.push("Visualization spec yAxisLabelRight must be a non-empty string when provided.");
    }

    if (
      "valueFormat" in rawSpec &&
      rawSpec.valueFormat !== undefined &&
      !isValueFormat(rawSpec.valueFormat)
    ) {
      issues.push(
        "Visualization spec valueFormat must be currency, number, or percent when provided.",
      );
    }

    if (
      "showDataZoom" in rawSpec &&
      rawSpec.showDataZoom !== undefined &&
      typeof rawSpec.showDataZoom !== "boolean"
    ) {
      issues.push("Visualization spec showDataZoom must be a boolean when provided.");
    }

    if ("donut" in rawSpec && rawSpec.donut !== undefined && typeof rawSpec.donut !== "boolean") {
      issues.push("Visualization spec donut must be a boolean when provided.");
    }

    if ("sort" in rawSpec && rawSpec.sort !== undefined) {
      if (!isRecord(rawSpec.sort)) {
        issues.push("Visualization spec sort must be an object when provided.");
      } else {
        if (!isNonEmptyString(rawSpec.sort.by)) {
          issues.push("Visualization spec sort.by must be a non-empty string.");
        }

        if (rawSpec.sort.order !== "asc" && rawSpec.sort.order !== "desc") {
          issues.push('Visualization spec sort.order must be "asc" or "desc".');
        }
      }
    }

    const rows = Array.isArray(rawSpec.data)
      ? (rawSpec.data.filter(isRecord) as VisualizationDataRow[])
      : [];
    const dataKeys = new Set<string>(rows.flatMap((row) => Object.keys(row)));

    if (rawSpec.chartType === "pie") {
      if (!isNonEmptyString(rawSpec.labelKey)) {
        issues.push("Pie visualizations require spec.labelKey.");
      }

      if (!Array.isArray(rawSpec.series) || rawSpec.series.length !== 1) {
        issues.push("Pie visualizations require exactly one series.");
      }
    } else if (!isNonEmptyString(rawSpec.xKey)) {
      issues.push(`${String(rawSpec.chartType ?? "This")} visualizations require spec.xKey.`);
    }

    if (rawSpec.donut === true && rawSpec.chartType !== "pie") {
      issues.push("Visualization spec donut can only be used with pie charts.");
    }

    if (isNonEmptyString(rawSpec.xKey) && !dataKeys.has(rawSpec.xKey)) {
      issues.push(`Visualization spec xKey "${rawSpec.xKey}" is not present in the data rows.`);
    }

    if (isNonEmptyString(rawSpec.labelKey) && !dataKeys.has(rawSpec.labelKey)) {
      issues.push(
        `Visualization spec labelKey "${rawSpec.labelKey}" is not present in the data rows.`,
      );
    }

    if (
      isRecord(rawSpec.sort) &&
      isNonEmptyString(rawSpec.sort.by) &&
      !dataKeys.has(rawSpec.sort.by)
    ) {
      issues.push(
        `Visualization spec sort.by "${rawSpec.sort.by}" is not present in the data rows.`,
      );
    }

    if (Array.isArray(rawSpec.series)) {
      rawSpec.series.forEach((series, index) => {
        if (!isRecord(series) || !isNonEmptyString(series.dataKey)) {
          return;
        }

        if (!dataKeys.has(series.dataKey)) {
          issues.push(
            `Series ${index + 1} dataKey "${series.dataKey}" is not present in the data rows.`,
          );
        }
      });
    }
  }

  if (issues.length > 0) {
    throw new VisualizationValidationError(issues);
  }

  const specRecord = rawSpec as Record<string, unknown>;
  const sortRecord = isRecord(specRecord.sort) ? specRecord.sort : undefined;
  const warnings =
    Array.isArray(value.warnings) && value.warnings.length > 0
      ? value.warnings.filter((warning): warning is string => isNonEmptyString(warning))
      : undefined;

  return {
    kind: "visualization",
    version: 1,
    renderer: "echarts",
    ...(isNonEmptyString(value.title) ? { title: value.title } : {}),
    summary: value.summary as string,
    altText: value.altText as string,
    spec: {
      chartType: specRecord.chartType as VisualizationChartType,
      data: cloneRows(specRecord.data as readonly VisualizationDataRow[]),
      series: (specRecord.series as readonly VisualizationSeries[]).map((series) => ({
        ...series,
      })),
      ...(isNonEmptyString(specRecord.xKey) ? { xKey: specRecord.xKey } : {}),
      ...(isNonEmptyString(specRecord.labelKey) ? { labelKey: specRecord.labelKey } : {}),
      ...(typeof specRecord.legend === "boolean" ? { legend: specRecord.legend } : {}),
      ...(isNonEmptyString(specRecord.xAxisLabel) ? { xAxisLabel: specRecord.xAxisLabel } : {}),
      ...(isNonEmptyString(specRecord.yAxisLabel) ? { yAxisLabel: specRecord.yAxisLabel } : {}),
      ...(isNonEmptyString(specRecord.yAxisLabelRight)
        ? { yAxisLabelRight: specRecord.yAxisLabelRight }
        : {}),
      ...(isValueFormat(specRecord.valueFormat) ? { valueFormat: specRecord.valueFormat } : {}),
      ...(sortRecord &&
      isNonEmptyString(sortRecord.by) &&
      (sortRecord.order === "asc" || sortRecord.order === "desc")
        ? { sort: { by: sortRecord.by, order: sortRecord.order } }
        : {}),
      ...(typeof specRecord.showDataZoom === "boolean"
        ? { showDataZoom: specRecord.showDataZoom }
        : {}),
      ...(typeof specRecord.donut === "boolean" ? { donut: specRecord.donut } : {}),
    },
    ...(warnings ? { warnings } : {}),
  };
}

export function createVisualizationArtifact(
  input: CreateVisualizationArtifactInput,
): VisualizationArtifact {
  return validateVisualizationArtifact({
    kind: "visualization",
    version: 1,
    renderer: "echarts",
    ...(input.title ? { title: input.title } : {}),
    summary: input.summary,
    altText: input.altText,
    spec: input.spec,
    ...(input.warnings ? { warnings: [...input.warnings] } : {}),
  });
}

export function isVisualizationArtifact(value: unknown): value is VisualizationArtifact {
  try {
    validateVisualizationArtifact(value);
    return true;
  } catch {
    return false;
  }
}
