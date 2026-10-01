/**
 * A small SVG bar or line chart with its scope always in view (#500).
 *
 * No chart library: the charts Studio needs are bars and lines over at most a thousand
 * groups, and drawing them here keeps every value's exact text in reach (each mark's
 * tooltip) and every missing value visible as a gap.
 */
import { useTranslation } from "react-i18next";

import type { ChartPoint } from "./chartData";
import { representsWhole, scopeLabel, type ChartScope } from "./chartScope";

const WIDTH = 640;
const HEIGHT = 240;
const PAD = { top: 12, right: 12, bottom: 28, left: 48 };

export interface SimpleChartProps {
  kind: "bar" | "line";
  points: readonly ChartPoint[];
  scope: ChartScope;
  xLabel: string;
  yLabel: string;
}

export function SimpleChart({
  kind,
  points,
  scope,
  xLabel,
  yLabel,
}: SimpleChartProps) {
  const { t } = useTranslation();
  const values = points
    .map((point) => point.y)
    .filter((y): y is number => y !== null);
  const missing = points.length - values.length;
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const plotWidth = WIDTH - PAD.left - PAD.right;
  const plotHeight = HEIGHT - PAD.top - PAD.bottom;
  const step = points.length ? plotWidth / points.length : plotWidth;
  const x = (index: number) => PAD.left + step * index + step / 2;
  const y = (value: number) =>
    PAD.top + plotHeight - ((value - min) / span) * plotHeight;

  // A line breaks at every missing value instead of bridging it.
  const segments: string[] = [];
  let current: string[] = [];
  points.forEach((point, index) => {
    if (point.y === null) {
      if (current.length) segments.push(current.join(" "));
      current = [];
    } else current.push(`${x(index)},${y(point.y)}`);
  });
  if (current.length) segments.push(current.join(" "));

  return (
    <figure className="space-y-2">
      <figcaption
        className={`text-xs font-semibold ${representsWhole(scope) ? "text-muted-foreground" : "text-status-warning"}`}
        data-scope={scope.kind}
        data-testid="chart-scope"
      >
        {scopeLabel(t, scope)}
      </figcaption>
      <svg
        aria-label={t("charts.aria", { x: xLabel, y: yLabel })}
        className="w-full"
        role="img"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      >
        <line
          stroke="currentColor"
          strokeOpacity={0.3}
          x1={PAD.left}
          x2={WIDTH - PAD.right}
          y1={y(0)}
          y2={y(0)}
        />
        <text fontSize={10} x={4} y={PAD.top + 8}>
          {String(max)}
        </text>
        <text fontSize={10} x={4} y={HEIGHT - PAD.bottom}>
          {String(min)}
        </text>
        {kind === "bar" ? (
          points.map((point, index) =>
            point.y === null ? (
              <g data-missing="true" key={index}>
                <title>{`${point.x}: ${t("charts.missing")}`}</title>
                <text
                  fontSize={10}
                  textAnchor="middle"
                  x={x(index)}
                  y={y(0) - 4}
                >
                  ∅
                </text>
              </g>
            ) : (
              <rect
                className="fill-data-accent-strong"
                height={Math.abs(y(point.y) - y(0))}
                key={index}
                width={Math.max(1, step * 0.7)}
                x={x(index) - Math.max(1, step * 0.7) / 2}
                y={Math.min(y(point.y), y(0))}
              >
                <title>{`${point.x}: ${point.exact}`}</title>
              </rect>
            ),
          )
        ) : (
          <>
            {segments.map((segment, index) => (
              <polyline
                className="stroke-data-accent-strong"
                fill="none"
                key={index}
                points={segment}
                strokeWidth={2}
              />
            ))}
            {points.map((point, index) =>
              point.y === null ? null : (
                <circle
                  className="fill-data-accent-strong"
                  cx={x(index)}
                  cy={y(point.y)}
                  key={index}
                  r={3}
                >
                  <title>{`${point.x}: ${point.exact}`}</title>
                </circle>
              ),
            )}
          </>
        )}
      </svg>
      <p className="text-xs text-muted-foreground">
        {xLabel} → {yLabel}
        {missing ? ` · ${t("charts.missingCount", { count: missing })}` : ""}
      </p>
    </figure>
  );
}
