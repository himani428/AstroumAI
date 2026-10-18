import { Alert, Badge, Box, Button, Group, SimpleGrid, Stack, Text, Textarea, List, Chip } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconSearch } from '@tabler/icons-react';
import { useState } from 'react';
import { api, useApi } from '../api';
import { Card, ErrorState, Expand, JsonView, Loading, PageHeader, RLink } from '../components/common';
import { ClaimList, useEvidenceDrawer } from '../components/Evidence';

export function AnswerView({ a, onOpen }: { a: any; onOpen: (c: any) => void }) {
  return (
    <Stack gap="md">
      <Group gap="xs"><Badge color={a.outcome === 'ABSTAINED' ? 'clay' : a.outcome === 'PARTIAL' ? 'orange' : 'navy'} variant={a.outcome === 'ABSTAINED' ? 'filled' : 'light'}>{a.outcome}</Badge>{a.intent.map((i: string) => <Badge key={i} variant="outline" color="gray" size="xs">{i}</Badge>)}
        <Badge size="xs" color={a.guard.passed ? 'navy' : 'rust'} variant="outline">numbers grounded: {String(a.guard.passed)} ({a.guard.numeric_tokens_checked} checked)</Badge></Group>
      {a.notes.map((n: string) => <Alert key={n} color="navy" variant="light" p="xs">{n}</Alert>)}
      {a.blocks.map((b: any) => (
        <Card key={b.block_id} title={<Group gap="xs"><Badge color={b.source_type === 'LOCAL_PROTOCOL' ? 'teal' : b.source_type === 'REGISTER' ? 'sage' : 'navy'} variant="filled" size="sm">{b.source_type === 'LOCAL_PROTOCOL' ? 'CLINIC PROTOCOL' : b.source_type === 'REGISTER' ? 'REGISTER' : 'NATIONAL STW'}</Badge><Text size="sm" fw={600}>{b.label}</Text></Group>}>
          <Text size="xs" c="dimmed" mb="xs">{b.source_label}</Text>
          {b.status === 'ANSWERED' ? <ClaimList claims={b.claims} onOpen={onOpen} /> : (
            <Alert color="clay" variant="light" title={`Abstained: ${b.abstention.reason_code}`}>
              <Text size="sm">{b.abstention.explanation}</Text>
              <Text size="xs" fw={600} mt="xs">What evidence is missing</Text><List size="xs">{b.abstention.missing_evidence.map((m: string) => <List.Item key={m}>{m}</List.Item>)}</List>
              {b.abstention.nearest_sources.length > 0 && <><Text size="xs" fw={600} mt="xs">Nearest documents (not used for any claim)</Text><List size="xs">{b.abstention.nearest_sources.map((n: any) => <List.Item key={n.doc_code + n.version}>{n.doc_code} v{n.version}: {n.title}</List.Item>)}</List></>}
            </Alert>)}
        </Card>))}
      {a.conflicts.map((c: any) => (
        <Card key={c.topic} title={`Conflicting editions: ${c.topic}`}>
          <Alert color="orange" variant="light" mb="sm" p="xs">{c.note}</Alert>
          <SimpleGrid cols={{ base: 1, md: c.versions.length }} spacing="md">{c.versions.map((v: any) => (
            <Box key={v.version} p="sm" style={{ border: '1px solid #e4dfd3', borderRadius: 6, background: v.doc_status === 'CURRENT' ? '#fffefb' : '#f7f2ea' }}>
              <Group gap="xs" mb={4}><Text size="sm" fw={600}>{v.doc_code} v{v.version}</Text><Badge size="xs" color={v.doc_status === 'CURRENT' ? 'navy' : 'orange'}>{v.doc_status}</Badge></Group>
              <Text size="xs" c="dimmed" mb="xs">Effective {v.effective_date}</Text><ClaimList claims={v.claims} onOpen={onOpen} /></Box>))}</SimpleGrid>
        </Card>))}
      <Expand label="Retrieval metadata and composer"><Stack gap="xs"><Text size="xs">Composer: {a.composer.mode} (provider {a.composer.provider}). Retrieval {a.versions.retrieval}, answerer {a.versions.answerer}.</Text><JsonView data={a.retrieval} maxH={300} /></Stack></Expand>
    </Stack>
  );
}

export default function Qa() {
  const samples = useApi<any>('/eval/runs/latest');
  const llm = useApi<any>('/settings/llm');
  const [q, setQ] = useState(''); const [a, setA] = useState<any>(null); const [busy, setBusy] = useState(false); const [err, setErr] = useState<Error | null>(null);
  const ev = useEvidenceDrawer();
  const ask = async (text = q) => { if (text.trim().length < 3) return; setBusy(true); setErr(null); try { setA(await api('/qa/ask', { method: 'POST', body: { question: text } })); } catch (e) { setErr(e as Error); setA(null); notifications.show({ color: 'rust', title: 'Question failed', message: (e as Error).message }); } finally { setBusy(false); } };
  const core = (samples.data?.results ?? []).filter((r: any) => r.set === 'core');
  return (
    <>
      <PageHeader title="Grounded clinical Q&A" subtitle="Answers are quoted from the supplied STW pack and the clinic protocol only, with a citation on every claim. When the corpus cannot support an answer the system abstains and says what is missing." />
      <Card mb="md">
        <Textarea label="Clinical question" placeholder="e.g. Which analgesic class must be avoided in suspected dengue, and why?" value={q} onChange={(e) => setQ(e.currentTarget.value)} autosize minRows={2} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) ask(); }} />
        <Group mt="sm" justify="space-between"><Text size="xs" c="dimmed">Ctrl+Enter to ask. No dose is ever calculated for an individual patient. Wording: {llm.data?.configured ? `LLM-verified (${llm.data.model})` : "verbatim extractive"}. <RLink to="/audit">Set an Anthropic API key</RLink></Text><Button leftSection={<IconSearch size={14} />} loading={busy} onClick={() => ask()}>Ask</Button></Group>
        {core.length > 0 && <Box mt="sm"><Text size="xs" c="dimmed" mb={4}>The 11 assessment questions</Text><Group gap={6}>{core.map((r: any) => <Chip key={r.id} size="xs" checked={false} onChange={() => { setQ(r.question); ask(r.question); }}>{r.id}</Chip>)}</Group></Box>}
      </Card>
      {err && <ErrorState error={err} />}
      {busy && <Loading rows={5} />}
      {a && !busy && <AnswerView a={a} onOpen={ev.open} />}
      {ev.drawer}
    </>
  );
}
