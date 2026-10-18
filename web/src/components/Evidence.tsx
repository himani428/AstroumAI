import { Anchor, Badge, Box, Drawer, Group, Paper, Stack, Text } from '@mantine/core';
import { useState } from 'react';
import { KV } from './common';
import { BORDER, SURFACE } from '../theme';

const srcColor = (t: string) => (t === 'LOCAL_PROTOCOL' ? 'teal' : t === 'REGISTER' ? 'sage' : 'navy');

export function CitationChip({ c, onOpen }: { c: any; onOpen: (c: any) => void }) {
  const label = c.kind === 'REGISTER' ? `${c.notification_id} (${c.event_id})` : `${c.doc_code} v${c.version}${c.page ? ` p${c.page}` : ''} / ${c.section ?? ''}`;
  return <Badge component="button" onClick={() => onOpen(c)} color={c.kind === 'REGISTER' ? 'sage' : srcColor(c.source_type)} variant="light" size="sm" style={{ cursor: 'pointer', textTransform: 'none' }} aria-label={`Open evidence ${label}`}>{label}</Badge>;
}

export function ClaimList({ claims, onOpen }: { claims: any[]; onOpen: (c: any) => void }) {
  return (
    <Stack gap="xs">
      {claims.map((cl) => (
        <Box key={cl.id} pl="sm" style={{ borderLeft: '3px solid #7db5b0' }}>
          <Text size="sm">{cl.text}</Text>
          <Group gap={4} mt={4}>{cl.citations.map((c: any, i: number) => <CitationChip key={i} c={c} onOpen={onOpen} />)}</Group>
        </Box>
      ))}
    </Stack>
  );
}

export function useEvidenceDrawer() {
  const [open, setOpen] = useState<any | null>(null);
  const drawer = (
    <Drawer opened={!!open} onClose={() => setOpen(null)} position="right" size="md" title="Evidence" transitionProps={{ duration: 150 }}>
      {open && open.kind === 'CORPUS' && (
        <Stack gap="md">
          <Paper p="md" bg="#f1eee6" style={{ borderColor: BORDER }}><Text size="xs" c="dimmed" mb={4}>Excerpt as extracted (verbatim)</Text><Text size="sm" fw={500}>{open.excerpt}</Text></Paper>
          <KV rows={[['Source', <Badge key="s" color={srcColor(open.source_type)} variant="light" style={{ textTransform: 'none' }}>{open.source_label}</Badge>], ['Document', `${open.title}`], ['Code and version', `${open.doc_code} v${open.version}`], ['Effective / approved', open.effective_date], ['Edition status', open.doc_status], ['Page', open.page ?? 'n/a (Markdown source)'], ['Section', open.section], ['Anchor', open.anchor], ['Chunk id', open.chunk_id]]} />
        </Stack>
      )}
      {open && open.kind === 'REGISTER' && <KV rows={[['Source', open.source_label], ['Notification', open.notification_id], ['Event', open.event_id], ['Action', open.action], ['Published', open.date_published], ['Effective', open.effective_date], ['Target', open.target], ['Evaluated as of', open.as_of]]} />}
    </Drawer>
  );
  return { open: setOpen, drawer };
}

export const AnchorLike = Anchor;
export const SurfacePaper = ({ children }: { children: React.ReactNode }) => <Paper p="md" bg={SURFACE} style={{ borderColor: BORDER }}>{children}</Paper>;
