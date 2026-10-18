import { Alert, Badge, Button, Drawer, Group, Pagination, Select, Stack, Table, Text, TextInput, Textarea } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, useApi } from '../api';
import { Card, Empty, ErrorState, JsonView, KV, Loading, PageHeader, ReasonBadges } from '../components/common';

const stColor: Record<string, string> = { OPEN: 'clay', RESOLVED: 'sage', REJECTED: 'gray', DEFERRED: 'navy' };

function Detail({ id, onChanged, onClose }: { id: number; onChanged: () => void; onClose: () => void }) {
  const { data, error, reload } = useApi<any>(`/review-queue/${id}`);
  const [actor, setActor] = useState(() => localStorage.getItem('brahmo-reviewer') ?? ''); const [note, setNote] = useState(''); const [cand, setCand] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const it = data.item;
  const canAccept = ['RX_LINE', 'STOCK_LINE'].includes(it.item_type);
  const decide = async (decision: string) => {
    setBusy(true);
    try { localStorage.setItem('brahmo-reviewer', actor); await api(`/review-queue/${id}/decision`, { method: 'POST', body: { actor, decision, candidate_product_id: decision === 'ACCEPT_CANDIDATE' ? cand ?? undefined : undefined, note: note || undefined } }); notifications.show({ color: 'navy', title: 'Decision recorded', message: `${decision} by ${actor}` }); setNote(''); reload(); onChanged(); }
    catch (e) { notifications.show({ color: 'rust', title: 'Decision rejected', message: (e as Error).message }); }
    finally { setBusy(false); }
  };
  return (
    <Stack gap="md">
      <KV rows={[['Type', it.item_type], ['Input', <b key="i">{it.input_text}</b>], ['Status', <Badge key="s" color={stColor[it.status]}>{it.status}</Badge>], ['Method', `${it.method}${it.confidence != null ? ` (${Math.round(it.confidence * 100)}%)` : ''}`], ['Reason codes', <ReasonBadges key="r" codes={it.reason_codes} />], ['Created', it.created_at]]} />
      {Object.keys(it.context).length > 0 && <Card title="Context" pad="sm"><JsonView data={it.context} maxH={160} /></Card>}
      <Card title={`Candidate mappings (${it.candidates.length})`} pad="sm">
        {it.candidates.length === 0 ? <Text size="sm" c="dimmed">No candidate. Candidates are suggestions for a human; the highest score is never selected automatically.</Text> :
          <Table fz="xs"><Table.Tbody>{it.candidates.slice(0, 30).map((c: any) => <Table.Tr key={c.product_id} onClick={() => canAccept && it.status === 'OPEN' && setCand(c.product_id)} style={{ cursor: canAccept ? 'pointer' : 'default', background: cand === c.product_id ? '#e1ece9' : undefined }}><Table.Td>{c.product_id}</Table.Td><Table.Td>{c.label}</Table.Td><Table.Td>{c.score != null ? `${Math.round(c.score * 100)}%` : ''}</Table.Td><Table.Td>{c.basis}</Table.Td></Table.Tr>)}</Table.Tbody></Table>}
        {canAccept && it.status === 'OPEN' && it.candidates.length > 0 && <Text size="xs" c="dimmed" mt={4}>Select a candidate row, then choose Accept candidate.</Text>}
        {!canAccept && <Text size="xs" c="dimmed" mt={4}>{it.item_type === 'BRAND_COLLISION' ? 'A brand collision cannot be resolved globally; each prescription line using it is reviewed on its own.' : 'This item records a data issue. Acknowledging does not change any data.'}</Text>}
      </Card>
      {data.source_row && <Card title={`Source evidence (${data.source_row.dataset}, row ${data.source_row.row_number})`} pad="sm"><JsonView data={data.source_row.raw} maxH={140} /></Card>}
      <Card title="Decision" pad="sm">
        <TextInput label="Reviewer name" required value={actor} onChange={(e) => setActor(e.currentTarget.value)} mb="xs" />
        <Textarea label="Note" value={note} onChange={(e) => setNote(e.currentTarget.value)} mb="sm" autosize minRows={2} />
        <Group gap="xs">
          {canAccept && <Button size="xs" disabled={!actor.trim() || !cand || it.status !== 'OPEN'} loading={busy} onClick={() => decide('ACCEPT_CANDIDATE')}>Accept candidate</Button>}
          <Button size="xs" variant="light" disabled={!actor.trim() || it.status !== 'OPEN'} onClick={() => decide('ACKNOWLEDGE')}>Acknowledge</Button>
          <Button size="xs" variant="light" color="rust" disabled={!actor.trim() || it.status !== 'OPEN'} onClick={() => decide('REJECT')}>Reject</Button>
          <Button size="xs" variant="default" disabled={!actor.trim() || it.status !== 'OPEN'} onClick={() => decide('DEFER')}>Defer</Button>
          <Button size="xs" variant="default" disabled={!actor.trim() || it.status === 'OPEN'} onClick={() => decide('REOPEN')}>Reopen</Button>
        </Group>
      </Card>
      <Card title={`Decision history (${data.decisions.length})`} pad="sm">
        {data.decisions.length === 0 ? <Text size="sm" c="dimmed">No human decision yet.</Text> : <Table fz="xs"><Table.Tbody>{data.decisions.map((d: any) => <Table.Tr key={d.id}><Table.Td>{d.decided_at.slice(0, 19).replace('T', ' ')}</Table.Td><Table.Td>{d.actor}</Table.Td><Table.Td>{d.decision}</Table.Td><Table.Td>{d.note}</Table.Td></Table.Tr>)}</Table.Tbody></Table>}
      </Card>
      <Button variant="default" size="xs" onClick={onClose}>Close</Button>
    </Stack>
  );
}

