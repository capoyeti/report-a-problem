'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { ReportProblemPanel, type ReportProblemPanelProps } from './ReportProblemPanel.js';

interface Ctx { open: () => void; close: () => void; isOpen: boolean; enabled: boolean }

const ReportProblemContext = createContext<Ctx>({ open: () => {}, close: () => {}, isOpen: false, enabled: false });

export interface ReportProblemProviderProps {
  enabled?: boolean;
  endpoints?: ReportProblemPanelProps['endpoints'];
  availability?: ReportProblemPanelProps['availability'];
  children: ReactNode;
}

export function ReportProblemProvider({ enabled = true, endpoints, availability, children }: ReportProblemProviderProps) {
  const [isOpen, setOpen] = useState(false);
  const open = useCallback(() => { if (enabled) setOpen(true); }, [enabled]);
  const close = useCallback(() => setOpen(false), []);
  const value = useMemo(() => ({ open, close, isOpen, enabled }), [open, close, isOpen, enabled]);
  const panelAvailability = enabled ? availability : {
    ...availability,
    canSubmit: false,
    message: availability?.message ?? 'Reporting has been turned off for this workspace. Copy your description before closing.',
  };
  return (
    <ReportProblemContext.Provider value={value}>
      {children}
      {isOpen ? <ReportProblemPanel open onClose={close} endpoints={endpoints} availability={panelAvailability} /> : null}
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
