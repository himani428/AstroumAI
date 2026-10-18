import { Alert, Badge, Button, Group, Modal, Pagination, Select, SimpleGrid, Table, Text, TextInput, Textarea } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useApi } from '../api';
import { Card, Empty, ErrorState, Expand, Loading, PageHeader, Stat } from '../components/common';

const vColor: Record<string, string> = { CROSS_CHECKED_SAME_SOURCE: 'navy', REVIEWER_VERIFIED: 'sage', DISCREPANCY: 'rust', DISPUTED_BY_REVIEWER: 'rust' };

export default function Fdc() {
  const [q, setQ] = useState(''); const [ver, setVer] = useState<string | null>(null); const [page, setPage] = useState(1);
  const stats = useApi<any>('/fdc/stats');
  const p = new URLSearchParams({ page: String(page), size: '20' }); if (q) p.set('q', q); if (ver) p.set('verification', ver);
  const { data, error, loading, reload } = useApi<any>(`/fdc?${p}`);
  const [target, setTarget] = useState<{ id: string; decision: 'VERIFIED' | 'DISPUTED' } | null>(null);
  const [actor, setActor] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { await api(`/fdc/${target!.id}/verify`, { method: 'POST', body: { actor, decision: target!.decision, note: note || undefined } }); notifications.show({ color: 'navy', title: 'Recorded', message: `${target!.id} marked ${target!.decision.toLowerCase()} by ${actor}` }); setTarget(null); setNote(''); reload(); stats.reload(); }
    catch (e) { notifications.show({ color: 'rust', title: 'Could not record decision', message: (e as Error).message }); }
    finally { setBusy(false); }
  };
  const s = stats.data;
  return (
    <>
      <PageHeader title="Fixed-dose combination explorer" subtitle="Each combination product decomposed into ingredients and strengths, with method, confidence and verification state." />
      {s && <>
        <SimpleGrid cols={{ base: 2, md: 4 }} spacing="sm" mb="md">
          <Stat label="FDC products decomposed" value={s.total_fdc_products} hint={`target minimum ${s.target_minimum}: ${s.meets_minimum_decomposed ? 'met' : 'NOT met'}`} />
          <Stat label="Distinct compositions" value={s.distinct_compositions} />
          <Stat label="Internal consistency" value={`${Math.round((s.internal_consistency_rate ?? 0) * 100)}%`} hint="two derivations of one source row" />
          <Stat label="Clinician verified" value={s.clinician_verified} hint="no independent key supplied" color="clay.7" />
        </SimpleGrid>
        <Alert color="clay" variant="light" mb="md" title="Gate G2 (95% decomposition accuracy) is UNVERIFIED">{s.g2_statement}</Alert></>}
      <Card mb="md"><Group gap="sm" align="flex-end"><TextInput label="Search" placeholder="Brand or ingredient" value={q} onChange={(e) => { setQ(e.currentTarget.value); setPage(1); }} w={260} />
        <Select label="Verification" clearable data={['CROSS_CHECKED_SAME_SOURCE', 'REVIEWER_VERIFIED', 'DISCREPANCY', 'DISPUTED_BY_REVIEWER']} value={ver} onChange={(v) => { setVer(v); setPage(1); }} w={260} /></Group></Card>
      {error && <ErrorState error={error} onRetry={reload} />}
      {loading && !data && <Loading rows={8} />}
      {data && <Card pad="xs">
        {data.items.length === 0 ? <Empty title="No FDC products match" /> : <Table.ScrollContainer minWidth={900}><Table fz="sm"><Table.Thead><Table.Tr><Table.Th>Product</Table.Th><Table.Th>Decomposition</Table.Th><Table.Th>Method / confidence</Table.Th><Table.Th>Verification</Table.Th><Table.Th>Review</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{data.items.map((x: any) => (
            <Table.Tr key={x.product_id}>
              <Table.Td><Link to={`/drugs/${x.product_id}`}>{x.brand_name}</Link><Text size="xs" c="dimmed">{x.product_id} / {x.dose_form}</Text></Table.Td>
              <Table.Td>{x.ingredients.map((i: any) => <Text key={i.id} size="xs">{i.ingredient_name}: <b>{i.strength_value} {i.strength_unit}</b>{i.strength_unit_note ? ' (unit suspect)' : ''}</Text>)}</Table.Td>
              <Table.Td><Text size="xs">{x.ingredients[0].decomposition_method}</Text><Text size="xs" c="dimmed">{Math.round(x.ingredients[0].decomposition_confidence * 100)}%</Text></Table.Td>
              <Table.Td><Badge size="xs" color={vColor[x.ingredients[0].verification_status] ?? 'gray'}>{x.ingredients[0].verification_status}</Badge><Expand label="Evidence"><Text size="xs">{x.ingredients[0].verification_detail}</Text><Text size="xs" c="dimmed">source row {x.source_row_id}, batch {x.batch_id}, text "{x.strength_text}"</Text></Expand></Table.Td>
              <Table.Td><Group gap={4} wrap="nowrap"><Button size="compact-xs" variant="light" color="sage" onClick={() => setTarget({ id: x.product_id, decision: 'VERIFIED' })}>Verify</Button><Button size="compact-xs" variant="light" color="rust" onClick={() => setTarget({ id: x.product_id, decision: 'DISPUTED' })}>Dispute</Button></Group></Table.Td>
            </Table.Tr>))}</Table.Tbody></Table></Table.ScrollContainer>}
        <Group justify="space-between" p="sm"><Text size="xs" c="dimmed">{data.total} products</Text><Pagination total={Math.max(1, Math.ceil(data.total / data.size))} value={page} onChange={setPage} size="sm" /></Group></Card>}
      <Modal opened={!!target} onClose={() => setTarget(null)} title={`${target?.decision === 'VERIFIED' ? 'Verify' : 'Dispute'} decomposition for ${target?.id}`} transitionProps={{ duration: 150 }}>
        <TextInput label="Reviewer name" required value={actor} onChange={(e) => setActor(e.currentTarget.value)} mb="sm" data-autofocus />
        <Textarea label="Note (what was checked, against which source)" value={note} onChange={(e) => setNote(e.currentTarget.value)} mb="md" />
        <Group justify="flex-end"><Button variant="default" onClick={() => setTarget(null)}>Cancel</Button><Button disabled={!actor.trim()} loading={busy} onClick={submit}>Record decision</Button></Group>
      </Modal>
    </>
  );
}
