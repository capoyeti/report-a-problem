'use client';
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { ReportProblemPanel } from './ReportProblemPanel.js';
const ReportProblemContext = createContext({ open: () => { }, close: () => { }, isOpen: false, enabled: false });
/** Owns open/close state and mounts the panel once. `enabled` is whatever the consumer decides (flag, role, env). */
export function ReportProblemProvider({ enabled = true, endpoints, children }) {
    const [isOpen, setOpen] = useState(false);
    const open = useCallback(() => { if (enabled)
        setOpen(true); }, [enabled]);
    const close = useCallback(() => setOpen(false), []);
    const value = useMemo(() => ({ open, close, isOpen, enabled }), [open, close, isOpen, enabled]);
    return (_jsxs(ReportProblemContext.Provider, { value: value, children: [children, enabled ? _jsx(ReportProblemPanel, { open: isOpen, onClose: close, endpoints: endpoints }) : null] }));
}
export function useReportProblem() { return useContext(ReportProblemContext); }
