import { Text } from '@mantine/core';
import { ReactNode } from 'react';
import {
  ActivityLogRow,
  Algorithm,
  AlgorithmDataRow,
  AlgorithmSummary,
  CompressedAlgorithmDataRow,
  CompressedListing,
  CompressedObservations,
  CompressedOrder,
  CompressedOrderDepth,
  CompressedTrade,
  CompressedTradingState,
  ConversionObservation,
  Listing,
  Observation,
  Order,
  OrderDepth,
  Position,
  Product,
  ProsperitySymbol,
  Trade,
  TradingState,
} from '../models.ts';
import { authenticatedAxios } from './axios.ts';

interface Prosperity4LogArtifact {
  submissionId?: string;
  activitiesLog: string;
  logs?: Array<{
    sandboxLog?: string;
    lambdaLog?: string;
    timestamp: number;
  }>;
  tradeHistory?: Array<{
    symbol: ProsperitySymbol;
    price: number;
    quantity: number;
    buyer?: string;
    seller?: string;
    timestamp: number;
  }>;
}

interface Prosperity4ResultArtifact {
  round?: string;
  status?: string;
  profit?: number;
  activitiesLog: string;
  graphLog?: string;
  positions?: Array<{
    symbol: Product;
    quantity: number;
  }>;
}

export class AlgorithmParseError extends Error {
  public constructor(public readonly node: ReactNode) {
    super('Failed to parse algorithm logs');
  }
}

function getColumnValues(columns: string[], indices: number[]): number[] {
  const values: number[] = [];

  for (const index of indices) {
    const value = columns[index];
    if (value !== '') {
      values.push(parseFloat(value));
    }
  }

  return values;
}

function getActivityLogs(logLines: string[]): ActivityLogRow[] {
  const headerIndex = logLines.indexOf('Activities log:');
  if (headerIndex === -1) {
    return [];
  }

  const rows: ActivityLogRow[] = [];

  for (let i = headerIndex + 2; i < logLines.length; i++) {
    const line = logLines[i];
    if (line === '') {
      break;
    }

    const columns = line.split(';');

    rows.push({
      day: Number(columns[0]),
      timestamp: Number(columns[1]),
      product: columns[2],
      bidPrices: getColumnValues(columns, [3, 5, 7]),
      bidVolumes: getColumnValues(columns, [4, 6, 8]),
      askPrices: getColumnValues(columns, [9, 11, 13]),
      askVolumes: getColumnValues(columns, [10, 12, 14]),
      midPrice: Number(columns[15]),
      profitLoss: Number(columns[16]),
    });
  }

  return rows;
}

function getActivityLogsFromCsv(csv: string): ActivityLogRow[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length <= 1) {
    return [];
  }

  const rows: ActivityLogRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line === '') {
      continue;
    }

    const columns = line.split(';');

    rows.push({
      day: Number(columns[0]),
      timestamp: Number(columns[1]),
      product: columns[2],
      bidPrices: getColumnValues(columns, [3, 5, 7]),
      bidVolumes: getColumnValues(columns, [4, 6, 8]),
      askPrices: getColumnValues(columns, [9, 11, 13]),
      askVolumes: getColumnValues(columns, [10, 12, 14]),
      midPrice: Number(columns[15]),
      profitLoss: Number(columns[16]),
    });
  }

  return rows;
}

function decompressListings(compressed: CompressedListing[]): Record<ProsperitySymbol, Listing> {
  const listings: Record<ProsperitySymbol, Listing> = {};

  for (const [symbol, product, denomination] of compressed) {
    listings[symbol] = {
      symbol,
      product,
      denomination,
    };
  }

  return listings;
}

function decompressOrderDepths(
  compressed: Record<ProsperitySymbol, CompressedOrderDepth>,
): Record<ProsperitySymbol, OrderDepth> {
  const orderDepths: Record<ProsperitySymbol, OrderDepth> = {};

  for (const [symbol, [buyOrders, sellOrders]] of Object.entries(compressed)) {
    orderDepths[symbol] = {
      buyOrders,
      sellOrders,
    };
  }

  return orderDepths;
}

function decompressTrades(compressed: CompressedTrade[]): Record<ProsperitySymbol, Trade[]> {
  const trades: Record<ProsperitySymbol, Trade[]> = {};

  for (const [symbol, price, quantity, buyer, seller, timestamp] of compressed) {
    if (trades[symbol] === undefined) {
      trades[symbol] = [];
    }

    trades[symbol].push({
      symbol,
      price,
      quantity,
      buyer,
      seller,
      timestamp,
    });
  }

  return trades;
}

function decompressObservations(compressed: CompressedObservations): Observation {
  const conversionObservations: Record<Product, ConversionObservation> = {};

  for (const [
    product,
    [bidPrice, askPrice, transportFees, exportTariff, importTariff, sugarPrice, sunlightIndex],
  ] of Object.entries(compressed[1])) {
    conversionObservations[product] = {
      bidPrice,
      askPrice,
      transportFees,
      exportTariff,
      importTariff,
      sugarPrice,
      sunlightIndex,
    };
  }

  return {
    plainValueObservations: compressed[0],
    conversionObservations,
  };
}

