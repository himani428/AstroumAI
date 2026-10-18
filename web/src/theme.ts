import { createTheme, type MantineColorsTuple } from '@mantine/core';

const navy: MantineColorsTuple = ['#eef1f5', '#d9dfe7', '#b4bfcd', '#8c9bb0', '#6b7d96', '#546883', '#435974', '#34495f', '#2a3b4f', '#1f2d3d'];
const teal: MantineColorsTuple = ['#eaf4f3', '#d3e7e5', '#a9cfcb', '#7db5b0', '#59a09a', '#3f918a', '#2f7d7a', '#276a67', '#1f5654', '#164240'];
const sage: MantineColorsTuple = ['#f1f4ee', '#e1e8da', '#c6d3b9', '#a9bd98', '#92ab7e', '#82a06b', '#6f8c59', '#5c7449', '#4a5e3a', '#38482c'];
const clay: MantineColorsTuple = ['#fbf1ea', '#f4ddcd', '#ebbb9c', '#e1976a', '#d97c45', '#d46a2c', '#c35f22', '#a95119', '#8e4313', '#74360e'];
const rust: MantineColorsTuple = ['#fbeeed', '#f4d6d3', '#e8aaa4', '#dc7d74', '#d1574b', '#c8402f', '#b43526', '#9a2c1f', '#802418', '#661c12'];

export const theme = createTheme({
  primaryColor: 'navy', primaryShade: 9,
  colors: { navy, teal, sage, clay, rust },
  fontFamily: '"Inter", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif',
  fontFamilyMonospace: 'ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace',
  headings: { fontFamily: '"Inter", "Segoe UI", system-ui, sans-serif', fontWeight: '600' },
  defaultRadius: 'sm', respectReducedMotion: true, cursorType: 'pointer',
  black: '#1b2430', white: '#ffffff',
  components: {
    Button: { defaultProps: { size: 'sm' } },
    Badge: { defaultProps: { radius: 'sm', variant: 'light' } },
    Paper: { defaultProps: { radius: 'sm', withBorder: true } },
    Table: { defaultProps: { verticalSpacing: 6, horizontalSpacing: 'sm', highlightOnHover: true } },
  },
});

export const PAGE_BG = '#f7f5f0';
export const SURFACE = '#fffefb';
export const BORDER = '#e4dfd3';

/** Status colours are semantic. Green is never used for CHECKED_NO_HIT because "no hit" is not "safe". */
export const STATUS_STYLE: Record<string, { color: string; variant: 'filled' | 'light' | 'outline'; label: string }> = {
  HIT: { color: 'rust', variant: 'filled', label: 'HIT' },
  CHECKED_NO_HIT: { color: 'navy', variant: 'outline', label: 'CHECKED, NO HIT' },
  PARTIAL_COVERAGE: { color: 'clay', variant: 'light', label: 'PARTIAL COVERAGE' },
  UNVERIFIED_INPUT: { color: 'clay', variant: 'filled', label: 'UNVERIFIED INPUT' },
  NOT_CHECKED: { color: 'gray', variant: 'light', label: 'NOT CHECKED' },
  DATA_EXPIRED: { color: 'orange', variant: 'light', label: 'DATA EXPIRED' },
  SOURCE_CONFLICT: { color: 'grape', variant: 'light', label: 'SOURCE CONFLICT' },
  SERVICE_UNAVAILABLE: { color: 'dark', variant: 'filled', label: 'SERVICE UNAVAILABLE' },
};
export const SEVERITY_COLOR: Record<string, string> = { CRITICAL: 'rust', HIGH: 'rust', MODERATE: 'clay', LOW: 'yellow', INFO: 'gray', NONE: 'gray' };
