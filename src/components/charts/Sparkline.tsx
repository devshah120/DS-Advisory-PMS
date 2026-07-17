'use client';

import { AreaChart, Area, ResponsiveContainer } from 'recharts';

export function Sparkline({
  data,
  color = '#2563eb',
  positive,
}: {
  data: number[];
  color?: string;
  positive?: boolean;
}) {
  const stroke = positive === undefined ? color : positive ? '#16a34a' : '#dc2626';
  const series = data.map((v, i) => ({ i, v }));
  const id = `spark-${Math.round((data[0] || 0) * 1000)}-${data.length}`;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={series} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={stroke} stopOpacity={0.3} />
            <stop offset="100%" stopColor={stroke} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey="v"
          stroke={stroke}
          strokeWidth={1.75}
          fill={`url(#${id})`}
          dot={false}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