function decompressState(compressed: CompressedTradingState): TradingState {
  return {
    timestamp: compressed[0],
    traderData: compressed[1],
    listings: decompressListings(compressed[2]),
    orderDepths: decompressOrderDepths(compressed[3]),
    ownTrades: decompressTrades(compressed[4]),
    marketTrades: decompressTrades(compressed[5]),
    position: compressed[6],
    observations: decompressObservations(compressed[7]),
  };
}

function decompressOrders(compressed: CompressedOrder[]): Record<ProsperitySymbol, Order[]> {
  const orders: Record<ProsperitySymbol, Order[]> = {};

  for (const [symbol, price, quantity] of compressed) {
    if (orders[symbol] === undefined) {
      orders[symbol] = [];
    }

    orders[symbol].push({
      symbol,
      price,
      quantity,
    });
  }

  return orders;
}

function decompressDataRow(compressed: CompressedAlgorithmDataRow, sandboxLogs: string): AlgorithmDataRow {
  return {
    state: decompressState(compressed[0]),
    orders: decompressOrders(compressed[1]),
    conversions: compressed[2],
    traderData: compressed[3],
    algorithmLogs: compressed[4],
    sandboxLogs,
  };
}

function getAlgorithmData(logLines: string[]): AlgorithmDataRow[] {
  const headerIndex = logLines.indexOf('Sandbox logs:');
  if (headerIndex === -1) {
    return [];
  }

  const rows: AlgorithmDataRow[] = [];
  let nextSandboxLogs = '';

  const sandboxLogPrefix = '  "sandboxLog": ';
  const lambdaLogPrefix = '  "lambdaLog": ';

  for (let i = headerIndex + 1; i < logLines.length; i++) {
    const line = logLines[i];
    if (line.endsWith(':')) {
      break;
    }

    if (line.startsWith(sandboxLogPrefix)) {
      nextSandboxLogs = JSON.parse(line.substring(sandboxLogPrefix.length, line.length - 1)).trim();

      if (nextSandboxLogs.startsWith('Conversion request')) {
        const lastRow = rows[rows.length - 1];
        lastRow.sandboxLogs += (lastRow.sandboxLogs.length > 0 ? '\n' : '') + nextSandboxLogs;

        nextSandboxLogs = '';
      }

      continue;
    }

    if (!line.startsWith(lambdaLogPrefix) || line === '  "lambdaLog": "",') {
      continue;
    }

    const start = line.indexOf('[[');
    const end = line.lastIndexOf(']') + 1;

    try {
      const compressedDataRow = JSON.parse(JSON.parse('"' + line.substring(start, end) + '"'));
      rows.push(decompressDataRow(compressedDataRow, nextSandboxLogs));
    } catch (err) {
      console.log(line);
      console.error(err);

      throw new AlgorithmParseError(
        (
          <>
            <Text>Logs are in invalid format. Could not parse the following line:</Text>
            <Text>{line}</Text>
          </>
        ),
      );
    }
  }

  return rows;
}

function createListing(symbol: ProsperitySymbol): Listing {
  return {
    symbol,
    product: symbol,
    denomination: 'XIRECS',
  };
}

function createOrderDepth(row: ActivityLogRow): OrderDepth {
  const buyOrders: Record<number, number> = {};
  const sellOrders: Record<number, number> = {};

  row.bidPrices.forEach((price, index) => {
    buyOrders[price] = row.bidVolumes[index];
  });

  row.askPrices.forEach((price, index) => {
    sellOrders[price] = -row.askVolumes[index];
  });

  return {
    buyOrders,
    sellOrders,
  };
}

function groupTradesBySymbol(trades: Trade[]): Record<ProsperitySymbol, Trade[]> {
  const grouped: Record<ProsperitySymbol, Trade[]> = {};

  for (const trade of trades) {
    if (grouped[trade.symbol] === undefined) {
      grouped[trade.symbol] = [];
    }

    grouped[trade.symbol].push(trade);
  }

  return grouped;
}

function parseProsperity4TradeHistory(artifact: Prosperity4LogArtifact): Map<number, Trade[]> {
  const tradesByTimestamp = new Map<number, Trade[]>();

  for (const trade of artifact.tradeHistory || []) {
    if (!tradesByTimestamp.has(trade.timestamp)) {
      tradesByTimestamp.set(trade.timestamp, []);
    }

    tradesByTimestamp.get(trade.timestamp)!.push({
      symbol: trade.symbol,
      price: trade.price,
      quantity: trade.quantity,
      buyer: trade.buyer || '',
      seller: trade.seller || '',
      timestamp: trade.timestamp,
    });
  }

  return tradesByTimestamp;
}

function getFinalPositions(artifact: Prosperity4ResultArtifact): Record<Product, Position> | undefined {
  if (!artifact.positions || artifact.positions.length === 0) {
    return undefined;
  }

  const positions: Record<Product, Position> = {};
  for (const entry of artifact.positions) {
    positions[entry.symbol] = entry.quantity;
  }

  return positions;
}

