import { Badge, Button, Group, Pagination, Select, Table, Tabs, Text, TextInput, Stack, Alert, UnstyledButton } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { IconArrowDown, IconArrowUp } from '@tabler/icons-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useApi } from '../api';
import { Card, Empty, ErrorState, JsonView, KV, Loading, PageHeader, ReasonBadges } from '../components/common';

const regColor: Record<string, string> = { PROHIBITED: 'rust', WITHDRAWN: 'rust', RESTRICTED: 'clay', STAYED: 'clay', SOURCE_CONFLICT: 'grape' };

export default function DrugMaster() {
  const [q, setQ] = useState(''); const [dq] = useDebouncedValue(q, 250);
  const [form, setForm] = useState<string | null>(null); const [fdc, setFdc] = useState<string | null>(null); const [mapping, setMapping] = useState<string | null>(null);
  const [flag, setFlag] = useState<string | null>(null); const [reg, setReg] = useState<string | null>(null);
  const [sort, setSort] = useState('product_id'); const [dir, setDir] = useState('asc'); const [page, setPage] = useState(1);
  const nav = useNavigate();
  const facets = useApi<any>('/drugs/facets');
  const p = new URLSearchParams({ page: String(page), size: '25', sort, dir });
  if (dq) p.set('q', dq); if (form) p.set('form', form); if (fdc) p.set('fdc', fdc); if (mapping) p.set('mapping', mapping); if (flag) p.set('flag', flag); if (reg) p.set('reg', reg);
  const { data, error, loading, reload } = useApi<any>(`/drugs?${p}`);
  const th = (key: string, label: string) => (
    <Table.Th><UnstyledButton onClick={() => { if (sort === key) setDir(dir === 'asc' ? 'desc' : 'asc'); else { setSort(key); setDir('asc'); } }} aria-label={`Sort by ${label}`}><Group gap={2} wrap="nowrap"><Text size="xs" fw={600}>{label}</Text>{sort === key && (dir === 'asc' ? <IconArrowUp size={12} /> : <IconArrowDown size={12} />)}</Group></UnstyledButton></Table.Th>
  );
  const reset = (fn: (v: any) => void) => (v: any) => { fn(v); setPage(1); };
  return (
    <>
      <PageHeader title="India Drug Master" subtitle="Brand-level products from the CDCI subset with decomposed ingredients, source rows and derived regulatory status. Nothing is inferred or filled in." />
      <Card mb="md">
        <Group gap="sm" align="flex-end">
          <TextInput label="Search" placeholder="Brand, product id, strength, manufacturer" value={q} onChange={(e) => { setQ(e.currentTarget.value); setPage(1); }} w={280} />
          <Select label="Dose form" data={(facets.data?.forms ?? []).map((f: any) => ({ value: f.dose_form, label: `${f.dose_form} (${f.n})` }))} value={form} onChange={reset(setForm)} clearable w={150} />
          <Select label="Composition" data={[{ value: 'true', label: 'Fixed-dose combination' }, { value: 'false', label: 'Single ingredient' }]} value={fdc} onChange={reset(setFdc)} clearable w={190} />
          <Select label="Mapping" data={[{ value: 'unique', label: 'Unique brand name' }, { value: 'collision', label: 'Brand name collision' }]} value={mapping} onChange={reset(setMapping)} clearable w={180} />
          <Select label="Provenance flag" data={[{ value: 'UNIT_SUSPECT', label: 'Unit suspect' }, { value: 'DECOMPOSITION_DISCREPANCY', label: 'Decomposition discrepancy' }]} value={flag} onChange={reset(setFlag)} clearable w={200} />
          <Select label="Regulatory status" data={(facets.data?.reg_states ?? []).map((s: string) => ({ value: s, label: s === 'ANY' ? 'Any regulatory event' : s }))} value={reg} onChange={reset(setReg)} clearable w={190} />
        </Group>
      </Card>
      {error && <ErrorState error={error} onRetry={reload} />}
      {loading && !data && <Loading rows={8} />}
      {data && (
        <Card pad="xs">
          {data.items.length === 0 ? <Empty title="No products match these filters" hint="Clear a filter or search by a different brand name or ingredient." /> : (
            <Table.ScrollContainer minWidth={900}>
              <Table fz="sm"><Table.Thead><Table.Tr>{th('product_id', 'ID')}{th('brand', 'Brand')}{th('manufacturer', 'Manufacturer')}<Table.Th>Form</Table.Th>{th('ingredients', 'Ingredients and strengths')}<Table.Th>Mapping</Table.Th><Table.Th>Regulatory</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>{data.items.map((x: any) => (
                  <Table.Tr key={x.product_id} onClick={() => nav(`/drugs/${x.product_id}`)} style={{ cursor: 'pointer' }}>
                    <Table.Td>{x.product_id}</Table.Td><Table.Td><Text fw={500} size="sm">{x.brand_name}</Text></Table.Td><Table.Td>{x.manufacturer}</Table.Td><Table.Td>{x.dose_form}</Table.Td>
                    <Table.Td>{x.is_fdc ? <Badge size="xs" mr={4}>FDC</Badge> : null}<Text span size="sm">{x.strength_text}</Text>{x.anomaly_flags.map((f: string) => <Badge key={f} size="xs" color="clay" ml={4}>{f}</Badge>)}</Table.Td>
                    <Table.Td>{x.mapping_status === 'BRAND_COLLISION' ? <Badge color="clay" size="xs">BRAND COLLISION</Badge> : <Badge color="navy" variant="outline" size="xs">UNIQUE</Badge>}</Table.Td>
                    <Table.Td>{x.reg_state ? <Badge color={regColor[x.reg_state] ?? 'gray'} variant="filled" size="xs">{x.reg_state}{x.reg_applicability === 'POSSIBLE' ? ' (possible)' : ''}</Badge> : <Text size="xs" c="dimmed">no event</Text>}</Table.Td>
                  </Table.Tr>))}</Table.Tbody></Table>
            </Table.ScrollContainer>
          )}
          <Group justify="space-between" p="sm"><Text size="xs" c="dimmed">{data.total.toLocaleString()} products</Text><Pagination total={Math.max(1, Math.ceil(data.total / data.size))} value={page} onChange={setPage} size="sm" /></Group>
        </Card>
      )}
    </>
  );
}

