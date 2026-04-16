import { Grid, Text, Title } from '@mantine/core';
import { ReactNode } from 'react';
import { ScrollableCodeHighlight } from '../../components/ScrollableCodeHighlight.tsx';
import { AlgorithmDataRow } from '../../models.ts';
import { useStore } from '../../store.ts';
import { formatNumber } from '../../utils/format.ts';
import { ConversionObservationsTable } from './ConversionObservationsTable.tsx';
import { ListingsTable } from './ListingsTable.tsx';
import { OrderDepthTable } from './OrderDepthTable.tsx';
import { OrdersTable } from './OrdersTable.tsx';
import { PlainValueObservationsTable } from './PlainValueObservationsTable.tsx';
import { PositionTable } from './PositionTable.tsx';
import { ProfitLossTable } from './ProfitLossTable.tsx';
import { TradesTable } from './TradesTable.tsx';

function formatTraderData(value: any): string {
  if (typeof value === 'string') {
    return value;
  }

  return JSON.stringify(value);
}

export interface TimestampDetailProps {
  row: AlgorithmDataRow;
}

export function TimestampDetail({
  row: { state, orders, conversions, traderData, algorithmLogs, sandboxLogs },
}: TimestampDetailProps): ReactNode {
  const algorithm = useStore(state => state.algorithm)!;
  const hasDetailedState = algorithm.format !== 'prosperity4';
  const hasPositions = Object.keys(state.position).length > 0;
  const hasOrders = Object.keys(orders).length > 0;
  const hasOwnTrades = Object.keys(state.ownTrades).length > 0;
  const hasMarketTrades = Object.keys(state.marketTrades).length > 0;
  const hasPlainValueObservations = Object.keys(state.observations.plainValueObservations).length > 0;
  const hasConversionObservations = Object.keys(state.observations.conversionObservations).length > 0;

  const profitLoss = algorithm.activityLogs
    .filter(row => row.timestamp === state.timestamp)
    .reduce((acc, val) => acc + val.profitLoss, 0);

  return (
    <Grid columns={12}>
      <Grid.Col span={12}>
        <Title order={5}>
          Timestamp {formatNumber(state.timestamp)} • Profit / Loss: {formatNumber(profitLoss)}
          {hasDetailedState ? ` • Conversions: ${formatNumber(conversions)}` : ''}
        </Title>
      </Grid.Col>
      <Grid.Col span={{ xs: 12, sm: 4 }}>
        <Title order={5}>Listings</Title>
        <ListingsTable listings={state.listings} />
      </Grid.Col>
      {hasDetailedState && hasPositions && (
        <Grid.Col span={{ xs: 12, sm: 4 }}>
          <Title order={5}>Positions</Title>
          <PositionTable position={state.position} />
        </Grid.Col>
      )}
      <Grid.Col span={{ xs: 12, sm: 4 }}>
        <Title order={5}>Profit / Loss</Title>
        <ProfitLossTable timestamp={state.timestamp} />
      </Grid.Col>
      {Object.entries(state.orderDepths).map(([symbol, orderDepth], i) => (
        <Grid.Col key={i} span={{ xs: 12, sm: 4 }}>
          <Title order={5}>{symbol} order depth</Title>
          <OrderDepthTable orderDepth={orderDepth} />
        </Grid.Col>
      ))}
      {Object.keys(state.orderDepths).length % 3 <= 2 && <Grid.Col span={{ xs: 12, sm: 4 }} />}
      {Object.keys(state.orderDepths).length % 3 <= 1 && <Grid.Col span={{ xs: 12, sm: 4 }} />}
      {(hasDetailedState || hasOwnTrades) && (
        <Grid.Col span={{ xs: 12, sm: 4 }}>
          <Title order={5}>Own trades</Title>
          {<TradesTable trades={state.ownTrades} />}
        </Grid.Col>
      )}
      {(hasDetailedState || hasMarketTrades) && (
        <Grid.Col span={{ xs: 12, sm: 4 }}>
          <Title order={5}>Market trades</Title>
          {<TradesTable trades={state.marketTrades} />}
        </Grid.Col>
      )}
      {hasDetailedState && hasOrders && (
        <Grid.Col span={{ xs: 12, sm: 4 }}>
          <Title order={5}>Orders</Title>
          {<OrdersTable orders={orders} />}
        </Grid.Col>
      )}
      {hasDetailedState && hasPlainValueObservations && (
        <Grid.Col span={{ xs: 12, sm: 4 }}>
          <Title order={5}>Plain value observations</Title>
          <PlainValueObservationsTable plainValueObservations={state.observations.plainValueObservations} />
        </Grid.Col>
      )}
      {hasDetailedState && hasConversionObservations && (
        <Grid.Col span={{ xs: 12, sm: 8 }}>
          <Title order={5}>Conversion observations</Title>
          <ConversionObservationsTable conversionObservations={state.observations.conversionObservations} />
        </Grid.Col>
      )}
      {(hasDetailedState || sandboxLogs) && (
        <Grid.Col span={{ xs: 12, sm: 6 }}>
          <Title order={5}>Sandbox logs</Title>
          {sandboxLogs ? (
            <ScrollableCodeHighlight code={sandboxLogs} language="markdown" />
          ) : (
            <Text>Timestamp has no sandbox logs</Text>
          )}
        </Grid.Col>
      )}
      {(hasDetailedState || algorithmLogs) && (
        <Grid.Col span={{ xs: 12, sm: 6 }}>
          <Title order={5}>Algorithm logs</Title>
          {algorithmLogs ? (
            <ScrollableCodeHighlight code={algorithmLogs} language="markdown" />
          ) : (
            <Text>Timestamp has no algorithm logs</Text>
          )}
        </Grid.Col>
      )}
      {hasDetailedState && (
        <Grid.Col span={{ xs: 12, sm: 6 }}>
          <Title order={5}>Previous trader data</Title>
          {state.traderData ? (
            <ScrollableCodeHighlight code={formatTraderData(state.traderData)} language="json" />
          ) : (
            <Text>Timestamp has no previous trader data</Text>
          )}
        </Grid.Col>
      )}
      {hasDetailedState && (
        <Grid.Col span={{ xs: 12, sm: 6 }}>
          <Title order={5}>Next trader data</Title>
          {traderData ? (
            <ScrollableCodeHighlight code={formatTraderData(traderData)} language="json" />
          ) : (
            <Text>Timestamp has no next trader data</Text>
          )}
        </Grid.Col>
      )}
    </Grid>
  );
}