function parseProsperity4Artifact(logs: string): Algorithm {
  let artifact: Prosperity4LogArtifact | Prosperity4ResultArtifact;

  try {
    artifact = JSON.parse(logs);
  } catch {
    throw new AlgorithmParseError(<Text>Logs are in invalid JSON format.</Text>);
  }

  if (typeof artifact !== 'object' || artifact === null || typeof artifact.activitiesLog !== 'string') {
    throw new AlgorithmParseError(<Text>Unsupported Prosperity 4 artifact format.</Text>);
  }

  const activityLogs = getActivityLogsFromCsv(artifact.activitiesLog);
  if (activityLogs.length === 0) {
    throw new AlgorithmParseError(<Text>Prosperity 4 artifact does not contain any activity logs.</Text>);
  }

  const products = [...new Set(activityLogs.map(row => row.product))].sort((a, b) => a.localeCompare(b));
  const logsByTimestamp = new Map<number, { sandboxLog?: string; lambdaLog?: string }>();
  const artifactLogs = 'logs' in artifact && Array.isArray(artifact.logs) ? artifact.logs : [];
  for (const row of artifactLogs) {
    logsByTimestamp.set(row.timestamp, row);
  }

  const tradesByTimestamp =
    'tradeHistory' in artifact && Array.isArray(artifact.tradeHistory) ? parseProsperity4TradeHistory(artifact) : new Map();

  const rowsByTimestamp = new Map<number, ActivityLogRow[]>();
  for (const row of activityLogs) {
    if (!rowsByTimestamp.has(row.timestamp)) {
      rowsByTimestamp.set(row.timestamp, []);
    }

    rowsByTimestamp.get(row.timestamp)!.push(row);
  }

  const data: AlgorithmDataRow[] = [...rowsByTimestamp.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([timestamp, timestampRows]) => {
      const listings: Record<ProsperitySymbol, Listing> = {};
      const orderDepths: Record<ProsperitySymbol, OrderDepth> = {};

      for (const product of products) {
        listings[product] = createListing(product);
      }

      for (const row of timestampRows) {
        orderDepths[row.product] = createOrderDepth(row);
      }

      const tickLogs = logsByTimestamp.get(timestamp);
      const marketTrades = groupTradesBySymbol(tradesByTimestamp.get(timestamp) || []);

      return {
        state: {
          timestamp,
          traderData: '',
          listings,
          orderDepths,
          ownTrades: {},
          marketTrades,
          position: {},
          observations: {
            plainValueObservations: {},
            conversionObservations: {},
          },
        },
        orders: {},
        conversions: 0,
        traderData: '',
        algorithmLogs: tickLogs?.lambdaLog || '',
        sandboxLogs: tickLogs?.sandboxLog || '',
      };
    });

  return {
    activityLogs,
    data,
    format: 'prosperity4',
    finalPositions: getFinalPositions(artifact),
  };
}

export function parseAlgorithmLogs(logs: string, summary?: AlgorithmSummary): Algorithm {
  const trimmedLogs = logs.trim();

  if (trimmedLogs.startsWith('{')) {
    const parsed = parseProsperity4Artifact(trimmedLogs);
    if (summary) {
      parsed.summary = summary;
    }

    return parsed;
  }

  const logLines = logs.trim().split(/\r?\n/);

  const activityLogs = getActivityLogs(logLines);
  const data = getAlgorithmData(logLines);

  if (activityLogs.length === 0 && data.length === 0) {
    throw new AlgorithmParseError(
      (
        <Text>
          Logs are empty, either something went wrong with your submission or your backtester logs in a different format
          than Prosperity&apos;s submission environment.
        </Text>
      ),
    );
  }

  if (activityLogs.length === 0 || data.length === 0) {
    throw new AlgorithmParseError(
      /* prettier-ignore */
      <Text>Logs are in invalid format.</Text>,
    );
  }

  return {
    summary,
    activityLogs,
    data,
    format: 'prosperity3',
  };
}

export async function getAlgorithmLogsUrl(algorithmId: string): Promise<string> {
  const urlResponse = await authenticatedAxios.get(
    `https://bz97lt8b1e.execute-api.eu-west-1.amazonaws.com/prod/submission/logs/${algorithmId}`,
  );

  return urlResponse.data;
}

function downloadFile(url: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = new URL(url).pathname.split('/').pop()!;
  link.target = '_blank';
  link.rel = 'noreferrer';

  document.body.appendChild(link);
  link.click();
  link.remove();
}

export async function downloadAlgorithmLogs(algorithmId: string): Promise<void> {
  const logsUrl = await getAlgorithmLogsUrl(algorithmId);
  downloadFile(logsUrl);
}

export async function downloadAlgorithmResults(algorithmId: string): Promise<void> {
  const detailsResponse = await authenticatedAxios.get(
    `https://bz97lt8b1e.execute-api.eu-west-1.amazonaws.com/prod/results/tutorial/${algorithmId}`,
  );

  downloadFile(detailsResponse.data.algo.summary.activitiesLog);
}
