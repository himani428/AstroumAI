import { Alert, Badge, Box, Group, List, Paper, SimpleGrid, Stack, Table, Text } from '@mantine/core';
import { IconShieldQuestion } from '@tabler/icons-react';
import { Link } from 'react-router-dom';
import { BORDER, SURFACE } from '../theme';
import { Expand, JsonView, ReasonBadges, SeverityBadge, StatusBadge } from './common';

const GROUPS: { title: string; hint: string; statuses: string[] }[] = [
  { title: 'Findings', hint: 'A rule matched. Review before proceeding.', statuses: ['HIT'] },
  { title: 'Incomplete, unverified or unavailable', hint: 'The check could not give a complete answer. This is NOT a clean result.', statuses: ['PARTIAL_COVERAGE', 'UNVERIFIED_INPUT', 'DATA_EXPIRED', 'SOURCE_CONFLICT', 'SERVICE_UNAVAILABLE', 'NOT_CHECKED'] },
  { title: 'Checked, no finding in stated scope', hint: 'The check ran with the coverage described. Not a clinical clearance.', statuses: ['CHECKED_NO_HIT'] },
];

function ExposureTable({ ev }: { ev: any }) {
  return (
    <Box>
      <Text size="sm" fw={600}>{ev.ingredient}</Text>
      <Table withTableBorder fz="xs" mt={4}>
        <Table.Thead><Table.Tr><Table.Th>Line</Table.Th><Table.Th>Product</Table.Th><Table.Th>Per unit</Table.Th><Table.Th>Frequency</Table.Th><Table.Th>Units/day</Table.Th><Table.Th>Daily (mg)</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {ev.contributing_lines.map((l: any) => (
            <Table.Tr key={l.line_no}>
              <Table.Td>#{l.line_no}</Table.Td><Table.Td>{l.brand} <Text span c="dimmed" size="xs">({l.dose_form})</Text></Table.Td><Table.Td>{l.strength_per_unit}</Table.Td><Table.Td>{l.frequency_raw || <Text span c="dimmed">none given</Text>}</Table.Td>
              <Table.Td>{l.units_per_day ?? '?'}</Table.Td>
              <Table.Td>{l.daily_mg ?? <Text span c="clay.7" size="xs">unknown: {l.reasons.join('; ')}</Text>}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Text size="xs" mt={4}><b>Aggregate:</b> {ev.aggregate.is_lower_bound ? 'at least ' : ''}{ev.aggregate.total_daily_mg} mg/day ({ev.aggregate.complete ? 'complete' : 'INCOMPLETE'}). {ev.reference_ceiling ? <>Cited reference ceiling {ev.reference_ceiling.value} {ev.reference_ceiling.unit}/day: {ev.reference_ceiling.exceeded ? <b>exceeded</b> : 'not exceeded'}. <Text span c="dimmed" size="xs">{ev.reference_ceiling.context}</Text></> : <Text span c="dimmed" size="xs">No sourced reference ceiling available.</Text>}</Text>
    </Box>
  );
}

function CheckCard({ c }: { c: any }) {
  const hit = c.status === 'HIT';
  const border = hit ? '#c8402f' : c.status === 'CHECKED_NO_HIT' ? BORDER : '#d97c45';
  const exposure = c.evidence.filter((e: any) => e?.contributing_lines);
  return (
    <Paper p="md" bg={SURFACE} style={{ borderLeft: `4px solid ${border}`, borderColor: BORDER, borderLeftColor: border }} role="group" aria-label={`${c.check_type} ${c.status}`}>
      <Group justify="space-between" mb={6} wrap="wrap">
        <Group gap="xs"><Text fw={600} size="sm">{c.check_type.replaceAll('_', ' ')}</Text><StatusBadge status={c.status} /><SeverityBadge severity={c.severity} /></Group>
        <Text size="xs" c="dimmed">{c.rule_id} / {c.rule_version} / {c.data_version}</Text>
      </Group>
      <Text size="sm">{c.explanation}</Text>
      {c.affected_products.length > 0 && <Text size="xs" c="dimmed" mt={6}>Products: {c.affected_products.map((p: any) => `#${p.line_no} ${p.brand_name}`).join(', ')}{c.affected_ingredients.length ? ` / Ingredients: ${c.affected_ingredients.join(', ')}` : ''}</Text>}
      {exposure.length > 0 && <Stack gap="sm" mt="sm">{exposure.map((e: any) => <ExposureTable key={e.ingredient} ev={e} />)}</Stack>}
      {c.unresolved_inputs.length > 0 && (
        <Alert mt="sm" color="clay" variant="light" icon={<IconShieldQuestion size={16} />} title="Unresolved input, not examined">
          <List size="xs" spacing={2}>
            {c.unresolved_inputs.map((u: any) => <List.Item key={u.line_no}>#{u.line_no} "{u.written_product}" {u.status}: <ReasonBadges codes={u.reason_codes} /> {u.queue_id && <Link to={`/review?id=${u.queue_id}`}>review item {u.queue_id}</Link>}</List.Item>)}
          </List>
        </Alert>
      )}
      {c.limitations.length > 0 && <Expand label={`Limitations (${c.limitations.length})`} defaultOpen={c.status !== 'CHECKED_NO_HIT' && c.status !== 'HIT'}><List size="xs" spacing={2}>{[...new Set<string>(c.limitations)].map((l, i) => <List.Item key={i}>{l}</List.Item>)}</List></Expand>}
      <Expand label="Evidence and provenance"><Stack gap="xs"><JsonView data={c.evidence.filter((e: any) => !e?.contributing_lines)} maxH={260} />
        <Text size="xs" fw={600}>Source references</Text>
        <Table fz="xs" withTableBorder><Table.Tbody>{c.source_references.slice(0, 40).map((s: any, i: number) => <Table.Tr key={i}><Table.Td>{s.dataset}</Table.Td><Table.Td>{s.ref}</Table.Td><Table.Td>{s.version ?? ''}</Table.Td><Table.Td>{s.batch_id ? `batch ${s.batch_id}` : ''}{s.source_row_id ? ` / row ${s.source_row_id}` : ''}</Table.Td><Table.Td>{s.detail ?? ''}</Table.Td></Table.Tr>)}</Table.Tbody></Table></Stack></Expand>
      <Text size="xs" c="dimmed" mt={4}>Executed {c.executed_at} / depends on: {c.data_dependencies.join(', ') || 'none'}</Text>
    </Paper>
  );
}

export function SafetyReport({ report }: { report: any }) {
  return (
    <Stack gap="md">
      <Alert color="navy" variant="light" title="What this report does and does not say">
        <Text size="sm">{report.summary.statement}</Text>
        <Text size="xs" c="dimmed" mt={4}>Rule version {report.rule_version} / data {report.data_version} / evaluated as of {report.as_of} / LLM used in safety path: <b>{String(report.llm_used_in_safety_path)}</b></Text>
      </Alert>
      <SimpleGrid cols={{ base: 2, sm: 4 }} spacing="xs">
        {report.checks.map((c: any) => <Paper key={c.check_type} p="xs" bg={SURFACE} style={{ borderColor: BORDER }}><Text size="xs" c="dimmed">{c.check_type.replaceAll('_', ' ')}</Text><Box mt={4}><StatusBadge status={c.status} size="xs" /></Box></Paper>)}
      </SimpleGrid>
      <Paper p="md" bg={SURFACE} style={{ borderColor: BORDER }}>
        <Text fw={600} size="sm" mb="xs">Draft lines and how each was understood</Text>
        <Table fz="xs"><Table.Thead><Table.Tr><Table.Th>#</Table.Th><Table.Th>As written</Table.Th><Table.Th>Resolution</Table.Th><Table.Th>Resolved product and ingredients</Table.Th></Table.Tr></Table.Thead>
          <Table.Tbody>{report.lines.map((l: any) => (
            <Table.Tr key={l.line_no}>
              <Table.Td>{l.line_no}</Table.Td>
              <Table.Td>{l.written_product} {l.strength_as_written} <Text span c="dimmed">{l.dose_frequency}</Text></Table.Td>
              <Table.Td><Badge size="xs" color={l.resolution.status === 'RESOLVED' ? 'navy' : 'clay'} variant={l.resolution.status === 'RESOLVED' ? 'outline' : 'filled'}>{l.resolution.status}</Badge> <Text span size="xs" c="dimmed">{l.resolution.method} {Math.round(l.resolution.confidence * 100)}%</Text>
                {l.resolution.reason_codes.length > 0 && <Box mt={2}><ReasonBadges codes={l.resolution.reason_codes} /></Box>}
                {l.resolution.warnings.map((w: string) => <Text key={w} size="xs" c="clay.8">{w}</Text>)}</Table.Td>
              <Table.Td>{l.product_id ? <><Link to={`/drugs/${l.product_id}`}>{l.resolved_brand}</Link> <Text span c="dimmed">{l.ingredients.map((i: any) => `${i.name} ${i.strength}`).join(' + ')}</Text></> : <Text size="xs" c="dimmed">{l.resolution.candidates.length ? `${l.resolution.candidates.length} candidate(s) in review queue (not auto-selected)` : 'no candidate'}</Text>}</Table.Td>
            </Table.Tr>))}</Table.Tbody></Table>
      </Paper>
      {GROUPS.map((g) => {
        const items = report.checks.filter((c: any) => g.statuses.includes(c.status));
        if (!items.length) return null;
        return <Box key={g.title}><Text fw={600} size="sm">{g.title}</Text><Text size="xs" c="dimmed" mb="xs">{g.hint}</Text><Stack gap="sm">{items.map((c: any) => <CheckCard key={c.check_type} c={c} />)}</Stack></Box>;
      })}
    </Stack>
  );
}