export function DrugDetail() {
  const { id } = useParams();
  const { data, error, loading, reload } = useApi<any>(`/drugs/${id}`);
  if (error) return <><PageHeader title="Drug record" crumbs={[{ label: 'Drug Master', to: '/drugs' }, { label: String(id) }]} /><ErrorState error={error} onRetry={reload} /></>;
  if (loading || !data) return <Loading rows={8} />;
  const p = data.product;
  return (
    <>
      <PageHeader title={p.brand_name} subtitle={`${p.product_id} / ${p.dose_form} / ${p.strength_text}`} crumbs={[{ label: 'Drug Master', to: '/drugs' }, { label: p.product_id }]} />
      {data.brand_collisions.length > 0 && <Alert color="clay" variant="light" mb="md" title="This brand name is not unique">{data.brand_collisions.length} other product(s) share the name "{p.brand_name}". A written brand name alone cannot identify this product; prescriptions using it go to the review queue.</Alert>}
      <Tabs defaultValue="overview" keepMounted={false}>
        <Tabs.List mb="md"><Tabs.Tab value="overview">Identity and ingredients</Tabs.Tab><Tabs.Tab value="reg">Regulatory ({data.regulatory.length})</Tabs.Tab><Tabs.Tab value="ref">NLEM, Jan Aushadhi, stock</Tabs.Tab><Tabs.Tab value="prov">Provenance</Tabs.Tab></Tabs.List>
        <Tabs.Panel value="overview">
          <Stack gap="md">
            <Card title="Product"><KV rows={[['Product id', p.product_id], ['Brand', p.brand_name], ['Manufacturer', p.manufacturer], ['Dose form', p.dose_form], ['Strength as sourced', p.strength_text], ['Composition', p.is_fdc ? 'Fixed-dose combination' : 'Single ingredient'], ['Source', `${p.source} @ ${p.source_version}`], ['Effective from', p.effective_from], ['Flags', p.anomaly_flags.length ? <ReasonBadges codes={p.anomaly_flags} /> : 'none']]} /></Card>
            <Card title="Ingredients (decomposition)"><Table fz="sm"><Table.Thead><Table.Tr><Table.Th>#</Table.Th><Table.Th>Ingredient</Table.Th><Table.Th>Strength</Table.Th><Table.Th>Method</Table.Th><Table.Th>Confidence</Table.Th><Table.Th>Verification</Table.Th></Table.Tr></Table.Thead>
              <Table.Tbody>{data.ingredients.map((i: any) => <Table.Tr key={i.id}><Table.Td>{i.position}</Table.Td><Table.Td>{i.ingredient_name}</Table.Td><Table.Td>{i.strength_value} {i.strength_unit} {i.strength_unit_note && <Badge color="clay" size="xs" title={i.strength_unit_note}>UNIT SUSPECT</Badge>}</Table.Td><Table.Td>{i.decomposition_method}</Table.Td><Table.Td>{Math.round(i.decomposition_confidence * 100)}%</Table.Td><Table.Td><Badge size="xs" color={i.verification_status === 'REVIEWER_VERIFIED' ? 'sage' : i.verification_status === 'DISCREPANCY' || i.verification_status === 'DISPUTED_BY_REVIEWER' ? 'rust' : 'gray'}>{i.verification_status}</Badge><Text size="xs" c="dimmed">{i.verification_detail}</Text></Table.Td></Table.Tr>)}</Table.Tbody></Table></Card>
            {data.brand_collisions.length > 0 && <Card title="Other products with the same brand name"><Table fz="xs"><Table.Tbody>{data.brand_collisions.map((c: any) => <Table.Tr key={c.product_id}><Table.Td><Link to={`/drugs/${c.product_id}`}>{c.product_id}</Link></Table.Td><Table.Td>{c.manufacturer}</Table.Td><Table.Td>{c.dose_form}</Table.Td><Table.Td>{c.strength_text}</Table.Td></Table.Tr>)}</Table.Tbody></Table></Card>}
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="reg">
          {data.regulatory.length === 0 ? <Card><Empty title="No register target matches this product" hint="The register holds a small number of events. Absence here is not evidence that the product is unrestricted." /></Card> : <Stack gap="md">{data.regulatory.map((r: any, i: number) => (
            <Card key={i} title={r.target} right={<Badge color={regColor[r.derived_state] ?? 'gray'} variant="filled">{r.derived_state} as of {data.as_of}</Badge>}>
              {r.applicability === 'POSSIBLE' && <Alert color="clay" variant="light" mb="sm" title="Applicability not confirmed">{r.notes.join(' ')}</Alert>}
              <Table fz="xs"><Table.Thead><Table.Tr><Table.Th>Event</Table.Th><Table.Th>Notification</Table.Th><Table.Th>Action</Table.Th><Table.Th>Published</Table.Th><Table.Th>Effective</Table.Th><Table.Th>Supersedes</Table.Th><Table.Th>In force</Table.Th></Table.Tr></Table.Thead>
                <Table.Tbody>{r.timeline.map((t: any) => <Table.Tr key={t.event_id}><Table.Td>{t.event_id}</Table.Td><Table.Td>{t.notification_id}</Table.Td><Table.Td>{t.action}</Table.Td><Table.Td>{t.date_published}</Table.Td><Table.Td>{t.effective_date}</Table.Td><Table.Td>{t.supersedes_event_id ?? '-'}</Table.Td><Table.Td>{t.in_force ? (t.superseded_by ? `superseded by ${t.superseded_by}` : 'active') : 'not yet effective'}</Table.Td></Table.Tr>)}</Table.Tbody></Table>
            </Card>))}</Stack>}
        </Tabs.Panel>
        <Tabs.Panel value="ref">
          <Stack gap="md">
            <Card title={`NLEM cross-reference (${data.nlem.length})`}>{data.nlem.length ? <Table fz="xs"><Table.Tbody>{data.nlem.map((n: any) => <Table.Tr key={n.id}><Table.Td>{n.medicine}</Table.Td><Table.Td>{n.therapeutic_category ?? 'category missing in source'}</Table.Td><Table.Td>{n.care_levels}</Table.Td><Table.Td>{n.nlem_edition}</Table.Td></Table.Tr>)}</Table.Tbody></Table> : <Text size="sm" c="dimmed">No exact-name NLEM entry. Names are matched exactly; no fuzzy cross-reference is made.</Text>}</Card>
            <Card title={`Jan Aushadhi (${data.jan_aushadhi.length})`}>{data.jan_aushadhi.length ? <Table fz="xs"><Table.Tbody>{data.jan_aushadhi.map((n: any) => <Table.Tr key={n.id}><Table.Td>{n.generic_name}</Table.Td><Table.Td>{n.strength}</Table.Td><Table.Td>{n.pack}</Table.Td><Table.Td>INR {n.mrp_inr}</Table.Td><Table.Td>{n.catalog_version}</Table.Td></Table.Tr>)}</Table.Tbody></Table> : <Text size="sm" c="dimmed">No exact-name Jan Aushadhi entry.</Text>}</Card>
            <Card title={`Pharmacy stock mapped to this product (${data.stock.length})`}>{data.stock.length ? <Table fz="xs"><Table.Tbody>{data.stock.map((s: any) => <Table.Tr key={s.id}><Table.Td>{s.item_name_as_billed}</Table.Td><Table.Td>qty {s.qty_units}</Table.Td><Table.Td>batch {s.batch_no}</Table.Td><Table.Td>exp {s.expiry}</Table.Td><Table.Td>{s.mapping_method}</Table.Td></Table.Tr>)}</Table.Tbody></Table> : <Text size="sm" c="dimmed">No stock line is mapped unambiguously to this product.</Text>}
              {data.stock_unmapped_with_same_brand.length > 0 && <Text size="xs" c="dimmed" mt="xs">{data.stock_unmapped_with_same_brand.length} unmapped stock line(s) share this brand string and are awaiting review; they are not assumed to be this product.</Text>}<Text size="xs" c="dimmed" mt={4}>{data.stock_note}</Text></Card>
          </Stack>
        </Tabs.Panel>
        <Tabs.Panel value="prov">
          <Stack gap="md">
            <Card title="Provenance chain"><Text size="xs" c="dimmed" mb="xs">derived record, source row, ingestion batch, source file and SHA-256</Text>{data.provenance.batch && <KV rows={[['Source file', data.provenance.batch.source_file], ['SHA-256', data.provenance.batch.source_sha256], ['Batch', `#${data.provenance.batch.id} (${data.provenance.batch.mode}, ${data.provenance.batch.status})`], ['Loaded', data.provenance.batch.started_at], ['Pipeline version', data.provenance.batch.pipeline_version], ['Source row number', data.provenance.source_row?.row_number], ['Row hash', data.provenance.source_row?.row_hash]]} />}</Card>
            <Card title="Original source row (verbatim)"><JsonView data={data.provenance.source_row?.raw} maxH={260} /></Card>
          </Stack>
        </Tabs.Panel>
      </Tabs>
      <Group mt="md"><Button component={Link} to="/drugs" variant="default" size="xs">Back to list</Button></Group>
    </>
  );
}
