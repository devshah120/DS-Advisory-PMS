'use client';

import { usePageHeading } from '@/components/layout/PageHeaderContext';
import ClientPortfolioWatchlist from '@/components/watchlist/ClientPortfolioWatchlist';

export default function ClientPortfolioWatchlistPage() {
  usePageHeading({
    title: 'Client Watchlist',
    subtitle: "A client's holdings, with MTD / QTD / YTD for their own position vs. benchmarks",
  });
  return <ClientPortfolioWatchlist />;
}
