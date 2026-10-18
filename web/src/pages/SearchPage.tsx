import { Anchor, Badge, SimpleGrid, Stack, Table, Text } from '@mantine/core';
import { Link, useSearchParams } from 'react-router-dom';
import { useApi } from '../api';
import { Card, Empty, ErrorState, Loading, PageHeader } from '../components/common';

export default function SearchPage() {
  const [sp] = useSearchParams();
  const q = sp.get('q') ?? '';
  const { data, error, loading, reload } = useApi<any>(q.length >= 2 ? `/search?q=${encodeURIComponent(q)}` : null);
  return (
    <>
      <PageHeader title="Global search" subtitle="Across drug records, regulatory events, clinical evidence and review items. Use the search box in the header." />
      {q.length < 2 && <Empty title="Type at least two characters in the header search and press Enter" />}
      {error && <ErrorState error={error} onRetry={reload} />}
      {loading && <Loading />}
      {data && (
        <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
          <Card title={`Drugs (${data.drugs.length})`}>{data.drugs.length ? <Stack gap={4}>{data.drugs.map((x: any) => <Text key={x.product_id} size="sm"><Anchor component={Link} to={`/drugs/${x.product_id}`}>{x.brand_name}</Anchor> <Text span size="xs" c="dimmed">{x.dose_form} / {x.strength_text} {x.is_fdc ? <Badge size="xs">FDC</Badge> : null}</Text></Text>)}</Stack> : <Empty title="No drug matches" />}</Card>
          <Card title={`Regulatory events (${data.regulatory.length})`}>{data.regulatory.length ? <Stack gap={4}>{data.regulatory.map((x: any) => <Text key={x.event_id} size="sm"><Anchor component={Link} to="/regulatory">{x.notification_id}</Anchor> {x.action} <Text span size="xs" c="dimmed">eff. {x.effective_date} / {x.target_description}</Text></Text>)}</Stack> : <Empty title="No event matches" />}</Card>
          <Card title={`Clinical evidence (${data.evidence.length})`}>{data.evidence.length ? <Table fz="xs"><Table.Tbody>{data.evidence.map((x: any) => <Table.Tr key={x.chunk_id}><Table.Td>{x.doc_code} v{x.version} {x.status === 'SUPERSEDED' && <Badge size="xs" color="orange">superseded</Badge>}</Table.Td><Table.Td>{x.text}</Table.Td></Table.Tr>)}</Table.Tbody></Table> : <Empty title="No evidence matches" />}</Card>
          <Card title={`Review items (${data.review.length})`}>{data.review.length ? <Stack gap={4}>{data.review.map((x: any) => <Text key={x.id} size="sm"><Anchor component={Link} to={`/review?id=${x.id}`}>{x.input_text}</Anchor> <Text span size="xs" c="dimmed">{x.item_type} / {x.status}</Text></Text>)}</Stack> : <Empty title="No review matches" />}</Card>
        </SimpleGrid>
      )}
    </>
  );
}