export default function ReviewQueue() {
  const [sp, setSp] = useSearchParams();
  const [status, setStatus] = useState<string | null>('OPEN'); const [type, setType] = useState<string | null>(sp.get('type')); const [q, setQ] = useState(''); const [page, setPage] = useState(1);
  const [open, setOpen] = useState<number | null>(sp.get('id') ? Number(sp.get('id')) : null);
  useEffect(() => { if (sp.get('id')) setOpen(Number(sp.get('id'))); }, [sp]);
  const p = new URLSearchParams({ page: String(page), size: '25' }); if (status) p.set('status', status); if (type) p.set('type', type); if (q) p.set('q', q);
  const { data, error, loading, reload } = useApi<any>(`/review-queue?${p}`);
  const types = [...new Set<string>((data?.facets.types ?? []).map((t: any) => t.item_type))];
  return (
    <>
      <PageHeader title="Ambiguity review queue" subtitle="Every uncertain identity, unit or decomposition appears here with reason codes and candidates. Nothing is resolved by score alone; every manual decision is audited." />
      <Card mb="md"><Group gap="sm" align="flex-end"><TextInput label="Search input text" value={q} onChange={(e) => { setQ(e.currentTarget.value); setPage(1); }} w={240} />
        <Select label="Status" clearable data={['OPEN', 'RESOLVED', 'REJECTED', 'DEFERRED']} value={status} onChange={(v) => { setStatus(v); setPage(1); }} w={150} />
        <Select label="Type" clearable data={types.length ? types : ['RX_LINE', 'STOCK_LINE', 'BRAND_COLLISION', 'FDC_DECOMPOSITION', 'UNIT_ANOMALY', 'REFERENCE_NAME', 'INTERACTION_TERM']} value={type} onChange={(v) => { setType(v); setPage(1); }} w={210} /></Group></Card>
      {error && <ErrorState error={error} onRetry={reload} />}
      {loading && !data && <Loading rows={8} />}
      {data && <Card pad="xs">
        {data.items.length === 0 ? <Empty title="Nothing in this view" hint="Open items appear when ingestion or a prescription contains an uncertain identity." /> :
          <Table.ScrollContainer minWidth={760}><Table fz="sm"><Table.Thead><Table.Tr><Table.Th>#</Table.Th><Table.Th>Type</Table.Th><Table.Th>Input</Table.Th><Table.Th>Reason codes</Table.Th><Table.Th>Candidates</Table.Th><Table.Th>Status</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{data.items.map((x: any) => <Table.Tr key={x.id} style={{ cursor: 'pointer' }} onClick={() => setOpen(x.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(x.id)}><Table.Td>{x.id}</Table.Td><Table.Td><Badge size="xs" color="navy">{x.item_type}</Badge></Table.Td><Table.Td>{x.input_text}</Table.Td><Table.Td><ReasonBadges codes={x.reason_codes} /></Table.Td><Table.Td>{x.candidates.length}</Table.Td><Table.Td><Badge size="xs" color={stColor[x.status]}>{x.status}</Badge></Table.Td></Table.Tr>)}</Table.Tbody></Table></Table.ScrollContainer>}
        <Group justify="space-between" p="sm"><Text size="xs" c="dimmed">{data.total.toLocaleString()} items</Text><Pagination total={Math.max(1, Math.ceil(data.total / data.size))} value={page} onChange={setPage} size="sm" /></Group></Card>}
      <Drawer opened={open != null} onClose={() => { setOpen(null); setSp({}); }} position="right" size="lg" title={`Review item ${open ?? ''}`} transitionProps={{ duration: 150 }}>
        {open != null && <Detail id={open} onChanged={reload} onClose={() => { setOpen(null); setSp({}); }} />}
      </Drawer>
      <Alert mt="md" color="gray" variant="light">Resolving an RX_LINE with a chosen candidate stores a reviewer-confirmed alias that the normalizer then uses (method "reviewer_confirmed"); Reopen removes it.</Alert>
    </>
  );
}
