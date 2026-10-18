import { Alert, Badge, Box, Button, Code, Collapse, Group, Paper, ScrollArea, Skeleton, Stack, Text, Title, Anchor, Breadcrumbs } from '@mantine/core';
import { IconAlertTriangle, IconChevronDown, IconChevronRight, IconInbox } from '@tabler/icons-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { ApiError } from '../api';
import { BORDER, SEVERITY_COLOR, STATUS_STYLE, SURFACE } from '../theme';

export function PageHeader({ title, subtitle, actions, crumbs }: { title: string; subtitle?: ReactNode; actions?: ReactNode; crumbs?: { label: string; to?: string }[] }) {
  return (
    <Box mb="lg">
      {crumbs && (
        <Breadcrumbs mb={6} separator="/" styles={{ breadcrumb: { fontSize: 12 } }}>
          {crumbs.map((c) => (c.to ? <Anchor key={c.label} component={Link} to={c.to} size="xs">{c.label}</Anchor> : <Text key={c.label} size="xs" c="dimmed">{c.label}</Text>))}
        </Breadcrumbs>
      )}
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <Box maw={820}>
          <Title order={2} size="h3">{title}</Title>
          {subtitle && <Text size="sm" c="dimmed" mt={4}>{subtitle}</Text>}
        </Box>
        {actions && <Group gap="xs">{actions}</Group>}
      </Group>
    </Box>
  );
}

export function StatusBadge({ status, size = 'sm' }: { status: string; size?: 'xs' | 'sm' | 'md' }) {
  const s = STATUS_STYLE[status] ?? { color: 'gray', variant: 'light' as const, label: status };
  return <Badge color={s.color} variant={s.variant} size={size} radius="sm" styles={{ root: { letterSpacing: 0.3 } }}>{s.label}</Badge>;
}
export const RLink = ({ to, children }: { to: string; children: ReactNode }) => <Anchor component={Link} to={to} size="sm" c="teal.8" underline="hover">{children}</Anchor>;
export const SeverityBadge = ({ severity }: { severity: string }) => <Badge color={SEVERITY_COLOR[severity] ?? 'gray'} variant="dot" size="sm">{severity}</Badge>;

export function Card({ title, children, right, pad = 'md', mb }: { title?: ReactNode; children: ReactNode; right?: ReactNode; pad?: string; mb?: string }) {
  return (
    <Paper p={pad} bg={SURFACE} style={{ borderColor: BORDER }} mb={mb}>
      {(title || right) && (
        <Group justify="space-between" mb="sm">
          {title && <Text fw={600} size="sm">{title}</Text>}
          {right}
        </Group>
      )}
      {children}
    </Paper>
  );
}

export function Stat({ label, value, hint, color }: { label: string; value: ReactNode; hint?: ReactNode; color?: string }) {
  return (
    <Paper p="md" bg={SURFACE} style={{ borderColor: BORDER }}>
      <Text size="xs" c="dimmed" tt="uppercase" fw={600} style={{ letterSpacing: 0.5 }}>{label}</Text>
      <Text fz={26} fw={600} c={color} lh={1.2} mt={4}>{value}</Text>
      {hint && <Text size="xs" c="dimmed" mt={2}>{hint}</Text>}
    </Paper>
  );
}

export function ErrorState({ error, onRetry }: { error: ApiError | Error; onRetry?: () => void }) {
  return (
    <Alert color="rust" icon={<IconAlertTriangle size={18} />} title="Request failed">
      <Text size="sm">{error.message}</Text>
      {onRetry && <Button mt="xs" size="xs" variant="light" color="rust" onClick={onRetry}>Retry</Button>}
    </Alert>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <Stack align="center" py="xl" gap={4}>
      <IconInbox size={28} color="#8c9bb0" />
      <Text fw={500} size="sm">{title}</Text>
      {hint && <Text size="xs" c="dimmed" ta="center" maw={420}>{hint}</Text>}
    </Stack>
  );
}

export function Loading({ rows = 4 }: { rows?: number }) {
  return <Stack gap="xs">{Array.from({ length: rows }).map((_, i) => <Skeleton key={i} h={22} />)}</Stack>;
}

export function Expand({ label, children, defaultOpen = false }: { label: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Box>
      <Button variant="subtle" size="compact-xs" color="navy" onClick={() => setOpen(!open)} leftSection={open ? <IconChevronDown size={14} /> : <IconChevronRight size={14} />} aria-expanded={open}>{label}</Button>
      <Collapse expanded={open}><Box mt={6}>{children}</Box></Collapse>
    </Box>
  );
}

export function JsonView({ data, maxH = 420 }: { data: unknown; maxH?: number }) {
  return (
    <ScrollArea.Autosize mah={maxH} type="auto">
      <Code block style={{ fontSize: 11.5, background: '#f1eee6' }}>{JSON.stringify(data, null, 2)}</Code>
    </ScrollArea.Autosize>
  );
}

export function KV({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <Stack gap={4}>
      {rows.map(([k, v]) => (
        <Group key={k} gap="sm" wrap="nowrap" align="flex-start">
          <Text size="xs" c="dimmed" w={150} style={{ flexShrink: 0 }}>{k}</Text>
          <Text size="sm" style={{ wordBreak: 'break-word' }}>{v ?? '-'}</Text>
        </Group>
      ))}
    </Stack>
  );
}

export const ReasonBadges = ({ codes }: { codes: string[] }) => (
  <Group gap={4}>{codes.map((c) => <Badge key={c} size="xs" color="clay" variant="light" style={{ textTransform: 'none' }}>{c}</Badge>)}</Group>
);

export const DemoLabel = ({ children = 'Synthetic demonstration data' }: { children?: ReactNode }) => <Badge color="gray" variant="outline" size="sm">{children}</Badge>;
