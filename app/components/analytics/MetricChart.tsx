import { LineChart, PolarisVizProvider } from "@shopify/polaris-viz";
import "@shopify/polaris-viz/build/esm/styles.css";

// Biểu đồ theo ngày của chỉ số đang chọn (Polaris Viz). Nạp lười, chỉ ở client (OverviewView) — thư viện nặng
// và đo kích thước bằng DOM, không render được phía server.

export type MetricChartProps = {
  name: string;
  points: { label: string; value: number }[];
  format: (value: number) => string;
};

export default function MetricChart({ name, points, format }: MetricChartProps) {
  const fmt = (v: string | number | null) => format(Number(v ?? 0));
  return (
    <PolarisVizProvider>
      <div style={{ height: 300 }}>
        <LineChart
          theme="Light"
          showLegend={false}
          data={[{ name, data: points.map((p) => ({ key: p.label, value: p.value })) }]}
          yAxisOptions={{ labelFormatter: fmt }}
          tooltipOptions={{ valueFormatter: fmt }}
        />
      </div>
    </PolarisVizProvider>
  );
}
