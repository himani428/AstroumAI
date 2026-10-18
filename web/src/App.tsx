import { AppShell, ActionIcon, Badge, Burger, Group, NavLink, Text, TextInput, Tooltip, ScrollArea, Box, UnstyledButton } from '@mantine/core';
import { useDisclosure, useLocalStorage } from '@mantine/hooks';
import { IconActivity, IconAlertHexagon, IconBook2, IconDatabase, IconGitBranch, IconHistory, IconLayoutDashboard, IconMenu2, IconPill, IconPillOff, IconScale, IconSearch, IconShieldCheck, IconStethoscope, IconTestPipe, IconBinaryTree2 } from '@tabler/icons-react';
import { useState, type ReactNode } from 'react';
import { Link, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useApi } from './api';
import { BORDER, PAGE_BG, SURFACE } from './theme';
import Dashboard from './pages/Dashboard';
import DrugMaster, { DrugDetail } from './pages/DrugMaster';
import Fdc from './pages/Fdc';
import ReviewQueue from './pages/ReviewQueue';
import Regulatory from './pages/Regulatory';
import Safety from './pages/Safety';
import Qa from './pages/Qa';
import Evaluation from './pages/Evaluation';
import Trace from './pages/Trace';
import DataPage from './pages/DataPage';
import AuditSettings from './pages/AuditSettings';
import SearchPage from './pages/SearchPage';

const NAV: { group: string; items: { to: string; label: string; icon: ReactNode }[] }[] = [
  { group: 'Overview', items: [{ to: '/', label: 'Dashboard', icon: <IconLayoutDashboard size={18} /> }, { to: '/search', label: 'Search', icon: <IconSearch size={18} /> }] },
  { group: 'Drug intelligence', items: [
    { to: '/drugs', label: 'India Drug Master', icon: <IconPill size={18} /> }, { to: '/fdc', label: 'FDC Explorer', icon: <IconBinaryTree2 size={18} /> },
    { to: '/review', label: 'Ambiguity Review', icon: <IconAlertHexagon size={18} /> }, { to: '/regulatory', label: 'Regulatory Register', icon: <IconScale size={18} /> } ] },
  { group: 'Clinical workspace', items: [
    { to: '/safety', label: 'Prescription Safety', icon: <IconShieldCheck size={18} /> }, { to: '/qa', label: 'Clinical Q&A', icon: <IconStethoscope size={18} /> },
    { to: '/trace', label: 'End-to-end Trace', icon: <IconGitBranch size={18} /> } ] },
  { group: 'Quality and operations', items: [
    { to: '/evaluation', label: 'Evaluation', icon: <IconTestPipe size={18} /> }, { to: '/data', label: 'Data and Ingestion', icon: <IconDatabase size={18} /> },
    { to: '/audit', label: 'Audit and Settings', icon: <IconHistory size={18} /> } ] },
];

function HealthPill() {
  const { data } = useApi<any>('/health');
  if (!data) return <Badge color="gray" variant="outline" size="sm">Checking</Badge>;
  const errs = data.degraded.filter((d: any) => d.severity === 'ERROR'), warns = data.degraded.filter((d: any) => d.severity === 'WARN');
  const label = errs.length ? `Degraded (${errs.length})` : warns.length ? `Attention (${warns.length})` : 'Operational';
  const tip = data.degraded.map((d: any) => `${d.severity}: ${d.component} - ${d.message}`).join('\n');
  return <Tooltip multiline w={360} label={<Text size="xs" style={{ whiteSpace: 'pre-line' }}>{tip}</Text>}><Link to="/audit" style={{ textDecoration: 'none' }}><Badge color={errs.length ? 'rust' : warns.length ? 'clay' : 'navy'} variant={errs.length ? 'filled' : 'light'} leftSection={<IconActivity size={12} />} size="sm">{label}</Badge></Link></Tooltip>;
}

