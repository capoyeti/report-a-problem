'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { ReportProblemPanel, type ReportProblemPanelProps } from './ReportProblemPanel.js';

interface Ctx { open: () => void; close: () => void; isOpen: boolean; enabled: boolean }

const ReportProblemContext = createContext<Ctx>({ open: () => {}, close: () => {}, isOpen: false, enabled: false });

/** Owns open/close state and mounts the panel once. `enabled` is whatever the consumer decides (flag, role, env). */
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

export function useReportProblem(): Ctx { return useContext(ReportProblemContext); }
