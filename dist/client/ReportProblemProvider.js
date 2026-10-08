'use client';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { ReportProblemPanel } from './ReportProblemPanel.js';
const ReportProblemContext = createContext({ open: () => { }, close: () => { }, isOpen: false, enabled: false });
export function ReportProblemProvider({ enabled = true, endpoints, availability, children }) {
    const [isOpen, setOpen] = useState(false);
    const open = useCallback(() => { if (enabled)
        setOpen(true); }, [enabled]);
    const close = useCallback(() => setOpen(false), []);
    const value = useMemo(() => ({ open, close, isOpen, enabled }), [open, close, isOpen, enabled]);
    const panelAvailability = enabled ? availability : {
        ...availability,
        canSubmit: false,
        message: availability?.message ?? 'Reporting has been turned off for this workspace. Copy your description before closing.',
    };
    return (_jsxs(ReportProblemContext.Provider, { value: value, children: [children, isOpen ? _jsx(ReportProblemPanel, { open: true, onClose: close, endpoints: endpoints, availability: panelAvailability }) : null] }));
}
/**
 * Reads the panel controls from context. Outside a provider it returns an inert
 * context with `enabled: false` rather than throwing, so a shared header
 * component carrying a "Report a problem" item can render in an app that has not
 * adopted the package.
 */
export function useReportProblem() { return useContext(ReportProblemContext); }