export default function App() {
  const [mobileOpen, { toggle: toggleMobile, close: closeMobile }] = useDisclosure(false);
  const [collapsed, setCollapsed] = useLocalStorage({ key: 'brahmo-nav-collapsed', defaultValue: false });
  const [q, setQ] = useState('');
  const nav = useNavigate();
  const loc = useLocation();
  const width = collapsed ? 64 : 244;
  return (
    <AppShell header={{ height: 54 }} navbar={{ width, breakpoint: 'sm', collapsed: { mobile: !mobileOpen } }} padding="lg" styles={{ main: { background: PAGE_BG }, header: { background: SURFACE, borderColor: BORDER }, navbar: { background: SURFACE, borderColor: BORDER, transition: 'width 150ms ease' } }}>
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between" wrap="nowrap">
          <Group gap="sm" wrap="nowrap">
            <Burger opened={mobileOpen} onClick={toggleMobile} hiddenFrom="sm" size="sm" aria-label="Toggle navigation" />
            <ActionIcon variant="subtle" color="navy" visibleFrom="sm" onClick={() => setCollapsed(!collapsed)} aria-label="Collapse or expand sidebar"><IconMenu2 size={18} /></ActionIcon>
            <UnstyledButton component={Link} to="/"><Group gap={8} wrap="nowrap"><Box w={26} h={26} bg="navy.9" style={{ borderRadius: 6, display: 'grid', placeItems: 'center' }}><IconPillOff size={0} /><Text c="teal.3" fw={700} size="sm" lh={1}>B</Text></Box><Text fw={600} size="sm" visibleFrom="xs">BRAHMO AI</Text><Text size="xs" c="dimmed" visibleFrom="md">Clinical intelligence for Indian outpatient practice</Text></Group></UnstyledButton>
          </Group>
          <Group gap="sm" wrap="nowrap">
            <TextInput aria-label="Global search" placeholder="Search drugs, events, evidence" leftSection={<IconSearch size={14} />} size="xs" w={{ base: 130, sm: 260 }} value={q} onChange={(e) => setQ(e.currentTarget.value)} onKeyDown={(e) => { if (e.key === 'Enter' && q.trim().length >= 2) nav(`/search?q=${encodeURIComponent(q.trim())}`); }} />
            <HealthPill />
          </Group>
        </Group>
      </AppShell.Header>
      <AppShell.Navbar p="xs">
        <ScrollArea>
          {NAV.map((g) => (
            <Box key={g.group} mb="sm">
              {!collapsed && <Text size="xs" c="dimmed" tt="uppercase" fw={600} px="xs" mb={4} style={{ letterSpacing: 0.6 }}>{g.group}</Text>}
              {g.items.map((it) => {
                const active = it.to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(it.to);
                return (
                  <Tooltip key={it.to} label={it.label} position="right" disabled={!collapsed}>
                    <NavLink component={Link} to={it.to} label={collapsed ? undefined : it.label} leftSection={it.icon} active={active} onClick={closeMobile} color="navy" variant="light" style={{ borderRadius: 6 }} aria-label={it.label} aria-current={active ? 'page' : undefined} />
                  </Tooltip>
                );
              })}
            </Box>
          ))}
          {!collapsed && <Text size="xs" c="dimmed" px="xs" mt="md"><IconBook2 size={12} style={{ verticalAlign: -1 }} /> Assessment build. Decision support only; the doctor remains responsible for every prescription.</Text>}
        </ScrollArea>
      </AppShell.Navbar>
      <AppShell.Main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/drugs" element={<DrugMaster />} />
          <Route path="/drugs/:id" element={<DrugDetail />} />
          <Route path="/fdc" element={<Fdc />} />
          <Route path="/review" element={<ReviewQueue />} />
          <Route path="/regulatory" element={<Regulatory />} />
          <Route path="/safety" element={<Safety />} />
          <Route path="/qa" element={<Qa />} />
          <Route path="/trace" element={<Trace />} />
          <Route path="/evaluation" element={<Evaluation />} />
          <Route path="/data" element={<DataPage />} />
          <Route path="/audit" element={<AuditSettings />} />
          <Route path="*" element={<Text>Page not found. <Link to="/">Back to dashboard</Link></Text>} />
        </Routes>
      </AppShell.Main>
    </AppShell>
  );
}
