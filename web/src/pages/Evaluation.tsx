import { Alert, Badge, Button, SimpleGrid, Table, Text, Stack, Box } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconPlayerPlay } from '@tabler/icons-react';
import { useState } from 'react';
import { api, download, useApi } from '../api';
import { Card, ErrorState, Expand, Loading, PageHeader, Stat } from '../components/common';
import { AnswerView } from './Qa';
import { useEvidenceDrawer } from '../components/Evidence';

const oc: Record<string, string> = { CORRECT: 'navy', CORRECTLY_ABSTAINED: 'teal', WRONG: 'rust' };

export default function Evaluation() {
  const { data, error, loading, reload } = useApi<any>('/eval/runs/latest');
  const runs = useApi<any>('/eval/runs');
  const [busy, setBusy] = useState(false);
  const ev = useEvidenceDrawer();
  const rerun = async () => { setBusy(true); try { const r = await api('/eval/run', { method: 'POST' }); notifications.show({ color: 'navy', title: 'Evaluation complete', message: `Core: ${r.core_totals.correct} correct, ${r.core_totals.correctly_abstained} abstained, ${r.core_totals.wrong} wrong` }); reload(); runs.reload(); } catch (e) { notifications.show({ color: 'rust', title: 'Evaluation failed', message: (e as Error).message }); } finally { setBusy(false); } };
  return (
    <>
      <PageHeader title="Module B evaluation" subtitle="All 11 sample questions plus supplementary robustness cases, run through the same pipeline the Q&A page uses. Rerun after any change." actions={<><Button leftSection={<IconPlayerPlay size={14} />} loading={busy} onClick={rerun}>Run evaluation</Button>{data && <Button variant="default" onClick={() => download('evaluation-latest.json', data)}>Export JSON</Button>}</>} />
      {error && <ErrorState error={error} onRetry={reload} />}
      {loading && !data && <Loading rows={8} />}
      {data && <>
        <Alert color="clay" variant="light" mb="md" title="Read this before quoting a number">{data.disclaimer}</Alert>
        <SimpleGrid cols={{ base: 2, md: 4 }} spacing="sm" mb="md">
          <Stat label="Core correct" value={data.core_totals.correct} hint={`of ${data.core_totals.total} sample questions`} />
          <Stat label="Core correctly abstained" value={data.core_totals.correctly_abstained} />
          <Stat label="Core wrong" value={data.core_totals.wrong} color={data.core_totals.wrong ? 'rust.6' : undefined} />
          <Stat label="All cases" value={`${data.totals.correct + data.totals.correctly_abstained}/${data.totals.total}`} hint="incl. supplementary" />
        </SimpleGrid>
        <Card pad="xs">
          <Table.ScrollContainer minWidth={760}><Table fz="sm"><Table.Thead><Table.Tr><Table.Th>ID</Table.Th><Table.Th>Question</Table.Th><Table.Th>Expected</Table.Th><Table.Th>Outcome</Table.Th><Table.Th>Explanation</Table.Th></Table.Tr></Table.Thead>
            <Table.Tbody>{data.results.map((r: any) => (
              <Table.Tr key={r.id}>
                <Table.Td><Text size="sm" fw={600}>{r.id}</Text><Badge size="xs" variant="outline" color="gray">{r.set}</Badge></Table.Td>
                <Table.Td maw={330}><Text size="sm">{r.question}</Text></Table.Td><Table.Td>{r.expected}</Table.Td>
                <Table.Td><Badge color={oc[r.outcome]} variant={r.outcome === 'WRONG' ? 'filled' : 'light'}>{r.outcome.replace('_', ' ')}</Badge></Table.Td>
                <Table.Td maw={440}><Text size="xs">{r.explanation}</Text>
                  <Expand label={`Checks (${r.checks.filter((c: any) => c.pass).length}/${r.checks.length} passed) and actual response`}><Stack gap="xs">
                    {r.checks.map((c: any, i: number) => <Text key={i} size="xs" c={c.pass ? undefined : 'rust.7'}>{c.pass ? 'PASS' : 'FAIL'}: {c.name}{c.detail ? ` (${c.detail})` : ''}</Text>)}
                    <Box><AnswerView a={r.response} onOpen={ev.open} /></Box></Stack></Expand></Table.Td>
              </Table.Tr>))}</Table.Tbody></Table></Table.ScrollContainer>
        </Card>
        <Text size="xs" c="dimmed" mt="sm">Run {data.created_at}. Versions: {Object.entries(data.versions).map(([k, v]) => `${k} ${v}`).join(', ')}. History: {(runs.data?.items ?? []).length} stored run(s).</Text>
      </>}
      {ev.drawer}
    </>
  );
}
