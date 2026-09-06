'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { ReportProblemPanel, type ReportProblemPanelProps } from './ReportProblemPanel.js';

interface Ctx { open: () => void; close: () => void; isOpen: boolean; enabled: boolean }

const ReportProblemContext = createContext<Ctx>({ open: () => {}, close: () => {}, isOpen: false, enabled: false });

/**
 * Owns the open/close state and mounts the panel exactly once, so a trigger
 * anywhere in the tree is a hook call rather than another copy of the same forty
 * lines of state. `enabled` is whatever the consumer decides (a flag, a role, an
 * environment check); when false the panel is not rendered at all, so its
 * html2canvas import never loads.
 */
export function ReportProblemProvider({ enabled = true, endpoints, children }: { enabled?: boolean; endpoints?: ReportProblemPanelProps['endpoints']; children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const open = useCallback(() => { if (enabled) setOpen(true); }, [enabled]);
  const close = useCallback(() => setOpen(false), []);
  const value = useMemo(() => ({ open, close, isOpen, enabled }), [open, close, isOpen, enabled]);
  return (
    <ReportProblemContext.Provider value={value}>
      {children}
      {enabled ? <ReportProblemPanel open={isOpen} onClose={close} endpoints={endpoints} /> : null}
    </ReportProblemContext.Provider>
  );
}

/**
 * Reads the panel controls from context. Outside a provider it returns an inert
 * context with `enabled: false` rather than throwing, so a shared header
 * component carrying a "Report a problem" item can render in an app that has not
 * adopted the package.
 */
export function useReportProblem(): Ctx { return useContext(ReportProblemContext); }
